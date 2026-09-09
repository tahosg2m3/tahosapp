import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MessageSquare, Plus, Search, Send, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';
import {
  createForumPost,
  createForumReply,
  createForumTag,
  listForumPosts,
  listForumReplies,
  listForumTags,
  listChannelPermissions,
} from '../../services/platformApi';
import { formatTime } from '../../utils/formatTime';

const inputClass = 'w-full rounded-xl border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-[#e2e8f0] outline-none focus:border-[#3b82f6] placeholder:text-[#64748b]';
function unwrap(payload, key) { return Array.isArray(payload) ? payload : payload?.[key] || payload?.items || []; }

export default function ForumArea() {
  const { currentChannel, currentServer } = useServer();
  const { socket } = useSocket();
  const channelId = currentChannel?.id;
  const [posts, setPosts] = useState([]);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [replies, setReplies] = useState([]);
  const [postForm, setPostForm] = useState({ title: '', content: '', tagIds: [] });
  const [reply, setReply] = useState('');
  const [newTag, setNewTag] = useState('');
  const [canManageChannel, setCanManageChannel] = useState(false);
  const [canSendMessages, setCanSendMessages] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) return;
    try {
      const [postPayload, tagPayload, permissionPayload] = await Promise.all([listForumPosts(channelId), listForumTags(channelId), listChannelPermissions(channelId)]);
      const nextPosts = unwrap(postPayload, 'posts');
      setPosts(nextPosts);
      setSelectedPost(current => current ? nextPosts.find(post => String(post.id) === String(current.id)) || null : null);
      setTags(unwrap(tagPayload, 'tags'));
      const effective = permissionPayload.effectivePermissions || [];
      setCanManageChannel(effective.includes('ADMINISTRATOR') || effective.includes('MANAGE_CHANNELS'));
      setCanSendMessages(effective.includes('ADMINISTRATOR') || effective.includes('SEND_MESSAGES'));
    } catch (error) { toast.error(error.message); }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSelectedPost(null);
    setReplies([]);
    setShowComposer(false);
    setReply('');
  }, [channelId]);
  useEffect(() => {
    if (!canSendMessages) setShowComposer(false);
  }, [canSendMessages]);
  useEffect(() => {
    if (!socket) return undefined;
    const update = payload => {
      if (String(payload?.serverId || '') !== String(currentServer?.id || '')) return;
      if (!['forum-posts', 'forum-tags', 'channel-permissions'].includes(payload?.scope)) return;
      load();
      if (payload.scope === 'forum-posts' && selectedPost?.id && String(payload?.data?.postId || payload?.data?.id || '') === String(selectedPost.id)) {
        listForumReplies(channelId, selectedPost.id)
          .then(result => setReplies(unwrap(result, 'replies')))
          .catch(() => {});
      }
    };
    const permissionsChanged = payload => {
      if (String(payload?.channelId || '') === String(channelId)) load();
    };
    socket.on('platform:update', update);
    socket.on('channel:permissions-changed', permissionsChanged);
    return () => {
      socket.off('platform:update', update);
      socket.off('channel:permissions-changed', permissionsChanged);
    };
  }, [channelId, currentServer?.id, load, selectedPost?.id, socket]);

  const openPost = async post => {
    setSelectedPost(post);
    try { setReplies(unwrap(await listForumReplies(channelId, post.id), 'replies')); }
    catch (error) { toast.error(error.message); }
  };

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    if (!normalized) return posts;
    return posts.filter(post => `${post.title || ''} ${post.content || ''}`.toLocaleLowerCase('en-US').includes(normalized));
  }, [posts, query]);

  if (selectedPost) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-[#111827]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-5"><button type="button" onClick={() => setSelectedPost(null)} className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><ArrowLeft className="h-5 w-5" /></button><div className="min-w-0"><h1 className="truncate font-bold text-white">{selectedPost.title}</h1><p className="text-xs text-[#64748b]">{selectedPost.username || selectedPost.authorUsername || 'Member'} started by</p></div></header>
        <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-5"><article className="rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5"><div className="mb-3 flex flex-wrap gap-1.5">{(selectedPost.tags || []).map(tag => <span key={tag.id || tag} className="rounded-full bg-[#2563eb]/15 px-2 py-1 text-[10px] font-bold text-[#93c5fd]">{tag.name || tag}</span>)}</div><p className="whitespace-pre-wrap text-[15px] leading-6 text-[#e2e8f0]">{selectedPost.content}</p></article><div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-white/[0.06]" /><span className="text-xs font-bold uppercase text-[#64748b]">{replies.length} replies</span><div className="h-px flex-1 bg-white/[0.06]" /></div><div className="space-y-2">{replies.map(item => <article key={item.id} className="rounded-xl px-4 py-3 hover:bg-white/[0.035]"><div className="flex items-baseline gap-2"><strong className="text-sm text-[#f8fafc]">{item.username || item.authorUsername || 'Member'}</strong><span className="text-[10px] text-[#64748b]">{formatTime(item.createdAt || item.timestamp)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-[#cbd5e1]">{item.content}</p></article>)}</div></div>
        {!selectedPost.archived && canSendMessages && <form className="flex shrink-0 gap-2 border-t border-white/[0.06] px-5 py-4" onSubmit={async event => { event.preventDefault(); if (!reply.trim()) return; try { const result = await createForumReply(channelId, selectedPost.id, { content: reply.trim() }); setReplies(current => [...current, result.reply || result]); setReply(''); } catch (error) { toast.error(error.message); } }}><input value={reply} onChange={event => setReply(event.target.value)} className={inputClass} placeholder="Write a reply" /><button className="rounded-xl bg-[#2563eb] p-3 text-white hover:bg-[#1d4ed8]"><Send className="h-4 w-4" /></button></form>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[#111827]">
      <header className="border-b border-white/[0.06] px-6 py-5"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-[#60a5fa]" /><h1 className="text-xl font-bold text-white">{currentChannel.name}</h1></div><p className="mt-1 text-sm text-[#94a3b8]">{currentChannel.topic || 'An organized discussion space for questions and topics.'}</p></div>{canSendMessages && <button type="button" onClick={() => setShowComposer(show => !show)} className="flex items-center gap-2 rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8]"><Plus className="h-4 w-4" /> New post</button>}</div><label className="mt-5 flex items-center rounded-xl border border-white/[0.07] bg-[#0f172a] px-3"><Search className="h-4 w-4 text-[#64748b]" /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#64748b]" placeholder="Search the forum" /></label></header>
      {showComposer && <form className="border-b border-white/[0.06] bg-[#151d2c] p-5" onSubmit={async event => { event.preventDefault(); try { await createForumPost(channelId, postForm); setPostForm({ title: '', content: '', tagIds: [] }); setShowComposer(false); toast.success('Forum post created.'); load(); } catch (error) { toast.error(error.message); } }}><div className="grid gap-3"><input required maxLength="120" value={postForm.title} onChange={event => setPostForm({ ...postForm, title: event.target.value })} className={inputClass} placeholder="Post title" /><textarea required rows="4" value={postForm.content} onChange={event => setPostForm({ ...postForm, content: event.target.value })} className={`${inputClass} resize-none`} placeholder="Describe your topic in detail" /><div className="flex flex-wrap items-center gap-2">{tags.map(tag => <button key={tag.id} type="button" onClick={() => setPostForm(current => ({ ...current, tagIds: current.tagIds.includes(tag.id) ? current.tagIds.filter(id => id !== tag.id) : [...current.tagIds, tag.id] }))} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${postForm.tagIds.includes(tag.id) ? 'bg-[#2563eb] text-white' : 'bg-[#0f172a] text-[#94a3b8]'}`}>{tag.name}</button>)}{canManageChannel && <div className="ml-auto flex gap-1"><input value={newTag} onChange={event => setNewTag(event.target.value)} className="w-28 rounded-lg bg-[#0f172a] px-2 py-1 text-xs text-white outline-none" placeholder="Add tag" /><button type="button" onClick={async () => { if (!newTag.trim()) return; try { await createForumTag(channelId, { name: newTag.trim() }); setNewTag(''); load(); } catch (error) { toast.error(error.message); } }} className="rounded-lg bg-white/[0.07] p-1.5 text-[#94a3b8] hover:text-white"><Tag className="h-4 w-4" /></button></div>}</div><button className="justify-self-end rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8]">Publish post</button></div></form>}
      <div className="custom-scrollbar flex-1 overflow-y-auto p-5">{filteredPosts.length === 0 ? <div className="rounded-2xl border border-dashed border-white/[0.1] py-16 text-center text-[#64748b]">No posts yet. Start the first discussion.</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredPosts.map(post => <button key={post.id} type="button" onClick={() => openPost(post)} className="rounded-2xl border border-white/[0.07] bg-[#151d2c] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#3b82f6]/40"><div className="mb-2 flex flex-wrap gap-1">{(post.tags || []).slice(0, 3).map(tag => <span key={tag.id || tag} className="rounded-full bg-[#2563eb]/15 px-2 py-0.5 text-[10px] font-bold text-[#93c5fd]">{tag.name || tag}</span>)}</div><h3 className="line-clamp-2 font-bold text-white">{post.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-5 text-[#94a3b8]">{post.content}</p><div className="mt-4 flex items-center justify-between text-[11px] text-[#64748b]"><span>{post.username || post.authorUsername || 'Member'}</span><span>{post.replyCount || post.replies?.length || 0} replies</span></div></button>)}</div>}</div>
    </div>
  );
}
