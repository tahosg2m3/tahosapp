import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useDM } from '../../context/DMContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { fetchDMConversations } from '../../services/api';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';
import CreateGroupDMModal from './CreateGroupDMModal';
import GroupDMAvatar from './GroupDMAvatar';

function isGroupDM(conversation) {
  return conversation?.type === 'group' || conversation?.isGroupDM;
}

function upsertConversation(conversations, conversation) {
  if (!conversation?.id) return conversations;
  const exists = conversations.some((item) => item.id === conversation.id);
  return exists
    ? conversations.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item)
    : [conversation, ...conversations];
}

export default function DMList({ setViewMode }) {
  const { user } = useAuth();
  const { activeDM, setActiveDM } = useDM();
  const { socket } = useSocket();
  const [dms, setDms] = useState([]);
  const [query, setQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const loadConversations = useCallback(() => {
    if (!user?.id) return Promise.resolve([]);
    return fetchDMConversations(user.id)
      .then((conversations) => {
        const safeConversations = Array.isArray(conversations) ? conversations : [];
        setDms(safeConversations);
        setActiveDM((current) => {
          if (!current?.id) return current;
          const refreshed = safeConversations.find((conversation) => conversation.id === current.id);
          return refreshed ? { ...current, ...refreshed } : current;
        });
        return safeConversations;
      });
  }, [setActiveDM, user?.id]);

  useEffect(() => {
    loadConversations().catch(console.error);
  }, [loadConversations]);

  useEffect(() => {
    if (!socket || !user) return undefined;

    const handleNotification = () => loadConversations().catch(console.error);
    const handleGroupCreated = ({ conversation } = {}) => {
      if (!conversation?.id) return;
      setDms((current) => upsertConversation(current, conversation));
    };
    const handleGroupUpdated = ({ conversation } = {}) => {
      if (!conversation?.id) return;
      setDms((current) => upsertConversation(current, conversation));
      setActiveDM((current) => current?.id === conversation.id ? { ...current, ...conversation } : current);
    };
    const handleGroupRemoved = ({ conversationId } = {}) => {
      if (!conversationId) return;
      setDms((current) => current.filter((conversation) => conversation.id !== conversationId));
      setActiveDM((current) => current?.id === conversationId ? null : current);
    };

    socket.on('dm:notification', handleNotification);
    socket.on('dm:group-created', handleGroupCreated);
    socket.on('dm:group-updated', handleGroupUpdated);
    socket.on('dm:group-removed', handleGroupRemoved);
    return () => {
      socket.off('dm:notification', handleNotification);
      socket.off('dm:group-created', handleGroupCreated);
      socket.off('dm:group-updated', handleGroupUpdated);
      socket.off('dm:group-removed', handleGroupRemoved);
    };
  }, [loadConversations, setActiveDM, socket, user]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const handleExternalDMOpen = (event) => {
      const requestedConversation = event.detail?.conversation;
      loadConversations()
        .then((conversations) => {
          const completeConversation = conversations.find((conversation) => conversation.id === requestedConversation?.id);
          if (completeConversation) setActiveDM(completeConversation);
        })
        .catch(console.error);
    };

    window.addEventListener('tahosapp:navigate-to-dm', handleExternalDMOpen);
    return () => window.removeEventListener('tahosapp:navigate-to-dm', handleExternalDMOpen);
  }, [loadConversations, setActiveDM, user?.id]);

  const handleSelectDM = useCallback((dm) => {
    if (activeDM?.channelId && socket) socket.emit('user:leave', { channelId: activeDM.channelId });
    setActiveDM(dm);
    setViewMode?.('dms');
    socket?.emit('user:join', {
      username: user.username,
      serverId: dm.id,
      channelId: dm.channelId,
    });
  }, [activeDM?.channelId, setActiveDM, setViewMode, socket, user.username]);

  const visibleDMs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    if (!normalized) return dms;
    return dms.filter((dm) => {
      const label = isGroupDM(dm) ? dm.name : dm.otherUser?.username;
      return String(label || '').toLocaleLowerCase('en-US').includes(normalized);
    });
  }, [dms, query]);

  const handleCreated = (conversation) => {
    setDms((current) => upsertConversation(current, conversation));
    setShowCreateGroup(false);
    handleSelectDM(conversation);
  };

  return (
    <>
      <div className="flex h-full w-[256px] flex-col overflow-y-auto border-r border-[#1E1F22]/50 bg-[#151b27] custom-scrollbar">
        <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#151b27] px-3 shadow-sm">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748b]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sohbet bul" className="w-full rounded-lg border border-white/[0.06] bg-[#0f172a] py-2 pl-8 pr-2 text-[13px] text-[#e2e8f0] outline-none placeholder:text-[#64748b] focus:border-[#3b82f6]/60" />
          </div>
          <button type="button" onClick={() => setShowCreateGroup(true)} className="rounded-lg p-2 text-[#94a3b8] transition-colors hover:bg-white/[0.08] hover:text-white" title="Create a group conversation" aria-label="Create a group conversation"><Plus className="h-5 w-5" /></button>
        </div>

        <div className="p-2">
          <div className="mb-2 flex items-center justify-between px-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#94a3b8]">Direkt Messages</h3>
            <button type="button" onClick={() => setShowCreateGroup(true)} className="rounded p-1 text-[#64748b] hover:bg-white/[0.06] hover:text-white" title="Create a group conversation"><Plus className="h-3.5 w-3.5" /></button>
          </div>

          <div className="space-y-0.5">
            {visibleDMs.map((dm) => {
              const group = isGroupDM(dm);
              const directUser = dm.otherUser;
              if (!group && !directUser) return null;
              const isActive = activeDM?.id === dm.id;
              const label = group ? (dm.name || 'New Group') : directUser.username;
              const status = directUser?.presenceStatus || directUser?.status;
              const online = status && !['offline', 'invisible'].includes(status);
              const avatarUrl = group ? null : resolveSafeAvatarUrl(directUser.avatar);

              return (
                <button key={dm.id} type="button" onClick={() => handleSelectDM(dm)} className={`group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${isActive ? 'bg-white/[0.1] text-white' : 'text-[#94a3b8] hover:bg-white/[0.06] hover:text-[#DBDEE1]'}`}>
                  <div className="relative shrink-0">
                    {group ? <GroupDMAvatar conversation={dm} size={34} /> : avatarUrl ? (
                      <img src={avatarUrl} className="h-[34px] w-[34px] rounded-full object-cover" alt="" />
                    ) : (
                      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ backgroundColor: getColorForString(directUser.username) }}>{directUser.username[0].toUpperCase()}</div>
                    )}
                    {!group && status && <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] ${isActive ? 'border-[#2a3140]' : 'border-[#151b27] group-hover:border-[#202838]'} ${online ? status === 'idle' ? 'bg-[#f0b232]' : status === 'dnd' ? 'bg-[#f23f43]' : 'bg-[#23A559]' : 'bg-[#80848E]'}`} />}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{label}</span>
                    {group && <span className="block truncate text-[11px] text-[#64748b]">{dm.memberIds?.length || dm.members?.length || 0} member</span>}
                  </span>
                </button>
              );
            })}
            {visibleDMs.length === 0 && <p className="px-3 py-6 text-center text-xs leading-5 text-[#64748b]">{query ? 'No matching conversations found.' : 'You do not have any direct messages yet.'}</p>}
          </div>
        </div>
      </div>

      {showCreateGroup && <CreateGroupDMModal onClose={() => setShowCreateGroup(false)} onCreated={handleCreated} />}
    </>
  );
}
