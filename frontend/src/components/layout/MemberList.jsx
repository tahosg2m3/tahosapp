import { useCallback, useEffect, useState } from 'react';
import { MicOff, Shield, VolumeX } from 'lucide-react';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';
import { fetchServerMembers } from '../../services/api';
import { getColorForString } from '../../utils/colors';
import { getAvatarDecoration, getNameAppearance } from '../../utils/profileAppearance';
import UserPopover from '../profile/UserPopover';

function sortMembers(members) {
  return [...members].sort((first, second) => {
    const firstOnline = !['offline', 'invisible'].includes(first.status);
    const secondOnline = !['offline', 'invisible'].includes(second.status);
    if (firstOnline !== secondOnline) {
      return firstOnline ? -1 : 1;
    }

    return first.username.localeCompare(second.username, 'tr');
  });
}

function activityLabel(type) {
  return ({ listening: 'Listening', watching: 'Watching', working: 'Working', competing: 'Competing', custom: 'Active' })[type] || 'Playing';
}

function memberActivityText(activity) {
  if (activity?.playbackStatus === 'paused') return `Paused: ${activity.name}`;
  return `${activityLabel(activity?.type)}: ${activity?.name}`;
}

export default function MemberList() {
  const { currentServer } = useServer();
  const { socket, isPresenceReady } = useSocket();
  const [members, setMembers] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);

  const loadMembers = useCallback(() => {
    if (!currentServer?.id) return;
    fetchServerMembers(currentServer.id)
      .then(data => setMembers(sortMembers(data)))
      .catch(console.error);
  }, [currentServer?.id]);

  useEffect(() => {
    if (!currentServer?.id || !isPresenceReady) return;

    loadMembers();
  }, [currentServer?.id, isPresenceReady, loadMembers]);

  useEffect(() => {
    if (!socket) return undefined;

    const handlePresence = ({ userId, status, serverId }) => {
      if (serverId && serverId !== currentServer?.id) return;

      setMembers(previousMembers => sortMembers(
        previousMembers.map(member => (
          member.id === userId ? { ...member, status } : member
        )),
      ));
    };

    socket.on('presence:update', handlePresence);

    const handleRichPresence = ({ userId, activities, serverId }) => {
      if (serverId && serverId !== currentServer?.id) return;
      setMembers(previousMembers => previousMembers.map(member => (
        String(member.id) === String(userId) ? { ...member, activities: activities || [] } : member
      )));
    };
    socket.on('rich-presence:update', handleRichPresence);

    const refreshMembers = ({ serverId }) => {
      if (!serverId || serverId === currentServer?.id) loadMembers();
    };
    socket.on('server:members-changed', refreshMembers);
    socket.on('server:member-updated', refreshMembers);
    socket.on('roles:changed', refreshMembers);

    return () => {
      socket.off('presence:update', handlePresence);
      socket.off('rich-presence:update', handleRichPresence);
      socket.off('server:members-changed', refreshMembers);
      socket.off('server:member-updated', refreshMembers);
      socket.off('roles:changed', refreshMembers);
    };
  }, [socket, currentServer?.id, loadMembers]);

  if (!currentServer) return null;

  const onlineMembers = members.filter(member => !['offline', 'invisible'].includes(member.status));
  const offlineMembers = members.filter(member => ['offline', 'invisible'].includes(member.status));
  const roleGroups = [];
  const remainingOnline = [];
  onlineMembers.forEach(member => {
    const highestRole = [...(member.roles || [])]
      .filter(role => role.hoist && !role.isDefault)
      .sort((a, b) => (b.position || 0) - (a.position || 0))[0];
    if (!highestRole) { remainingOnline.push(member); return; }
    let group = roleGroups.find(item => item.role.id === highestRole.id);
    if (!group) { group = { role: highestRole, members: [] }; roleGroups.push(group); }
    group.members.push(member);
  });
  roleGroups.sort((a, b) => (b.role.position || 0) - (a.role.position || 0));

  const renderGroup = (title, group, online) => {
    if (!group.length) return null;

    return (
      <section className="mb-5">
        <h3 className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
          {title} — {group.length}
        </h3>

        <div className="space-y-0.5">
          {group.map(member => {
            const nameAppearance = getNameAppearance(member);
            const avatarDecoration = getAvatarDecoration(member);
            return (
            <button
              type="button"
              key={member.id}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSelectedProfile({
                  user: member,
                  anchorRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                });
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
            >
              <div className={`relative shrink-0 ${avatarDecoration.className}`} style={avatarDecoration.style}>
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold text-white ${online ? '' : 'grayscale opacity-55'}`}
                  style={{ backgroundColor: getColorForString(member.nickname || member.username) }}
                >
                  {member.serverAvatar || member.avatar ? <img src={member.serverAvatar || member.avatar} alt="" className="h-full w-full rounded-xl object-cover" /> : (member.nickname || member.username)?.[0]?.toUpperCase() || '?'}
                </div>

                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[3px] border-[#151b27] ${!online ? 'bg-[#64748b]' : member.status === 'idle' ? 'bg-[#f59e0b]' : member.status === 'dnd' ? 'bg-[#ef4444]' : 'bg-[#34d399]'}`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {member.isOwner && <Shield className="h-3.5 w-3.5 shrink-0 text-[#fbbf24]" title="Server owner" />}
                  <div className={`truncate text-[14px] font-medium ${online ? 'text-[#e2e8f0]' : 'text-[#718096]'} ${nameAppearance.className}`} style={nameAppearance.style}>
                    {member.nickname || member.username}
                  </div>
                  {member.serverMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-[#fb7185]" title="Muted by the server" />}
                  {member.serverDeafened && <VolumeX className="h-3.5 w-3.5 shrink-0 text-[#fb7185]" title="Deafened by the server" />}
                </div>
                {(member.roles || []).filter(role => !role.isDefault).slice(0, 2).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(member.roles || []).filter(role => !role.isDefault).slice(0, 2).map(role => (
                      <span key={role.id} className="max-w-[92px] truncate rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: `${role.color || '#64748b'}22`, color: role.color || '#cbd5e1' }}>
                        {role.icon && <img src={role.icon} alt="" className="mr-1 inline h-2.5 w-2.5 rounded-full" />}{role.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`text-[11px] ${online ? 'text-[#34d399]' : 'text-[#64748b]'}`}>
                  {online
                    ? member.activities?.[0]
                      ? memberActivityText(member.activities[0])
                      : member.status === 'idle' ? 'Idle' : member.status === 'dnd' ? 'Do Not Disturb' : (member.customStatus || 'Online')
                    : 'Offline'}
                </div>
              </div>
            </button>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <>
      {selectedProfile && (
        <UserPopover
          targetUser={selectedProfile.user}
          anchorRect={selectedProfile.anchorRect}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      <aside className="flex h-full w-[256px] flex-col overflow-y-auto border-l border-white/[0.06] bg-[#151b27] custom-scrollbar">
        <div className="px-3 py-4">
          <div className="mb-4 flex items-center justify-between px-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94a3b8]">
              Members
            </h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-[#cbd5e1]">
              {members.length}
            </span>
          </div>

          {roleGroups.map(group => renderGroup(group.role.name, group.members, true))}
          {renderGroup('Online', remainingOnline, true)}
          {renderGroup('Offline', offlineMembers, false)}
        </div>
      </aside>
    </>
  );
}
