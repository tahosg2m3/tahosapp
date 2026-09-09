import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Crown,
  Image,
  Save,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import { getColorForString } from '../../utils/colors';
import { resolveSafeMediaUrl } from '../../utils/safeMediaUrl';
import MemberManagementModal from './MemberManagementModal';
import RoleManagementModal from './RoleManagementModal';
import ServerPlatformModal from './ServerPlatformModal';
import { buildInviteUrl } from '../../utils/inviteLinks';
import {
  getServerMembers,
  getServerRoles,
  permissionsToMap,
  removeServer,
  transferServerOwnership,
  unwrapMembers,
  unwrapRoles,
  updateServerDetails,
} from './serverManagementApi';

const ownerTabs = [
  { id: 'overview', label: 'Overview', icon: Settings },
  { id: 'roles', label: 'Roller', icon: Shield },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'community', label: 'Topluluk Merkezi', icon: Sparkles },
  { id: 'delete', label: 'Danger Zone', icon: Trash2, danger: true },
];

export default function ServerSettingsModal({ onClose, initialTab = 'overview' }) {
  const { currentServer, setCurrentServer, setCurrentChannel, setServers } = useServer();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [serverName, setServerName] = useState(currentServer?.name || '');
  const [serverIcon, setServerIcon] = useState(currentServer?.icon || '');
  const [serverBanner, setServerBanner] = useState(currentServer?.banner || '');
  const [description, setDescription] = useState(currentServer?.description || '');
  const [discoveryEnabled, setDiscoveryEnabled] = useState(Boolean(currentServer?.discoveryEnabled));
  const [vanityCode, setVanityCode] = useState(currentServer?.vanityCode || '');
  const [defaultNotificationMode, setDefaultNotificationMode] = useState(currentServer?.defaultNotificationMode || 'mentions');
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [failedServerIconUrl, setFailedServerIconUrl] = useState('');

  const isOwner = Boolean(currentServer && user?.id && currentServer.creatorId === user.id);
  const visibleTabs = isOwner
    ? ownerTabs
    : ownerTabs.filter(tab => tab.id === 'community');
  const serverColor = useMemo(() => getColorForString(currentServer?.name || 'Sunucu'), [currentServer?.name]);
  const safeServerIconUrl = resolveSafeMediaUrl(serverIcon);
  const serverIconPreviewUrl = safeServerIconUrl === failedServerIconUrl ? null : safeServerIconUrl;

  useEffect(() => {
    if (!currentServer?.id) return undefined;

    setServerName(currentServer.name || '');
    setServerIcon(currentServer.icon || '');
    setFailedServerIconUrl('');
    setServerBanner(currentServer.banner || '');
    setDescription(currentServer.description || '');
    setDiscoveryEnabled(Boolean(currentServer.discoveryEnabled));
    setVanityCode(currentServer.vanityCode || '');
    setDefaultNotificationMode(currentServer.defaultNotificationMode || 'mentions');
    setIsLoading(true);

    Promise.all([getServerRoles(currentServer.id), getServerMembers(currentServer.id)])
      .then(([rolePayload, memberPayload]) => {
        setRoles(unwrapRoles(rolePayload));
        setMembers(unwrapMembers(memberPayload));
        setPermissions(permissionsToMap(rolePayload?.currentUserPermissions || rolePayload?.permissions || []));
      })
      .catch((error) => {
        // Sunucu sahibi, roles verisi yüklenmese bile genel ayarları görebilir.
        console.error('Could not load server settings:', error);
        toast.error(error.message || 'Could not load server settings.');
      })
      .finally(() => setIsLoading(false));

    return undefined;
  }, [currentServer?.id]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!visibleTabs.some(tab => tab.id === activeTab)) setActiveTab('community');
  }, [activeTab, visibleTabs]);

  const refreshMembers = async () => {
    if (!currentServer?.id) return;
    try {
      const payload = await getServerMembers(currentServer.id);
      setMembers(unwrapMembers(payload));
    } catch (error) {
      console.error('Members yenilenemedi:', error);
    }
  };

  const handleSaveOverview = async () => {
    if (!isOwner || !serverName.trim()) return;

    setIsSaving(true);
    try {
      const updated = await updateServerDetails(currentServer.id, {
        name: serverName.trim(),
        icon: serverIcon.trim(),
        banner: serverBanner.trim(),
        description: description.trim(),
        discoveryEnabled,
        vanityCode: vanityCode.trim().toLowerCase().replace(/[^a-z0-9-_]/g, ''),
        defaultNotificationMode,
        actorId: user.id,
      });
      const nextServer = { ...currentServer, ...(updated.server || updated) };
      setServers((previous) => previous.map((server) => (server.id === currentServer.id ? nextServer : server)));
      setCurrentServer(nextServer);
      toast.success('Server settings saved.');
    } catch (error) {
      toast.error(error.message || 'Server settings could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const copyInvite = async () => {
    if (!currentServer?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(buildInviteUrl(currentServer.inviteCode));
      setCopied(true);
      toast.success('Invite link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('The invite link could not be copied.');
    }
  };

  const handleDelete = async () => {
    if (!isOwner) return;
    const confirmation = window.prompt(`To delete the server, type “${currentServer.name}” yaz.`);
    if (confirmation !== currentServer.name) {
      if (confirmation !== null) toast.error('The server name does not match.');
      return;
    }

    setIsSaving(true);
    try {
      await removeServer(currentServer.id, user.id);
      setServers((previous) => previous.filter((server) => server.id !== currentServer.id));
      setCurrentServer(null);
      setCurrentChannel(null);
      toast.success('Sunucu silindi.');
      onClose?.();
    } catch (error) {
      toast.error(error.message || 'Sunucu silinemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferTargetId || !isOwner) return;
    const target = members.find((member) => (member.id || member.userId || member.user?.id) === transferTargetId);
    const targetName = target?.username || target?.user?.username || 'the selected member';
    if (!window.confirm(`Transfer server ownership to ${targetName}? You will no longer be able to change these settings.`)) return;

    setIsSaving(true);
    try {
      const updated = await transferServerOwnership(currentServer.id, transferTargetId);
      const nextServer = { ...currentServer, ...(updated.server || updated) };
      setServers((previous) => previous.map((server) => (server.id === currentServer.id ? nextServer : server)));
      setCurrentServer(nextServer);
      toast.success('Server ownership transferred.');
      onClose?.();
    } catch (error) {
      toast.error(error.message || 'Server ownership could not be transferred.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!currentServer) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6">
      <div className="flex h-[min(760px,calc(100vh-24px))] w-full max-w-6xl overflow-hidden rounded-lg border border-black/40 bg-[#313338] shadow-2xl">
        <aside className="flex w-[205px] shrink-0 flex-col border-r border-black/30 bg-[#2B2D31] px-2 py-5 sm:w-[230px]">
          <div className="mb-4 px-3">
            <p className="truncate text-sm font-bold text-[#F2F3F5]">{currentServer.name}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[#949BA4]">Server Settings</p>
          </div>

          <nav className="space-y-0.5">
            {visibleTabs.map(({ id, label, icon: Icon, danger }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium transition ${activeTab === id ? (danger ? 'bg-[#F23F42]/15 text-[#F23F42]' : 'bg-[#404249] text-white') : (danger ? 'text-[#F23F42] hover:bg-[#F23F42]/10' : 'text-[#B5BAC1] hover:bg-[#35373C] hover:text-[#DBDEE1]')}`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          {isOwner && <div className="mt-auto border-t border-black/25 px-3 pt-4"><div className="flex items-center gap-2 text-xs text-[#B5BAC1]"><Crown className="h-4 w-4 text-[#FEE75C]" /> Sunucu sahibi</div></div>}
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#313338]">
          <button type="button" onClick={onClose} title="Close" className="absolute right-4 top-4 z-20 rounded-full border border-[#B5BAC1] p-1.5 text-[#B5BAC1] transition hover:border-white hover:text-white">
            <X className="h-4 w-4" />
          </button>

          {activeTab === 'overview' && (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-10">
              <div className="mx-auto max-w-[650px] pb-20">
                <h1 className="text-xl font-bold text-[#F2F3F5]">Overview</h1>
                <p className="mt-1 text-sm text-[#B5BAC1]">Manage the server’s display name, icon, and invite.</p>

                <div className="mt-7 rounded-lg border border-black/25 bg-[#2B2D31] p-5">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[28px] text-3xl font-bold text-white shadow-lg" style={{ backgroundColor: serverColor }}>
                      {serverIconPreviewUrl ? <img src={serverIconPreviewUrl} alt="Sunucu ikonu" className="h-full w-full object-cover" onError={() => setFailedServerIconUrl(serverIconPreviewUrl)} /> : serverName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]">Server name</label>
                      <input value={serverName} onChange={(event) => setServerName(event.target.value)} maxLength={100} className="w-full rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none transition focus:border-[#00A8FC]" />
                    </div>
                  </div>

                  <div className="mt-5">
                    <label className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]"><Image className="h-3.5 w-3.5" /> Server icon URL</label>
                    <input value={serverIcon} onChange={(event) => setServerIcon(event.target.value)} placeholder="https://example.com/server-icon.png" className="w-full rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none transition placeholder:text-[#72767D] focus:border-[#00A8FC]" />
                    <p className="mt-2 text-xs leading-5 text-[#949BA4]">Paste an image URL. If left blank, the server initials will be used.</p>
                  </div>
                  <div className="mt-5">
                    <label className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]"><Image className="h-3.5 w-3.5" /> Server banner URL</label>
                    <input value={serverBanner} onChange={(event) => setServerBanner(event.target.value)} placeholder="https://example.com/server-banner.png" className="w-full rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none transition placeholder:text-[#72767D] focus:border-[#00A8FC]" />
                  </div>
                  <label className="mt-5 block"><span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]">Server description</span><textarea rows="4" maxLength="500" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full resize-none rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none transition focus:border-[#00A8FC]" /></label>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label><span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]">Custom invite code</span><input value={vanityCode} onChange={(event) => setVanityCode(event.target.value)} placeholder="my-community" className="w-full rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none focus:border-[#00A8FC]" /></label>
                    <label><span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[#B5BAC1]">Default notifications</span><select value={defaultNotificationMode} onChange={(event) => setDefaultNotificationMode(event.target.value)} className="w-full rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#F2F3F5] outline-none focus:border-[#00A8FC]"><option value="all">All messages</option><option value="mentions">Mentions only</option><option value="nothing">Nothing</option></select></label>
                  </div>
                  <label className="mt-5 flex items-center justify-between rounded-lg bg-[#1E1F22] px-3 py-3 text-sm text-[#DBDEE1]"><span><strong className="block">Show in Server Discovery</strong><small className="text-[#949BA4]">Anyone can find this server in discovery.</small></span><input type="checkbox" checked={discoveryEnabled} onChange={(event) => setDiscoveryEnabled(event.target.checked)} /></label>
                </div>

                <div className="mt-7 rounded-lg border border-black/25 bg-[#2B2D31] p-5">
                  <h2 className="text-sm font-bold text-[#F2F3F5]">Invite Link</h2>
                  <p className="mt-1 text-xs leading-5 text-[#949BA4]">Anyone who opens this link can join the server after signing in.</p>
                  <div className="mt-4 flex items-center gap-2 rounded-[4px] bg-[#1E1F22] p-2">
                    <code className="min-w-0 flex-1 truncate px-2 text-xs font-bold text-[#DBDEE1]">{buildInviteUrl(currentServer.inviteCode) || '—'}</code>
                    <button type="button" onClick={copyInvite} className="flex shrink-0 items-center gap-2 rounded bg-[#5865F2] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#4752C4]">
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end border-t border-black/30 bg-[#232428] px-6 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
                <button type="button" onClick={handleSaveOverview} disabled={isSaving || !serverName.trim()} className="flex items-center gap-2 rounded bg-[#23A559] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D8046] disabled:cursor-not-allowed disabled:opacity-50">
                  <Save className="h-4 w-4" /> {isSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'roles' && (
            isLoading ? <LoadingState label="Loading roles…" /> : <RoleManagementModal serverId={currentServer.id} actorId={user.id} roles={roles} onRolesChange={setRoles} isOwner={isOwner} />
          )}

          {activeTab === 'members' && (
            isLoading ? <LoadingState label="Loading members…" /> : <MemberManagementModal embedded serverId={currentServer.id} actorId={user.id} roles={roles} members={members} permissions={permissions} isOwner={isOwner} onMembersChange={setMembers} />
          )}

          {activeTab === 'community' && (
            <ServerPlatformModal embedded initialTab="events" permissions={permissions} isOwner={isOwner} />
          )}

          {activeTab === 'delete' && (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-10">
              <div className="mx-auto max-w-[650px]">
                <h1 className="text-xl font-bold text-[#F2F3F5]">Danger Zone</h1>
                <p className="mt-1 text-sm text-[#B5BAC1]">These actions cannot be undone.</p>
                <div className="mt-7 rounded-lg border border-[#F23F42]/60 bg-[#F23F42]/10 p-5">
                  <div className="flex gap-4">
                    <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-[#F23F42]" />
                    <div>
                      <h2 className="font-bold text-[#F23F42]">Sunucuyu Sil</h2>
                      <p className="mt-1 text-sm leading-6 text-[#DBDEE1]">Channels, messages, roles, and membership data will be permanently deleted. This action cannot be undone.</p>
                      <button type="button" onClick={handleDelete} disabled={isSaving} className="mt-4 rounded bg-[#DA373C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#A12828] disabled:opacity-50">
                        <Trash2 className="mr-2 inline h-4 w-4" /> Sunucuyu Sil
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-5 rounded-lg border border-[#F0B232]/50 bg-[#F0B232]/10 p-5">
                  <div className="flex gap-4">
                    <Crown className="mt-0.5 h-6 w-6 shrink-0 text-[#F0B232]" />
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold text-[#F0B232]">Transfer Server Ownership</h2>
                      <p className="mt-1 text-sm leading-6 text-[#DBDEE1]">Make another member the server owner. After the transfer, you will no longer be able to change these settings.</p>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <select value={transferTargetId} onChange={(event) => setTransferTargetId(event.target.value)} className="min-w-0 flex-1 rounded-[3px] border border-transparent bg-[#1E1F22] px-3 py-2 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]">
                          <option value="">Choose a new owner</option>
                          {members.filter((member) => !(member.isOwner || (member.id || member.userId || member.user?.id) === user.id)).map((member) => {
                            const memberId = member.id || member.userId || member.user?.id;
                            return <option key={memberId} value={memberId}>{member.username || member.user?.username || memberId}</option>;
                          })}
                        </select>
                        <button type="button" onClick={handleTransferOwnership} disabled={isSaving || !transferTargetId} className="shrink-0 rounded bg-[#F0B232] px-4 py-2 text-sm font-medium text-[#1E1F22] transition hover:bg-[#D99B00] disabled:cursor-not-allowed disabled:opacity-50">Transfer Ownership</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LoadingState({ label }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-[#949BA4]">
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-[#5865F2] border-t-transparent" />
      {label}
    </div>
  );
}
