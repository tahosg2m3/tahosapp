import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Copy,
  Crown,
  Flag,
  Gamepad2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Server,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  acceptFriendRequest,
  createDMConversation,
  fetchUserProfile,
  removeFriend,
  savePrivateUserNote,
  sendFriendRequest,
} from '../../services/api';
import { assignMemberRoles } from '../server/serverManagementApi';
import { blockUser, createReport, unblockUser } from '../../services/platformApi';
import { useAuth } from '../../context/AuthContext';
import { useDM } from '../../context/DMContext';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';
import { getColorForString } from '../../utils/colors';
import { resolveSafeMediaUrl } from '../../utils/safeMediaUrl';
import RichPresenceCard from './RichPresenceCard';

const PRESENCE_STYLES = {
  online: 'bg-[#23a559]',
  idle: 'bg-[#f0b232]',
  dnd: 'bg-[#f23f43]',
  offline: 'bg-[#80848e]',
  invisible: 'bg-[#80848e]',
};

function formatProfileDate(value) {
  if (!value) return 'Bilinmiyor';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'Bilinmiyor';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatActivityTime(value) {
  if (!value) return 'Şimdi';
  const elapsed = Math.max(0, Date.now() - Number(value));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Şimdi';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

function stopEvent(event) {
  event.stopPropagation();
}

function getCompactPosition(anchorRect) {
  if (!anchorRect || typeof window === 'undefined') return null;
  const cardWidth = Math.min(350, window.innerWidth - 24);
  const estimatedHeight = 560;
  const gap = 12;
  const left = anchorRect.left > window.innerWidth / 2
    ? anchorRect.left - cardWidth - gap
    : anchorRect.right + gap;
  return {
    left: Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12)),
    top: Math.max(12, Math.min(anchorRect.top - 18, window.innerHeight - estimatedHeight - 12)),
    width: cardWidth,
  };
}

function ProfileAvatar({ avatar, username, presence, size = 'large', serverBorder = false }) {
  const safeAvatar = resolveSafeMediaUrl(avatar);
  const sizeClasses = size === 'hero' ? 'h-44 w-44 text-6xl' : 'h-24 w-24 text-3xl';
  const statusClasses = size === 'hero'
    ? 'bottom-2 right-2 h-10 w-10 border-[8px]'
    : 'bottom-0 right-0 h-7 w-7 border-[6px]';
  const borderColor = serverBorder ? 'border-[#111214]' : 'border-[#0b0b0d]';

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`${sizeClasses} flex items-center justify-center overflow-hidden rounded-full border-[7px] ${borderColor} font-black text-white shadow-xl`}
        style={{ backgroundColor: getColorForString(username || '?') }}
      >
        {safeAvatar
          ? <img src={safeAvatar} alt={`${username} profil resmi`} className="h-full w-full object-cover" />
          : (username?.[0]?.toUpperCase() || '?')}
      </div>
      <span
        aria-label={presence === 'online' ? 'Çevrimiçi' : 'Çevrimdışı'}
        className={`absolute rounded-full border-[#111214] ${statusClasses} ${PRESENCE_STYLES[presence] || PRESENCE_STYLES.offline}`}
      />
    </div>
  );
}

function ProfileBadges({ verified, isOwner, isFriend }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {verified && <BadgeCheck className="h-4 w-4 fill-[#23cdb5]/20 text-[#23cdb5]" aria-label="Doğrulanmış profil" />}
      {isOwner && <Crown className="h-4 w-4 fill-[#f0b232]/20 text-[#f0b232]" aria-label="Sunucu sahibi" />}
      {isFriend && <ShieldCheck className="h-4 w-4 fill-[#5865f2]/20 text-[#8b93ff]" aria-label="Arkadaş" />}
    </span>
  );
}

function MutualAvatars({ users: mutualFriends }) {
  const visible = (mutualFriends || []).slice(0, 3);
  if (!visible.length) return null;

  return (
    <span className="flex -space-x-2">
      {visible.map(friend => {
        const avatar = resolveSafeMediaUrl(friend.avatar);
        return (
          <span
            key={friend.id}
            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-[#111214] text-[9px] font-bold text-white"
            style={{ backgroundColor: getColorForString(friend.username) }}
          >
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : friend.username?.[0]?.toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}

function RoleChips({ roles, availableRoles, canManage, onToggleRole, compact = false }) {
  const [open, setOpen] = useState(false);
  const assignedIds = new Set((roles || []).map(role => role.id));
  const visibleRoles = (roles || []).filter(role => !role.isDefault);
  const selectableRoles = (availableRoles || []).filter(role => !role.isDefault && !role.managed);

  return (
    <div className="relative flex flex-wrap gap-1.5" onClick={stopEvent}>
      {visibleRoles.map(role => (
        <span
          key={role.id}
          className={`inline-flex max-w-[190px] items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#202225] text-[#dbdee1] ${compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'}`}
        >
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: role.color || '#b5bac1' }} />
          <span className="truncate">{role.name}</span>
          {canManage && !role.managed && (
            <button
              type="button"
              onClick={() => onToggleRole(role.id)}
              className="ml-0.5 rounded text-[#949ba4] hover:text-white"
              aria-label={`${role.name} rolünü kaldır`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}

      {canManage && (
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-[#202225] text-[#b5bac1] hover:bg-[#2b2d31] hover:text-white"
          aria-label="Rol ekle"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-white/[0.08] bg-[#111214] p-2 shadow-2xl">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#949ba4]">Rolleri yönet</p>
          <div className="max-h-52 overflow-y-auto">
            {selectableRoles.length ? selectableRoles.map(role => (
              <button
                type="button"
                key={role.id}
                onClick={async () => {
                  await onToggleRole(role.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-[#dbdee1] hover:bg-white/[0.07]"
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: role.color || '#b5bac1' }} />
                <span className="min-w-0 flex-1 truncate">{role.name}</span>
                {assignedIds.has(role.id) && <Check className="h-4 w-4 text-[#23a559]" />}
              </button>
            )) : <p className="px-2 py-3 text-xs text-[#949ba4]">Yönetilebilir rol yok.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function MoreMenu({ open, onToggle, onCopyId, copied, onReport, onBlock, isBlocked, canReport, onRemoveFriend, isFriend, compact = false }) {
  return (
    <div className="relative" onClick={stopEvent}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center justify-center rounded-full border border-white/[0.08] bg-black/55 text-white hover:bg-black/75 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
        aria-label="Diğer seçenekler"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-60 rounded-xl border border-white/[0.08] bg-[#111214] p-1.5 shadow-2xl">
          <button type="button" onClick={onCopyId} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#dbdee1] hover:bg-[#5865f2] hover:text-white">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Kullanıcı ID'sini kopyala
          </button>
          {isFriend && (
            <button type="button" onClick={onRemoveFriend} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#dbdee1] hover:bg-[#da373c] hover:text-white">
              <UserMinus className="h-4 w-4" /> Arkadaşlıktan çıkar
            </button>
          )}
          {canReport && (
            <button type="button" onClick={onReport} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#f23f42] hover:bg-[#da373c] hover:text-white">
              <Flag className="h-4 w-4" /> Şikâyet et
            </button>
          )}
          <button type="button" onClick={onBlock} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#f23f42] hover:bg-[#da373c] hover:text-white">
            <ShieldOff className="h-4 w-4" /> {isBlocked ? 'Engeli kaldır' : 'Engelle'}
          </button>
        </div>
      )}
    </div>
  );
}

function FullProfileModal({
  profile,
  details,
  roles,
  availableRoles,
  canManageRoles,
  onToggleRole,
  onClose,
  onMessage,
  onFriend,
  friendLabel,
  onCopyId,
  copied,
  onReport,
  onBlock,
  onRemoveFriend,
}) {
  const [activeTab, setActiveTab] = useState('activity');
  const [moreOpen, setMoreOpen] = useState(false);
  const [note, setNote] = useState(details?.note || '');
  const [noteSaving, setNoteSaving] = useState(false);
  const lastSavedNote = useRef(details?.note || '');
  const safeBanner = resolveSafeMediaUrl(profile.banner);
  const relationship = details?.relationship || {};
  const mutualFriends = details?.mutualFriends || [];
  const mutualServers = details?.mutualServers || [];
  const activities = details?.activities || [];
  const member = details?.serverMember;
  const displayName = member?.nickname || profile.username;

  useEffect(() => {
    const next = details?.note || '';
    setNote(next);
    lastSavedNote.current = next;
  }, [details?.note]);

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const saveNote = async () => {
    const cleanNote = note.trim().slice(0, 256);
    if (cleanNote === lastSavedNote.current || relationship.isSelf) return;
    setNoteSaving(true);
    try {
      const payload = await savePrivateUserNote(profile.id, cleanNote);
      setNote(payload.note || '');
      lastSavedNote.current = payload.note || '';
    } catch (error) {
      toast.error(error.message || 'Not kaydedilemedi.');
    } finally {
      setNoteSaving(false);
    }
  };

  const tabItems = [
    { id: 'activity', label: 'Etkinlik', count: null },
    { id: 'friends', label: 'Ortak Arkadaş', count: mutualFriends.length },
    { id: 'servers', label: 'Ortak Sunucu', count: mutualServers.length },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} tam profili`}
        className="relative flex h-[calc(100vh-48px)] max-h-[780px] w-[calc(100vw-48px)] max-w-[1160px] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#070708] shadow-[0_30px_100px_rgba(0,0,0,.75)]"
        onMouseDown={stopEvent}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31] hover:text-white"
          aria-label="Profili kapat"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid h-full min-h-0 w-full grid-cols-1 overflow-y-auto lg:grid-cols-[410px_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="min-h-full bg-[#111214] lg:overflow-y-auto">
            <div className="relative h-44 overflow-hidden" style={{ backgroundColor: getColorForString(`${profile.id}banner`) }}>
              {safeBanner && <img src={safeBanner} alt="" className="h-full w-full object-cover" />}
            </div>

            <div className="relative px-8 pb-8">
              <div className="-mt-20">
                <ProfileAvatar avatar={member?.serverAvatar || profile.avatar} username={displayName} presence={profile.status || profile.presenceStatus} size="hero" serverBorder />
              </div>

              <div className="mt-7">
                <h1 className="flex flex-wrap items-center gap-2 text-3xl font-black leading-tight text-white">
                  {displayName}
                  <ProfileBadges verified={profile.emailVerified} isOwner={member?.isOwner} isFriend={relationship.isFriend} />
                </h1>
                <p className="mt-2 flex items-center gap-2 text-base font-medium text-[#dbdee1]">
                  {profile.username}
                  {profile.customStatus && <span className="text-sm text-[#949ba4]">• {profile.customStatus}</span>}
                </p>
                {profile.bio && <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-[#b5bac1]">{profile.bio}</p>}
              </div>

              {!relationship.isSelf && (
                <div className="mt-6 flex items-center gap-2.5">
                  <button type="button" onClick={onMessage} className="flex h-10 items-center gap-2 rounded-lg bg-[#5865f2] px-5 font-bold text-white hover:bg-[#4752c4]">
                    <MessageSquare className="h-5 w-5 fill-white" /> Mesaj
                  </button>
                  <button type="button" onClick={onFriend} className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#2b2d31] px-3.5 font-semibold text-[#dbdee1] hover:bg-[#35373c]">
                    {relationship.isFriend ? <UserCheck className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                    <span className="hidden xl:inline">{friendLabel}</span>
                  </button>
                  <MoreMenu
                    open={moreOpen}
                    onToggle={() => setMoreOpen(value => !value)}
                    onCopyId={onCopyId}
                    copied={copied}
                    onReport={onReport}
                    onBlock={onBlock}
                    isBlocked={relationship.isBlocked}
                    canReport={Boolean(details?.server)}
                    onRemoveFriend={onRemoveFriend}
                    isFriend={relationship.isFriend}
                  />
                </div>
              )}

              <div className="mt-8 space-y-6 text-[#dbdee1]">
                <section>
                  <h2 className="mb-3 text-sm font-semibold text-[#949ba4]">Şu Tarihten Beri Üye:</h2>
                  <div className="flex flex-wrap items-center gap-3 text-base">
                    <span className="inline-flex items-center gap-2"><MessageSquare className="h-5 w-5 text-[#b5bac1]" /> {formatProfileDate(profile.createdAt)}</span>
                    {member?.serverProfile?.joinedAt && (
                      <><span className="text-[#6d6f78]">•</span><span className="inline-flex items-center gap-2"><Server className="h-5 w-5" /> {formatProfileDate(member.serverProfile.joinedAt)}</span></>
                    )}
                  </div>
                </section>

                {relationship.isFriend && (
                  <section>
                    <h2 className="mb-3 text-sm font-semibold text-[#949ba4]">Şu Tarihten Beri Arkadaş</h2>
                    <p className="inline-flex items-center gap-2 text-base"><CalendarDays className="h-5 w-5" /> {formatProfileDate(relationship.friendsSince)}</p>
                  </section>
                )}

                <section>
                  <h2 className="mb-3 text-sm font-semibold text-[#949ba4]">Roller</h2>
                  <RoleChips roles={roles} availableRoles={availableRoles} canManage={canManageRoles} onToggleRole={onToggleRole} />
                  {!roles.filter(role => !role.isDefault).length && !canManageRoles && <p className="text-sm text-[#6d6f78]">Atanmış özel rol yok.</p>}
                </section>

                {!relationship.isSelf && (
                  <section>
                    <div className="mb-2 flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-[#949ba4]">Not (sadece sana görünür)</h2>
                      {noteSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#949ba4]" />}
                    </div>
                    <textarea
                      value={note}
                      onChange={event => setNote(event.target.value.slice(0, 256))}
                      onBlur={saveNote}
                      onKeyDown={event => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur();
                      }}
                      rows={3}
                      placeholder="Not eklemek için tıkla"
                      className="w-full resize-none rounded-lg border border-transparent bg-transparent px-0 py-2 text-base italic text-[#dbdee1] outline-none placeholder:text-[#6d6f78] hover:border-white/[0.08] hover:px-3 focus:border-[#5865f2] focus:bg-[#0b0b0d] focus:px-3"
                    />
                  </section>
                )}
              </div>
            </div>
          </aside>

          <main className="min-h-0 bg-[#09090b] px-8 pb-8 pt-16 lg:overflow-y-auto">
            <nav className="sticky top-0 z-20 flex gap-10 border-b border-white/[0.1] bg-[#09090b]">
              {tabItems.map(tab => (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative pb-4 text-base font-bold transition-colors ${activeTab === tab.id ? 'text-white' : 'text-[#949ba4] hover:text-[#dbdee1]'}`}
                >
                  {tab.label}{tab.count !== null ? ` ${tab.count}` : ''}
                  {activeTab === tab.id && <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-white" />}
                </button>
              ))}
            </nav>

            {activeTab === 'activity' && (
              <section className="pt-8">
                <h2 className="mb-4 text-base font-medium text-[#949ba4]">Son Etkinlik</h2>
                <div className="space-y-3">
                  {activities.length ? activities.map(activity => (
                    <RichPresenceCard key={activity.sessionId || activity.id} activity={activity} />
                  )) : (
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] text-center">
                      <Gamepad2 className="h-12 w-12 text-[#4e5058]" />
                      <p className="mt-4 font-semibold text-[#b5bac1]">Yakın zamanda etkinlik yok</p>
                      <p className="mt-1 text-sm text-[#6d6f78]">Kullanıcının oyun veya özel durum etkinliği burada görünür.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'friends' && (
              <section className="pt-8">
                <h2 className="mb-4 text-base font-medium text-[#949ba4]">{mutualFriends.length} Ortak Arkadaş</h2>
                <div className="grid gap-3 xl:grid-cols-2">
                  {mutualFriends.map(friend => {
                    const avatar = resolveSafeMediaUrl(friend.avatar);
                    return (
                      <article key={friend.id} className="flex items-center gap-4 rounded-xl bg-[#1e1f22] p-4">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white" style={{ backgroundColor: getColorForString(friend.username) }}>
                          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : friend.username?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0"><p className="truncate font-bold text-white">{friend.username}</p><p className="text-sm text-[#949ba4]">{friend.customStatus || (friend.status === 'online' ? 'Çevrimiçi' : 'Çevrimdışı')}</p></div>
                      </article>
                    );
                  })}
                  {!mutualFriends.length && <p className="text-[#949ba4]">Ortak arkadaşınız yok.</p>}
                </div>
              </section>
            )}

            {activeTab === 'servers' && (
              <section className="pt-8">
                <h2 className="mb-4 text-base font-medium text-[#949ba4]">{mutualServers.length} Ortak Sunucu</h2>
                <div className="grid gap-3 xl:grid-cols-2">
                  {mutualServers.map(server => {
                    const icon = resolveSafeMediaUrl(server.icon);
                    return (
                      <article key={server.id} className="flex items-center gap-4 rounded-xl bg-[#1e1f22] p-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-bold text-white" style={{ backgroundColor: getColorForString(server.name) }}>
                          {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : server.name?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0"><p className="truncate font-bold text-white">{server.name}</p><p className="text-sm text-[#949ba4]">{server.memberCount} üye</p></div>
                      </article>
                    );
                  })}
                  {!mutualServers.length && <p className="text-[#949ba4]">Ortak sunucunuz yok.</p>}
                </div>
              </section>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

export default function UserPopover({ targetUser, onClose, anchorRect = null }) {
  const { user: currentUser } = useAuth();
  const { socket } = useSocket();
  const { setActiveDM } = useDM();
  const { currentServer, setCurrentServer } = useServer();
  const baseUser = useMemo(() => ({ ...(targetUser?.user || {}), ...(targetUser || {}) }), [targetUser]);
  const targetId = baseUser.id || baseUser.userId;
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const payload = await fetchUserProfile(targetId, currentServer?.id || '');
      setDetails(payload);
    } catch (error) {
      toast.error(error.message || 'Profil bilgileri alınamadı.');
    } finally {
      setLoading(false);
    }
  }, [targetId, currentServer?.id]);

  useEffect(() => {
    let active = true;
    if (!targetId) return undefined;
    setLoading(true);
    fetchUserProfile(targetId, currentServer?.id || '')
      .then(payload => { if (active) setDetails(payload); })
      .catch(error => { if (active) toast.error(error.message || 'Profil bilgileri alınamadı.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [targetId, currentServer?.id]);

  useEffect(() => {
    if (!socket || !targetId) return undefined;
    const handleRichPresenceUpdate = payload => {
      if (String(payload?.userId || '') !== String(targetId)) return;
      setDetails(previous => previous ? { ...previous, activities: payload.activities || [] } : previous);
    };
    socket.on('rich-presence:update', handleRichPresenceUpdate);
    return () => socket.off('rich-presence:update', handleRichPresenceUpdate);
  }, [socket, targetId]);

  const profile = { ...baseUser, ...(details?.user || {}) };
  const member = details?.serverMember || baseUser;
  const relationship = details?.relationship || { isSelf: currentUser?.id === targetId };
  const displayName = member?.nickname || profile.username || 'Kullanıcı';
  const accountName = profile.username || displayName;
  const avatar = member?.serverAvatar || profile.avatar;
  const safeBanner = resolveSafeMediaUrl(profile.banner);
  const roles = member?.roles || baseUser.roles || [];
  const mutualFriends = details?.mutualFriends || [];
  const mutualServers = details?.mutualServers || [];
  const activities = details?.activities || [];
  const presence = profile.status || profile.presenceStatus || 'offline';
  const canManageRoles = Boolean(details?.viewer?.canManageRoles && currentServer?.id && !relationship.isSelf);
  const compactPosition = getCompactPosition(anchorRect);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [expanded]);

  const handleCopyId = async () => {
    if (!targetId) return;
    try {
      await navigator.clipboard.writeText(targetId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Kullanıcı ID kopyalandı.');
    } catch (_) {
      toast.error('Kullanıcı ID kopyalanamadı.');
    }
  };

  const handleSendMessage = async () => {
    try {
      const conversation = await createDMConversation(currentUser.id, targetId);
      const completeConversation = { ...conversation, otherUser: profile };
      setActiveDM(completeConversation);
      setCurrentServer(null);
      window.dispatchEvent(new CustomEvent('tahosapp:navigate-to-dm', { detail: { conversation: completeConversation } }));
      onClose();
    } catch (error) {
      toast.error(error.message || 'Mesaj başlatılamadı.');
    }
  };

  const handleFriend = async () => {
    if (relationship.isBlocked) return toast.error('Önce kullanıcının engelini kaldır.');
    if (relationship.isFriend) return handleRemoveFriend();
    if (relationship.pendingRequest?.direction === 'outgoing') return toast('Arkadaşlık isteği zaten gönderildi.');
    try {
      if (relationship.pendingRequest?.direction === 'incoming') {
        await acceptFriendRequest(relationship.pendingRequest.id);
        toast.success('Arkadaşlık isteği kabul edildi.');
      } else {
        await sendFriendRequest(currentUser.id, accountName);
        toast.success('Arkadaşlık isteği gönderildi.');
      }
      await loadProfile();
    } catch (error) {
      toast.error(error.message || 'Arkadaşlık işlemi tamamlanamadı.');
    }
  };

  const handleRemoveFriend = async () => {
    if (!relationship.isFriend) return;
    if (!window.confirm(`${displayName} kullanıcısını arkadaşlıktan çıkarmak istiyor musun?`)) return;
    try {
      await removeFriend(currentUser.id, targetId);
      toast.success('Arkadaşlıktan çıkarıldı.');
      await loadProfile();
    } catch (error) {
      toast.error(error.message || 'Arkadaşlık kaldırılamadı.');
    }
  };

  const handleBlock = async () => {
    const action = relationship.isBlocked ? 'engelini kaldırmak' : 'engellemek';
    if (!window.confirm(`${displayName} kullanıcısının ${action} istiyor musun?`)) return;
    try {
      if (relationship.isBlocked) await unblockUser(targetId);
      else await blockUser(targetId);
      toast.success(relationship.isBlocked ? 'Kullanıcının engeli kaldırıldı.' : 'Kullanıcı engellendi.');
      setMoreOpen(false);
      await loadProfile();
    } catch (error) {
      toast.error(error.message || 'İşlem tamamlanamadı.');
    }
  };

  const handleReport = async () => {
    if (!currentServer?.id) return;
    const reason = window.prompt(`${displayName} kullanıcısını neden şikâyet ediyorsun?`);
    if (!reason?.trim()) return;
    try {
      await createReport(currentServer.id, { type: 'user', targetUserId: targetId, reason: reason.trim() });
      toast.success('Şikâyet moderatörlere gönderildi.');
      setMoreOpen(false);
    } catch (error) {
      toast.error(error.message || 'Şikâyet gönderilemedi.');
    }
  };

  const handleToggleRole = async roleId => {
    if (!canManageRoles) return;
    const roleIds = new Set(member?.roleIds || roles.map(role => role.id));
    if (roleIds.has(roleId)) roleIds.delete(roleId);
    else roleIds.add(roleId);
    try {
      const payload = await assignMemberRoles(currentServer.id, targetId, [...roleIds], currentUser.id);
      setDetails(previous => ({ ...previous, serverMember: payload.member }));
      toast.success('Kullanıcı rolleri güncellendi.');
    } catch (error) {
      toast.error(error.message || 'Roller güncellenemedi.');
    }
  };

  const friendLabel = relationship.isFriend
    ? 'Arkadaş'
    : relationship.pendingRequest?.direction === 'incoming'
      ? 'İsteği Kabul Et'
      : relationship.pendingRequest?.direction === 'outgoing'
        ? 'İstek Gönderildi'
        : 'Arkadaş Ekle';

  if (!targetId) return null;

  if (expanded) {
    return createPortal(
      <FullProfileModal
        profile={profile}
        details={details}
        roles={roles}
        availableRoles={details?.availableRoles || []}
        canManageRoles={canManageRoles}
        onToggleRole={handleToggleRole}
        onClose={onClose}
        onMessage={handleSendMessage}
        onFriend={handleFriend}
        friendLabel={friendLabel}
        onCopyId={handleCopyId}
        copied={copied}
        onReport={handleReport}
        onBlock={handleBlock}
        onRemoveFriend={handleRemoveFriend}
      />,
      document.body,
    );
  }

  return createPortal(
    <div className={`fixed inset-0 z-[110] ${compactPosition ? '' : 'flex items-center justify-center p-4'}`} onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${displayName} profili`}
        title="Tam profili açmak için karta tekrar tıkla"
        onMouseDown={stopEvent}
        onClick={() => setExpanded(true)}
        style={compactPosition || undefined}
        className={`${compactPosition ? 'absolute' : 'relative w-full max-w-[350px]'} cursor-pointer overflow-hidden rounded-xl border border-white/[0.1] bg-[#111214] shadow-[0_24px_80px_rgba(0,0,0,.8)]`}
      >
        <div className="relative h-24 overflow-hidden" style={{ backgroundColor: getColorForString(`${targetId}banner`) }}>
          {safeBanner && <img src={safeBanner} alt="" className="h-full w-full object-cover" />}
          {!relationship.isSelf && (
            <div className="absolute right-3 top-3 flex gap-1.5" onClick={stopEvent}>
              <button type="button" onClick={handleBlock} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-black/65 text-white hover:bg-black/80" aria-label={relationship.isBlocked ? 'Engeli kaldır' : 'Engelle'}>
                <ShieldOff className="h-5 w-5" />
              </button>
              <button type="button" onClick={handleFriend} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-black/65 text-white hover:bg-black/80" aria-label={friendLabel}>
                {relationship.isFriend ? <UserCheck className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              </button>
              <MoreMenu
                compact
                open={moreOpen}
                onToggle={() => setMoreOpen(value => !value)}
                onCopyId={handleCopyId}
                copied={copied}
                onReport={handleReport}
                onBlock={handleBlock}
                isBlocked={relationship.isBlocked}
                canReport={Boolean(currentServer?.id)}
                onRemoveFriend={handleRemoveFriend}
                isFriend={relationship.isFriend}
              />
            </div>
          )}
        </div>

        <div className="relative px-4 pb-4">
          <div className="-mt-12 scale-90 origin-left">
            <ProfileAvatar avatar={avatar} username={displayName} presence={presence} serverBorder />
          </div>

          <div className="mt-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-black text-white">{displayName}</h2>
              {loading && <Loader2 className="h-5 w-5 animate-spin text-[#949ba4]" />}
            </div>
            <p className="mt-1 flex items-center gap-2 text-sm text-[#dbdee1]">
              <span className="truncate">{accountName}</span>
              <ProfileBadges verified={profile.emailVerified} isOwner={member?.isOwner} isFriend={relationship.isFriend} />
            </p>
            {profile.customStatus && <p className="mt-2 text-sm text-[#b5bac1]">{profile.customStatus}</p>}
            {activities[0] && <div className="mt-3"><RichPresenceCard activity={activities[0]} compact /></div>}
          </div>

          <button
            type="button"
            onClick={event => { stopEvent(event); setExpanded(true); }}
            className="mt-4 flex w-full items-center gap-2 text-left text-xs text-[#949ba4] hover:text-[#dbdee1]"
          >
            <MutualAvatars users={mutualFriends} />
            <span>{mutualFriends.length} Ortak Arkadaş</span>
            <span>•</span>
            <span>{mutualServers.length} Ortak Sunucu</span>
          </button>

          <div className="mt-4">
            <RoleChips
              compact
              roles={roles}
              availableRoles={details?.availableRoles || []}
              canManage={canManageRoles}
              onToggleRole={handleToggleRole}
            />
          </div>

          {!relationship.isSelf && (
            <div className="mt-4 flex gap-2" onClick={stopEvent}>
              <button type="button" onClick={handleSendMessage} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#5865f2] px-4 py-2.5 font-semibold text-white hover:bg-[#4752c4]">
                <MessageSquare className="h-4 w-4" /> Mesaj
              </button>
              <button type="button" onClick={() => setExpanded(true)} className="rounded-lg bg-[#2b2d31] px-4 py-2.5 font-semibold text-[#dbdee1] hover:bg-[#35373c]">Profili Gör</button>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
