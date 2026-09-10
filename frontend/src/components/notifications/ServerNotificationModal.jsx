import { useEffect, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getNotificationPreferences, saveServerNotificationPreferences } from '../../services/platformApi';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_PREFERENCES = {
  level: 'inherit',
  mutedUntil: null,
  suppressEveryone: false,
  suppressRoles: false,
};

const MUTE_OPTIONS = [
  ['none', 'serverNotifications.notMuted'],
  ['15m', 'serverNotifications.minutes15'],
  ['1h', 'serverNotifications.hour1'],
  ['8h', 'serverNotifications.hours8'],
  ['24h', 'serverNotifications.hours24'],
  ['forever', 'serverNotifications.untilEnabled'],
];

function muteValue(option) {
  if (option === 'none') return null;
  if (option === 'forever') return 4102444800000;
  const duration = { '15m': 15 * 60_000, '1h': 60 * 60_000, '8h': 8 * 60 * 60_000, '24h': 24 * 60 * 60_000 }[option];
  return Date.now() + duration;
}

function selectedMute(value) {
  if (!value || Number(value) <= Date.now()) return 'none';
  if (Number(value) >= 4102444800000) return 'forever';
  const remaining = Number(value) - Date.now();
  if (remaining <= 16 * 60_000) return '15m';
  if (remaining <= 65 * 60_000) return '1h';
  if (remaining <= 9 * 60 * 60_000) return '8h';
  return '24h';
}

export default function ServerNotificationModal({ server, onClose }) {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [mute, setMute] = useState('none');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getNotificationPreferences()
      .then(payload => {
        if (!active) return;
        const current = { ...DEFAULT_PREFERENCES, ...(payload.servers?.[server.id] || {}) };
        setPreferences(current);
        setMute(selectedMute(current.mutedUntil));
      })
      .catch(() => toast.error(t('serverNotifications.loadError')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [server.id, t]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveServerNotificationPreferences(server.id, { ...preferences, mutedUntil: muteValue(mute) });
      setPreferences(current => ({ ...current, ...(saved || {}) }));
      toast.success(t('serverNotifications.saved'));
      onClose();
    } catch (error) {
      toast.error(error.message || t('serverNotifications.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/70 p-4" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18191C] text-[#DBDEE1] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="server-notification-title">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 py-5">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/15 text-[#aab4ff]"><Bell className="h-5 w-5" /></span>
            <div><h2 id="server-notification-title" className="truncate text-lg font-bold text-white">{t('serverNotifications.title', { server: server.name })}</h2><p className="mt-1 text-sm leading-5 text-[#949BA4]">{t('serverNotifications.description')}</p></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#949BA4] hover:bg-white/[0.07] hover:text-white" aria-label={t('common.close')}><X className="h-5 w-5" /></button>
        </header>

        <div className={`space-y-5 px-6 py-5 ${loading ? 'pointer-events-none opacity-55' : ''}`}>
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">{t('serverNotifications.level')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {['inherit', 'all', 'mentions', 'nothing'].map(level => (
                <button key={level} type="button" onClick={() => setPreferences(current => ({ ...current, level }))} className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left text-sm font-semibold transition ${preferences.level === level ? 'border-[#5865F2] bg-[#5865F2]/15 text-white' : 'border-white/[0.07] bg-[#1E1F22] text-[#B5BAC1] hover:border-white/[0.15]'}`}>
                  {t(`serverNotifications.${level}`)}{preferences.level === level && <Check className="h-4 w-4 text-[#8b93ff]" />}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">{t('serverNotifications.mute')}</span><select value={mute} onChange={event => setMute(event.target.value)} className="w-full rounded-lg border border-white/[0.07] bg-[#1E1F22] px-3 py-3 text-sm text-[#DBDEE1] outline-none focus:border-[#5865F2]">{MUTE_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></label>

          {[
            ['suppressEveryone', 'serverNotifications.everyone', 'serverNotifications.everyoneHelp'],
            ['suppressRoles', 'serverNotifications.roles', 'serverNotifications.rolesHelp'],
          ].map(([field, label, help]) => (
            <label key={field} className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-[#1E1F22] px-4 py-3">
              <span><span className="block text-sm font-semibold text-[#DBDEE1]">{t(label)}</span><span className="mt-1 block text-xs leading-5 text-[#949BA4]">{t(help)}</span></span>
              <input type="checkbox" checked={Boolean(preferences[field])} onChange={event => setPreferences(current => ({ ...current, [field]: event.target.checked }))} className="h-4 w-4 shrink-0 accent-[#5865F2]" />
            </label>
          ))}
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/[0.07] bg-[#111214] px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-[#B5BAC1] hover:bg-white/[0.06] hover:text-white">{t('common.cancel')}</button><button type="button" onClick={save} disabled={loading || saving} className="rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-bold text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50">{saving ? t('serverNotifications.saving') : t('serverNotifications.save')}</button></footer>
      </section>
    </div>
  );
}
