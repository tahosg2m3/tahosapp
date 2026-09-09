import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Pin, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDM } from '../../context/DMContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { fetchDMMessages } from '../../services/api';
import Message from '../chat/Message';
import MessageInput from '../chat/MessageInput';
import TypingIndicator from '../chat/TypingIndicator';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';
import GroupDMAvatar from './GroupDMAvatar';
import GroupDMDetailsPanel from './GroupDMDetailsPanel';
import { useDirectCall } from '../../context/DirectCallContext';

function updateMessageInList(messages, update) {
  const messageId = update.messageId || update.id;
  return messages.map((message) => message.id === messageId ? { ...message, ...update } : message);
}

function isGroupConversation(conversation) {
  return conversation?.type === 'group' || conversation?.isGroupDM;
}

export default function DMArea() {
  const { activeDM, setActiveDM } = useDM();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { call, peerReady, startCall } = useDirectCall();
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [showPinned, setShowPinned] = useState(false);
  const [showGroupDetails, setShowGroupDetails] = useState(false);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const messageListRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimersRef = useRef(new Map());
  const isNearBottomRef = useRef(true);
  const shouldScrollToBottomRef = useRef(true);
  const channelId = activeDM?.channelId;
  const conversationId = activeDM?.id;

  const markDMRead = useCallback(() => {
    if (!channelId || !user?.id) return;
    localStorage.setItem(`chat:last-read:${channelId}:${user.id}`, String(Date.now()));
    setFirstUnreadId(null);
    socket?.emit('channel:read', { channelId, userId: user.id });
  }, [channelId, socket, user?.id]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return undefined;
    }

    let stillCurrent = true;
    setMessages([]);
    setTypingUsers([]);
    setReplyTo(null);
    setFirstUnreadId(null);
    setShowPinned(false);
    setShowGroupDetails(false);
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    // Önceki DM'nin boşaltma render'ı kaydırma isteğini erken tüketmesin.
    shouldScrollToBottomRef.current = false;
    fetchDMMessages(conversationId)
      .then((dmMessages) => {
        if (!stillCurrent) return;
        shouldScrollToBottomRef.current = true;
        setMessages(Array.isArray(dmMessages) ? dmMessages : []);
      })
      .catch((error) => console.error('Could not load direct messages:', error));

    return () => { stillCurrent = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!socket || !channelId || !user) return undefined;
    socket.emit('user:join', { channelId, username: user.username });

    const clearTypingUser = (username) => {
      const timer = typingTimersRef.current.get(username);
      if (timer) clearTimeout(timer);
      typingTimersRef.current.delete(username);
      setTypingUsers((current) => current.filter((name) => name !== username));
    };

    const handleReceive = (message) => {
      if (message.channelId !== channelId) return;
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      if (message.userId !== user.id && !isNearBottomRef.current) setFirstUnreadId((current) => current || message.id);
      else shouldScrollToBottomRef.current = true;
    };
    const handleUpdate = (update) => {
      if (update.channelId && update.channelId !== channelId) return;
      setMessages((current) => updateMessageInList(current, update));
    };
    const handleDelete = ({ messageId, channelId: deletedFromChannel }) => {
      if (deletedFromChannel && deletedFromChannel !== channelId) return;
      setMessages((current) => current.filter((message) => message.id !== messageId));
      setReplyTo((current) => current?.id === messageId ? null : current);
    };
    const handleTypingActive = ({ username }) => {
      if (!username || username === user.username) return;
      const timer = typingTimersRef.current.get(username);
      if (timer) clearTimeout(timer);
      setTypingUsers((current) => current.includes(username) ? current : [...current, username]);
      typingTimersRef.current.set(username, setTimeout(() => clearTypingUser(username), 3000));
    };
    const handleTypingInactive = ({ username }) => username && clearTypingUser(username);
    const handleReactionUpdate = (payload) => {
      const update = payload.message || payload;
      if (update?.channelId && update.channelId !== channelId) return;
      if (update?.messageId || update?.id) setMessages((current) => updateMessageInList(current, update));
    };
    const handlePinUpdate = (payload) => {
      const update = payload.message || payload;
      if (update?.channelId && update.channelId !== channelId) return;
      if (update?.messageId || update?.id) setMessages((current) => updateMessageInList(current, update));
    };
    const handleMessageError = (payload = {}) => {
      if (!payload.channelId || payload.channelId === channelId) toast.error(payload.message || 'Message could not be sent.');
    };
    const handleGroupUpdated = ({ conversation } = {}) => {
      if (conversation?.id !== conversationId) return;
      setActiveDM((current) => current?.id === conversation.id ? { ...current, ...conversation } : current);
    };
    const handleGroupRemoved = ({ conversationId: removedId } = {}) => {
      if (removedId === conversationId) setActiveDM(null);
    };

    socket.on('message:receive', handleReceive);
    socket.on('message:update', handleUpdate);
    socket.on('message:delete', handleDelete);
    socket.on('typing:active', handleTypingActive);
    socket.on('typing:inactive', handleTypingInactive);
    socket.on('message:reaction:update', handleReactionUpdate);
    socket.on('message:pin:update', handlePinUpdate);
    socket.on('message:error', handleMessageError);
    socket.on('dm:group-updated', handleGroupUpdated);
    socket.on('dm:group-removed', handleGroupRemoved);

    return () => {
      socket.emit('user:leave', { channelId });
      socket.off('message:receive', handleReceive);
      socket.off('message:update', handleUpdate);
      socket.off('message:delete', handleDelete);
      socket.off('typing:active', handleTypingActive);
      socket.off('typing:inactive', handleTypingInactive);
      socket.off('message:reaction:update', handleReactionUpdate);
      socket.off('message:pin:update', handlePinUpdate);
      socket.off('message:error', handleMessageError);
      socket.off('dm:group-updated', handleGroupUpdated);
      socket.off('dm:group-removed', handleGroupRemoved);
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
    };
  }, [channelId, conversationId, setActiveDM, socket, user]);

  useEffect(() => {
    if (!shouldScrollToBottomRef.current) return;
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
    else messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    shouldScrollToBottomRef.current = false;
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    markDMRead();
  }, [markDMRead, messages]);

  const handleScroll = () => {
    const node = messageListRef.current;
    if (!node) return;
    const nextNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
    if (nextNearBottom !== isNearBottomRef.current) {
      isNearBottomRef.current = nextNearBottom;
      setIsNearBottom(nextNearBottom);
    }
    if (nextNearBottom) markDMRead();
  };

  const handleSendMessage = (payload) => {
    if (!channelId || !socket || !user) return;
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
    shouldScrollToBottomRef.current = true;
  };

  const handleReaction = (message, emoji) => socket?.emit('message:reaction:toggle', { channelId, messageId: message.id, emoji, userId: user.id });
  const handlePin = (message) => socket?.emit('message:pin:toggle', { channelId, messageId: message.id, userId: user.id });

  if (!activeDM) {
    return (
      <div className="flex flex-1 select-none flex-col items-center justify-center bg-[#111827] text-[#94a3b8]">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#1e293b] shadow-inner"><span className="text-4xl text-[#475569]">@</span></div>
        <h3 className="mb-2 text-xl font-bold text-[#f8fafc]">Message your friends</h3>
        <p className="text-[15px]">Select someone on the left to start a conversation.</p>
      </div>
    );
  }

  const groupDM = isGroupConversation(activeDM);
  const directUser = activeDM.otherUser;
  if (!groupDM && !directUser) {
    return <div className="flex flex-1 items-center justify-center bg-[#111827] text-[#94a3b8]">This conversation could not be loaded.</div>;
  }

  const title = groupDM ? (activeDM.name || 'New Group') : directUser.username;
  const avatarColor = getColorForString(title);
  const initial = title[0].toUpperCase();
  const directAvatarUrl = groupDM ? null : resolveSafeAvatarUrl(directUser.avatar);
  const pinnedMessages = messages.filter((message) => message.isPinned);
  const mentionSuggestions = groupDM
    ? (activeDM.members || []).filter((member) => String(member.id) !== String(user.id))
    : [directUser];

  const handleGroupUpdated = (conversation) => {
    if (!conversation?.id) return;
    setActiveDM((current) => current?.id === conversation.id ? { ...current, ...conversation } : current);
  };
  const handleGroupLeft = () => {
    socket?.emit('user:leave', { channelId });
    setActiveDM(null);
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-[#111827]">
      <div className="z-10 flex h-14 shrink-0 items-center border-b border-white/[0.06] bg-[#111827]/90 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          {groupDM ? <GroupDMAvatar conversation={activeDM} size={30} /> : <span className="select-none text-xl font-medium text-[#94a3b8]">@</span>}
          <span className="truncate font-semibold text-[#f8fafc]">{title}</span>
          {!groupDM && (directUser.presenceStatus === 'online' || directUser.status === 'online') && <div className="h-2.5 w-2.5 rounded-full bg-[#23A559]" />}
          {groupDM && <span className="hidden text-xs text-[#64748b] sm:inline">{activeDM.memberIds?.length || activeDM.members?.length || 0} member</span>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {!groupDM && <button type="button" disabled={Boolean(call) || !peerReady} onClick={async () => { const result = await startCall({ targetUser: directUser, conversationId: activeDM.id }); if (!result?.success) toast.error(result?.error || 'Could not start the call.'); }} className="rounded-lg p-2 text-[#94a3b8] transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40" title={call ? 'You are already in a call' : !peerReady ? 'Call services are getting ready' : 'Start a voice call'} aria-label="Start a voice call"><Phone className="h-5 w-5" /></button>}
          {groupDM && <button type="button" onClick={() => setShowGroupDetails((show) => !show)} className={`rounded-lg p-2 text-[#94a3b8] transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showGroupDetails ? 'bg-white/[0.07] text-white' : ''}`} title="Group members" aria-label="Group members"><Users className="h-5 w-5" /></button>}
          <button type="button" onClick={() => setShowPinned((show) => !show)} className={`rounded-lg p-2 text-[#94a3b8] transition-colors hover:bg-white/[0.07] hover:text-[#f8fafc] ${showPinned ? 'text-[#fbbf24]' : ''}`} title="Pinned messages" aria-label="Pinned messages"><Pin className="h-5 w-5" /></button>
        </div>
      </div>

      {showPinned && (
        <div className="absolute top-16 z-40 w-80 overflow-hidden rounded-xl border border-white/[0.1] bg-[#1e293b] shadow-2xl shadow-black/40" style={{ right: showGroupDetails ? 316 : 20 }}>
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2.5"><span className="text-sm font-semibold text-[#f8fafc]">Pinned messages</span><button type="button" onClick={() => setShowPinned(false)} className="rounded p-1 text-[#94a3b8] hover:bg-white/[0.08] hover:text-white"><X className="h-4 w-4" /></button></div>
          <div className="custom-scrollbar max-h-72 overflow-y-auto p-2">{pinnedMessages.length === 0 ? <p className="p-3 text-sm text-[#94a3b8]">No pinned messages.</p> : pinnedMessages.map((message) => <button key={message.id} type="button" onClick={() => { setShowPinned(false); document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-white/[0.06]"><span className="mr-2 text-xs font-semibold text-[#93c5fd]">{message.username}</span><span className="text-sm text-[#cbd5e1]">{message.content || 'Message with an attachment'}</span></button>)}</div>
        </div>
      )}

      <div ref={messageListRef} onScroll={handleScroll} className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-7 mt-5 border-b border-white/[0.06] pb-6">
          {groupDM ? <div className="mb-4"><GroupDMAvatar conversation={activeDM} size={80} /></div> : directAvatarUrl ? <img src={directAvatarUrl} className="mb-4 h-20 w-20 rounded-full object-cover" alt="" /> : <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold text-white" style={{ backgroundColor: avatarColor }}>{initial}</div>}
          <h1 className="mb-2 text-3xl font-bold text-[#f8fafc]">{title}</h1>
          <p className="text-[15px] text-[#94a3b8]">{groupDM ? <>Bu, <strong>{title}</strong> is the beginning of this group conversation.</> : <>Bu, <strong>{directUser.username}</strong> is the beginning of your message history.</>}</p>
        </div>

        {messages.map((message, index) => {
          const previousMessage = messages[index - 1];
          const grouped = previousMessage && previousMessage.userId === message.userId && (message.timestamp - previousMessage.timestamp < 300000);
          return (
            <div id={`message-${message.id}`} key={message.id}>
              {firstUnreadId === message.id && <div className="my-3 flex items-center gap-2 text-xs font-semibold text-[#f87171]"><div className="h-px flex-1 bg-[#ef4444]/70" /><span>New messages</span><div className="h-px flex-1 bg-[#ef4444]/70" /></div>}
              <Message message={message} isOwn={message.userId === user.id} grouped={grouped} userId={user.id} currentUsername={user.username} canPinMessages onReply={setReplyTo} onReaction={handleReaction} onPin={handlePin} />
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {!isNearBottom && firstUnreadId && <button type="button" onClick={() => { shouldScrollToBottomRef.current = true; messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); markDMRead(); }} className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/30 transition-colors hover:bg-[#3b82f6]">Jump to new messages</button>}
      <div className="shrink-0 px-5 pb-2 pt-1"><TypingIndicator users={typingUsers} /></div>
      <div className="shrink-0 px-5 pb-5 pt-2"><MessageInput onSendMessage={handleSendMessage} onTypingStart={() => socket?.emit('typing:start', { channelId })} onTypingStop={() => socket?.emit('typing:stop', { channelId })} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} draftKey={`dm:${channelId}:${user?.id || 'guest'}`} mentionSuggestions={mentionSuggestions} placeholder={groupDM ? `${title} Send a message to` : `@${directUser.username} Send a message to`} /></div>

      {groupDM && showGroupDetails && <div className="absolute inset-y-0 right-0 z-50"><GroupDMDetailsPanel conversation={activeDM} onClose={() => setShowGroupDetails(false)} onUpdated={handleGroupUpdated} onLeft={handleGroupLeft} /></div>}
    </div>
  );
}
