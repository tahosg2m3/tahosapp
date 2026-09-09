import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CalendarDays,
  Folder,
  Image,
  Megaphone,
  MessageSquare,
  Radio,
  Copy,
  Crown,
  Hash,
  Headphones,
  Mic,
  LogOut,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  UserCog,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';
import { useVoice } from '../../context/VoiceContext';
import MemberManagementModal from '../server/MemberManagementModal';
import ServerSettingsModal from '../server/ServerSettingsModal';
import ChannelSettingsModal from '../server/ChannelSettingsModal';
import ServerProfileModal from '../profile/ServerProfileModal';
import {
  createManagedChannel,
  getEffectivePermissions,
  getServerMembers,
  getServerRoles,
  permissionsToMap,
  removeManagedChannel,
  unwrapMembers,
  unwrapRoles,
} from '../server/serverManagementApi';
import { fetchChannels, leaveServer } from '../../services/api';
import { buildInviteUrl } from '../../utils/inviteLinks';

function getMemberId(member) {
  return member?.id || member?.userId || member?.user?.id;
}

function getVoiceParticipantId(participant) {
  return participant?.userId || participant?.id || participant?.user?.id;
}

export default function ChannelList({ onNavigate }) {
  const { currentServer, currentChannel, setCurrentChannel, setServers, setCurrentServer } = useServer();
  const { socket } = useSocket();
  const { user } = useAuth();
  const {
    joinVoiceChannel,
    activeVoiceChannel,
    voiceChannelMembers,
    requestVoiceChannelMembers,
    speakingUserIds,
  } = useVoice();

  const [channels, setChannels] = useState([]);
  const [createType, setCreateType] = useState(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [channelKind, setChannelKind] = useState('text');
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverSettingsInitialTab, setServerSettingsInitialTab] = useState('overview');
  const [showMemberManager, setShowMemberManager] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState(null);
  const [showServerProfile, setShowServerProfile] = useState(false);
  const [openChannelMenu, setOpenChannelMenu] = useState(null);
  const [openVoiceMenu, setOpenVoiceMenu] = useState(null);
  const [voiceDropTargetId, setVoiceDropTargetId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [permissionMap, setPermissionMap] = useState({});
  const [voiceOverrides, setVoiceOverrides] = useState({});
  const [unreadByChannel, setUnreadByChannel] = useState({});
  const menuRef = useRef(null);
  const floatingRef = useRef(null);
  const channelLoadIdRef = useRef(0);

  const isOwner = Boolean(currentServer?.creatorId && currentServer.creatorId === user?.id);
  const currentMember = useMemo(() => members.find((member) => getMemberId(member) === user?.id), [members, user?.id]);
  const fallbackPermissions = useMemo(() => getEffectivePermissions({ roles, member: currentMember, isOwner }), [roles, currentMember, isOwner]);
  const permissions = Object.keys(permissionMap).length ? permissionMap : fallbackPermissions;
  const canManageChannels = isOwner || Boolean(permissions.MANAGE_CHANNELS || permissions.ADMINISTRATOR);
  const canManageMembers = isOwner || Boolean(permissions.KICK_MEMBERS || permissions.MODERATE_MEMBERS || permissions.MUTE_MEMBERS || permissions.DEAFEN_MEMBERS || permissions.MOVE_MEMBERS || permissions.ADMINISTRATOR);
  const canMuteMembers = isOwner || Boolean(permissions.MUTE_MEMBERS || permissions.ADMINISTRATOR);
  const canDeafenMembers = isOwner || Boolean(permissions.DEAFEN_MEMBERS || permissions.ADMINISTRATOR);
  const canDisconnectMembers = isOwner || Boolean(permissions.MOVE_MEMBERS || permissions.ADMINISTRATOR);

  useEffect(() => {
    if (!currentServer?.id) return undefined;

    setChannels([]);
    setRoles([]);
    setMembers([]);
    setPermissionMap({});
    setVoiceOverrides({});
    setUnreadByChannel({});
    setOpenChannelMenu(null);
    setOpenVoiceMenu(null);
    setVoiceDropTargetId(null);
    loadChannels();
    requestVoiceChannelMembers(currentServer.id);

    Promise.all([getServerRoles(currentServer.id), getServerMembers(currentServer.id)])
      .then(([rolePayload, memberPayload]) => {
        setRoles(unwrapRoles(rolePayload));
        setMembers(unwrapMembers(memberPayload));
        setPermissionMap(permissionsToMap(rolePayload?.currentUserPermissions || rolePayload?.permissions || []));
      })
      .catch((error) => {
        // Eski bir sunucu/veri has bu endpoint henüz yoksa normal kanal akışı çalışmaya devam eder.
        console.warn('Could not load role permissions:', error.message);
        setRoles([]);
        setMembers([]);
        setPermissionMap({});
      });

    return undefined;
  }, [currentServer?.id]);

  useEffect(() => {
    if (!socket || !currentServer?.id) return undefined;

    const requestCurrentVoiceSnapshot = () => {
      requestVoiceChannelMembers(currentServer.id);
    };
    const handleChannelsChanged = ({ serverId }) => {
      if (serverId === currentServer.id) loadChannels();
    };
    const handleMembersChanged = ({ serverId }) => {
      if (serverId !== currentServer.id) return;
      getServerMembers(currentServer.id).then((payload) => setMembers(unwrapMembers(payload))).catch(() => {});
      getServerRoles(currentServer.id).then((payload) => setPermissionMap(permissionsToMap(payload?.currentUserPermissions || payload?.permissions || []))).catch(() => {});
    };

    // On a full refresh currentServer can be restored before Socket.IO has
    // authenticated. The first request is then intentionally ignored by the
    // backend. Request the snapshot again after presence:ready so users who
    // were already in voice are visible without another F5.
    socket.on('presence:ready', requestCurrentVoiceSnapshot);
    socket.on('channels:changed', handleChannelsChanged);
    socket.on('server:members-changed', handleMembersChanged);
    if (socket.connected) requestCurrentVoiceSnapshot();
    return () => {
      socket.off('presence:ready', requestCurrentVoiceSnapshot);
      socket.off('channels:changed', handleChannelsChanged);
      socket.off('server:members-changed', handleMembersChanged);
    };
  }, [socket, currentServer?.id]);

  useEffect(() => {
    if (!socket || !currentServer?.id) return undefined;
    const receive = (message) => {
      if (!message?.channelId || message.userId === user?.id || message.channelId === currentChannel?.id) return;
      if (!channels.some(channel => channel.id === message.channelId && channel.serverId === currentServer.id)) return;
      const mentioned = message.mentions?.includes?.(user?.id) || message.content?.toLocaleLowerCase('en-US').includes(`@${user?.username || ''}`.toLocaleLowerCase('en-US'));
      setUnreadByChannel(current => ({
        ...current,
        [message.channelId]: {
          count: Math.min(99, (current[message.channelId]?.count || 0) + 1),
          mentions: (current[message.channelId]?.mentions || 0) + (mentioned ? 1 : 0),
        },
      }));
    };
    socket.on('message:receive', receive);
    return () => socket.off('message:receive', receive);
  }, [channels, currentChannel?.id, currentServer?.id, socket, user?.id, user?.username]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setShowServerMenu(false);
      if (floatingRef.current && !floatingRef.current.contains(event.target)) {
        setOpenChannelMenu(null);
        setOpenVoiceMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadChannels() {
    if (!currentServer?.id) return;
    const requestId = ++channelLoadIdRef.current;
    const requestedServerId = currentServer.id;
    try {
      const data = await fetchChannels(requestedServerId);
      if (requestId !== channelLoadIdRef.current) return;
      setChannels(data);
      const currentStillExists = data.some((channel) => channel.id === currentChannel?.id);
      if (data.length && (!currentChannel || currentChannel.serverId !== requestedServerId || !currentStillExists)) {
        setCurrentChannel(data.find(channel => channel.type !== 'category') || null);
      } else if (!data.length) {
        setCurrentChannel(null);
      }
    } catch (error) {
      if (requestId !== channelLoadIdRef.current) return;
      console.error('Could not load channels:', error);
      toast.error('Could not load channels.');
    }
  }

  const handleCreateChannel = async (event) => {
    event.preventDefault();
    const channelName = newChannelName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!channelName || !createType || !currentServer?.id) return;

    try {
      const typeToCreate = createType === 'text' || createType === 'voice' ? channelKind : createType;
      const channel = await createManagedChannel(currentServer.id, channelName, typeToCreate, user.id);
      setChannels((previous) => [...previous, channel]);
      setNewChannelName('');
      setCreateType(null);
      setChannelKind('text');
      setCurrentChannel(channel);
      toast.success('Channel created.');
    } catch (error) {
      toast.error(error.message || 'The channel could not be created.');
    }
  };

  const handleDeleteChannel = async (channel) => {
    if (!canManageChannels) return;
    if (!window.confirm(`“${channel.name}” channel? This action cannot be undone.`)) return;

    try {
      await removeManagedChannel(channel.id, user.id);
      const remaining = channels.filter((candidate) => candidate.id !== channel.id);
      setChannels(remaining);
      if (currentChannel?.id === channel.id) setCurrentChannel(remaining[0] || null);
      setOpenChannelMenu(null);
      toast.success('Kanal silindi.');
    } catch (error) {
      toast.error(error.message || 'Kanal silinemedi.');
    }
  };

  const handleChannelClick = (channel) => {
    onNavigate?.();
    setUnreadByChannel(current => ({ ...current, [channel.id]: { count: 0, mentions: 0 } }));
    setCurrentChannel({ ...channel, previous: currentChannel?.id });
    if (channel.type === 'voice' || channel.type === 'stage') joinVoiceChannel(channel);
  };

  const handleLeaveServer = async () => {
    if (!currentServer || isOwner) return;
    if (!window.confirm(`“${currentServer.name}” server?`)) return;

    try {
      await leaveServer(currentServer.id, user.id);
      setServers((previous) => previous.filter((server) => server.id !== currentServer.id));
      setCurrentServer(null);
      setCurrentChannel(null);
      toast.success('You left the server.');
    } catch (error) {
      toast.error(error.message || 'You could not leave the server.');
    }
  };

  const copyInviteCode = async () => {
    if (!currentServer?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(buildInviteUrl(currentServer.inviteCode));
      toast.success('Invite link copied.');
      setShowServerMenu(false);
    } catch {
      toast.error('The invite link could not be copied.');
    }
  };

  const shareInvite = async () => {
    if (!currentServer?.inviteCode) return;
    const url = buildInviteUrl(currentServer.inviteCode);
    const text = `${currentServer.name} Join the server: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: currentServer.name, text, url });
      else await navigator.clipboard.writeText(text);
      toast.success('Invite details are ready.');
      setShowServerMenu(false);
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error('The invite could not be shared.');
    }
  };

  const emitVoiceModeration = (action, participant, channel, targetChannel = null) => {
    const targetUserId = getVoiceParticipantId(participant);
    if (!socket || !targetUserId || targetUserId === user?.id) return;

    const requiresMute = ['mute', 'unmute'].includes(action);
    const requiresDeafen = ['deafen', 'undeafen'].includes(action);
    if ((requiresMute && !canMuteMembers) || (requiresDeafen && !canDeafenMembers) || (['disconnect', 'move'].includes(action) && !canDisconnectMembers)) {
      toast.error('You do not have permission to do that.');
      return;
    }

    if (action === 'move' && (!targetChannel?.id || targetChannel.id === channel.id)) {
      toast.error('Choose a different voice channel.');
      return;
    }

    socket.emit('voice:moderate', {
      action,
      targetUserId,
      channelId: channel.id,
      ...(action === 'move' ? { targetChannelId: targetChannel.id } : {}),
    }, (result) => {
      if (!result?.success) {
        toast.error(result?.error || 'Voice moderation could not be applied.');
        requestVoiceChannelMembers(currentServer?.id);
        return;
      }

      setVoiceOverrides((previous) => ({
        ...previous,
        [targetUserId]: {
          ...previous[targetUserId],
          ...(action === 'mute' ? { muted: true } : {}),
          ...(action === 'unmute' ? { muted: false } : {}),
          ...(action === 'deafen' ? { deafened: true } : {}),
          ...(action === 'undeafen' ? { deafened: false } : {}),
        },
      }));
      setOpenVoiceMenu(null);
      const labels = { mute: 'muted', unmute: 'unmuted', deafen: 'deafened', undeafen: 'undeafened', disconnect: 'disconnected from voice', move: `${targetChannel?.name || 'another channel'} moved` };
      toast.success(`Member ${labels[action]}.`);
      if (action === 'move') requestVoiceChannelMembers(currentServer?.id);
    });
  };

  const emitStageModeration = (action, participant, channel) => {
    const targetUserId = getVoiceParticipantId(participant);
    if (!socket || !targetUserId || !canDisconnectMembers) return;
    socket.emit('voice:stage:moderate', { action, targetUserId, channelId: channel.id }, result => {
      if (!result?.success) toast.error(result?.error || 'The Stage action could not be applied.');
      else { toast.success('Stage role updated.'); setOpenVoiceMenu(null); requestVoiceChannelMembers(currentServer?.id); }
    });
  };

  const byPosition = (first, second) => (Number(first.position ?? Number.MAX_SAFE_INTEGER) - Number(second.position ?? Number.MAX_SAFE_INTEGER)) || first.name.localeCompare(second.name, 'tr');
  const categories = channels.filter((channel) => channel.type === 'category').sort(byPosition);
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  const byCategoryAndPosition = (first, second) => {
    const firstCategory = first.categoryId ? (categoryOrder.get(first.categoryId) ?? categoryOrder.size) : -1;
    const secondCategory = second.categoryId ? (categoryOrder.get(second.categoryId) ?? categoryOrder.size) : -1;
    return firstCategory - secondCategory || byPosition(first, second);
  };
  const textChannels = channels.filter((channel) => !channel.type || ['text', 'announcement', 'forum', 'media'].includes(channel.type)).sort(byCategoryAndPosition);
  const voiceChannels = channels.filter((channel) => ['voice', 'stage'].includes(channel.type)).sort(byCategoryAndPosition);

  const handleVoiceDragStart = (event, participant, sourceChannel) => {
    const targetUserId = getVoiceParticipantId(participant);
    if (!canDisconnectMembers || !targetUserId || targetUserId === user?.id) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tahosapp-voice-member', JSON.stringify({
      targetUserId,
      sourceChannelId: sourceChannel.id,
    }));
    event.dataTransfer.setData('text/plain', targetUserId);
  };

  const handleVoiceDrop = (event, targetChannel) => {
    event.preventDefault();
    setVoiceDropTargetId(null);
    if (!canDisconnectMembers) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-tahosapp-voice-member'));
      if (!payload?.targetUserId || !payload?.sourceChannelId || payload.sourceChannelId === targetChannel.id) return;
      const sourceChannel = voiceChannels.find((candidate) => candidate.id === payload.sourceChannelId);
      const participant = (voiceChannelMembers[payload.sourceChannelId] || [])
        .find((candidate) => getVoiceParticipantId(candidate) === payload.targetUserId);
      if (!sourceChannel || !participant) {
        toast.error('The user is no longer connected to voice.');
        requestVoiceChannelMembers(currentServer?.id);
        return;
      }
      emitVoiceModeration('move', participant, sourceChannel, targetChannel);
    } catch {
      toast.error('The move request could not be read.');
    }
  };

  const renderCreateForm = (type) => {
    if (createType !== type) return null;
    return (
      <form onSubmit={handleCreateChannel} className="px-2 pb-2">
        <select
          value={channelKind}
          onChange={(event) => setChannelKind(event.target.value)}
          className="mb-2 w-full rounded-[4px] border border-white/[0.08] bg-[#1E1F22] px-2.5 py-2 text-xs text-[#DBDEE1] outline-none focus:border-[#00A8FC]"
        >
          {type === 'voice' ? <><option value="voice">Voice channel</option><option value="stage">Stage channel</option></> : <><option value="text">Text channel</option><option value="announcement">Announcement channel</option><option value="forum">Forum channel</option><option value="media">Media channel</option><option value="category">Category</option></>}
        </select>
        <label className="sr-only" htmlFor={`new-${type}-channel`}>Channel name</label>
        <input
          id={`new-${type}-channel`}
          type="text"
          value={newChannelName}
          onChange={(event) => setNewChannelName(event.target.value)}
          placeholder={`${channelKind === 'category' ? 'category' : channelKind === 'stage' ? 'stage' : type === 'voice' ? 'voice' : 'text'}-channel`}
          maxLength={50}
          className="w-full rounded-[4px] border border-[#00A8FC] bg-[#1E1F22] px-2.5 py-2 text-sm text-white outline-none placeholder:text-[#72767D]"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Escape') setCreateType(null);
          }}
          onBlur={() => {
            if (!newChannelName) setCreateType(null);
          }}
        />
        <p className="mt-1 px-1 text-[10px] text-[#949BA4]">Press Enter to create or Esc to cancel</p>
      </form>
    );
  };

  const renderChannel = (channel) => {
    const isActive = currentChannel?.id === channel.id;
    const isMenuOpen = openChannelMenu === channel.id;
    const unread = unreadByChannel[channel.id];
    const ChannelIcon = channel.type === 'announcement' ? Megaphone : channel.type === 'forum' ? MessageSquare : channel.type === 'media' ? Image : Hash;
    return (
      <div key={channel.id} className="group relative px-2" ref={isMenuOpen ? floatingRef : null}>
        <button
          type="button"
          onClick={() => handleChannelClick(channel)}
          className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left transition ${isActive ? 'bg-[#404249] text-white shadow-sm' : 'text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]'}`}
        >
          <ChannelIcon className="mr-1.5 h-5 w-5 shrink-0 text-[#80848E]" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{channel.name}</span>
          {unread?.mentions > 0 ? <span className="ml-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">{unread.mentions > 9 ? '9+' : unread.mentions}</span> : unread?.count > 0 ? <span className="ml-1 h-2 w-2 rounded-full bg-[#f8fafc]" title={`${unread.count} unread messages`} /> : null}
        </button>
        {canManageChannels && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setOpenChannelMenu(isMenuOpen ? null : channel.id); setOpenVoiceMenu(null); }}
            title="Channel actions"
            className={`absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#949BA4] transition hover:bg-[#1E1F22] hover:text-white ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
        {isMenuOpen && (
          <div className="absolute right-2 top-10 z-50 w-40 rounded-md border border-black/30 bg-[#111214] p-1 shadow-2xl">
            <button type="button" onClick={() => { setSettingsChannel(channel); setOpenChannelMenu(null); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C]"><Settings className="h-3.5 w-3.5" /> Channel settings</button>
            <button type="button" onClick={() => handleDeleteChannel(channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#F23F42] transition hover:bg-[#F23F42]/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete channel
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="flex h-full w-[256px] flex-col border-r border-white/[0.06] bg-[#151b27]">
        <header className="relative z-20 h-14 shrink-0 border-b border-white/[0.06] px-3" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowServerMenu((open) => !open)}
            className={`flex h-full w-full items-center justify-between gap-2 px-2 text-left transition ${showServerMenu ? 'text-white' : 'text-[#F2F3F5] hover:text-white'}`}
          >
            <span className="min-w-0 flex-1 truncate font-semibold">{currentServer?.name}</span>
            {showServerMenu ? <X className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[#B5BAC1]" />}
          </button>

          {showServerMenu && (
            <div className="absolute left-3 right-3 top-12 z-50 overflow-hidden rounded-lg border border-white/[0.08] bg-[#111214] p-1.5 shadow-2xl">
              <div className="mb-1.5 rounded-md border border-[#5865F2]/25 bg-[#5865F2]/10 px-2.5 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-[#8EA1E1]">Invite link</span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs font-bold text-[#F2F3F5]">{buildInviteUrl(currentServer?.inviteCode) || '—'}</code>
                  <button type="button" onClick={copyInviteCode} title="Copy" className="rounded p-1 text-[#B5BAC1] transition hover:bg-white/10 hover:text-white"><Copy className="h-4 w-4" /></button>
                </div>
              </div>

              <button type="button" onClick={shareInvite} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#5865F2] hover:text-white">
                <UserPlus className="h-4 w-4" /> Invite people
              </button>

              <button type="button" onClick={() => { setServerSettingsInitialTab('community'); setShowServerSettings(true); setShowServerMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#35373C] hover:text-white">
                <CalendarDays className="h-4 w-4" /> Activelikler
              </button>

              <button type="button" onClick={() => { setShowServerProfile(true); setShowServerMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#35373C] hover:text-white">
                <UserCog className="h-4 w-4" /> Edit server profile
              </button>

              {isOwner && (
                <button type="button" onClick={() => { setServerSettingsInitialTab('overview'); setShowServerSettings(true); setShowServerMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#35373C] hover:text-white">
                  <Settings className="h-4 w-4" /> Server settings and community
                </button>
              )}

              {!isOwner && (
                <button type="button" onClick={() => { setServerSettingsInitialTab('community'); setShowServerSettings(true); setShowServerMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#35373C] hover:text-white">
                  <Sparkles className="h-4 w-4" /> Community Hub
                </button>
              )}

              {!isOwner && canManageMembers && (
                <button type="button" onClick={() => { setShowMemberManager(true); setShowServerMenu(false); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#DBDEE1] transition hover:bg-[#35373C] hover:text-white">
                  <UserCog className="h-4 w-4" /> Manage members
                </button>
              )}

              {!isOwner && (
                <>
                  <div className="my-1 h-px bg-white/[0.07]" />
                  <button type="button" onClick={handleLeaveServer} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-[#F23F42] transition hover:bg-[#F23F42]/10">
                    <LogOut className="h-4 w-4" /> Leave server
                  </button>
                </>
              )}
            </div>
          )}
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-3" onClick={() => setShowServerMenu(false)}>
          {categories.length > 0 && (
            <section className="pb-2">
              {categories.map(category => (
                <div key={category.id} className="group relative px-3 py-1" ref={openChannelMenu === category.id ? floatingRef : null}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#949BA4]"><Folder className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate">{category.name}</span>{canManageChannels && <button type="button" onClick={() => setSettingsChannel(category)} className="rounded p-1 opacity-0 hover:bg-[#35373C] hover:text-white group-hover:opacity-100"><Settings className="h-3.5 w-3.5" /></button>}</div>
                </div>
              ))}
            </section>
          )}
          <section className="pb-3">
            <div className="mb-1 flex items-center justify-between px-4">
              <span className="flex items-center text-[11px] font-bold uppercase tracking-wide text-[#949BA4]"><ChevronDown className="mr-0.5 h-3.5 w-3.5" /> Text Channels</span>
              {canManageChannels && (
                <button type="button" onClick={() => { const opening = createType !== 'text'; setCreateType(opening ? 'text' : null); if (opening) setChannelKind('text'); }} title="Create channel" className="rounded p-1 text-[#949BA4] transition hover:bg-[#35373C] hover:text-white"><Plus className="h-4 w-4" /></button>
              )}
            </div>
            {renderCreateForm('text')}
            <div className="space-y-0.5">{textChannels.map(renderChannel)}</div>
          </section>

          <section className="pt-2">
            <div className="mb-1 flex items-center justify-between px-4">
              <span className="flex items-center text-[11px] font-bold uppercase tracking-wide text-[#949BA4]"><ChevronDown className="mr-0.5 h-3.5 w-3.5" /> Voiceli Kanallar</span>
              {canManageChannels && (
                <button type="button" onClick={() => { const opening = createType !== 'voice'; setCreateType(opening ? 'voice' : null); if (opening) setChannelKind('voice'); }} title="Create a voice or Stage channel" className="rounded p-1 text-[#949BA4] transition hover:bg-[#35373C] hover:text-white"><Plus className="h-4 w-4" /></button>
              )}
            </div>
            {renderCreateForm('voice')}

            <div className="space-y-1">
              {voiceChannels.map((channel) => {
                const isActive = activeVoiceChannel?.id === channel.id || currentChannel?.id === channel.id;
                const channelMembers = voiceChannelMembers[channel.id] || [];
                return (
                  <div
                    key={channel.id}
                    className={`group relative rounded-lg px-2 transition ${voiceDropTargetId === channel.id ? 'bg-[#5865F2]/20 ring-1 ring-inset ring-[#818CF8]' : ''}`}
                    ref={openChannelMenu === channel.id ? floatingRef : null}
                    onDragOver={(event) => {
                      if (!canDisconnectMembers || !Array.from(event.dataTransfer.types || []).includes('application/x-tahosapp-voice-member')) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setVoiceDropTargetId(channel.id);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setVoiceDropTargetId(null);
                    }}
                    onDrop={(event) => handleVoiceDrop(event, channel)}
                  >
                    <button type="button" onClick={() => handleChannelClick(channel)} className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left transition ${isActive ? 'bg-[#404249] text-white shadow-sm' : 'text-[#949BA4] hover:bg-[#35373C] hover:text-[#DBDEE1]'}`}>
                      {channel.type === 'stage' ? <Radio className="mr-1.5 h-5 w-5 shrink-0 text-[#80848E]" /> : <Volume2 className="mr-1.5 h-5 w-5 shrink-0 text-[#80848E]" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{channel.name}</span>
                    </button>
                    {canManageChannels && (
                      <button type="button" onClick={(event) => { event.stopPropagation(); setOpenChannelMenu(openChannelMenu === channel.id ? null : channel.id); setOpenVoiceMenu(null); }} title="Channel actions" className={`absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#949BA4] transition hover:bg-[#1E1F22] hover:text-white ${openChannelMenu === channel.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                    {openChannelMenu === channel.id && (
                      <div className="absolute right-2 top-10 z-50 w-40 rounded-md border border-black/30 bg-[#111214] p-1 shadow-2xl">
                        <button type="button" onClick={() => { setSettingsChannel(channel); setOpenChannelMenu(null); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C]"><Settings className="h-3.5 w-3.5" /> Channel settings</button>
                        <button type="button" onClick={() => handleDeleteChannel(channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#F23F42] transition hover:bg-[#F23F42]/10"><Trash2 className="h-3.5 w-3.5" /> Delete channel</button>
                      </div>
                    )}

                    {channelMembers.map((participant) => {
                      const participantId = getVoiceParticipantId(participant);
                      const member = members.find((candidate) => getMemberId(candidate) === participantId);
                      const displayName = participant.username || participant.user?.username || member?.username || member?.user?.username || 'Connected user';
                      const isSpeaking = Boolean(speakingUserIds[participantId]);
                      const override = voiceOverrides[participantId] || {};
                      const isMuted = override.muted ?? Boolean(participant.muted || participant.serverMuted || member?.serverMuted);
                      const isDeafened = override.deafened ?? Boolean(participant.deafened || participant.serverDeafened || member?.serverDeafened);
                      const voiceMenuKey = `${channel.id}:${participantId}`;
                      const moderatorCanAct = participantId !== user?.id && (canMuteMembers || canDeafenMembers || canDisconnectMembers);
                      return (
                        <div
                          key={participantId}
                          className={`relative ml-7 mr-2 mt-1 ${canDisconnectMembers && participantId !== user?.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          ref={openVoiceMenu === voiceMenuKey ? floatingRef : null}
                          draggable={canDisconnectMembers && participantId !== user?.id}
                          onDragStart={(event) => handleVoiceDragStart(event, participant, channel)}
                          onDragEnd={() => setVoiceDropTargetId(null)}
                          title={canDisconnectMembers && participantId !== user?.id ? 'Drag to move to another voice channel' : undefined}
                        >
                          <div className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition-all ${isSpeaking ? 'border-[#34D399] bg-[#34D399]/10 shadow-[0_0_12px_rgba(52,211,153,0.18)]' : 'border-transparent hover:bg-white/[0.04]'}`}>
                            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white ${isSpeaking ? 'bg-[#34D399]' : 'bg-[#475569]'}`}>{displayName[0]?.toUpperCase() || '?'}</div>
                            <span className={`min-w-0 flex-1 truncate text-[12px] ${isSpeaking ? 'font-semibold text-[#D1FAE5]' : 'text-[#CBD5E1]'}`}>{displayName}</span>
                            {participant.requestedToSpeak && <span className="shrink-0 rounded-full bg-[#f59e0b]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#fbbf24]">Requesting to speak</span>}
                            {isMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-[#ED4245]" title="Muteuldu" />}
                            {isDeafened && <Headphones className="h-3.5 w-3.5 shrink-0 text-[#ED4245]" title="Deafened" />}
                            {isSpeaking && !isMuted && <VolumeX className="h-3.5 w-3.5 shrink-0 rotate-180 text-[#34D399]" />}
                            {moderatorCanAct && (
                              <button type="button" onClick={() => { setOpenVoiceMenu(openVoiceMenu === voiceMenuKey ? null : voiceMenuKey); setOpenChannelMenu(null); }} title="Voice moderasyonu" className="rounded p-0.5 text-[#949BA4] transition hover:bg-[#1E1F22] hover:text-white"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                          {openVoiceMenu === voiceMenuKey && (
                            <div
                              className="absolute right-0 top-8 z-[60] w-48 rounded-md border border-black/30 bg-[#111214] p-1 shadow-2xl"
                              draggable={false}
                              onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            >
                              {channel.type === 'stage' && canDisconnectMembers && participant.requestedToSpeak && <button type="button" onClick={() => emitStageModeration('approve', participant, channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#34d399] transition hover:bg-[#34d399]/10"><Mic className="h-3.5 w-3.5" /> Invite to speak</button>}
                              {channel.type === 'stage' && canDisconnectMembers && participant.stageRole === 'speaker' && <button type="button" onClick={() => emitStageModeration('audience', participant, channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C]"><VolumeX className="h-3.5 w-3.5" /> Move to audience</button>}
                              {canMuteMembers && <button type="button" onClick={() => emitVoiceModeration(isMuted ? 'unmute' : 'mute', participant, channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C]"><MicOff className="h-3.5 w-3.5" /> {isMuted ? 'Unmute' : 'Mute'}</button>}
                              {canDeafenMembers && <button type="button" onClick={() => emitVoiceModeration(isDeafened ? 'undeafen' : 'deafen', participant, channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C]"><Headphones className="h-3.5 w-3.5" /> {isDeafened ? 'Undeafen' : 'Deafen'}</button>}
                              {canDisconnectMembers && voiceChannels.some((candidate) => candidate.id !== channel.id) && (
                                <label className="block rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#949BA4]">
                                  Move to another channel
                                  <select
                                    defaultValue=""
                                    onChange={(event) => {
                                      const targetChannel = voiceChannels.find((candidate) => candidate.id === event.target.value);
                                      if (targetChannel) emitVoiceModeration('move', participant, channel, targetChannel);
                                    }}
                                    className="mt-1 w-full rounded border border-white/10 bg-[#1E1F22] px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-[#DBDEE1] outline-none focus:border-[#5865F2]"
                                    aria-label={`${displayName} to another voice channel`}
                                  >
                                    <option value="" disabled>Choose a channel…</option>
                                    {voiceChannels.filter((candidate) => candidate.id !== channel.id).map((candidate) => (
                                      <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {canDisconnectMembers && <button type="button" onClick={() => emitVoiceModeration('disconnect', participant, channel)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-[#F23F42] transition hover:bg-[#F23F42]/10"><PhoneOff className="h-3.5 w-3.5" /> Disconnect</button>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {showServerSettings && <ServerSettingsModal initialTab={serverSettingsInitialTab} onClose={() => setShowServerSettings(false)} />}
      {settingsChannel && <ChannelSettingsModal channel={settingsChannel} channels={channels} roles={roles} members={members} onUpdated={(updated) => { setChannels(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item)); if (currentChannel?.id === updated.id) setCurrentChannel(current => ({ ...current, ...updated })); setSettingsChannel(null); }} onClose={() => setSettingsChannel(null)} />}
      {showServerProfile && <ServerProfileModal server={currentServer} member={currentMember} user={user} onUpdated={(updated) => setMembers(current => current.map(item => getMemberId(item) === user?.id ? { ...item, ...updated } : item))} onClose={() => setShowServerProfile(false)} />}
      {showMemberManager && (
        <MemberManagementModal
          serverId={currentServer?.id}
          actorId={user?.id}
          roles={roles}
          members={members}
          permissions={permissions}
          isOwner={isOwner}
          onMembersChange={setMembers}
          onClose={() => setShowMemberManager(false)}
        />
      )}
    </>
  );
}
