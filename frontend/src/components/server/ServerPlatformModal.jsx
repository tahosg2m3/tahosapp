import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Bot,
  CalendarDays,
  Check,
  ClipboardList,
  Copy,
  Download,
  Gavel,
  Gift,
  Link,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Smile,
  Sparkles,
  Trash2,
  UserCheck,
  Webhook,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  createCommand,
  createEvent,
  createInvite,
  createBackup,
  createServerAsset,
  createServerTemplate,
  createWebhook,
  deleteCommand,
  deleteBackup,
  deleteEvent,
  deleteServerAsset,
  deleteWebhook,
  exportServer,
  getAutomod,
  getOnboarding,
  getServerStats,
  listAuditLogs,
  listBackups,
  listBans,
  listCommands,
  listEvents,
  listInvites,
  listReports,
  listServerAssets,
  listServerTemplates,
  listServerTrash,
  listWebhooks,
  purgeServerTrash,
  resolveReport,
  restoreBackup,
  restoreServerTrash,
  revokeInvite,
  rsvpEvent,
  saveAutomod,
  saveOnboarding,
  unbanMember,
} from '../../services/platformApi';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import { useSocket } from '../../context/SocketContext';
import { fetchChannels } from '../../services/api';
import { buildInviteUrl } from '../../utils/inviteLinks';

const TAB_GROUPS = [
  {
    label: 'Topluluk',
    tabs: [
      { id: 'events', label: 'Events', icon: CalendarDays },
      { id: 'invites', label: 'Davetler', icon: Link, permission: 'MANAGE_SERVER' },
      { id: 'onboarding', label: 'Onboarding', icon: UserCheck, owner: true },
    ],
  },
  {
    label: 'Safety',
    tabs: [
      { id: 'automod', label: 'Otomatik Moderasyon', icon: ShieldCheck, permission: 'MANAGE_SERVER' },
      { id: 'reports', label: 'Reports', icon: Gavel, permission: 'MODERATE_MEMBERS' },
      { id: 'bans', label: 'Yasaklananlar', icon: Gavel, permission: 'BAN_MEMBERS' },
      { id: 'audit', label: 'Audit Log', icon: ClipboardList, permission: 'VIEW_AUDIT_LOG' },
    ],
  },
  {
    label: 'Advanced',
    tabs: [
      { id: 'stats', label: 'Analytics', icon: Activity, permission: 'MANAGE_SERVER' },
      { id: 'integrations', label: 'Bot and Webhook', icon: Bot, owner: true },
      { id: 'assets', label: 'Emoji and Sticker', icon: Smile, permission: 'MANAGE_EMOJIS_AND_STICKERS' },
      { id: 'trash', label: 'Trash', icon: Trash2, permission: 'MANAGE_CHANNELS' },
      { id: 'templates', label: 'Templates and Backup', icon: Gift, owner: true },
    ],
  },
];

const fieldClass = 'w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-[#e2e8f0] outline-none transition focus:border-[#3b82f6] placeholder:text-[#64748b]';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-sm font-semibold text-[#cbd5e1] transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-40';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40';

function asArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function formatDate(value) {
  if (!value) return 'Never expires';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-US');
}

function Panel({ title, description, action, children }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-[#f8fafc]">{title}</h3>
          {description && <p className="mt-1 text-xs leading-5 text-[#94a3b8]">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-white/[0.1] px-4 py-8 text-center text-sm text-[#64748b]">{children}</div>;
}

export default function ServerPlatformModal({ onClose, initialTab = 'events', canManage = false, isOwner = false, permissions = {}, embedded = false }) {
  const { currentServer } = useServer();
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const serverId = currentServer?.id;
  const permissionMap = useMemo(() => Array.isArray(permissions)
    ? Object.fromEntries(permissions.map(permission => [permission, true]))
    : permissions || {}, [permissions]);
  const hasPermission = permission => isOwner || permissionMap.ADMINISTRATOR || permissionMap[permission];
  const allowedTabs = useMemo(() => TAB_GROUPS.map(group => ({
    ...group,
    tabs: group.tabs.filter(tab => (!tab.owner || isOwner) && (!tab.permission || hasPermission(tab.permission))),
  })).filter(group => group.tabs.length), [isOwner, permissionMap]);
  const allTabs = useMemo(() => allowedTabs.flatMap(group => group.tabs), [allowedTabs]);
  const [activeTab, setActiveTab] = useState(() => allTabs.some(tab => tab.id === initialTab) ? initialTab : allTabs[0]?.id || 'events');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    if (!serverId) return undefined;
    let live = true;
    setLoading(true);
    const loaders = {
      events: () => listEvents(serverId),
      invites: () => listInvites(serverId),
      onboarding: () => getOnboarding(serverId),
      automod: () => getAutomod(serverId),
      reports: () => listReports(serverId),
      bans: () => listBans(serverId),
      audit: () => listAuditLogs(serverId),
      stats: () => getServerStats(serverId),
      integrations: async () => ({
        webhooks: asArray(await listWebhooks(serverId), ['webhooks']),
        commands: asArray(await listCommands(serverId), ['commands']),
        channels: asArray(await fetchChannels(serverId), ['channels']).filter(channel => ['text', 'announcement'].includes(channel.type || 'text')),
      }),
      assets: async () => ({
        emojis: asArray(await listServerAssets(serverId, 'emojis'), ['emojis', 'items']),
        stickers: asArray(await listServerAssets(serverId, 'stickers'), ['stickers', 'items']),
      }),
      trash: () => listServerTrash(serverId),
      templates: async () => ({
        templates: asArray(await listServerTemplates(serverId), ['templates']),
        backups: asArray(await listBackups(serverId), ['backups']),
      }),
    };
    const loader = loaders[activeTab];
    if (!loader) return undefined;
    loader()
      .then(payload => { if (live) setData(payload); })
      .catch(error => { if (live) { setData(null); toast.error(error.message); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [activeTab, refreshKey, serverId]);

  useEffect(() => {
    if (!socket || !serverId) return undefined;
    const activeScopes = {
      events: ['events'],
      invites: ['invites'],
      onboarding: ['onboarding'],
      automod: ['automod'],
      reports: ['reports'],
      bans: ['bans'],
      audit: ['audit'],
      stats: ['stats'],
      integrations: ['webhooks', 'commands', 'channels'],
      assets: ['emojis', 'stickers', 'assets'],
      trash: ['trash'],
      templates: ['templates', 'backups'],
    };
    const shouldRefresh = payload => String(payload?.serverId || '') === String(serverId)
      && (activeScopes[activeTab] || []).includes(payload?.scope);
    const onPlatformUpdate = payload => { if (shouldRefresh(payload)) refresh(); };
    const onAudit = payload => {
      if (activeTab === 'audit' && String(payload?.serverId || '') === String(serverId)) refresh();
    };
    socket.on('platform:update', onPlatformUpdate);
    socket.on('audit:new', onAudit);
    return () => {
      socket.off('platform:update', onPlatformUpdate);
      socket.off('audit:new', onAudit);
    };
  }, [activeTab, refresh, serverId, socket]);

  useEffect(() => {
    if (!allTabs.some(tab => tab.id === activeTab)) setActiveTab(allTabs[0]?.id || 'events');
  }, [activeTab, allTabs]);

  useEffect(() => {
    const onKey = event => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!serverId) return null;

  const content = loading ? (
    <div className="flex h-64 items-center justify-center text-sm text-[#94a3b8]">Uploading…</div>
  ) : activeTab === 'events' ? (
    <EventsTab serverId={serverId} payload={data} userId={user?.id} canManage={hasPermission('MANAGE_EVENTS')} refresh={refresh} />
  ) : activeTab === 'invites' ? (
    <InvitesTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'automod' ? (
    <AutomodTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'onboarding' ? (
    <OnboardingTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'audit' ? (
    <AuditTab payload={data} />
  ) : activeTab === 'reports' ? (
    <ReportsTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'bans' ? (
    <BansTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'stats' ? (
    <StatsTab payload={data} />
  ) : activeTab === 'integrations' ? (
    <IntegrationsTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'assets' ? (
    <AssetsTab serverId={serverId} payload={data} refresh={refresh} />
  ) : activeTab === 'trash' ? (
    <TrashTab serverId={serverId} payload={data} refresh={refresh} />
  ) : (
    <>
      <TemplatesTab serverId={serverId} payload={data} refresh={refresh} serverName={currentServer.name} />
      <BackupManager serverId={serverId} payload={data} refresh={refresh} />
    </>
  );

  const modal = (
    <div className={embedded ? 'flex h-full min-h-0 w-full bg-[#0f172a]' : 'fixed inset-0 z-[100] flex bg-black/75 backdrop-blur-sm'}>
      <aside className={`${embedded ? 'w-[230px]' : 'w-[280px]'} shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#0b1220] px-4 py-6 custom-scrollbar`}>
        <div className="mb-6 px-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#64748b]">Server Hub</p>
          <h2 className="mt-1 truncate text-lg font-bold text-white">{currentServer.name}</h2>
        </div>
        <nav className="space-y-5">
          {allowedTabs.map(group => (
            <div key={group.label}>
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-[#64748b]">{group.label}</p>
              <div className="space-y-0.5">
                {group.tabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${activeTab === tab.id ? 'bg-[#2563eb] text-white' : 'text-[#94a3b8] hover:bg-white/[0.06] hover:text-[#e2e8f0]'}`}>
                      <Icon className="h-4 w-4" /> {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#0f172a]">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/[0.07] bg-[#0f172a]/90 px-8 backdrop-blur-xl">
          <div><h1 className="font-bold text-white">{allTabs.find(tab => tab.id === activeTab)?.label}</h1><p className="text-xs text-[#64748b]">Changes are applied to the server immediately.</p></div>
          {!embedded && <button type="button" onClick={onClose} className="rounded-full border border-white/[0.1] p-2 text-[#94a3b8] transition hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>}
        </header>
        <div className="mx-auto max-w-5xl space-y-4 px-8 py-7">{content}</div>
      </main>
    </div>
  );
  return embedded ? modal : createPortal(modal, document.body);
}

function InvitesTab({ serverId, payload, refresh }) {
  const invites = asArray(payload, ['invites']);
  const [maxUses, setMaxUses] = useState(0);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const submit = async event => {
    event.preventDefault();
    try {
      const created = await createInvite(serverId, { maxUses: Number(maxUses) || 0, maxAgeSeconds: Math.max(0, Number(expiresInHours) || 0) * 3600 });
      await navigator.clipboard?.writeText(buildInviteUrl(created.code || created.invite?.code || ''));
      toast.success('Invite created and link copied.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };
  return <>
    <Panel title="New invite" description="Choose how long the invite lasts and how many times it can be used.">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-semibold text-[#94a3b8]">Use limit<input type="number" min="0" value={maxUses} onChange={e => setMaxUses(e.target.value)} className={`${fieldClass} mt-1.5`} /></label>
        <label className="text-xs font-semibold text-[#94a3b8]">Expires in (hours)<input type="number" min="0" value={expiresInHours} onChange={e => setExpiresInHours(e.target.value)} className={`${fieldClass} mt-1.5`} /></label>
        <button className={`${primaryButton} self-end`}><Plus className="h-4 w-4" /> Create</button>
      </form>
    </Panel>
    <Panel title="Active invites" description="Expired or revoked links cannot be used.">
      {invites.length === 0 ? <Empty>No active invites.</Empty> : <div className="space-y-2">{invites.map(invite => <div key={invite.id || invite.code} className="flex items-center gap-3 rounded-xl bg-[#0f172a] p-3"><code className="min-w-0 flex-1 truncate font-bold text-[#93c5fd]">{buildInviteUrl(invite.code)}</code><span className="shrink-0 text-xs text-[#64748b]">{invite.uses || 0}/{invite.maxUses || '∞'} uses · {formatDate(invite.expiresAt)}</span><div className="flex shrink-0 gap-1"><button className={secondaryButton} onClick={() => navigator.clipboard?.writeText(buildInviteUrl(invite.code)).then(() => toast.success('Invite link copied.'))}><Copy className="h-4 w-4" /></button><button className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10" onClick={() => revokeInvite(serverId, invite.id || invite.code).then(refresh).catch(error => toast.error(error.message))}><Trash2 className="h-4 w-4" /></button></div></div>)}</div>}
    </Panel>
  </>;
}

function EventsTab({ serverId, payload, userId, canManage, refresh }) {
  const events = asArray(payload, ['events']);
  const [form, setForm] = useState({ name: '', description: '', startsAt: '', location: '' });
  const [submitting, setSubmitting] = useState(false);
  const minimumStart = useMemo(() => {
    const date = new Date(Date.now() + 60_000);
    date.setSeconds(0, 0);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }, []);
  const submit = async event => {
    event.preventDefault();
    const startsAt = new Date(form.startsAt).getTime();
    if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
      toast.error('Choose a future start time for the event.');
      return;
    }
    setSubmitting(true);
    try {
      await createEvent(serverId, { ...form, startsAt, type: 'external' });
      setForm({ name: '', description: '', startsAt: '', location: '' });
      await refresh();
      toast.success('Event created.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };
  const choices = [
    ['going', 'Going'],
    ['interested', 'Interested'],
    ['not_going', 'Not going'],
  ];
  return <>
    {canManage && <Panel title="Schedule an event" description="Members can RSVP and see the start time."><form onSubmit={submit} className="grid gap-3 md:grid-cols-2"><input required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={fieldClass} placeholder="Event name" /><input type="datetime-local" min={minimumStart} required value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} className={fieldClass} /><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={fieldClass} placeholder="Location or voice channel" /><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={fieldClass} placeholder="Description" /><button disabled={submitting} className={`${primaryButton} md:col-span-2 disabled:cursor-not-allowed disabled:opacity-50`}><CalendarDays className="h-4 w-4" /> {submitting ? 'Creating…' : 'Schedule'}</button></form></Panel>}
    <Panel title="Upcoming events">{events.length === 0 ? <Empty>No scheduled events.</Empty> : <div className="grid gap-3 md:grid-cols-2">{events.map(item => {
      const rsvps = item.rsvps || {};
      const statusOf = value => typeof value === 'string' ? value : value?.status || null;
      const currentStatus = statusOf(rsvps[userId]) || item.currentUserStatus || null;
      return <article key={item.id} className="rounded-xl border border-white/[0.07] bg-[#0f172a] p-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-[#2563eb]/15 p-2 text-[#60a5fa]"><CalendarDays className="h-5 w-5" /></div><div className="min-w-0"><h4 className="font-bold text-white">{item.name || item.title}</h4><p className="text-xs text-[#94a3b8]">{formatDate(item.startsAt || item.scheduledStartAt)}</p>{item.location && <p className="mt-1 truncate text-xs text-[#64748b]">{item.location}</p>}</div></div>{item.description && <p className="mt-3 text-sm text-[#cbd5e1]">{item.description}</p>}<div className="mt-3 flex flex-wrap gap-2">{choices.map(([status, label]) => { const count = Object.values(rsvps).filter(value => statusOf(value) === status).length; return <button type="button" key={status} className={currentStatus === status ? primaryButton : secondaryButton} onClick={() => rsvpEvent(serverId, item.id, status).then(refresh).catch(error => toast.error(error.message))}>{status === 'going' && <Check className="h-4 w-4" />}{label} ({count})</button>; })}{canManage && <button type="button" className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10" onClick={() => deleteEvent(serverId, item.id).then(refresh).catch(error => toast.error(error.message))}><Trash2 className="h-4 w-4" /></button>}</div></article>;
    })}</div>}</Panel>
  </>;
}

function AutomodTab({ serverId, payload, refresh }) {
  const initial = payload?.automod || payload || {};
  const normalize = value => ({ enabled: value.enabled ?? true, blockedWords: (value.blockedWords || []).join(', '), blockLinks: value.blockLinks ?? false, blockInvites: value.blockInvites ?? true, spamMessageCount: value.spamMessageCount || value.maxMessagesPerInterval || 6, capsPercentage: value.capsPercentage || value.capsThreshold || 75, action: value.action || 'block' });
  const [form, setForm] = useState(() => normalize(initial));
  useEffect(() => setForm(normalize(initial)), [payload]);
  const save = async () => { try { await saveAutomod(serverId, { ...form, blockedWords: form.blockedWords.split(',').map(word => word.trim()).filter(Boolean), spamMessageCount: Number(form.spamMessageCount), capsPercentage: Number(form.capsPercentage) }); toast.success('Auto moderation saved.'); refresh(); } catch (error) { toast.error(error.message); } };
  return <Panel title="Auto moderation" description="Stops spam, harmful links, invites, and blocked words before messages are sent." action={<button className={primaryButton} onClick={save}><Save className="h-4 w-4" /> Save</button>}><div className="grid gap-4 md:grid-cols-2"><Toggle label="Enable auto moderation" checked={form.enabled} onChange={value => setForm({ ...form, enabled: value })} /><Toggle label="Block server invites" checked={form.blockInvites} onChange={value => setForm({ ...form, blockInvites: value })} /><Toggle label="Block all links" checked={form.blockLinks} onChange={value => setForm({ ...form, blockLinks: value })} /><label className="text-xs font-semibold text-[#94a3b8]">Capital letter limit (%)<input type="number" min="20" max="100" className={`${fieldClass} mt-1.5`} value={form.capsPercentage} onChange={e => setForm({ ...form, capsPercentage: e.target.value })} /></label><label className="text-xs font-semibold text-[#94a3b8]">Messages allowed in a short period<input type="number" min="2" max="30" className={`${fieldClass} mt-1.5`} value={form.spamMessageCount} onChange={e => setForm({ ...form, spamMessageCount: e.target.value })} /></label><label className="text-xs font-semibold text-[#94a3b8]">Violation action<select className={`${fieldClass} mt-1.5`} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}><option value="block">Block message</option><option value="warn">Warn</option><option value="timeout">Apply timeout</option></select></label><label className="text-xs font-semibold text-[#94a3b8] md:col-span-2">Blocked words<input className={`${fieldClass} mt-1.5`} value={form.blockedWords} onChange={e => setForm({ ...form, blockedWords: e.target.value })} placeholder="word1, word2" /></label></div></Panel>;
}

function Toggle({ label, checked, onChange }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#0f172a] px-4 py-3 text-left text-sm text-[#cbd5e1]"><span>{label}</span><span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#2563eb]' : 'bg-[#334155]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} /></span></button>;
}

function OnboardingTab({ serverId, payload, refresh }) {
  const initial = payload?.onboarding || payload || {};
  const normalize = value => ({
    enabled: value.enabled ?? false,
    welcomeMessage: value.welcomeMessage || '',
    rules: (value.rules || []).map(rule => typeof rule === 'string' ? rule : rule.title || rule.description).filter(Boolean).join('\n'),
    questions: (value.questions || []).map(question => {
      if (typeof question === 'string') return question;
      const options = (question.options || []).map(option => option.title).filter(Boolean).join(', ');
      return `${question.title || ''}${options ? ` | ${options}` : ''}`;
    }).filter(Boolean).join('\n'),
    verificationLevel: value.verificationLevel || 'email',
  });
  const [form, setForm] = useState(() => normalize(initial));
  useEffect(() => setForm(normalize(initial)), [payload]);
  const save = async () => {
    const questions = form.questions.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [title, optionText = ''] = line.split('|').map(value => value.trim());
      return {
        title,
        multiple: true,
        required: false,
        options: optionText.split(',').map(value => value.trim()).filter(Boolean).map(titleValue => ({ title: titleValue })),
      };
    });
    try {
      await saveOnboarding(serverId, { ...form, rules: form.rules.split('\n').map(value => value.trim()).filter(Boolean), questions });
      toast.success('Onboarding settings saved.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };
  return <Panel title="New member experience" description="New members review the rules and personalize the server before chatting." action={<button className={primaryButton} onClick={save}><Save className="h-4 w-4" /> Save</button>}><div className="space-y-4"><Toggle label="Enable onboarding and rule acceptance" checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })} /><label className="block text-xs font-semibold text-[#94a3b8]">Welcome message<textarea rows="3" className={`${fieldClass} mt-1.5 resize-none`} value={form.welcomeMessage} onChange={e => setForm({ ...form, welcomeMessage: e.target.value })} /></label><label className="block text-xs font-semibold text-[#94a3b8]">Rules — one per line<textarea rows="6" className={`${fieldClass} mt-1.5 resize-none`} value={form.rules} onChange={e => setForm({ ...form, rules: e.target.value })} /></label><label className="block text-xs font-semibold text-[#94a3b8]">Interest questions — “Question | Option 1, Option 2”<textarea rows="4" className={`${fieldClass} mt-1.5 resize-none`} value={form.questions} onChange={e => setForm({ ...form, questions: e.target.value })} placeholder="Which games do you enjoy? | FPS, Strategy, Racing" /></label><label className="block text-xs font-semibold text-[#94a3b8]">Verification level<select className={`${fieldClass} mt-1.5`} value={form.verificationLevel} onChange={e => setForm({ ...form, verificationLevel: e.target.value })}><option value="none">None</option><option value="email">Verified email</option><option value="rules">Accept the rules</option><option value="high">Strict verification</option></select></label></div></Panel>;
}

function AuditTab({ payload }) {
  const entries = asArray(payload, ['entries', 'logs', 'auditLogs']);
  return <Panel title="Audit log" description="Administrative actions are recorded with an immutable timestamp.">{entries.length === 0 ? <Empty>No administrative actions have been recorded yet.</Empty> : <div className="space-y-1">{entries.map((entry, index) => <div key={entry.id || index} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/[0.04]"><div className="rounded-lg bg-[#334155]/50 p-2 text-[#94a3b8]"><ClipboardList className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm text-[#e2e8f0]"><strong>{entry.actorUsername || entry.actor?.username || 'System'}</strong> · {entry.actionLabel || entry.action || 'action'}</p><p className="truncate text-xs text-[#64748b]">{entry.targetUsername || entry.targetName || entry.reason || entry.details || ''}</p></div><time className="text-[11px] text-[#64748b]">{formatDate(entry.timestamp || entry.createdAt)}</time></div>)}</div>}</Panel>;
}

function BansTab({ serverId, payload, refresh }) {
  const bans = asArray(payload, ['bans']);
  return <Panel title="Banned users" description="Unbanned users can join again with an invite link.">{bans.length === 0 ? <Empty>No banned users.</Empty> : <div className="space-y-2">{bans.map(ban => { const userId = ban.userId || ban.user?.id || ban.id; return <div key={userId} className="flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ef4444]/15 font-bold text-[#f87171]">{(ban.username || ban.user?.username || '?')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{ban.username || ban.user?.username || userId}</p><p className="truncate text-xs text-[#64748b]">{ban.reason || 'No reason provided'} · {formatDate(ban.createdAt || ban.bannedAt)}</p></div><button type="button" className={secondaryButton} onClick={() => unbanMember(serverId, userId).then(() => { toast.success('The user was unbanned.'); refresh(); }).catch(error => toast.error(error.message))}>Remove ban</button></div>; })}</div>}</Panel>;
}

function TrashTab({ serverId, payload, refresh }) {
  const entries = asArray(payload, ['trash', 'entries', 'items']);
  const [busyId, setBusyId] = useState(null);

  const restore = async entry => {
    setBusyId(entry.id);
    try {
      const result = await restoreServerTrash(serverId, entry.id);
      const restoredMessages = Number(result?.restoredMessages || 0);
      toast.success(restoredMessages > 0
        ? `The channel and ${restoredMessages} messages were restored.`
        : 'Channel restored.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async entry => {
    const channelName = entry.channel?.name || 'this channel';
    if (!window.confirm(`#${channelName} permanently? This action cannot be undone.`)) return;
    setBusyId(entry.id);
    try {
      await purgeServerTrash(serverId, entry.id);
      toast.success('Channel permanently deleted.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel title="Channel trash" description="Deleted channels and messages can be restored until they expire. Permanent deletion cannot be undone.">
      {entries.length === 0 ? <Empty>No channels in the trash.</Empty> : (
        <div className="space-y-2">
          {entries.map(entry => {
            const channel = entry.channel || {};
            const isBusy = busyId === entry.id;
            return (
              <article key={entry.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#0f172a] px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#e2e8f0]">#{channel.name || 'deleted-channel'}</p>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {channel.type || 'text'} · {Number(entry.messageCount || 0)} messages · Deleted: {formatDate(entry.deletedAt)} · Expires: {formatDate(entry.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={isBusy} onClick={() => restore(entry)} className={secondaryButton}>
                    <RotateCcw className="h-4 w-4" /> Restore
                  </button>
                  <button type="button" disabled={isBusy} onClick={() => purge(entry)} className="inline-flex items-center gap-2 rounded-lg border border-[#ef4444]/25 px-3 py-2 text-sm font-semibold text-[#f87171] transition hover:bg-[#ef4444]/10 disabled:cursor-not-allowed disabled:opacity-40">
                    <Trash2 className="h-4 w-4" /> Delete permanently
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ReportsTab({ serverId, payload, refresh }) {
  const reports = asArray(payload, ['reports']);
  return <Panel title="Member reports" description="Review open reports and mark them as resolved.">{reports.length === 0 ? <Empty>No open reports.</Empty> : <div className="space-y-3">{reports.map(report => <article key={report.id} className="rounded-xl border border-white/[0.07] bg-[#0f172a] p-4"><div className="flex items-start justify-between"><div><p className="font-semibold text-white">{report.reason || report.category || 'Report'}</p><p className="mt-1 text-xs text-[#94a3b8]">Reported by: {report.reporterUsername || report.reporter?.username || 'Member'} · Target: {report.targetUsername || report.target?.username || 'Message'}</p></div><span className="rounded-full bg-[#f59e0b]/15 px-2 py-1 text-[10px] font-bold uppercase text-[#fbbf24]">{report.status || 'open'}</span></div>{report.description && <p className="mt-3 text-sm text-[#cbd5e1]">{report.description}</p>}<button className={`${secondaryButton} mt-3`} onClick={() => resolveReport(serverId, report.id, { status: 'resolved' }).then(refresh).catch(error => toast.error(error.message))}><Check className="h-4 w-4" /> Resolved</button></article>)}</div>}</Panel>;
}

function StatsTab({ payload }) {
  const stats = payload?.stats || payload || {};
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = stats.daily?.[todayKey] || {};
  const totals = stats.totals || {};
  const cards = [['Member', stats.currentMembers ?? 0], ['Messages today', today.messagesSent ?? 0], ['Total messages', totals.messagesSent ?? 0], ['Voice minutes', totals.voiceMinutes ?? 0]];
  const messagesPerMember = stats.currentMembers ? (Number(totals.messagesSent || 0) / stats.currentMembers).toFixed(1) : '0';
  return <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5"><p className="text-xs font-semibold text-[#64748b]">{label}</p><p className="mt-2 text-3xl font-bold text-white">{value}</p></div>)}</div><Panel title="Server health" description="Activity data is updated regularly."><div className="grid gap-3 md:grid-cols-3"><Metric label="Messages per member" value={messagesPerMember} /><Metric label="Joined today" value={today.membersJoined ?? 0} /><Metric label="Total reports" value={totals.reportsCreated ?? 0} /></div></Panel></>;
}

function Metric({ label, value }) { return <div className="rounded-xl bg-[#0f172a] p-4"><p className="text-xs text-[#64748b]">{label}</p><p className="mt-1 text-xl font-bold text-[#cbd5e1]">{value}</p></div>; }

function IntegrationsTab({ serverId, payload, refresh }) {
  const webhooks = asArray(payload?.webhooks, ['webhooks']);
  const commands = asArray(payload?.commands, ['commands']);
  const channels = asArray(payload?.channels, ['channels']);
  const [hookName, setHookName] = useState('');
  const [hookChannelId, setHookChannelId] = useState('');
  const [command, setCommand] = useState({ name: '', response: '' });
  return <><Panel title="Webhooks" description="Lets external services send messages securely to selected channels."><form className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]" onSubmit={async e => { e.preventDefault(); try { const result = await createWebhook(serverId, { name: hookName, channelId: hookChannelId }); setHookName(''); if (result.url || result.webhookUrl) await navigator.clipboard?.writeText(result.url || result.webhookUrl); toast.success('Webhook created. The URL is shown only once.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={hookName} onChange={e => setHookName(e.target.value)} placeholder="Webhook name" /><select required className={fieldClass} value={hookChannelId} onChange={e => setHookChannelId(e.target.value)}><option value="">Target channel</option>{channels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><button className={primaryButton}><Webhook className="h-4 w-4" /> Create</button></form>{webhooks.length === 0 ? <Empty>No webhooks found.</Empty> : webhooks.map(item => <Row key={item.id} title={item.name} subtitle={channels.find(channel => channel.id === item.channelId)?.name ? `#${channels.find(channel => channel.id === item.channelId).name}` : formatDate(item.createdAt)} onDelete={() => deleteWebhook(serverId, item.id).then(refresh).catch(error => toast.error(error.message))} />)}</Panel><Panel title="Slash commands" description="Show an automatic response when a command such as /rules is entered."><form className="mb-4 grid gap-2 md:grid-cols-[180px_1fr_auto]" onSubmit={async e => { e.preventDefault(); try { await createCommand(serverId, command); setCommand({ name: '', response: '' }); toast.success('Command added.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={command.name} onChange={e => setCommand({ ...command, name: e.target.value.replace(/^\//, '') })} placeholder="command" /><input required className={fieldClass} value={command.response} onChange={e => setCommand({ ...command, response: e.target.value })} placeholder="Response" /><button className={primaryButton}><Plus className="h-4 w-4" /> Add</button></form>{commands.length === 0 ? <Empty>No custom commands.</Empty> : commands.map(item => <Row key={item.id} title={`/${item.name}`} subtitle={item.response} onDelete={() => deleteCommand(serverId, item.id).then(refresh).catch(error => toast.error(error.message))} />)}</Panel></>;
}

function AssetsTab({ serverId, payload, refresh }) {
  const [form, setForm] = useState({ type: 'emojis', name: '', url: '' });
  const items = form.type === 'emojis' ? payload?.emojis || [] : payload?.stickers || [];
  const submit = async e => { e.preventDefault(); try { await createServerAsset(serverId, form.type, { name: form.name, url: form.url }); setForm({ ...form, name: '', url: '' }); toast.success('Server content eklendi.'); refresh(); } catch (error) { toast.error(error.message); } };
  return <Panel title="Custom emojis and stickers" description="Server-owned images can be used in messages."><div className="mb-4 flex gap-2"><button className={form.type === 'emojis' ? primaryButton : secondaryButton} onClick={() => setForm({ ...form, type: 'emojis' })}>Emoji</button><button className={form.type === 'stickers' ? primaryButton : secondaryButton} onClick={() => setForm({ ...form, type: 'stickers' })}>Sticker</button></div><form onSubmit={submit} className="mb-4 grid gap-2 md:grid-cols-[180px_1fr_auto]"><input required className={fieldClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Short name" /><input required type="url" className={fieldClass} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="Image URL" /><button className={primaryButton}><Plus className="h-4 w-4" /> Add</button></form>{items.length === 0 ? <Empty>No custom assets have been added yet.</Empty> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{items.map(item => <div key={item.id} className="group relative rounded-xl bg-[#0f172a] p-3 text-center"><img src={item.url} alt={item.name} className="mx-auto h-16 w-16 object-contain" /><p className="mt-2 truncate text-xs font-semibold text-[#cbd5e1]">:{item.name}:</p><button className="absolute right-1 top-1 hidden rounded p-1.5 text-[#f87171] hover:bg-[#ef4444]/10 group-hover:block" onClick={() => deleteServerAsset(serverId, form.type, item.id).then(refresh).catch(error => toast.error(error.message))}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}</Panel>;
}

function TemplatesTab({ serverId, payload, refresh, serverName }) {
  const templates = asArray(payload, ['templates']);
  const [name, setName] = useState(`${serverName} template`);
  const [isPublic, setIsPublic] = useState(false);
  const download = async () => { try { const result = await exportServer(serverId); const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${serverName.replace(/[^a-z0-9-_]+/gi, '-')}-backup.json`; anchor.click(); URL.revokeObjectURL(url); toast.success('Server backup downloaded.'); } catch (error) { toast.error(error.message); } };
  return <><Panel title="Secure backup" description="Export roles, channel settings, and community configuration as JSON." action={<button className={primaryButton} onClick={download}><Download className="h-4 w-4" /> Download backup</button>}><p className="text-sm text-[#94a3b8]">Passwords, tokens, direct messages, and personal email addresses are never included in backups.</p></Panel><Panel title="Server templates" description="Reuse role and channel layouts for new servers."><form className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto]" onSubmit={async e => { e.preventDefault(); try { await createServerTemplate(serverId, { name, isPublic }); toast.success('Template created.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={name} onChange={e => setName(e.target.value)} /><label className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs font-semibold text-[#94a3b8]"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} /> Public</label><button className={primaryButton}><Sparkles className="h-4 w-4" /> Save</button></form>{templates.length === 0 ? <Empty>No saved templates.</Empty> : templates.map(item => <Row key={item.id} title={item.name} subtitle={`${item.channels?.length || item.channelCount || 0} channels · ${item.roles?.length || item.roleCount || 0} roles${item.public ? ' · Public' : ''}`} />)}</Panel></>;
}

function BackupManager({ serverId, payload, refresh }) {
  const backups = asArray(payload?.backups, ['backups']);
  const [name, setName] = useState('Manuel yedek');
  const [busyId, setBusyId] = useState(null);

  const makeBackup = async (event) => {
    event.preventDefault();
    try {
      await createBackup(serverId, { name: name.trim() || 'Manuel yedek' });
      toast.success('Restorable server backup created.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };

  const restore = async (backup) => {
    if (!window.confirm('This backup will overwrite the current channel, role, and server settings. Continue?')) return;
    setBusyId(backup.id);
    try {
      await restoreBackup(serverId, backup.id);
      toast.success('Server backup restored.');
      refresh();
    } catch (error) { toast.error(error.message); }
    finally { setBusyId(null); }
  };

  const remove = async (backup) => {
    if (!window.confirm('Permanently delete this backup?')) return;
    try {
      await deleteBackup(serverId, backup.id);
      toast.success('Yedek silindi.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };

  return (
    <Panel title="Restore points" description="Save channel, role, and community settings in a server-side restore point.">
      <form onSubmit={makeBackup} className="mb-4 flex gap-2">
        <input maxLength="100" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Backup name" />
        <button className={primaryButton}><Save className="h-4 w-4" /> Create</button>
      </form>
      {backups.length === 0 ? <Empty>No restore points have been created yet.</Empty> : backups.map(backup => (
        <div key={backup.id} className="mb-2 flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#e2e8f0]">{backup.name || 'Server backup'}</p><p className="text-xs text-[#64748b]">{formatDate(backup.createdAt)}</p></div>
          <button type="button" disabled={busyId === backup.id} onClick={() => restore(backup)} className={secondaryButton}><RotateCcw className="h-4 w-4" /> Restore</button>
          <button type="button" onClick={() => remove(backup)} className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </Panel>
  );
}

function Row({ title, subtitle, onDelete }) {
  return <div className="mb-2 flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#e2e8f0]">{title}</p>{subtitle && <p className="truncate text-xs text-[#64748b]">{subtitle}</p>}</div>{onDelete && <button className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}</div>;
}
