import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Clock3,
  Crown,
  Headphones,
  MicOff,
  MoreVertical,
  Search,
  ShieldAlert,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';
import { banMember } from '../../services/platformApi';
import {
  assignMemberRoles,
  getMemberRoleIds,
  getServerMembers,
  getServerRoles,
  moderateMember,
  permissionsToMap,
  unwrapMembers,
  unwrapRoles,
} from './serverManagementApi';

function displayMember(member) {
  return member?.user || member || {};
}

function memberName(member) {
  return displayMember(member).username || displayMember(member).email || 'Unknown user';
}

function updateMemberInList(members, updatedMember) {
  if (!updatedMember) return members;
  const targetId = updatedMember.id || updatedMember.userId || updatedMember.user?.id;
  return members.map((member) => {
    const id = member.id || member.userId || member.user?.id;
    return id === targetId ? { ...member, ...updatedMember } : member;
  });
}

export default function MemberManagementModal({
  serverId,
  actorId,
  roles: suppliedRoles,
  members: suppliedMembers,
  permissions: suppliedPermissions,
  isOwner = false,
  onMembersChange,
  onClose,
  embedded = false,
}) {
  const [fetchedRoles, setFetchedRoles] = useState([]);
  const [fetchedMembers, setFetchedMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const roles = useMemo(() => unwrapRoles(suppliedRoles ?? fetchedRoles), [suppliedRoles, fetchedRoles]);
  const members = useMemo(() => unwrapMembers(suppliedMembers ?? fetchedMembers), [suppliedMembers, fetchedMembers]);
  const permissions = useMemo(() => permissionsToMap(suppliedPermissions || []), [suppliedPermissions]);

  useEffect(() => {
    if (suppliedMembers !== undefined || !serverId) return;

    setIsLoading(true);
    Promise.all([getServerMembers(serverId), getServerRoles(serverId)])
      .then(([memberPayload, rolePayload]) => {
        setFetchedMembers(unwrapMembers(memberPayload));
        setFetchedRoles(unwrapRoles(rolePayload));
      })
      .catch((error) => toast.error(error.message || 'Members could not be loaded.'))
      .finally(() => setIsLoading(false));
  }, [serverId, suppliedMembers]);

  const canManageRoles = isOwner || permissions.MANAGE_ROLES;
  const canKick = isOwner || permissions.KICK_MEMBERS;
  const canBan = isOwner || permissions.BAN_MEMBERS || permissions.ADMINISTRATOR;
  const canMute = isOwner || permissions.MUTE_MEMBERS || permissions.ADMINISTRATOR;
  const canDeafen = isOwner || permissions.DEAFEN_MEMBERS || permissions.ADMINISTRATOR;
  const canTimeout = isOwner || permissions.MODERATE_MEMBERS || permissions.ADMINISTRATOR;

  const filteredMembers = members.filter((member) => memberName(member).toLocaleLowerCase('en-US').includes(search.trim().toLocaleLowerCase('en-US')));

  const commitMembers = (nextMembers) => {
    if (suppliedMembers !== undefined) onMembersChange?.(nextMembers);
    else setFetchedMembers(nextMembers);
  };

  const handleRoleToggle = async (member, roleId) => {
    if (!canManageRoles || member.isOwner) return;
    const id = member.id || member.userId || member.user?.id;
    const currentRoleIds = getMemberRoleIds(member);
    const nextRoleIds = currentRoleIds.includes(roleId)
      ? currentRoleIds.filter((currentId) => currentId !== roleId)
      : [...currentRoleIds, roleId];

    setIsLoading(true);
    try {
      const response = await assignMemberRoles(serverId, id, nextRoleIds, actorId);
      const updated = response.member || { ...member, roleIds: nextRoleIds };
      commitMembers(updateMemberInList(members, updated));
      toast.success('Roles updated.');
    } catch (error) {
      toast.error(error.message || 'Roles could not be updated.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleModeration = async (member, action) => {
    const id = member.id || member.userId || member.user?.id;
    const name = memberName(member);
    const labels = {
      kick: 'kick from the server',
      ban: 'ban from the server',
      mute: 'susturmak',
      unmute: 'unmute',
      deafen: 'deafen',
      undeafen: 'undeafen',
      timeout: 'apply a timeout',
      untimeout: 'remove the timeout',
    };

    let options = {};
    if (action === 'timeout') {
      const rawDuration = window.prompt('Timeout duration in minutes (1–10080):', '10');
      if (rawDuration === null) return;
      const durationMinutes = Number(rawDuration);
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
        toast.error('The duration must be between 1 and 10080 minutes.');
        return;
      }
      options = { durationMinutes };
    }

    if (action === 'kick' && !window.confirm(`${name} from the server?`)) return;
    if (action === 'ban') {
      if (!window.confirm(`${name} permanently from the server?`)) return;
      const reason = window.prompt('Yasaklama nedeni (optional):', '') || '';
      options = { reason };
    }

    setIsLoading(true);
    try {
      const response = action === 'ban'
        ? await banMember(serverId, id, options)
        : await moderateMember(serverId, id, action, actorId, '', options);
      if (action === 'kick' || action === 'ban') {
        commitMembers(members.filter((candidate) => (candidate.id || candidate.userId || candidate.user?.id) !== id));
      } else if (response.member) {
        commitMembers(updateMemberInList(members, response.member));
      } else {
        commitMembers(members.map((candidate) => {
          const candidateId = candidate.id || candidate.userId || candidate.user?.id;
          if (candidateId !== id) return candidate;
          if (action === 'mute') return { ...candidate, serverMuted: true };
          if (action === 'unmute') return { ...candidate, serverMuted: false };
          if (action === 'deafen') return { ...candidate, serverDeafened: true };
          if (action === 'undeafen') return { ...candidate, serverDeafened: false };
          if (action === 'timeout') return { ...candidate, isTimedOut: true, timeoutUntil: Date.now() + (options.durationMinutes * 60 * 1000) };
          return { ...candidate, isTimedOut: false, timeoutUntil: null };
        }));
      }
      setOpenMenuId(null);
      toast.success(`${name} : moderation action applied.`);
    } catch (error) {
      toast.error(error.message || `${labels[action]} could not be completed.`);
    } finally {
      setIsLoading(false);
    }
  };

  const canActOnMember = (member) => {
    const id = member.id || member.userId || member.user?.id;
    return id !== actorId && !member.isOwner && (canKick || canBan || canMute || canDeafen || canTimeout);
  };

  const content = (
    <div className={`flex min-h-0 flex-1 flex-col ${embedded ? 'bg-[#313338]' : ''}`}>
      {embedded ? null : (
        <header className="flex items-center justify-between border-b border-black/30 bg-[#2B2D31] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#F2F3F5]">Manage Members</h2>
            <p className="mt-0.5 text-xs text-[#949BA4]">Sunucudaki rolesler and moderasyon actionsi</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-[#949BA4] transition hover:bg-[#404249] hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">
        {embedded && (
          <div className="mb-5">
            <h2 className="text-xl font-bold text-[#F2F3F5]">Members</h2>
            <p className="mt-1 text-sm text-[#B5BAC1]">Manage member roles and moderation status.</p>
          </div>
        )}

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949BA4]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Member ara"
            className="w-full rounded-[4px] border border-transparent bg-[#1E1F22] py-2.5 pl-9 pr-3 text-sm text-[#DBDEE1] outline-none transition placeholder:text-[#72767D] focus:border-[#00A8FC]"
          />
        </div>

        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#949BA4]">Members — {filteredMembers.length}</span>
          {isLoading && <span className="text-xs text-[#949BA4]">Up to dateleniyor…</span>}
        </div>

        {filteredMembers.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-[#4E5058] px-5 text-center text-[#949BA4]">
            <Users className="mb-3 h-10 w-10 opacity-40" />
            <p>{search ? 'No members match your search.' : 'No members to display.'}</p>
          </div>
        ) : (
          <div className="overflow-visible rounded-lg border border-black/25 bg-[#2B2D31]">
            {filteredMembers.map((member, index) => {
              const profile = displayMember(member);
              const id = member.id || member.userId || profile.id;
              const name = memberName(member);
              const color = getColorForString(name);
              const avatarUrl = resolveSafeAvatarUrl(profile.avatar);
              const roleIds = getMemberRoleIds(member);
              const memberRoles = roles.filter((role) => roleIds.includes(role.id));
              const menuOpen = openMenuId === id;
              const canAct = canActOnMember(member);

              return (
                <div key={id} className={`relative px-4 py-3 ${index ? 'border-t border-black/20' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="relative mt-0.5 shrink-0">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: color }}>
                          {name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-[#2B2D31] ${profile.status === 'online' ? 'bg-[#23A559]' : 'bg-[#80848E]'}`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-[#F2F3F5]">{name}</span>
                        {member.isOwner && <Crown className="h-4 w-4 shrink-0 text-[#FEE75C]" title="Sunucu sahibi" />}
                        {member.serverMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-[#ED4245]" title="Muteuldu" />}
                        {member.serverDeafened && <Headphones className="h-3.5 w-3.5 shrink-0 text-[#ED4245]" title="Deafened" />}
                        {member.isTimedOut && <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#FEE75C]" title="Timed out" />}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {memberRoles.length ? memberRoles.map((role) => (
                          <span key={role.id} className="inline-flex max-w-full items-center gap-1 rounded bg-[#1E1F22] px-1.5 py-0.5 text-[11px] text-[#DBDEE1]">
                            <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: role.color || '#99AAB5' }} />
                            <span className="truncate">{role.name}</span>
                          </span>
                        )) : <span className="text-xs text-[#949BA4]">No role assigned</span>}
                      </div>
                    </div>

                    {(canManageRoles || canAct) && (
                      <button
                        type="button"
                        onClick={() => setOpenMenuId(menuOpen ? null : id)}
                        className="rounded p-1.5 text-[#949BA4] transition hover:bg-[#404249] hover:text-white"
                        title="Member actionsi"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {menuOpen && (
                    <div className="relative mt-3 rounded-md border border-black/30 bg-[#1E1F22] p-2 shadow-xl">
                      {canManageRoles && !member.isOwner && (
                        <div className="mb-2 border-b border-[#35373C] pb-2">
                          <span className="mb-1.5 block px-1 text-[10px] font-bold uppercase tracking-wide text-[#949BA4]">Roles</span>
                          <div className="space-y-0.5">
                            {roles.map((role) => {
                              const assigned = roleIds.includes(role.id);
                              return (
                                <button
                                  key={role.id}
                                  type="button"
                                  onClick={() => handleRoleToggle(member, role.id)}
                                  disabled={isLoading || role.managed}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#DBDEE1] transition hover:bg-[#35373C] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${assigned ? 'border-[#5865F2] bg-[#5865F2] text-white' : 'border-[#72767D]'}`}>
                                    {assigned && <BadgeCheck className="h-3 w-3" />}
                                  </span>
                                  <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color || '#99AAB5' }} />
                                  <span className="truncate">{role.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {canAct && (
                        <div className="space-y-0.5">
                          <span className="mb-1.5 block px-1 text-[10px] font-bold uppercase tracking-wide text-[#949BA4]">Moderasyon</span>
                          {canMute && (
                            <button type="button" onClick={() => handleModeration(member, member.serverMuted ? 'unmute' : 'mute')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#DBDEE1] hover:bg-[#35373C]">
                              <MicOff className="h-3.5 w-3.5" /> {member.serverMuted ? 'Unmute' : 'Mute'}
                            </button>
                          )}
                          {canDeafen && (
                            <button type="button" onClick={() => handleModeration(member, member.serverDeafened ? 'undeafen' : 'deafen')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#DBDEE1] hover:bg-[#35373C]">
                              <Headphones className="h-3.5 w-3.5" /> {member.serverDeafened ? 'Undeafen' : 'Deafen'}
                            </button>
                          )}
                          {canTimeout && (
                            <button type="button" onClick={() => handleModeration(member, member.isTimedOut ? 'untimeout' : 'timeout')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#DBDEE1] hover:bg-[#35373C]">
                              <Clock3 className="h-3.5 w-3.5" /> {member.isTimedOut ? 'Remove timeout' : 'Apply timeout'}
                            </button>
                          )}
                          {canKick && (
                            <button type="button" onClick={() => handleModeration(member, 'kick')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#F23F42] hover:bg-[#F23F42]/10">
                              <UserMinus className="h-3.5 w-3.5" /> Sunucudan at
                            </button>
                          )}
                          {canBan && (
                            <button type="button" onClick={() => handleModeration(member, 'ban')} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-semibold text-[#F23F42] hover:bg-[#F23F42]/10">
                              <ShieldAlert className="h-3.5 w-3.5" /> Sunucudan yasakla
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]">
      <div className="flex h-[min(720px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-black/40 bg-[#313338] shadow-2xl">
        {content}
      </div>
    </div>
  );
}
