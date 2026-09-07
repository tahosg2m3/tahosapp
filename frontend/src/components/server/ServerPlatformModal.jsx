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
      { id: 'events', label: 'Etkinlikler', icon: CalendarDays },
      { id: 'invites', label: 'Davetler', icon: Link, permission: 'MANAGE_SERVER' },
      { id: 'onboarding', label: 'Karşılama', icon: UserCheck, owner: true },
    ],
  },
  {
    label: 'Güvenlik',
    tabs: [
      { id: 'automod', label: 'Otomatik Moderasyon', icon: ShieldCheck, permission: 'MANAGE_SERVER' },
      { id: 'reports', label: 'Şikâyetler', icon: Gavel, permission: 'MODERATE_MEMBERS' },
      { id: 'bans', label: 'Yasaklananlar', icon: Gavel, permission: 'BAN_MEMBERS' },
      { id: 'audit', label: 'Denetim Kaydı', icon: ClipboardList, permission: 'VIEW_AUDIT_LOG' },
    ],
  },
  {
    label: 'Gelişmiş',
    tabs: [
      { id: 'stats', label: 'İstatistikler', icon: Activity, permission: 'MANAGE_SERVER' },
      { id: 'integrations', label: 'Bot ve Webhook', icon: Bot, owner: true },
      { id: 'assets', label: 'Emoji ve Sticker', icon: Smile, permission: 'MANAGE_EMOJIS_AND_STICKERS' },
      { id: 'trash', label: 'Çöp Kutusu', icon: Trash2, permission: 'MANAGE_CHANNELS' },
      { id: 'templates', label: 'Şablon ve Yedek', icon: Gift, owner: true },
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
  if (!value) return 'Süresiz';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('tr-TR');
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
    <div className="flex h-64 items-center justify-center text-sm text-[#94a3b8]">Yükleniyor…</div>
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
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#64748b]">Sunucu merkezi</p>
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
          <div><h1 className="font-bold text-white">{allTabs.find(tab => tab.id === activeTab)?.label}</h1><p className="text-xs text-[#64748b]">Değişiklikler anında sunucuya uygulanır.</p></div>
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
      toast.success('Davet oluşturuldu ve bağlantı kopyalandı.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };
  return <>
    <Panel title="Yeni davet" description="Davetin ne kadar yaşayacağını ve kaç kez kullanılabileceğini belirle.">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-semibold text-[#94a3b8]">Kullanım sınırı<input type="number" min="0" value={maxUses} onChange={e => setMaxUses(e.target.value)} className={`${fieldClass} mt-1.5`} /></label>
        <label className="text-xs font-semibold text-[#94a3b8]">Geçerlilik (saat)<input type="number" min="0" value={expiresInHours} onChange={e => setExpiresInHours(e.target.value)} className={`${fieldClass} mt-1.5`} /></label>
        <button className={`${primaryButton} self-end`}><Plus className="h-4 w-4" /> Oluştur</button>
      </form>
    </Panel>
    <Panel title="Aktif davetler" description="Süresi dolan veya iptal edilen bağlantılar kullanılamaz.">
      {invites.length === 0 ? <Empty>Aktif davet bulunmuyor.</Empty> : <div className="space-y-2">{invites.map(invite => <div key={invite.id || invite.code} className="flex items-center gap-3 rounded-xl bg-[#0f172a] p-3"><code className="min-w-0 flex-1 truncate font-bold text-[#93c5fd]">{buildInviteUrl(invite.code)}</code><span className="shrink-0 text-xs text-[#64748b]">{invite.uses || 0}/{invite.maxUses || '∞'} kullanım · {formatDate(invite.expiresAt)}</span><div className="flex shrink-0 gap-1"><button className={secondaryButton} onClick={() => navigator.clipboard?.writeText(buildInviteUrl(invite.code)).then(() => toast.success('Davet bağlantısı kopyalandı.'))}><Copy className="h-4 w-4" /></button><button className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10" onClick={() => revokeInvite(serverId, invite.id || invite.code).then(refresh).catch(error => toast.error(error.message))}><Trash2 className="h-4 w-4" /></button></div></div>)}</div>}
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
      toast.error('Etkinlik için gelecekte bir başlangıç zamanı seç.');
      return;
    }
    setSubmitting(true);
    try {
      await createEvent(serverId, { ...form, startsAt, type: 'external' });
      setForm({ name: '', description: '', startsAt: '', location: '' });
      await refresh();
      toast.success('Etkinlik oluşturuldu.');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };
  const choices = [
    ['going', 'Katılacağım'],
    ['interested', 'İlgileniyorum'],
    ['not_going', 'Katılmayacağım'],
  ];
  return <>
    {canManage && <Panel title="Etkinlik planla" description="Üyeler katılım durumunu bildirebilir ve başlangıç saatini görebilir."><form onSubmit={submit} className="grid gap-3 md:grid-cols-2"><input required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={fieldClass} placeholder="Etkinlik adı" /><input type="datetime-local" min={minimumStart} required value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} className={fieldClass} /><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className={fieldClass} placeholder="Konum veya ses kanalı" /><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={fieldClass} placeholder="Açıklama" /><button disabled={submitting} className={`${primaryButton} md:col-span-2 disabled:cursor-not-allowed disabled:opacity-50`}><CalendarDays className="h-4 w-4" /> {submitting ? 'Oluşturuluyor…' : 'Planla'}</button></form></Panel>}
    <Panel title="Yaklaşan etkinlikler">{events.length === 0 ? <Empty>Planlanmış etkinlik yok.</Empty> : <div className="grid gap-3 md:grid-cols-2">{events.map(item => {
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
  const save = async () => { try { await saveAutomod(serverId, { ...form, blockedWords: form.blockedWords.split(',').map(word => word.trim()).filter(Boolean), spamMessageCount: Number(form.spamMessageCount), capsPercentage: Number(form.capsPercentage) }); toast.success('Otomatik moderasyon kaydedildi.'); refresh(); } catch (error) { toast.error(error.message); } };
  return <Panel title="Otomatik moderasyon" description="Spam, zararlı bağlantı, davet ve istenmeyen kelimeleri mesaj gönderilmeden durdurur." action={<button className={primaryButton} onClick={save}><Save className="h-4 w-4" /> Kaydet</button>}><div className="grid gap-4 md:grid-cols-2"><Toggle label="Otomatik moderasyon aktif" checked={form.enabled} onChange={value => setForm({ ...form, enabled: value })} /><Toggle label="Sunucu davetlerini engelle" checked={form.blockInvites} onChange={value => setForm({ ...form, blockInvites: value })} /><Toggle label="Tüm bağlantıları engelle" checked={form.blockLinks} onChange={value => setForm({ ...form, blockLinks: value })} /><label className="text-xs font-semibold text-[#94a3b8]">Büyük harf sınırı (%)<input type="number" min="20" max="100" className={`${fieldClass} mt-1.5`} value={form.capsPercentage} onChange={e => setForm({ ...form, capsPercentage: e.target.value })} /></label><label className="text-xs font-semibold text-[#94a3b8]">Kısa sürede izin verilen mesaj<input type="number" min="2" max="30" className={`${fieldClass} mt-1.5`} value={form.spamMessageCount} onChange={e => setForm({ ...form, spamMessageCount: e.target.value })} /></label><label className="text-xs font-semibold text-[#94a3b8]">İhlal eylemi<select className={`${fieldClass} mt-1.5`} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}><option value="block">Mesajı engelle</option><option value="warn">Uyar</option><option value="timeout">Zaman aşımı uygula</option></select></label><label className="text-xs font-semibold text-[#94a3b8] md:col-span-2">Engellenen kelimeler<input className={`${fieldClass} mt-1.5`} value={form.blockedWords} onChange={e => setForm({ ...form, blockedWords: e.target.value })} placeholder="kelime1, kelime2" /></label></div></Panel>;
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
      toast.success('Karşılama ayarları kaydedildi.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };
  return <Panel title="Yeni üye deneyimi" description="Yeni üyeler sohbet etmeden önce kuralları görür ve sunucuyu kendilerine göre düzenler." action={<button className={primaryButton} onClick={save}><Save className="h-4 w-4" /> Kaydet</button>}><div className="space-y-4"><Toggle label="Karşılama ve kural onayı aktif" checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })} /><label className="block text-xs font-semibold text-[#94a3b8]">Karşılama mesajı<textarea rows="3" className={`${fieldClass} mt-1.5 resize-none`} value={form.welcomeMessage} onChange={e => setForm({ ...form, welcomeMessage: e.target.value })} /></label><label className="block text-xs font-semibold text-[#94a3b8]">Kurallar — her satıra bir kural<textarea rows="6" className={`${fieldClass} mt-1.5 resize-none`} value={form.rules} onChange={e => setForm({ ...form, rules: e.target.value })} /></label><label className="block text-xs font-semibold text-[#94a3b8]">İlgi soruları — “Soru | Seçenek 1, Seçenek 2”<textarea rows="4" className={`${fieldClass} mt-1.5 resize-none`} value={form.questions} onChange={e => setForm({ ...form, questions: e.target.value })} placeholder="Hangi oyunları seviyorsun? | FPS, Strateji, Yarış" /></label><label className="block text-xs font-semibold text-[#94a3b8]">Doğrulama seviyesi<select className={`${fieldClass} mt-1.5`} value={form.verificationLevel} onChange={e => setForm({ ...form, verificationLevel: e.target.value })}><option value="none">Yok</option><option value="email">Doğrulanmış e-posta</option><option value="rules">Kuralları kabul etme</option><option value="high">Sıkı doğrulama</option></select></label></div></Panel>;
}

function AuditTab({ payload }) {
  const entries = asArray(payload, ['entries', 'logs', 'auditLogs']);
  return <Panel title="Denetim kaydı" description="Yönetim işlemleri değiştirilemeyen zaman damgasıyla kaydedilir.">{entries.length === 0 ? <Empty>Henüz yönetim işlemi kaydedilmemiş.</Empty> : <div className="space-y-1">{entries.map((entry, index) => <div key={entry.id || index} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/[0.04]"><div className="rounded-lg bg-[#334155]/50 p-2 text-[#94a3b8]"><ClipboardList className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm text-[#e2e8f0]"><strong>{entry.actorUsername || entry.actor?.username || 'Sistem'}</strong> · {entry.actionLabel || entry.action || 'işlem'}</p><p className="truncate text-xs text-[#64748b]">{entry.targetUsername || entry.targetName || entry.reason || entry.details || ''}</p></div><time className="text-[11px] text-[#64748b]">{formatDate(entry.timestamp || entry.createdAt)}</time></div>)}</div>}</Panel>;
}

function BansTab({ serverId, payload, refresh }) {
  const bans = asArray(payload, ['bans']);
  return <Panel title="Yasaklanan kullanıcılar" description="Yasağı kaldırılan kullanıcılar yeniden davet bağlantısıyla katılabilir.">{bans.length === 0 ? <Empty>Yasaklanmış kullanıcı yok.</Empty> : <div className="space-y-2">{bans.map(ban => { const userId = ban.userId || ban.user?.id || ban.id; return <div key={userId} className="flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ef4444]/15 font-bold text-[#f87171]">{(ban.username || ban.user?.username || '?')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{ban.username || ban.user?.username || userId}</p><p className="truncate text-xs text-[#64748b]">{ban.reason || 'Neden belirtilmedi'} · {formatDate(ban.createdAt || ban.bannedAt)}</p></div><button type="button" className={secondaryButton} onClick={() => unbanMember(serverId, userId).then(() => { toast.success('Kullanıcının yasağı kaldırıldı.'); refresh(); }).catch(error => toast.error(error.message))}>Yasağı kaldır</button></div>; })}</div>}</Panel>;
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
        ? `Kanal ve ${restoredMessages} mesaj geri yüklendi.`
        : 'Kanal geri yüklendi.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async entry => {
    const channelName = entry.channel?.name || 'bu kanal';
    if (!window.confirm(`#${channelName} kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusyId(entry.id);
    try {
      await purgeServerTrash(serverId, entry.id);
      toast.success('Kanal kalıcı olarak silindi.');
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel title="Kanal çöp kutusu" description="Silinen kanallar ve mesajları süre dolana kadar geri yüklenebilir. Kalıcı silme işlemi geri alınamaz.">
      {entries.length === 0 ? <Empty>Çöp kutusunda kanal yok.</Empty> : (
        <div className="space-y-2">
          {entries.map(entry => {
            const channel = entry.channel || {};
            const isBusy = busyId === entry.id;
            return (
              <article key={entry.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#0f172a] px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#e2e8f0]">#{channel.name || 'silinen-kanal'}</p>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {channel.type || 'text'} · {Number(entry.messageCount || 0)} mesaj · Silinme: {formatDate(entry.deletedAt)} · Süre sonu: {formatDate(entry.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={isBusy} onClick={() => restore(entry)} className={secondaryButton}>
                    <RotateCcw className="h-4 w-4" /> Geri yükle
                  </button>
                  <button type="button" disabled={isBusy} onClick={() => purge(entry)} className="inline-flex items-center gap-2 rounded-lg border border-[#ef4444]/25 px-3 py-2 text-sm font-semibold text-[#f87171] transition hover:bg-[#ef4444]/10 disabled:cursor-not-allowed disabled:opacity-40">
                    <Trash2 className="h-4 w-4" /> Kalıcı sil
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
  return <Panel title="Üye şikâyetleri" description="Açık şikâyetleri inceleyip çözüldü olarak işaretle.">{reports.length === 0 ? <Empty>Açık şikâyet yok.</Empty> : <div className="space-y-3">{reports.map(report => <article key={report.id} className="rounded-xl border border-white/[0.07] bg-[#0f172a] p-4"><div className="flex items-start justify-between"><div><p className="font-semibold text-white">{report.reason || report.category || 'Şikâyet'}</p><p className="mt-1 text-xs text-[#94a3b8]">Bildiren: {report.reporterUsername || report.reporter?.username || 'Üye'} · Hedef: {report.targetUsername || report.target?.username || 'Mesaj'}</p></div><span className="rounded-full bg-[#f59e0b]/15 px-2 py-1 text-[10px] font-bold uppercase text-[#fbbf24]">{report.status || 'open'}</span></div>{report.description && <p className="mt-3 text-sm text-[#cbd5e1]">{report.description}</p>}<button className={`${secondaryButton} mt-3`} onClick={() => resolveReport(serverId, report.id, { status: 'resolved' }).then(refresh).catch(error => toast.error(error.message))}><Check className="h-4 w-4" /> Çözüldü</button></article>)}</div>}</Panel>;
}

function StatsTab({ payload }) {
  const stats = payload?.stats || payload || {};
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = stats.daily?.[todayKey] || {};
  const totals = stats.totals || {};
  const cards = [['Üye', stats.currentMembers ?? 0], ['Bugünkü mesaj', today.messagesSent ?? 0], ['Toplam mesaj', totals.messagesSent ?? 0], ['Ses dakikası', totals.voiceMinutes ?? 0]];
  const messagesPerMember = stats.currentMembers ? (Number(totals.messagesSent || 0) / stats.currentMembers).toFixed(1) : '0';
  return <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-[#151d2c] p-5"><p className="text-xs font-semibold text-[#64748b]">{label}</p><p className="mt-2 text-3xl font-bold text-white">{value}</p></div>)}</div><Panel title="Sunucu sağlığı" description="Aktiflik verileri düzenli aralıklarla güncellenir."><div className="grid gap-3 md:grid-cols-3"><Metric label="Mesaj/üye" value={messagesPerMember} /><Metric label="Bugün katılan" value={today.membersJoined ?? 0} /><Metric label="Toplam rapor" value={totals.reportsCreated ?? 0} /></div></Panel></>;
}

function Metric({ label, value }) { return <div className="rounded-xl bg-[#0f172a] p-4"><p className="text-xs text-[#64748b]">{label}</p><p className="mt-1 text-xl font-bold text-[#cbd5e1]">{value}</p></div>; }

function IntegrationsTab({ serverId, payload, refresh }) {
  const webhooks = asArray(payload?.webhooks, ['webhooks']);
  const commands = asArray(payload?.commands, ['commands']);
  const channels = asArray(payload?.channels, ['channels']);
  const [hookName, setHookName] = useState('');
  const [hookChannelId, setHookChannelId] = useState('');
  const [command, setCommand] = useState({ name: '', response: '' });
  return <><Panel title="Webhook’lar" description="Dış servislerin belirli kanallara güvenli mesaj göndermesini sağlar."><form className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]" onSubmit={async e => { e.preventDefault(); try { const result = await createWebhook(serverId, { name: hookName, channelId: hookChannelId }); setHookName(''); if (result.url || result.webhookUrl) await navigator.clipboard?.writeText(result.url || result.webhookUrl); toast.success('Webhook oluşturuldu. URL yalnızca bir kez gösterilir.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={hookName} onChange={e => setHookName(e.target.value)} placeholder="Webhook adı" /><select required className={fieldClass} value={hookChannelId} onChange={e => setHookChannelId(e.target.value)}><option value="">Hedef kanal</option>{channels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><button className={primaryButton}><Webhook className="h-4 w-4" /> Oluştur</button></form>{webhooks.length === 0 ? <Empty>Webhook bulunmuyor.</Empty> : webhooks.map(item => <Row key={item.id} title={item.name} subtitle={channels.find(channel => channel.id === item.channelId)?.name ? `#${channels.find(channel => channel.id === item.channelId).name}` : formatDate(item.createdAt)} onDelete={() => deleteWebhook(serverId, item.id).then(refresh).catch(error => toast.error(error.message))} />)}</Panel><Panel title="Slash komutları" description="Örneğin /kurallar yazıldığında otomatik bir yanıt göster."><form className="mb-4 grid gap-2 md:grid-cols-[180px_1fr_auto]" onSubmit={async e => { e.preventDefault(); try { await createCommand(serverId, command); setCommand({ name: '', response: '' }); toast.success('Komut eklendi.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={command.name} onChange={e => setCommand({ ...command, name: e.target.value.replace(/^\//, '') })} placeholder="komut" /><input required className={fieldClass} value={command.response} onChange={e => setCommand({ ...command, response: e.target.value })} placeholder="Yanıt" /><button className={primaryButton}><Plus className="h-4 w-4" /> Ekle</button></form>{commands.length === 0 ? <Empty>Özel komut yok.</Empty> : commands.map(item => <Row key={item.id} title={`/${item.name}`} subtitle={item.response} onDelete={() => deleteCommand(serverId, item.id).then(refresh).catch(error => toast.error(error.message))} />)}</Panel></>;
}

function AssetsTab({ serverId, payload, refresh }) {
  const [form, setForm] = useState({ type: 'emojis', name: '', url: '' });
  const items = form.type === 'emojis' ? payload?.emojis || [] : payload?.stickers || [];
  const submit = async e => { e.preventDefault(); try { await createServerAsset(serverId, form.type, { name: form.name, url: form.url }); setForm({ ...form, name: '', url: '' }); toast.success('Sunucu içeriği eklendi.'); refresh(); } catch (error) { toast.error(error.message); } };
  return <Panel title="Özel emoji ve sticker" description="Sunucuya ait görseller mesajlarda kullanılabilir."><div className="mb-4 flex gap-2"><button className={form.type === 'emojis' ? primaryButton : secondaryButton} onClick={() => setForm({ ...form, type: 'emojis' })}>Emoji</button><button className={form.type === 'stickers' ? primaryButton : secondaryButton} onClick={() => setForm({ ...form, type: 'stickers' })}>Sticker</button></div><form onSubmit={submit} className="mb-4 grid gap-2 md:grid-cols-[180px_1fr_auto]"><input required className={fieldClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Kısa ad" /><input required type="url" className={fieldClass} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="Görsel URL’si" /><button className={primaryButton}><Plus className="h-4 w-4" /> Ekle</button></form>{items.length === 0 ? <Empty>Henüz özel içerik eklenmemiş.</Empty> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{items.map(item => <div key={item.id} className="group relative rounded-xl bg-[#0f172a] p-3 text-center"><img src={item.url} alt={item.name} className="mx-auto h-16 w-16 object-contain" /><p className="mt-2 truncate text-xs font-semibold text-[#cbd5e1]">:{item.name}:</p><button className="absolute right-1 top-1 hidden rounded p-1.5 text-[#f87171] hover:bg-[#ef4444]/10 group-hover:block" onClick={() => deleteServerAsset(serverId, form.type, item.id).then(refresh).catch(error => toast.error(error.message))}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}</Panel>;
}

function TemplatesTab({ serverId, payload, refresh, serverName }) {
  const templates = asArray(payload, ['templates']);
  const [name, setName] = useState(`${serverName} şablonu`);
  const [isPublic, setIsPublic] = useState(false);
  const download = async () => { try { const result = await exportServer(serverId); const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${serverName.replace(/[^a-z0-9-_]+/gi, '-')}-backup.json`; anchor.click(); URL.revokeObjectURL(url); toast.success('Sunucu yedeği indirildi.'); } catch (error) { toast.error(error.message); } };
  return <><Panel title="Güvenli yedek" description="Roller, kanal ayarları ve topluluk yapılandırmasını JSON olarak dışa aktar." action={<button className={primaryButton} onClick={download}><Download className="h-4 w-4" /> Yedeği indir</button>}><p className="text-sm text-[#94a3b8]">Şifreler, tokenlar, özel mesajlar ve kişisel e-posta adresleri yedeğe dahil edilmez.</p></Panel><Panel title="Sunucu şablonları" description="Yeni sunucular için rol ve kanal düzenini tekrar kullan."><form className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto]" onSubmit={async e => { e.preventDefault(); try { await createServerTemplate(serverId, { name, isPublic }); toast.success('Şablon oluşturuldu.'); refresh(); } catch (error) { toast.error(error.message); } }}><input required className={fieldClass} value={name} onChange={e => setName(e.target.value)} /><label className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs font-semibold text-[#94a3b8]"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} /> Herkese açık</label><button className={primaryButton}><Sparkles className="h-4 w-4" /> Kaydet</button></form>{templates.length === 0 ? <Empty>Kayıtlı şablon yok.</Empty> : templates.map(item => <Row key={item.id} title={item.name} subtitle={`${item.channels?.length || item.channelCount || 0} kanal · ${item.roles?.length || item.roleCount || 0} rol${item.public ? ' · Herkese açık' : ''}`} />)}</Panel></>;
}

function BackupManager({ serverId, payload, refresh }) {
  const backups = asArray(payload?.backups, ['backups']);
  const [name, setName] = useState('Manuel yedek');
  const [busyId, setBusyId] = useState(null);

  const makeBackup = async (event) => {
    event.preventDefault();
    try {
      await createBackup(serverId, { name: name.trim() || 'Manuel yedek' });
      toast.success('Geri yüklenebilir sunucu yedeği oluşturuldu.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };

  const restore = async (backup) => {
    if (!window.confirm('Bu yedek mevcut kanal, rol ve sunucu ayarlarının üzerine uygulanacak. Devam edilsin mi?')) return;
    setBusyId(backup.id);
    try {
      await restoreBackup(serverId, backup.id);
      toast.success('Sunucu yedeği geri yüklendi.');
      refresh();
    } catch (error) { toast.error(error.message); }
    finally { setBusyId(null); }
  };

  const remove = async (backup) => {
    if (!window.confirm('Bu yedek kalıcı olarak silinsin mi?')) return;
    try {
      await deleteBackup(serverId, backup.id);
      toast.success('Yedek silindi.');
      refresh();
    } catch (error) { toast.error(error.message); }
  };

  return (
    <Panel title="Geri yükleme noktaları" description="Kanal, rol ve topluluk ayarlarını sunucuda saklanan bir geri yükleme noktasına kaydet.">
      <form onSubmit={makeBackup} className="mb-4 flex gap-2">
        <input maxLength="100" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Yedek adı" />
        <button className={primaryButton}><Save className="h-4 w-4" /> Oluştur</button>
      </form>
      {backups.length === 0 ? <Empty>Henüz geri yükleme noktası oluşturulmadı.</Empty> : backups.map(backup => (
        <div key={backup.id} className="mb-2 flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#e2e8f0]">{backup.name || 'Sunucu yedeği'}</p><p className="text-xs text-[#64748b]">{formatDate(backup.createdAt)}</p></div>
          <button type="button" disabled={busyId === backup.id} onClick={() => restore(backup)} className={secondaryButton}><RotateCcw className="h-4 w-4" /> Geri yükle</button>
          <button type="button" onClick={() => remove(backup)} className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </Panel>
  );
}

function Row({ title, subtitle, onDelete }) {
  return <div className="mb-2 flex items-center gap-3 rounded-xl bg-[#0f172a] px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#e2e8f0]">{title}</p>{subtitle && <p className="truncate text-xs text-[#64748b]">{subtitle}</p>}</div>{onDelete && <button className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>}</div>;
}
