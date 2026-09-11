import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Bell, Hash, MessageSquare, Pin, Radio, Search, Users, X } from 'lucide-react';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { fetchChannelMessages, fetchServerMembers } from '../../services/api';
import Message from '../chat/Message';
import MessageInput from '../chat/MessageInput';
import TypingIndicator from '../chat/TypingIndicator';
import PollPanel from '../chat/PollPanel';
import ThreadPanel from '../chat/ThreadPanel';
import AnnouncementFollowModal from '../server/AnnouncementFollowModal';
import toast from 'react-hot-toast';
import { getNotificationPreferences, listChannelPermissions, listCommands, listServerAssets, saveChannelNotificationPreferences, saveServerNotificationPreferences } from '../../services/platformApi';

function updateMessageInList(messages, update) {
  const messageId = update.messageId || update.id;
  return messages.map((message) => message.id === messageId ? { ...message, ...update } : message);
}

export default function ChatArea() {
  const { currentChannel, currentServer } = useServer();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [serverAssets, setServerAssets] = useState({ emojis: [], stickers: [], commands: [] });
  const [replyTo, setReplyTo] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteSearchResults, setRemoteSearchResults] = useState([]);
  const [showPinned, setShowPinned] = useState(false);
  const [showPolls, setShowPolls] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAnnouncementFollow, setShowAnnouncementFollow] = useState(false);
  const [serverNotification, setServerNotification] = useState({ level: 'inherit', mutedUntil: null });
  const [channelNotification, setChannelNotification] = useState({ level: 'inherit', mutedUntil: null });
  const [effectivePermissions, setEffectivePermissions] = useState([]);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [sendBlockedUntil, setSendBlockedUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const messageListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimersRef = useRef(new Map());
  const isNearBottomRef = useRef(true);
  const shouldScrollToBottomRef = useRef(true);

  const channelId = currentChannel?.id;
  const retrySeconds = Math.max(0, Math.ceil((sendBlockedUntil - clock) / 1000));
  const permissionSet = useMemo(() => new Set(effectivePermissions), [effectivePermissions]);
  const isAdministrator = permissionSet.has('ADMINISTRATOR');
  const canSendMessages = isAdministrator || permissionSet.has('SEND_MESSAGES');
  const canManageMessages = isAdministrator || permissionSet.has('MANAGE_MESSAGES');
  const canCreateThreads = isAdministrator || permissionSet.has('CREATE_PUBLIC_THREADS');
  const canSendThreadMessages = isAdministrator || permissionSet.has('SEND_MESSAGES_IN_THREADS');

  const loadPermissions = useCallback(() => {
    if (!channelId) {
      setEffectivePermissions([]);
      return Promise.resolve();
    }
    return listChannelPermissions(channelId)
      .then(payload => setEffectivePermissions(Array.isArray(payload?.effectivePermissions) ? payload.effectivePermissions : []))
      .catch(() => setEffectivePermissions([]));
  }, [channelId]);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const update = payload => {
      if (payload?.scope !== 'channel-permissions') return;
      if (String(payload?.serverId || '') !== String(currentServer?.id || '')) return;
      loadPermissions();
    };
    const permissionsChanged = payload => {
      if (String(payload?.channelId || '') === String(channelId)) loadPermissions();
    };
    socket.on('platform:update', update);
    socket.on('channel:permissions-changed', permissionsChanged);
    return () => {
      socket.off('platform:update', update);
      socket.off('channel:permissions-changed', permissionsChanged);
    };
  }, [channelId, currentServer?.id, loadPermissions, socket]);

  useEffect(() => {
    if (!sendBlockedUntil) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [sendBlockedUntil]);

  useEffect(() => {
    if (!currentServer?.id) {
      setMentionSuggestions([]);
      return;
    }
    fetchServerMembers(currentServer.id)
      .then(payload => setMentionSuggestions(Array.isArray(payload) ? payload : payload.members || []))
      .catch(() => setMentionSuggestions([]));
  }, [currentServer?.id]);

  useEffect(() => {
    if (!channelId) return;
    getNotificationPreferences()
      .then(payload => {
        setServerNotification({ level: 'inherit', mutedUntil: null, ...(payload.servers?.[currentServer?.id] || {}) });
        setChannelNotification({ level: 'inherit', mutedUntil: null, ...(payload.channels?.[channelId] || {}) });
      })
      .catch(() => {
        setServerNotification({ level: 'inherit', mutedUntil: null });
        setChannelNotification({ level: 'inherit', mutedUntil: null });
      });
  }, [channelId, currentServer?.id]);

  const saveServerNotifications = async (updates) => {
    const next = { ...serverNotification, ...updates };
    try {
      const saved = await saveServerNotificationPreferences(currentServer.id, next);
      setServerNotification(saved || next);
      toast.success('Server notifications updated.');
    } catch (error) { toast.error(error.message); }
  };

  const saveChannelNotifications = async (updates) => {
    const next = { ...channelNotification, ...updates };
    try {
      const saved = await saveChannelNotificationPreferences(channelId, next);
      setChannelNotification(saved || next);
      toast.success('Channel notifications updated.');
    } catch (error) { toast.error(error.message); }
  };

  const loadServerAssets = useCallback(() => {
    if (!currentServer?.id) {
      setServerAssets({ emojis: [], stickers: [], commands: [] });
      return Promise.resolve();
    }
    return Promise.all([listServerAssets(currentServer.id, 'emojis'), listServerAssets(currentServer.id, 'stickers'), listCommands(currentServer.id)])
      .then(([emojis, stickers, commands]) => setServerAssets({
        emojis: Array.isArray(emojis) ? emojis : emojis.emojis || emojis.items || [],
        stickers: Array.isArray(stickers) ? stickers : stickers.stickers || stickers.items || [],
        commands: Array.isArray(commands) ? commands : commands.commands || [],
      }))
      .catch(() => setServerAssets({ emojis: [], stickers: [], commands: [] }));
  }, [currentServer?.id]);

  useEffect(() => { loadServerAssets(); }, [loadServerAssets]);

  useEffect(() => {
    if (!socket || !currentServer?.id) return undefined;
    const update = payload => {
      if (String(payload?.serverId || '') !== String(currentServer.id)) return;
      if (['emojis', 'stickers', 'commands'].includes(payload?.scope)) loadServerAssets();
    };
    socket.on('platform:update', update);
    return () => socket.off('platform:update', update);
  }, [currentServer?.id, loadServerAssets, socket]);

  const markChannelRead = useCallback(() => {
    if (!channelId || !user?.id) return;
    localStorage.setItem(`chat:last-read:${channelId}:${user.id}`, String(Date.now()));
    setFirstUnreadId(null);
    socket?.emit('channel:read', { channelId, userId: user.id });
  }, [channelId, socket, user?.id]);

  useEffect(() => {
    if (!channelId) {
      setMessages([]);
      setFirstUnreadId(null);
      return undefined;
    }

    let stillCurrent = true;
    setMessages([]);
    setTypingUsers([]);
    setReplyTo(null);
    setShowPinned(false);
    setShowPolls(false);
    setShowThreads(false);
    setShowNotifications(false);
    setShowAnnouncementFollow(false);
    setSearchQuery('');
    setRemoteSearchResults([]);
    setFirstUnreadId(null);
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    // Kanal değişimindeki boşaltma render'ının, yeni mesajlar gelmeden önce
    // bekleyen alt-kaydırma isteğini tüketmesini engelle.
    shouldScrollToBottomRef.current = false;

    fetchChannelMessages(channelId)
      .then((channelMessages) => {
        if (!stillCurrent) return;
        shouldScrollToBottomRef.current = true;
        setMessages(Array.isArray(channelMessages) ? channelMessages : []);
      })
      .catch((error) => console.error('Could not load channel messages:', error));

    return () => {
      stillCurrent = false;
    };
  }, [channelId]);

  useEffect(() => {
    if (!socket || !channelId || !user) return undefined;

    socket.emit('user:join', { channelId, username: user.username });

    const clearTypingUser = (username) => {
      const existingTimer = typingTimersRef.current.get(username);
      if (existingTimer) clearTimeout(existingTimer);
      typingTimersRef.current.delete(username);
      setTypingUsers((current) => current.filter((name) => name !== username));
    };

    const handleReceive = (message) => {
      if (message.channelId !== channelId) return;
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        return [...current, message];
      });

      if (message.userId !== user.id && !isNearBottomRef.current) {
        setFirstUnreadId((current) => current || message.id);
      } else {
        shouldScrollToBottomRef.current = true;
      }
    };

    const handleUpdate = (updatedMessage) => {
      setMessages((current) => updateMessageInList(current, updatedMessage));
    };

    const handleDelete = ({ messageId }) => {
      setMessages((current) => current.filter((message) => message.id !== messageId));
      setReplyTo((current) => current?.id === messageId ? null : current);
    };

    const handleTypingActive = ({ username }) => {
      if (!username || username === user.username) return;
      const existingTimer = typingTimersRef.current.get(username);
      if (existingTimer) clearTimeout(existingTimer);
      setTypingUsers((current) => current.includes(username) ? current : [...current, username]);
      typingTimersRef.current.set(username, setTimeout(() => clearTypingUser(username), 3000));
    };

    const handleTypingInactive = ({ username }) => {
      if (username) clearTypingUser(username);
    };

    const handleReactionUpdate = (payload) => {
      const update = payload.message || payload;
      if (!update?.messageId && !update?.id) return;
      setMessages((current) => updateMessageInList(current, update));
    };

    const handlePinUpdate = (payload) => {
      const update = payload.message || payload;
      if (!update?.messageId && !update?.id) return;
      setMessages((current) => updateMessageInList(current, update));
    };

    const handleSearchResults = (payload) => {
      if (payload?.channelId && payload.channelId !== channelId) return;
      setRemoteSearchResults(Array.isArray(payload) ? payload : payload?.messages || payload?.results || []);
    };

    const handleMessageError = (payload = {}) => {
      if (payload.channelId && payload.channelId !== channelId) return;
      if (payload.retryAfterMs) {
        setSendBlockedUntil(Date.now() + Number(payload.retryAfterMs));
        setClock(Date.now());
      }
      toast.error(payload.message || 'Message could not be sent.');
    };

    const handleProfileUpdate = payload => {
      const updatedUser = payload?.user;
      if (!updatedUser?.id) return;
      setMessages(current => current.map(message => String(message.userId) === String(updatedUser.id)
        ? {
          ...message,
          username: updatedUser.username || message.username,
          authorAppearance: {
            ...message.authorAppearance,
            avatar: updatedUser.avatar || null,
            profileAccentColor: updatedUser.profileAccentColor,
            nameFont: updatedUser.nameFont,
            nameEffect: updatedUser.nameEffect,
          },
        }
        : message));
    };

    socket.on('message:receive', handleReceive);
    socket.on('message:update', handleUpdate);
    socket.on('message:delete', handleDelete);
    socket.on('typing:active', handleTypingActive);
    socket.on('typing:inactive', handleTypingInactive);
    socket.on('message:reaction:update', handleReactionUpdate);
    socket.on('message:pin:update', handlePinUpdate);
    socket.on('message:search:results', handleSearchResults);
    socket.on('message:error', handleMessageError);
    socket.on('user:profile-updated', handleProfileUpdate);

    return () => {
      socket.emit('user:leave', { channelId });
      socket.off('message:receive', handleReceive);
      socket.off('message:update', handleUpdate);
      socket.off('message:delete', handleDelete);
      socket.off('typing:active', handleTypingActive);
      socket.off('typing:inactive', handleTypingInactive);
      socket.off('message:reaction:update', handleReactionUpdate);
      socket.off('message:pin:update', handlePinUpdate);
      socket.off('message:search:results', handleSearchResults);
      socket.off('message:error', handleMessageError);
      socket.off('user:profile-updated', handleProfileUpdate);
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
    };
  }, [channelId, socket, user]);

  useEffect(() => {
    if (!searchQuery.trim() || !socket || !channelId) {
      setRemoteSearchResults([]);
      return undefined;
    }

    const timer = setTimeout(() => {
      socket.emit('message:search', { channelId, query: searchQuery.trim() }, (result) => {
        if (Array.isArray(result)) setRemoteSearchResults(result);
        else if (Array.isArray(result?.messages)) setRemoteSearchResults(result.messages);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [channelId, searchQuery, socket]);

  useEffect(() => {
    if (shouldScrollToBottomRef.current) {
      const messageList = messageListRef.current;
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
      else messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      shouldScrollToBottomRef.current = false;
      isNearBottomRef.current = true;
      setIsNearBottom(true);
      markChannelRead();
    }
  }, [markChannelRead, messages]);

  const localSearchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('en-US');
    if (!normalizedQuery) return messages;
    return messages.filter((message) => {
      const attachmentText = (message.attachments || []).map((attachment) => attachment.filename || attachment.name || '').join(' ');
      return `${message.username || ''} ${message.content || ''} ${attachmentText}`.toLocaleLowerCase('en-US').includes(normalizedQuery);
    });
  }, [messages, searchQuery]);

  const visibleMessages = searchQuery.trim() && remoteSearchResults.length > 0 ? remoteSearchResults : localSearchResults;
  const pinnedMessages = messages.filter((message) => message.isPinned);

  const handleScroll = () => {
    const node = messageListRef.current;
    if (!node) return;
    const nextNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
    if (nextNearBottom !== isNearBottomRef.current) {
      isNearBottomRef.current = nextNearBottom;
      setIsNearBottom(nextNearBottom);
    }
    if (nextNearBottom) markChannelRead();
  };

  const handleSendMessage = (payload) => {
    if (!channelId || !socket || !user || !canSendMessages) return;
    const messagePayload = typeof payload === 'string' ? { content: payload, attachments: [], replyTo: null } : payload;
    if (!messagePayload.content?.trim() && !(messagePayload.attachments || []).length) return;

    socket.emit('message:send', {
      channelId,
      content: messagePayload.content,
      attachments: messagePayload.attachments || [],
      replyTo: messagePayload.replyTo || null,
      spotifyInvite: messagePayload.spotifyInvite || null,
      userId: user.id,
      username: user.username,
    });
    socket.emit('typing:stop', { channelId });
    if (currentChannel?.slowmodeSeconds) {
      setSendBlockedUntil(Date.now() + Number(currentChannel.slowmodeSeconds) * 1000);
      setClock(Date.now());
    }
    shouldScrollToBottomRef.current = true;
  };

  const handleReaction = (message, emoji) => {
    if (!canSendMessages) return;
    socket?.emit('message:reaction:toggle', { channelId, messageId: message.id, emoji, userId: user.id });
  };

  const handlePin = (message) => {
    if (!canManageMessages) return;
    socket?.emit('message:pin:toggle', { channelId, messageId: message.id, userId: user.id });
  };

  if (!currentChannel) return null;

  return (
    <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col bg-[#111827]">
      <div className="z-20 flex h-14 shrink-0 items-center border-b border-white/[0.06] bg-[#111827]/90 px-5 backdrop-blur">
        <div className="mr-2.5 flex items-center text-[#60a5fa]"><Hash className="h-5 w-5" /></div>
        <div className="min-w-0"><div className="font-semibold text-[#f8fafc]">{currentChannel.name}</div>{currentChannel.topic && <div className="max-w-[420px] truncate text-[10px] text-[#64748b]">{currentChannel.topic}</div>}</div>

        <div className="ml-auto flex items-center gap-2 text-[#94a3b8]">
          {isSearchOpen ? (
            <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#1e293b] px-2">
              <Search className="h-4 w-4 text-[#64748b]" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus placeholder="Search messages" className="w-40 bg-transparent px-2 py-1.5 text-sm text-[#e2e8f0] outline-none placeholder:text-[#64748b]" />
              <button type="button" onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} className="rounded p-0.5 hover:bg-white/[0.08]" aria-label="Close search"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => setIsSearchOpen(true)} className="rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc]" title="Search messages" aria-label="Search messages"><Search className="h-5 w-5" /></button>
          )}
          <button type="button" onClick={() => setShowPinned((show) => !show)} className={`rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showPinned ? 'text-[#fbbf24]' : ''}`} title="Pinned messages" aria-label="Pinned messages"><Pin className="h-5 w-5" /></button>
          <button type="button" onClick={() => setShowPolls(show => !show)} className={`rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showPolls ? 'text-[#60a5fa]' : ''}`} title="Anketler" aria-label="Anketler"><BarChart3 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setShowThreads(show => !show)} className={`rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showThreads ? 'text-[#60a5fa]' : ''}`} title="Threads" aria-label="Threads"><MessageSquare className="h-5 w-5" /></button>
          {currentChannel.type === 'announcement' && <button type="button" onClick={() => setShowAnnouncementFollow(true)} className="rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#60a5fa]" title="Follow announcement channel" aria-label="Follow announcement channel"><Radio className="h-5 w-5" /></button>}
          <button type="button" onClick={() => setShowNotifications(show => !show)} className={`rounded-lg p-2 transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showNotifications ? 'text-[#60a5fa]' : ''}`} title="Channel notifications" aria-label="Channel notifications"><Bell className="h-5 w-5" /></button>
          <Users className="h-5 w-5 cursor-pointer transition-colors hover:text-[#f8fafc]" title="Member listesi" />
        </div>
      </div>

      {showPinned && (
        <div className="absolute right-5 top-16 z-40 w-80 overflow-hidden rounded-xl border border-white/[0.1] bg-[#1e293b] shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2.5"><span className="text-sm font-semibold text-[#f8fafc]">Pinned messages</span><button type="button" onClick={() => setShowPinned(false)} className="rounded p-1 text-[#94a3b8] hover:bg-white/[0.08] hover:text-white"><X className="h-4 w-4" /></button></div>
          <div className="custom-scrollbar max-h-72 overflow-y-auto p-2">
            {pinnedMessages.length === 0 ? <p className="p-3 text-sm text-[#94a3b8]">There are no pinned messages in this channel.</p> : pinnedMessages.map((message) => <button key={message.id} type="button" onClick={() => { setShowPinned(false); document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-white/[0.06]"><span className="mr-2 text-xs font-semibold text-[#93c5fd]">{message.username}</span><span className="text-sm text-[#cbd5e1]">{message.content || 'Message with an attachment'}</span></button>)}
          </div>
        </div>
      )}

      {showPolls && <PollPanel key={channelId} channelId={channelId} userId={user?.id} canSendMessages={canSendMessages} onClose={() => setShowPolls(false)} />}
      {showThreads && <ThreadPanel key={channelId} channelId={channelId} canCreateThread={canCreateThreads} canSendThreadMessages={canSendThreadMessages} onClose={() => setShowThreads(false)} />}
      {showAnnouncementFollow && <AnnouncementFollowModal channel={currentChannel} onClose={() => setShowAnnouncementFollow(false)} />}
      {showNotifications && (
        <div className="custom-scrollbar absolute right-5 top-16 z-50 max-h-[calc(100vh-5rem)] w-80 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#1e293b] p-3 shadow-2xl shadow-black/40">
          <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold text-white">Notification settings</p><p className="text-[11px] text-[#64748b]">Server default with optional channel override</p></div><button type="button" onClick={() => setShowNotifications(false)} className="rounded p-1 text-[#94a3b8] hover:bg-white/[0.08]"><X className="h-4 w-4" /></button></div>

          <section className="rounded-lg border border-white/[0.07] bg-black/10 p-2">
            <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">{currentServer?.name} server</p>
            <div className="space-y-1">{[['inherit', 'Use default setting'], ['all', 'All messages'], ['mentions', 'Mentions only'], ['nothing', 'Nothing']].map(([value, label]) => <button key={value} type="button" onClick={() => saveServerNotifications({ level: value })} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${serverNotification.level === value ? 'bg-[#2563eb] text-white' : 'text-[#cbd5e1] hover:bg-white/[0.06]'}`}><span>{label}</span>{serverNotification.level === value && <span>✓</span>}</button>)}</div>
            <div className="mt-2 grid grid-cols-2 gap-1"><button type="button" onClick={() => saveServerNotifications({ mutedUntil: 4102444800000 })} className="rounded-lg bg-white/[0.05] px-2 py-2 text-xs text-[#cbd5e1] hover:bg-white/[0.09]">Mute server</button><button type="button" onClick={() => saveServerNotifications({ mutedUntil: null })} className="rounded-lg bg-white/[0.05] px-2 py-2 text-xs text-[#cbd5e1] hover:bg-white/[0.09]">Unmute server</button></div>
          </section>

          <section className="mt-3 rounded-lg border border-white/[0.07] bg-black/10 p-2">
            <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">#{currentChannel.name} channel override</p>
            <div className="space-y-1">{[['inherit', 'Use server setting'], ['all', 'All messages'], ['mentions', 'Mentions only'], ['nothing', 'Nothing']].map(([value, label]) => <button key={value} type="button" onClick={() => saveChannelNotifications({ level: value })} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${channelNotification.level === value ? 'bg-[#2563eb] text-white' : 'text-[#cbd5e1] hover:bg-white/[0.06]'}`}><span>{label}</span>{channelNotification.level === value && <span>✓</span>}</button>)}</div>
            <div className="mt-2 grid grid-cols-2 gap-1"><button type="button" onClick={() => saveChannelNotifications({ mutedUntil: 4102444800000 })} className="rounded-lg bg-white/[0.05] px-2 py-2 text-xs text-[#cbd5e1] hover:bg-white/[0.09]">Mute channel</button><button type="button" onClick={() => saveChannelNotifications({ mutedUntil: null })} className="rounded-lg bg-white/[0.05] px-2 py-2 text-xs text-[#cbd5e1] hover:bg-white/[0.09]">Enable audio</button></div>
          </section>
        </div>
      )}

      <div ref={messageListRef} onScroll={handleScroll} className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-7 mt-5 border-b border-white/[0.06] pb-6">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-lg shadow-blue-500/20"><Hash className="h-8 w-8" /></div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-[#f8fafc]">Welcome to #{currentChannel.name}</h1>
          <p className="text-[14px] text-[#94a3b8]">Send the first message to start the conversation.</p>
        </div>

        {searchQuery.trim() && <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[#94a3b8]"><Search className="h-3.5 w-3.5" /> {visibleMessages.length} results for “{searchQuery}”</div>}

        {visibleMessages.map((message, index) => {
          const previousMessage = visibleMessages[index - 1];
          const grouped = previousMessage && previousMessage.userId === message.userId && (message.timestamp - previousMessage.timestamp < 300000);
          return (
            <div id={`message-${message.id}`} key={message.id}>
              {firstUnreadId === message.id && !searchQuery.trim() && <div className="my-3 flex items-center gap-2 text-xs font-semibold text-[#f87171]"><div className="h-px flex-1 bg-[#ef4444]/70" /><span>New messages</span><div className="h-px flex-1 bg-[#ef4444]/70" /></div>}
              <Message message={message} isOwn={message.userId === user.id} grouped={grouped} userId={user.id} currentUsername={user.username} canManageMessages={canManageMessages} onReply={setReplyTo} onReaction={handleReaction} onPin={handlePin} />
            </div>
          );
        })}

        {visibleMessages.length === 0 && searchQuery.trim() && <div className="py-12 text-center text-sm text-[#94a3b8]">No messages match your search.</div>}
        <div ref={messagesEndRef} />
      </div>

      {!isNearBottom && firstUnreadId && <button type="button" onClick={() => { shouldScrollToBottomRef.current = true; messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); markChannelRead(); }} className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-[#3b82f6]">Jump to new messages</button>}

      <div className="shrink-0 px-5 pb-2 pt-1"><TypingIndicator users={typingUsers} /></div>
      <div className="shrink-0 px-5 pb-5 pt-2">
          <MessageInput
            onSendMessage={handleSendMessage}
          onTypingStart={() => socket?.emit('typing:start', { channelId })}
          onTypingStop={() => socket?.emit('typing:stop', { channelId })}
          replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            draftKey={`channel:${channelId}:${user?.id || 'guest'}`}
            mentionSuggestions={mentionSuggestions}
            serverEmojis={serverAssets.emojis}
            serverStickers={serverAssets.stickers}
            commandSuggestions={serverAssets.commands}
            disabled={retrySeconds > 0 || !canSendMessages}
            placeholder={!canSendMessages ? 'You do not have permission to send messages in this channel' : retrySeconds > 0 ? `Slow mode: ${retrySeconds} seconds remaining` : `#${currentChannel.name} Send a message to`}
          />
      </div>
    </div>
  );
}
