import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Save, Shield, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  deleteChannelPermission,
  listChannelPermissions,
  saveChannelPermission,
  updateChannelMetadata,
} from '../../services/platformApi';

const CHANNEL_PERMISSIONS = [
  ['VIEW_CHANNEL', 'View channel'],
  ['SEND_MESSAGES', 'Send messages'],
  ['MANAGE_MESSAGES', 'Manage messages'],
  ['MENTION_EVERYONE', 'Mention @everyone'],
  ['CREATE_PUBLIC_THREADS', 'Create threads'],
  ['SEND_MESSAGES_IN_THREADS', 'Threadsnde yaz'],
  ['MANAGE_WEBHOOKS', 'Manage webhooks'],
  ['CONNECT', 'Connect to voice channels'],
  ['SPEAK', 'Speak'],
  ['STREAM', 'Start streaming'],
  ['MUTE_MEMBERS', 'Mute members'],
  ['DEAFEN_MEMBERS', 'Deafen members'],
  ['MOVE_MEMBERS', 'Move or disconnect members'],
];

const inputClass = 'w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-[#e2e8f0] outline-none focus:border-[#3b82f6] placeholder:text-[#64748b]';

function idOf(item) { return item?.id || item?.userId || item?.user?.id; }
function nameOf(item) { return item?.name || item?.username || item?.user?.username || 'Unnamed'; }
function unwrap(payload) { return Array.isArray(payload) ? payload : payload?.overrides || payload?.permissions || []; }

export default function ChannelSettingsModal({ channel, channels = [], roles = [], members = [], onUpdated, onClose }) {
  const [tab, setTab] = useState('overview');
  const [form, setForm] = useState({
    name: channel.name || '',
    topic: channel.topic || '',
    type: channel.type || 'text',
    categoryId: channel.categoryId || '',
    position: channel.position ?? 0,
    slowmodeSeconds: channel.slowmodeSeconds || 0,
    nsfw: Boolean(channel.nsfw),
    userLimit: channel.userLimit || 0,
    bitrate: channel.bitrate || 64000,
    temporary: Boolean(channel.temporary),
  });
  const [overrides, setOverrides] = useState([]);
  const [target, setTarget] = useState('');
  const [permissionState, setPermissionState] = useState({});
  const [saving, setSaving] = useState(false);

  const categories = channels.filter(item => item.type === 'category' && item.id !== channel.id);
  const isVoiceChannel = ['voice', 'stage'].includes(form.type);
  const targets = useMemo(() => [
    ...roles.map(role => ({ type: 'role', id: idOf(role), name: `Role · ${nameOf(role)}` })),
    ...members.map(member => ({ type: 'member', id: idOf(member), name: `Member · ${nameOf(member)}` })),
  ].filter(item => item.id), [members, roles]);

  useEffect(() => {
    if (tab !== 'permissions') return;
    listChannelPermissions(channel.id)
      .then(payload => setOverrides(unwrap(payload)))
      .catch(error => toast.error(error.message));
  }, [channel.id, tab]);

  useEffect(() => {
    if (!target) { setPermissionState({}); return; }
    const [targetType, targetId] = target.split(':');
    const existing = overrides.find(item => item.targetType === targetType && String(item.targetId) === targetId);
    const next = {};
    CHANNEL_PERMISSIONS.forEach(([permission]) => {
      if (existing?.allow?.includes(permission)) next[permission] = 'allow';
      else if (existing?.deny?.includes(permission)) next[permission] = 'deny';
      else next[permission] = 'inherit';
    });
    setPermissionState(next);
  }, [overrides, target]);

  const saveOverview = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await updateChannelMetadata(channel.id, {
        ...form,
        slowmodeSeconds: Number(form.slowmodeSeconds) || 0,
        userLimit: Number(form.userLimit) || 0,
        bitrate: Number(form.bitrate) || 64000,
        position: Number(form.position) || 0,
        categoryId: form.categoryId || null,
      });
      const normalized = updated.channel || updated;
      onUpdated?.(normalized);
      toast.success('Channel settings kaydedildi.');
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const savePermissions = async () => {
    if (!target) return;
    const [targetType, targetId] = target.split(':');
    const allow = Object.entries(permissionState).filter(([, value]) => value === 'allow').map(([permission]) => permission);
    const deny = Object.entries(permissionState).filter(([, value]) => value === 'deny').map(([permission]) => permission);
    try {
      const result = await saveChannelPermission(channel.id, targetType, targetId, { allow, deny });
      setOverrides(current => [...current.filter(item => !(item.targetType === targetType && String(item.targetId) === targetId)), result.override || result]);
      toast.success('Channel permissions saved.');
    } catch (error) { toast.error(error.message); }
  };

  const removePermissions = async () => {
    if (!target) return;
    const [targetType, targetId] = target.split(':');
    try {
      await deleteChannelPermission(channel.id, targetType, targetId);
      setOverrides(current => current.filter(item => !(item.targetType === targetType && String(item.targetId) === targetId)));
      setPermissionState({});
      toast.success('Custom permission removed.');
    } catch (error) { toast.error(error.message); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <section className="flex max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f172a] shadow-2xl">
        <aside className="w-56 shrink-0 border-r border-white/[0.07] bg-[#0b1220] p-4">
          <div className="mb-5 flex items-center gap-2 px-2"><Hash className="h-4 w-4 text-[#60a5fa]" /><span className="truncate font-bold text-white">{channel.name}</span></div>
          <button type="button" onClick={() => setTab('overview')} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === 'overview' ? 'bg-[#2563eb] text-white' : 'text-[#94a3b8] hover:bg-white/[0.06]'}`}><Hash className="h-4 w-4" /> Overview</button>
          <button type="button" onClick={() => setTab('permissions')} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === 'permissions' ? 'bg-[#2563eb] text-white' : 'text-[#94a3b8] hover:bg-white/[0.06]'}`}><Shield className="h-4 w-4" /> Permissions</button>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <header className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">Channel Settings</h2><p className="text-xs text-[#64748b]">Channel visibility and behavior</p></div><button onClick={onClose} className="rounded-full border border-white/[0.09] p-2 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button></header>
          {tab === 'overview' ? (
            <form onSubmit={saveOverview} className="space-y-4">
              <label className="block text-xs font-semibold text-[#94a3b8]">Channel name<input required maxLength="50" className={`${inputClass} mt-1.5`} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label className="block text-xs font-semibold text-[#94a3b8]">Channel type<select className={`${inputClass} mt-1.5`} value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}><option value="text">Text</option><option value="announcement">Announcement</option><option value="forum">Forum</option><option value="media">Media</option><option value="voice">Voice</option><option value="stage">Stage</option><option value="category">Category</option></select></label>
              <label className="block text-xs font-semibold text-[#94a3b8]">Category<select className={`${inputClass} mt-1.5`} value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}><option value="">Categorysiz</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="block text-xs font-semibold text-[#94a3b8]">Topic / description<textarea rows="3" className={`${inputClass} mt-1.5 resize-none`} maxLength="1024" value={form.topic} onChange={event => setForm({ ...form, topic: event.target.value })} /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[#94a3b8]">Position<input type="number" min="0" max="999" className={`${inputClass} mt-1.5`} value={form.position} onChange={event => setForm({ ...form, position: event.target.value })} /></label>{!isVoiceChannel && <label className="text-xs font-semibold text-[#94a3b8]">Slow mode (seconds)<input type="number" min="0" max="21600" className={`${inputClass} mt-1.5`} value={form.slowmodeSeconds} onChange={event => setForm({ ...form, slowmodeSeconds: event.target.value })} /></label>}{isVoiceChannel && <><label className="text-xs font-semibold text-[#94a3b8]">Voice user limit<input type="number" min="0" max="99" className={`${inputClass} mt-1.5`} value={form.userLimit} onChange={event => setForm({ ...form, userLimit: event.target.value })} /></label><label className="text-xs font-semibold text-[#94a3b8]">Audio quality (bitrate)<select className={`${inputClass} mt-1.5`} value={form.bitrate} onChange={event => setForm({ ...form, bitrate: event.target.value })}><option value="32000">32 kbps</option><option value="64000">64 kbps</option><option value="96000">96 kbps</option><option value="128000">128 kbps</option></select></label></>}</div>
              <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#151d2c] px-4 py-3 text-sm text-[#cbd5e1]"><span>Age-restricted (NSFW)</span><input type="checkbox" checked={form.nsfw} onChange={event => setForm({ ...form, nsfw: event.target.checked })} /></label>
              {isVoiceChannel && <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#151d2c] px-4 py-3 text-sm text-[#cbd5e1]"><span>Delete temporary voice channel when empty</span><input type="checkbox" checked={form.temporary} onChange={event => setForm({ ...form, temporary: event.target.checked })} /></label>}
              <div className="flex justify-end"><button disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}</button></div>
            </form>
          ) : (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-[#94a3b8]">Role or member<select className={`${inputClass} mt-1.5`} value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a target</option>{targets.map(item => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.name}</option>)}</select></label>
              {!target ? <div className="rounded-xl border border-dashed border-white/[0.1] py-12 text-center text-sm text-[#64748b]">Choose the role or member whose permissions you want to change.</div> : <><div className="overflow-hidden rounded-xl border border-white/[0.07]">{CHANNEL_PERMISSIONS.map(([permission, label]) => <div key={permission} className="grid grid-cols-[1fr_repeat(3,80px)] items-center border-b border-white/[0.06] px-4 py-3 last:border-0"><span className="text-sm text-[#cbd5e1]">{label}</span>{[['inherit', '—'], ['deny', '✕'], ['allow', '✓']].map(([value, symbol]) => <button key={value} type="button" onClick={() => setPermissionState(current => ({ ...current, [permission]: value }))} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${permissionState[permission] === value ? value === 'allow' ? 'bg-[#22c55e] text-white' : value === 'deny' ? 'bg-[#ef4444] text-white' : 'bg-[#475569] text-white' : 'bg-white/[0.04] text-[#64748b] hover:bg-white/[0.08]'}`}>{symbol}</button>)}</div>)}</div><div className="flex justify-between"><button type="button" onClick={removePermissions} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#f87171] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /> Remove custom permission</button><button type="button" onClick={savePermissions} className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8]"><Save className="h-4 w-4" /> Save permissions</button></div></>}
            </div>
          )}
        </main>
      </section>
    </div>,
    document.body,
  );
}
