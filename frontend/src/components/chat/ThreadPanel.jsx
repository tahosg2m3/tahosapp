import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, Plus, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createThread, createThreadMessage, listThreadMessages, listThreads } from '../../services/platformApi';
import { formatTime } from '../../utils/formatTime';
import { useSocket } from '../../context/SocketContext';

const fieldClass = 'w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#3b82f6] placeholder:text-[#64748b]';
function unwrap(payload, key) { return Array.isArray(payload) ? payload : payload?.[key] || payload?.items || []; }

export default function ThreadPanel({ channelId, onClose, canCreateThread = false, canSendThreadMessages = false }) {
  const { socket } = useSocket();
  const [threads, setThreads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => listThreads(channelId).then(payload => setThreads(unwrap(payload, 'threads'))).catch(error => toast.error(error.message)), [channelId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSelected(null);
    setMessages([]);
    setShowCreate(false);
    setName('');
    setMessage('');
  }, [channelId]);
  useEffect(() => {
    if (!canCreateThread) setShowCreate(false);
  }, [canCreateThread]);
  useEffect(() => {
    if (!socket) return undefined;
    const receive = payload => {
      if (!selected?.id || payload?.threadId !== selected.id || !payload.message) return;
      setMessages(current => current.some(item => item.id === payload.message.id) ? current : [...current, payload.message]);
    };
    const update = payload => {
      if (payload?.scope !== 'threads') return;
      if (payload?.data?.channelId && String(payload.data.channelId) !== String(channelId)) return;
      load();
      if (payload.action === 'deleted' && String(payload?.data?.id || '') === String(selected?.id || '')) {
        setSelected(null);
        setMessages([]);
      } else if (payload.action === 'updated' && String(payload?.data?.id || '') === String(selected?.id || '')) {
        setSelected(current => current ? { ...current, ...payload.data } : current);
      }
    };
    socket.on('thread:message', receive);
    socket.on('platform:update', update);
    return () => {
      socket.off('thread:message', receive);
      socket.off('platform:update', update);
    };
  }, [channelId, load, selected?.id, socket]);

  const open = async thread => {
    setSelected(thread);
    try { setMessages(unwrap(await listThreadMessages(channelId, thread.id), 'messages')); }
    catch (error) { toast.error(error.message); }
  };

  return (
    <aside className="absolute right-4 top-16 z-50 flex h-[min(660px,calc(100%-5rem))] w-[390px] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#151d2c] shadow-2xl shadow-black/40">
      <header className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">{selected && <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><ArrowLeft className="h-4 w-4" /></button>}<MessageSquare className="h-4 w-4 text-[#60a5fa]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{selected?.name || 'Threads'}</p><p className="text-[10px] text-[#64748b]">Keep a topic separate from the main chat</p></div>{!selected && canCreateThread && <button type="button" onClick={() => setShowCreate(show => !show)} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><Plus className="h-4 w-4" /></button>}<button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><X className="h-4 w-4" /></button></header>
      {selected ? <><div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-3">{messages.length === 0 ? <p className="py-12 text-center text-sm text-[#64748b]">There are no messages in this thread yet.</p> : messages.map(item => <article key={item.id} className="rounded-xl px-3 py-2.5 hover:bg-white/[0.04]"><div className="flex items-baseline gap-2"><strong className="text-xs text-white">{item.username || item.authorUsername || 'Member'}</strong><span className="text-[9px] text-[#64748b]">{formatTime(item.timestamp || item.createdAt)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-[#cbd5e1]">{item.content}</p></article>)}</div>{!selected.archived && canSendThreadMessages && <form className="flex gap-2 border-t border-white/[0.07] p-3" onSubmit={async event => { event.preventDefault(); if (!message.trim()) return; try { const result = await createThreadMessage(channelId, selected.id, { content: message.trim() }); const created = result.message || result; setMessages(current => current.some(item => item.id === created.id) ? current : [...current, created]); setMessage(''); } catch (error) { toast.error(error.message); } }}><input value={message} onChange={event => setMessage(event.target.value)} className={fieldClass} placeholder="Send a message to the thread" /><button className="rounded-lg bg-[#2563eb] p-2.5 text-white"><Send className="h-4 w-4" /></button></form>}</> : <><>{showCreate && canCreateThread && <form className="border-b border-white/[0.07] bg-[#0f172a] p-3" onSubmit={async event => { event.preventDefault(); try { const result = await createThread(channelId, { name: name.trim(), autoArchiveDuration: 1440 }); setName(''); setShowCreate(false); await load(); open(result.thread || result); } catch (error) { toast.error(error.message); } }}><input required maxLength="100" value={name} onChange={event => setName({ ...name, name: event.target.value })} className={fieldClass} placeholder="Thread name" /><button className="mt-2 w-full rounded-lg bg-[#2563eb] py-2 text-xs font-bold text-white">Create thread</button></form>}</><div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-3">{threads.length === 0 ? <p className="py-12 text-center text-sm text-[#64748b]">There are no open threads.</p> : threads.map(thread => <button key={thread.id} type="button" onClick={() => open(thread)} className="block w-full rounded-xl border border-white/[0.07] bg-[#0f172a] p-3 text-left hover:border-[#3b82f6]/40"><p className="font-semibold text-white">{thread.name}</p><p className="mt-1 text-xs text-[#64748b]">{thread.messageCount || thread.messages?.length || 0} messages · {thread.archived ? 'Archived' : 'Open'}</p></button>)}</div></>}
    </aside>
  );
}
