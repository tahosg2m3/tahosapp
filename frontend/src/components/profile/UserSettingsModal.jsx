import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowLeft,
  Bell,
  Check,
  Copy,
  Download,
  Globe2,
  Headphones,
  KeyRound,
  Lock,
  Mail,
  Mic,
  MonitorUp,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Search,
  User,
  UserX,
  Video,
  Volume2,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useVoice } from '../../context/VoiceContext';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl, resolveSafeMediaUrl } from '../../utils/safeMediaUrl';
import {
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  readAccessibilityPreferences,
  saveAccessibilityPreferences,
} from '../../utils/accessibilityPreferences';
import {
  readAutomaticPresencePreferences,
  saveAutomaticPresencePreferences,
} from '../../utils/automaticPresencePreferences';
import {
  clearRichPresenceActivity,
  createRichPresenceToken,
  getRichPresenceSettings,
  revokeRichPresenceToken,
  setRichPresenceActivity,
  updateRichPresenceSettings,
} from '../../services/api';
import {
  getNotificationPreferences,
  listBlockedUsers,
  platformRequest,
  saveNotificationPreferences,
  unblockUser,
} from '../../services/platformApi';
import RichPresenceCard from './RichPresenceCard';
import { API_URL } from '../../config/runtimeConfig';
import { apiFetch } from '../../services/httpClient';

const SETTING_GROUPS = [
  {
    label: 'KULLANICI AYARLARI',
    items: [
      { id: 'account', label: 'Hesabım', icon: User, description: 'Giriş bilgileri ve hesap özeti' },
      { id: 'profile', label: 'Profiller', icon: Palette, description: 'Görünen profilini düzenle' },
      { id: 'rich-presence', label: 'Rich Presence', icon: Activity, description: 'Otomatik oyun ve müzik etkinlikleri' },
      { id: 'privacy', label: 'Gizlilik ve Güvenlik', icon: Shield, description: 'Engellenen kullanıcıları yönet' },
    ],
  },
  {
    label: 'UYGULAMA AYARLARI',
    items: [
      { id: 'voice', label: 'Ses ve Görüntü', icon: Headphones, description: 'Cihazlar, kalite ve ses izolasyonu' },
      { id: 'notifications', label: 'Bildirimler', icon: Bell, description: 'Uyarı ve ses tercihleri' },
      { id: 'appearance', label: 'Görünüm', icon: Palette, description: 'Uygulama temasını seç' },
      { id: 'accessibility', label: 'Erişilebilirlik', icon: Settings, description: 'Okunabilirlik ve hareket seçenekleri' },
      { id: 'language', label: 'Dil', icon: Globe2, description: 'Uygulama dilini seç' },
      { id: 'updates', label: 'Güncellemeler', icon: Download, description: 'Masaüstü sürümünü güncel tut' },
    ],
  },
  {
    label: 'TAHOSAPP YÖNETİMİ',
    items: [
      { id: 'admin', label: 'Kullanıcı Yönetimi', icon: UserX, description: 'Kayıtlı kullanıcıları görüntüle ve platform banlarını yönet', adminOnly: true },
    ],
  },
];

async function authenticatedRequest(endpoint, options = {}) {
  const response = await apiFetch(API_URL + endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + localStorage.getItem('chat_token'),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || 'İşlem gerçekleştirilemedi.');
  return payload;
}

function SettingsSection({ icon: Icon, title, description, children, className = '' }) {
  return (
    <section className={'rounded-xl border border-white/[0.07] bg-[#2B2D31] p-5 shadow-sm ' + className}>
      <div className="flex items-start gap-3">
        {Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/15 text-[#9aa7ff]"><Icon className="h-5 w-5" /></span>}
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#F2F3F5]">{title}</h3>
          {description && <p className="mt-1 text-sm leading-5 text-[#949BA4]">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ToggleRow({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={'flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/[0.05] bg-[#1E1F22] px-4 py-3 ' + (disabled ? 'cursor-not-allowed opacity-50' : '')}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#DBDEE1]">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-5 text-[#949BA4]">{description}</span>}
      </span>
      <span className={'relative h-6 w-11 shrink-0 rounded-full transition-colors ' + (checked ? 'bg-[#23A559]' : 'bg-[#4E5058]')}>
        <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        <span className={'absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ' + (checked ? 'translate-x-6' : 'translate-x-1')} />
      </span>
    </label>
  );
}

function SelectField({ label, value, onChange, children, icon: Icon, disabled = false, help }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">
        {Icon && <Icon className="h-3.5 w-3.5" />}{label}
      </span>
      <select value={value} onChange={onChange} disabled={disabled} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none transition focus:border-[#00A8FC] disabled:cursor-not-allowed disabled:opacity-50">
        {children}
      </select>
      {help && <span className="mt-1.5 block text-xs leading-5 text-[#949BA4]">{help}</span>}
    </label>
  );
}

export default function UserSettingsModal({ onClose, initialTab = 'account' }) {
  const { user, updateUserData } = useAuth();
  const { socket } = useSocket();
  const voice = useVoice();
  const {
    availableDevices = { audioinput: [], audiooutput: [], videoinput: [] },
    inputDeviceId = '',
    outputDeviceId = '',
    cameraDeviceId = '',
    voiceMode = 'activity',
    pushToTalkKey = 'Space',
    noiseSuppression = true,
    screenSharePreset = '1080p30',
    voiceIsolationMode = 'standard',
    effectiveVoiceIsolationMode = voiceIsolationMode,
    audioQuality = 'standard',
    audioProcessingSupported = true,
    rnnoiseSupported = false,
    voiceProcessingStatus = 'idle',
    voiceProcessingEngine = 'none',
    changeInputDevice,
    refreshAvailableDevices,
    setOutputDeviceId,
    changeCameraDevice,
    setVoiceMode,
    setPushToTalkKey,
    setNoiseSuppression,
    setScreenSharePreset,
    setVoiceIsolationMode,
    setAudioQuality,
  } = voice;

  const settingGroups = useMemo(() => SETTING_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.adminOnly || user.isPlatformAdmin),
    }))
    .filter(group => group.items.length), [user.isPlatformAdmin]);
  const allSettings = useMemo(() => settingGroups.flatMap(group => group.items), [settingGroups]);
  const validInitialTab = allSettings.some(item => item.id === initialTab) ? initialTab : 'account';
  const [activeTab, setActiveTab] = useState(validInitialTab);
  const initialAvatar = resolveSafeAvatarUrl(user.avatar) || '';
  const [username, setUsername] = useState(user.username || '');
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [banner, setBanner] = useState(user.banner || '');
  const [bio, setBio] = useState(user.bio || '');
  const [customStatus, setCustomStatus] = useState(user.customStatus || '');
  const [presenceStatus, setPresenceStatus] = useState(user.presenceStatus || user.status || 'online');
  const [locale, setLocale] = useState(user.locale || localStorage.getItem('chat:locale') || 'tr');
  const [theme, setTheme] = useState(user.theme || localStorage.getItem('chat:theme') || 'dark');
  const [accessibilityPrefs, setAccessibilityPrefs] = useState(readAccessibilityPreferences);
  const [automaticPresencePrefs, setAutomaticPresencePrefs] = useState(readAutomaticPresencePreferences);
  const [notificationPrefs, setNotificationPrefs] = useState({
    desktop: true,
    mentions: true,
    directMessages: true,
    sound: true,
    suppressEveryone: false,
    suppressRoles: false,
    serverMode: 'mentions',
  });
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isInterfaceSaving, setIsInterfaceSaving] = useState(false);
  const [voiceSettingBusy, setVoiceSettingBusy] = useState('');
  const [deviceRefreshBusy, setDeviceRefreshBusy] = useState(false);
  const [newEmail, setNewEmail] = useState(user.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChangeTicket, setEmailChangeTicket] = useState(null);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [richPresenceState, setRichPresenceState] = useState({ enabled: true, token: { exists: false }, activities: [] });
  const [generatedPresenceToken, setGeneratedPresenceToken] = useState('');
  const [presenceBusy, setPresenceBusy] = useState('');
  const [desktopUpdateState, setDesktopUpdateState] = useState({
    supported: false,
    status: 'disabled',
    currentVersion: '',
    availableVersion: null,
    progress: null,
    automaticChecks: true,
    lastCheckedAt: null,
    message: 'Güncelleme bilgisi yükleniyor…',
  });
  const [desktopUpdateBusy, setDesktopUpdateBusy] = useState(false);
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminQuery, setAdminQuery] = useState('');
  const [adminBusy, setAdminBusy] = useState('');
  const [testPresence, setTestPresence] = useState({
    name: 'Örnek Oyun',
    type: 'playing',
    details: 'Bölüm 4 — Kristal Mağaralar',
    state: 'Skor: 12.450',
    imageUrl: '',
  });

  const avatarColor = getColorForString(username || user.username || 'U');
  const initial = (username || user.username || '?').slice(0, 1).toUpperCase();
  const safeAvatarUrl = resolveSafeAvatarUrl(avatarUrl);
  const safeBannerUrl = resolveSafeMediaUrl(banner);
  const isVerifyingEmail = Boolean(emailChangeTicket);
  const activeDefinition = allSettings.find(item => item.id === activeTab) || allSettings[0];

  const loadAdminOverview = async (query = adminQuery) => {
    if (!user.isPlatformAdmin) return;
    setAdminBusy('load');
    try {
      const payload = await authenticatedRequest(`/admin/overview?query=${encodeURIComponent(query.trim())}&limit=100`);
      setAdminOverview(payload);
    } catch (error) {
      toast.error(error.message || 'Kullanıcı listesi yüklenemedi.');
    } finally {
      setAdminBusy('');
    }
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    getNotificationPreferences()
      .then(payload => setNotificationPrefs(current => ({ ...current, ...(payload.preferences || payload) })))
      .catch(() => {});
    listBlockedUsers()
      .then(payload => setBlockedUsers(payload.users || payload.blockedUsers || []))
      .catch(() => {});
    getRichPresenceSettings()
      .then(payload => setRichPresenceState(payload))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket || !user?.id) return undefined;
    const handleRichPresence = payload => {
      if (String(payload?.userId || '') !== String(user.id)) return;
      setRichPresenceState(current => ({ ...current, activities: payload.activities || [] }));
    };
    socket.on('rich-presence:update', handleRichPresence);
    return () => socket.off('rich-presence:update', handleRichPresence);
  }, [socket, user?.id]);

  useEffect(() => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return undefined;
    bridge.getState().then(setDesktopUpdateState).catch(() => {});
    return bridge.onState(setDesktopUpdateState);
  }, []);

  useEffect(() => {
    if (user.isPlatformAdmin) loadAdminOverview('');
    // Yönetici durumu oturum doğrulamasından gelir; yalnız açılışta yüklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.isPlatformAdmin]);

  const handleUnblock = async targetUserId => {
    try {
      await unblockUser(targetUserId);
      setBlockedUsers(current => current.filter(item => (item.user?.id || item.id || item.userId) !== targetUserId));
      toast.success('Kullanıcının engeli kaldırıldı.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleCreatePresenceToken = async () => {
    if (richPresenceState.token?.exists && !window.confirm('Mevcut entegrasyon anahtarı geçersiz olacak. Yeni anahtar oluşturulsun mu?')) return;
    setPresenceBusy('token');
    try {
      const payload = await createRichPresenceToken();
      setGeneratedPresenceToken(payload.token || '');
      setRichPresenceState(current => ({
        ...current,
        token: {
          exists: true,
          lastFour: payload.lastFour,
          createdAt: payload.createdAt,
          lastUsedAt: payload.lastUsedAt,
        },
        activities: payload.activities || current.activities,
      }));
      toast.success('Yeni Rich Presence anahtarı oluşturuldu. Bu anahtar yalnızca şimdi gösterilir.');
    } catch (error) {
      toast.error(error.message || 'Entegrasyon anahtarı oluşturulamadı.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleRevokePresenceToken = async () => {
    if (!window.confirm('Entegrasyon anahtarını iptal edip aktif Rich Presence oturumlarını kapatmak istiyor musun?')) return;
    setPresenceBusy('token');
    try {
      await revokeRichPresenceToken();
      setGeneratedPresenceToken('');
      setRichPresenceState(current => ({ ...current, token: { exists: false }, activities: [] }));
      toast.success('Entegrasyon anahtarı iptal edildi.');
    } catch (error) {
      toast.error(error.message || 'Anahtar iptal edilemedi.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleToggleRichPresence = async enabled => {
    setPresenceBusy('toggle');
    try {
      const payload = await updateRichPresenceSettings(enabled);
      setRichPresenceState(payload);
      toast.success(enabled ? 'Rich Presence paylaşımı açıldı.' : 'Rich Presence paylaşımı kapatıldı.');
    } catch (error) {
      toast.error(error.message || 'Rich Presence tercihi güncellenemedi.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handlePublishTestPresence = async () => {
    if (!testPresence.name.trim()) return toast.error('Uygulama veya oyun adı gerekli.');
    setPresenceBusy('test');
    try {
      const payload = await setRichPresenceActivity({
        ...testPresence,
        sessionId: 'settings-preview',
        startedAt: Date.now(),
        ttlSeconds: 900,
        metadata: testPresence.type === 'playing' ? { Seviye: '24', Mod: 'Dereceli' } : {},
        music: testPresence.type === 'listening' ? {
          song: testPresence.details || 'Örnek Parça',
          artist: testPresence.state || 'Örnek Sanatçı',
          durationMs: 240000,
          positionMs: 45000,
        } : undefined,
      });
      setRichPresenceState(current => ({ ...current, activities: payload.activities || [] }));
      toast.success('Test etkinliği profilinde yayınlanıyor.');
    } catch (error) {
      toast.error(error.message || 'Test etkinliği yayınlanamadı.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleClearTestPresence = async () => {
    setPresenceBusy('test');
    try {
      const payload = await clearRichPresenceActivity('settings-preview');
      setRichPresenceState(current => ({ ...current, activities: payload.activities || [] }));
      toast.success('Test etkinliği kapatıldı.');
    } catch (error) {
      toast.error(error.message || 'Test etkinliği kapatılamadı.');
    } finally {
      setPresenceBusy('');
    }
  };

  const copyPresenceToken = async () => {
    if (!generatedPresenceToken) return;
    try {
      await navigator.clipboard.writeText(generatedPresenceToken);
      toast.success('Entegrasyon anahtarı kopyalandı.');
    } catch (_) {
      toast.error('Anahtar panoya kopyalanamadı.');
    }
  };

  const handleSaveProfile = async () => {
    if (!username.trim()) {
      toast.error('Kullanıcı adı boş olamaz.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await platformRequest('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ username: username.trim(), avatar: avatarUrl.trim(), banner: banner.trim(), bio: bio.trim(), customStatus: customStatus.trim(), presenceStatus, locale, theme }),
      });
      updateUserData(result.user || result);
      localStorage.setItem('chat:locale', locale);
      localStorage.setItem('chat:theme', theme);
      document.documentElement.lang = locale;
      document.documentElement.dataset.theme = theme;
      socket?.emit('status:change', { status: presenceStatus, customStatus: customStatus.trim() });
      toast.success('Profilin güncellendi.');
    } catch (error) {
      toast.error(error.message || 'Profil güncellenirken bir hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveInterface = async message => {
    setIsInterfaceSaving(true);
    try {
      const result = await platformRequest('/users/me', { method: 'PATCH', body: JSON.stringify({ locale, theme }) });
      updateUserData(result.user || result);
      localStorage.setItem('chat:locale', locale);
      localStorage.setItem('chat:theme', theme);
      document.documentElement.lang = locale;
      document.documentElement.dataset.theme = theme;
      toast.success(message);
    } catch (error) {
      toast.error(error.message || 'Tercihler kaydedilemedi.');
    } finally {
      setIsInterfaceSaving(false);
    }
  };

  const updateAccessibility = (key, value) => {
    setAccessibilityPrefs(current => saveAccessibilityPreferences({ ...current, [key]: value }));
  };

  const updateAutomaticPresencePreference = (key, value) => {
    setAutomaticPresencePrefs(current => saveAutomaticPresencePreferences({ ...current, [key]: value }));
  };

  const resetAccessibility = () => {
    setAccessibilityPrefs(saveAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES));
    toast.success('Erişilebilirlik ayarları sıfırlandı.');
  };

  const handleVoiceIsolationChange = async mode => {
    if (typeof setVoiceIsolationMode !== 'function') return;
    setVoiceSettingBusy('isolation');
    try {
      const applied = await setVoiceIsolationMode(mode);
      if (!applied) {
        toast.error('Ses izolasyonu aktif görüşmeye uygulanamadı. Önceki ayar korundu.');
        return;
      }
      toast.success('Ses izolasyonu güncellendi.');
    } catch (error) {
      toast.error(error.message || 'Ses izolasyonu uygulanamadı.');
    } finally {
      setVoiceSettingBusy('');
    }
  };

  const handleAudioQualityChange = async event => {
    if (typeof setAudioQuality !== 'function') return;
    setVoiceSettingBusy('quality');
    try {
      const applied = await setAudioQuality(event.target.value);
      if (!applied) {
        toast.error('Ses kalitesi aktif görüşmeye uygulanamadı. Önceki ayar korundu.');
        return;
      }
      toast.success('Ses kalitesi güncellendi.');
    } catch (error) {
      toast.error(error.message || 'Ses kalitesi uygulanamadı.');
    } finally {
      setVoiceSettingBusy('');
    }
  };

  const handleRequestEmailChange = async event => {
    event.preventDefault();
    if (!newEmail.trim() || !currentPassword) {
      toast.error('Yeni e-posta adresini ve mevcut şifreni gir.');
      return;
    }
    setIsEmailLoading(true);
    try {
      const result = await authenticatedRequest('/auth/request-email-change', { method: 'POST', body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword }) });
      setEmailChangeTicket(result.emailChangeTicket);
      setEmailCode('');
      toast.success('Doğrulama kodu yeni e-posta adresine gönderildi.');
    } catch (error) {
      toast.error(error.message || 'Doğrulama e-postası gönderilemedi.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleConfirmEmailChange = async event => {
    event.preventDefault();
    if (emailCode.trim().length !== 6) {
      toast.error('E-postandaki 6 haneli kodu gir.');
      return;
    }
    setIsEmailLoading(true);
    try {
      const result = await authenticatedRequest('/auth/confirm-email-change', { method: 'POST', body: JSON.stringify({ emailChangeTicket, code: emailCode.trim() }) });
      updateUserData(result.user);
      setNewEmail(result.user.email);
      setCurrentPassword('');
      setEmailCode('');
      setEmailChangeTicket(null);
      toast.success('E-posta adresin güncellendi.');
    } catch (error) {
      toast.error(error.message || 'Kod doğrulanamadı.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleResendEmailCode = async () => {
    setIsEmailLoading(true);
    try {
      await authenticatedRequest('/auth/resend-email-change', { method: 'POST', body: JSON.stringify({ emailChangeTicket }) });
      toast.success('Yeni doğrulama kodu gönderildi.');
    } catch (error) {
      toast.error(error.message || 'Kod tekrar gönderilemedi.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const cancelEmailChange = () => {
    setEmailChangeTicket(null);
    setEmailCode('');
    setCurrentPassword('');
    setNewEmail(user.email || '');
  };

  const handleDesktopUpdateCheck = async () => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return;
    setDesktopUpdateBusy(true);
    try {
      setDesktopUpdateState(await bridge.check());
    } catch (_) {
      toast.error('Güncelleme denetimi başlatılamadı.');
    } finally {
      setDesktopUpdateBusy(false);
    }
  };

  const handleAutomaticUpdateChange = async enabled => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return;
    setDesktopUpdateBusy(true);
    try {
      setDesktopUpdateState(await bridge.setAutomaticChecks(enabled));
      toast.success(enabled ? 'Otomatik güncelleme denetimi açıldı.' : 'Otomatik güncelleme denetimi kapatıldı.');
    } catch (_) {
      toast.error('Güncelleme tercihi kaydedilemedi.');
    } finally {
      setDesktopUpdateBusy(false);
    }
  };

  const installDesktopUpdate = async () => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return;
    const result = await bridge.install().catch(() => ({ started: false }));
    if (!result?.started) toast.error('İndirilen güncelleme henüz hazır değil.');
  };

  const renderAccount = () => (
    <div className="space-y-5">
      <section className="relative mt-12 overflow-visible rounded-xl border border-white/[0.07] bg-[#2B2D31]">
        <div className="relative h-24 overflow-hidden rounded-t-xl bg-gradient-to-r from-[#5865F2] via-[#7c5ce7] to-[#9256EA]">
          {safeBannerUrl && <img src={safeBannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {safeBannerUrl && <div className="absolute inset-0 bg-black/25" />}
        </div>
        <div className="absolute left-6 top-10 flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full border-[6px] border-[#2B2D31] text-4xl font-bold text-white shadow-lg" style={{ backgroundColor: safeAvatarUrl ? 'transparent' : avatarColor }}>
          {safeAvatarUrl ? <img src={safeAvatarUrl} alt="Profil resmi" className="h-full w-full object-cover" /> : initial}
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 pt-16 sm:flex-row sm:items-end sm:justify-between">
          <div><h3 className="text-2xl font-bold text-[#F2F3F5]">{username || user.username}</h3><p className="mt-1 text-sm text-[#949BA4]">{user.email}</p></div>
          <button type="button" onClick={() => setActiveTab('profile')} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752C4]">Profili Düzenle</button>
        </div>
      </section>

      <SettingsSection icon={Mail} title="E-posta Adresi" description="E-posta değişikliği yeni adresine gönderilen 6 haneli kodla doğrulanır.">
        {!isVerifyingEmail ? (
          <form className="space-y-4" onSubmit={handleRequestEmailChange}>
            <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Yeni e-posta adresi</span><input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" placeholder="ornek@mail.com" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
            <label className="block"><span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-[#B5BAC1]"><Lock className="h-3.5 w-3.5" /> Mevcut şifre</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Şifreni doğrulamak için gir" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
            <div className="flex justify-end"><button type="submit" disabled={isEmailLoading || !newEmail.trim() || !currentPassword} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50">{isEmailLoading ? 'Kod gönderiliyor…' : 'Doğrulama Kodu Gönder'}</button></div>
          </form>
        ) : (
          <form onSubmit={handleConfirmEmailChange}>
            <div className="rounded-md border border-[#23A559]/30 bg-[#23A559]/10 p-3 text-sm text-[#C4F1D1]"><Shield className="mr-2 inline h-4 w-4" /> Kod <strong>{newEmail}</strong> adresine gönderildi. Kod 10 dakika geçerlidir.</div>
            <label className="mt-4 block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">6 haneli doğrulama kodu</span><input value={emailCode} onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-3 text-center font-mono text-lg tracking-[0.35em] text-[#F2F3F5] outline-none focus:border-[#00A8FC]" /></label>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={cancelEmailChange} disabled={isEmailLoading} className="flex items-center gap-1.5 rounded px-2 py-2 text-sm text-[#B5BAC1] hover:bg-[#35373C] hover:text-white"><ArrowLeft className="h-4 w-4" /> Vazgeç</button><div className="flex items-center gap-2"><button type="button" onClick={handleResendEmailCode} disabled={isEmailLoading} className="flex items-center gap-1.5 rounded px-2 py-2 text-sm text-[#B5BAC1] hover:bg-[#35373C] hover:text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Tekrar gönder</button><button type="submit" disabled={isEmailLoading || emailCode.length !== 6} className="flex items-center gap-1.5 rounded-md bg-[#23A559] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D8046] disabled:opacity-50"><Check className="h-4 w-4" /> {isEmailLoading ? 'Doğrulanıyor…' : 'Doğrula'}</button></div></div>
          </form>
        )}
      </SettingsSection>
    </div>
  );

  const renderProfile = () => (
    <SettingsSection icon={User} title="Kullanıcı Profili" description="Diğer kullanıcıların göreceği profil bilgilerini ve çevrimiçi durumunu düzenle.">
      <div className="space-y-5">
        <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Kullanıcı adı <span className="text-[#DA373C]">*</span></span><input value={username} onChange={event => setUsername(event.target.value)} maxLength={50} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Profil resmi bağlantısı</span><input value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="https://ornek.com/resim.jpg" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Profil afişi bağlantısı</span><input value={banner} onChange={event => setBanner(event.target.value)} placeholder="https://ornek.com/banner.jpg" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        </div>
        <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Hakkımda</span><textarea rows="5" value={bio} onChange={event => setBio(event.target.value.slice(0, 300))} placeholder="Kendinden bahset" className="w-full resize-none rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /><span className="mt-1 block text-right text-[11px] text-[#72767D]">{bio.length}/300</span></label>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Özel durum</span><input value={customStatus} onChange={event => setCustomStatus(event.target.value.slice(0, 128))} placeholder="Şu anda ne yapıyorsun?" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <SelectField label="Çevrimiçi durumu" value={presenceStatus} onChange={event => setPresenceStatus(event.target.value)}><option value="online">Çevrimiçi</option><option value="idle">Boşta</option><option value="dnd">Rahatsız etmeyin</option><option value="invisible">Görünmez</option></SelectField>
        </div>
        <div className="flex justify-end"><button type="button" onClick={handleSaveProfile} disabled={isSaving} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}</button></div>
      </div>
    </SettingsSection>
  );

  const renderRichPresence = () => (
    <div className="space-y-5">
      <SettingsSection icon={Activity} title="Otomatik etkinlik durumu" description="Windows'ta çalışan oyunlar ile Spotify ve YouTube Music oturumları otomatik algılanır. Kullanıcı hesabı bağlamak, anahtar girmek veya oyuna eklenti kurmak gerekmez.">
        <ToggleRow
          checked={richPresenceState.enabled !== false}
          disabled={presenceBusy === 'toggle'}
          onChange={handleToggleRichPresence}
          label="Etkinlik paylaşımına izin ver"
          description="Kapattığında bütün aktif oturumlar anında kaldırılır; entegrasyonlar yeniden etkinleştirene kadar yayın yapamaz."
        />
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#1E1F22] p-4 text-sm text-[#949BA4]">
          <p><strong className="text-[#DBDEE1]">Canlı oturum:</strong> {richPresenceState.activities?.length || 0} / {richPresenceState.limits?.maxSessions || 5}</p>
          <p className="mt-1 text-xs">Windows medya bilgisi yaklaşık 3 saniyede bir yenilenir. Ayrıntılı seçenekler yalnız bu cihazdaki otomatik algılamayı etkiler.</p>
        </div>
      </SettingsSection>

      <SettingsSection icon={Settings} title="Otomatik Algılama" description="Uygulamanın bu bilgisayardaki oyun ve medya oturumlarını otomatik paylaşmasını yönet. Değişiklikler kaydetme düğmesine gerek olmadan hemen uygulanır.">
        <div className="space-y-3">
          <ToggleRow checked={automaticPresencePrefs.enabled} onChange={value => updateAutomaticPresencePreference('enabled', value)} label="Bu cihazda otomatik algılamayı kullan" description="Kapalıyken otomatik oyun, müzik ve video etkinlikleri kaldırılır; özel entegrasyon etkinlikleri etkilenmez." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showGames} onChange={value => updateAutomaticPresencePreference('showGames', value)} label="Oynadığım oyunları göster" description="Tanımlanan oyun süreçlerini profilinde Oynuyor olarak yayınla." />
        </div>
      </SettingsSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <SettingsSection icon={Activity} title="Oyun Gizliliği" description="Oyun etkinliğinde hangi ayrıntıların görüneceğini seç.">
          <div className="space-y-3">
            <ToggleRow disabled={!automaticPresencePrefs.enabled || !automaticPresencePrefs.showGames} checked={automaticPresencePrefs.showGamePlatform} onChange={value => updateAutomaticPresencePreference('showGamePlatform', value)} label="Oyun platformunu göster" description="Steam, Xbox, Epic Games veya algılanan diğer mağaza adını paylaş." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled || !automaticPresencePrefs.showGames} checked={automaticPresencePrefs.showGameElapsed} onChange={value => updateAutomaticPresencePreference('showGameElapsed', value)} label="Geçen oyun süresini göster" description="Oyunun ne kadar süredir açık olduğunu profil kartında göster." />
          </div>
        </SettingsSection>

        <SettingsSection icon={Headphones} title="Müzik Servisleri" description="Hangi müzik kaynaklarının profilinde görünebileceğini belirle.">
          <div className="space-y-3">
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showSpotify} onChange={value => updateAutomaticPresencePreference('showSpotify', value)} label="Spotify" description="Spotify masaüstü uygulamasındaki müziği göster." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showYouTubeMusic} onChange={value => updateAutomaticPresencePreference('showYouTubeMusic', value)} label="YouTube Music" description="Yalnız YouTube Music uygulamasını göster; normal YouTube videoları buna dahil değildir." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showOtherMusic} onChange={value => updateAutomaticPresencePreference('showOtherMusic', value)} label="Diğer müzik oynatıcıları" description="Windows medya denetimine bağlanan diğer bağımsız müzik uygulamalarını göster." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showPausedMusic} onChange={value => updateAutomaticPresencePreference('showPausedMusic', value)} label="Duraklatılmış müziği göster" description="Şarkı durdurulduğunda etkinliği silmek yerine Duraklatıldı olarak tut." />
          </div>
        </SettingsSection>
      </div>

      <SettingsSection icon={Headphones} title="Müzikte Gösterilecek Bilgiler" description="Şarkı etkinliğinde paylaşılacak her alanı ayrı ayrı seç.">
        <div className="grid gap-3 lg:grid-cols-2">
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showSongTitle} onChange={value => updateAutomaticPresencePreference('showSongTitle', value)} label="Şarkı adı" description="Kapalıysa gerçek isim yerine genel bir şarkı açıklaması kullanılır." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showArtist} onChange={value => updateAutomaticPresencePreference('showArtist', value)} label="Sanatçı" description="Şarkının sanatçı veya kanal bilgisini göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showAlbum} onChange={value => updateAutomaticPresencePreference('showAlbum', value)} label="Albüm" description="Windows tarafından sağlanıyorsa albüm adını göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showMusicProgress} onChange={value => updateAutomaticPresencePreference('showMusicProgress', value)} label="Şarkı ilerleme çubuğu" description="Geçerli saniyeyi, toplam süreyi ve ilerleme çubuğunu göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showMusicElapsed} onChange={value => updateAutomaticPresencePreference('showMusicElapsed', value)} label="Dinleme süresi" description="Etkinliğin ne kadar süredir açık olduğunu ayrıca göster." />
        </div>
      </SettingsSection>

      <SettingsSection icon={Video} title="Video ve Tarayıcı Etkinlikleri" description="Normal YouTube ve diğer tarayıcı videoları müzikten ayrı yönetilir. Gizlilik için tarayıcı videoları varsayılan olarak kapalıdır.">
        <div className="grid gap-3 lg:grid-cols-2">
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showBrowserVideos} onChange={value => updateAutomaticPresencePreference('showBrowserVideos', value)} label="Tarayıcı videolarını göster" description="Chrome, Edge, Firefox, Opera ve Vivaldi medya oturumlarını İzliyor olarak paylaş." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showOtherVideos} onChange={value => updateAutomaticPresencePreference('showOtherVideos', value)} label="Diğer video uygulamalarını göster" description="Tarayıcı dışındaki video oynatıcı etkinliklerine izin ver." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showPausedVideos} onChange={value => updateAutomaticPresencePreference('showPausedVideos', value)} label="Duraklatılmış videoları göster" description="Video durduğunda etkinliği Duraklatıldı olarak profilde tut." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoTitle} onChange={value => updateAutomaticPresencePreference('showVideoTitle', value)} label="Video başlığı" description="İzlenen videonun başlığını göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoCreator} onChange={value => updateAutomaticPresencePreference('showVideoCreator', value)} label="Kanal veya içerik üreticisi" description="Windows medya bilgisindeki sanatçı/kanal alanını göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoProgress} onChange={value => updateAutomaticPresencePreference('showVideoProgress', value)} label="Video ilerleme çubuğu" description="Geçerli saniyeyi ve toplam süreyi göster." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoElapsed} onChange={value => updateAutomaticPresencePreference('showVideoElapsed', value)} label="İzleme süresi" description="Etkinliğin ne kadar süredir açık olduğunu ayrıca göster." />
        </div>
      </SettingsSection>

      <SettingsSection icon={KeyRound} title="İsteğe Bağlı Gelişmiş Entegrasyon" description="Otomatik algılama için gerekli değildir. Yalnız özel skor, seviye veya parti bilgisi göndermek isteyen uygulamalar içindir ve mesajlarına, arkadaşlarına ya da hesap ayarlarına erişemez.">
        {generatedPresenceToken && (
          <div className="mb-4 rounded-lg border border-[#f0b232]/35 bg-[#f0b232]/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#f0b232]">Şimdi güvenli bir yere kaydet — tekrar gösterilmeyecek</p>
            <div className="mt-3 flex gap-2"><input readOnly value={generatedPresenceToken} className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-[#111214] px-3 py-2 font-mono text-xs text-[#DBDEE1] outline-none" /><button type="button" onClick={copyPresenceToken} className="flex items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold text-white hover:bg-[#4752C4]"><Copy className="h-4 w-4" /> Kopyala</button></div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1E1F22] p-4">
          <div><p className="text-sm font-bold text-[#DBDEE1]">{richPresenceState.token?.exists ? `Anahtar etkin ••••${richPresenceState.token.lastFour || ''}` : 'Henüz entegrasyon anahtarı yok'}</p><p className="mt-1 text-xs text-[#949BA4]">{richPresenceState.token?.createdAt ? `Oluşturulma: ${new Date(richPresenceState.token.createdAt).toLocaleString('tr-TR')}` : 'Yeni bir anahtar oluşturup oyununa veya uygulamana ekle.'}</p></div>
          <div className="flex gap-2"><button type="button" disabled={presenceBusy === 'token'} onClick={handleCreatePresenceToken} className="flex items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"><KeyRound className="h-4 w-4" /> {richPresenceState.token?.exists ? 'Yenile' : 'Anahtar Oluştur'}</button>{richPresenceState.token?.exists && <button type="button" disabled={presenceBusy === 'token'} onClick={handleRevokePresenceToken} className="flex items-center gap-2 rounded-md bg-[#DA373C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#b92d32] disabled:opacity-50"><Trash2 className="h-4 w-4" /> İptal Et</button>}</div>
        </div>
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#111214] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#949BA4]">HTTP bağlantısı</p>
          <pre className="custom-scrollbar overflow-x-auto whitespace-pre-wrap break-all text-xs leading-5 text-[#b5bac1]">{`PUT ${API_URL}/rich-presence\nAuthorization: Presence YOUR_INTEGRATION_KEY\nContent-Type: application/json`}</pre>
        </div>
      </SettingsSection>

      <SettingsSection icon={Play} title="Profilde Test Et" description="SDK bağlamadan görünümü deneyebilirsin. Test etkinliği 15 dakika sonra otomatik kapanır.">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Uygulama veya oyun</span><input value={testPresence.name} onChange={event => setTestPresence(current => ({ ...current, name: event.target.value.slice(0, 80) }))} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <SelectField label="Etkinlik türü" value={testPresence.type} onChange={event => setTestPresence(current => ({ ...current, type: event.target.value }))}><option value="playing">Oynuyor</option><option value="listening">Dinliyor</option><option value="watching">İzliyor</option><option value="working">Çalışıyor</option><option value="competing">Yarışıyor</option><option value="custom">Özel</option></SelectField>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Ayrıntı</span><input value={testPresence.details} onChange={event => setTestPresence(current => ({ ...current, details: event.target.value.slice(0, 160) }))} placeholder="Bölüm, şarkı veya çalışma bilgisi" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Durum</span><input value={testPresence.state} onChange={event => setTestPresence(current => ({ ...current, state: event.target.value.slice(0, 160) }))} placeholder="Skor, sanatçı veya ekip bilgisi" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <label className="block lg:col-span-2"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Görsel bağlantısı (isteğe bağlı)</span><input value={testPresence.imageUrl} onChange={event => setTestPresence(current => ({ ...current, imageUrl: event.target.value.slice(0, 2048) }))} placeholder="https://ornek.com/game-cover.png" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={handleClearTestPresence} disabled={presenceBusy === 'test'} className="rounded-md bg-[#4E5058] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78] disabled:opacity-50">Testi Kapat</button><button type="button" onClick={handlePublishTestPresence} disabled={presenceBusy === 'test' || richPresenceState.enabled === false} className="flex items-center gap-2 rounded-md bg-[#23A559] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D8046] disabled:opacity-50"><Play className="h-4 w-4" /> Profilde Yayınla</button></div>
      </SettingsSection>

      {richPresenceState.activities?.length > 0 && <SettingsSection icon={Activity} title="Şu Anda Yayınlananlar" description="Değişiklikler arkadaşlarının ve ortak sunuculardaki kullanıcıların ekranına anlık ulaşır."><div className="space-y-3">{richPresenceState.activities.map(activity => <RichPresenceCard key={activity.sessionId || activity.id} activity={activity} />)}</div></SettingsSection>}
    </div>
  );

  const renderPrivacy = () => (
    <SettingsSection icon={UserX} title="Engellenen Kullanıcılar" description="Engellediğin kişiler sana doğrudan mesaj gönderemez ve seninle etkileşime geçemez.">
      <div className="space-y-2">
        {blockedUsers.length === 0 ? <div className="rounded-lg border border-dashed border-white/[0.08] bg-[#1E1F22] p-6 text-center"><Shield className="mx-auto h-8 w-8 text-[#5865F2]" /><p className="mt-3 text-sm font-semibold text-[#DBDEE1]">Engellediğin kullanıcı yok</p><p className="mt-1 text-xs text-[#949BA4]">Engellediğin hesaplar burada görünür.</p></div> : blockedUsers.map(entry => {
          const blocked = entry.user || entry;
          const targetId = blocked.id || entry.userId;
          return <div key={targetId} className="flex items-center gap-3 rounded-lg bg-[#1E1F22] px-4 py-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#5865F2] text-sm font-bold text-white">{(blocked.username || '?')[0].toUpperCase()}</div><span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#DBDEE1]">{blocked.username || 'Kullanıcı'}</span><button type="button" onClick={() => handleUnblock(targetId)} className="rounded-md bg-[#4E5058] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6D6F78]">Engeli kaldır</button></div>;
        })}
      </div>
    </SettingsSection>
  );

  const isolationOptions = [
    { value: 'off', label: 'Kapalı', description: 'Ham mikrofon sesi; en düşük işlem yükü.' },
    { value: 'standard', label: 'Standart', description: 'Konuşmayı korurken sürekli arka plan seslerini azaltır.' },
    { value: 'strong', label: 'RNNoise (Güçlü)', description: 'Yapay zekâ modeli klavye, fan ve ortam gürültüsünü tamamen cihazında gerçek zamanlı temizler.' },
  ];
  const processingLabels = { idle: 'Hazır', starting: voiceIsolationMode === 'strong' ? 'RNNoise hazırlanıyor…' : 'Başlatılıyor…', active: 'Etkin', fallback: 'Güvenli yedek mod', error: 'İşleme hatası' };
  const processingEngineLabels = { none: 'Kapalı', rnnoise: 'RNNoise / WebAssembly', 'web-audio': 'Web Audio + tarayıcı', 'browser-fallback': 'Tarayıcı gürültü azaltma' };

  const renderVoice = () => (
    <div className="space-y-5">
      <SettingsSection icon={Mic} title="Ses Aygıtları" description="Bu ayarlar bir ses kanalında olmasan da kullanılabilir; aktif görüşmedeysen değişiklikler anında uygulanır.">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#1E1F22] px-4 py-3">
          <p className="min-w-0 flex-1 text-xs leading-5 text-[#949BA4]">Gerçek mikrofon ve hoparlör adları görünmüyorsa aygıt iznini verip listeyi yeniden tara.</p>
          <button type="button" disabled={deviceRefreshBusy} onClick={async () => {
            if (typeof refreshAvailableDevices !== 'function') return;
            setDeviceRefreshBusy(true);
            try {
              const result = await refreshAvailableDevices({ requestPermission: true });
              if (result?.success) toast.success('Ses aygıtları yenilendi.');
              else toast.error(result?.error || 'Ses aygıtları okunamadı.');
            } finally {
              setDeviceRefreshBusy(false);
            }
          }} className="flex shrink-0 items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold text-white hover:bg-[#4752C4] disabled:cursor-wait disabled:opacity-60">
            <RefreshCw className={'h-4 w-4 ' + (deviceRefreshBusy ? 'animate-spin' : '')} />
            {deviceRefreshBusy ? 'Taranıyor…' : 'Aygıtları tara ve izin ver'}
          </button>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <SelectField icon={Mic} label="Giriş aygıtı" value={inputDeviceId} onChange={event => { if (typeof changeInputDevice === 'function') void changeInputDevice(event.target.value); }}><option value="">Sistem varsayılanı</option>{availableDevices.audioinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Mikrofon ' + (index + 1)}</option>)}</SelectField>
          <SelectField icon={Volume2} label="Çıkış aygıtı" value={outputDeviceId} onChange={event => { if (typeof setOutputDeviceId === 'function') setOutputDeviceId(event.target.value); }}><option value="">Sistem varsayılanı</option>{availableDevices.audiooutput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Hoparlör ' + (index + 1)}</option>)}</SelectField>
          <SelectField icon={Video} label="Kamera" value={cameraDeviceId} onChange={event => { if (typeof changeCameraDevice === 'function') void changeCameraDevice(event.target.value); }}><option value="">Sistem varsayılanı</option>{availableDevices.videoinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Kamera ' + (index + 1)}</option>)}</SelectField>
          <SelectField label="Giriş modu" value={voiceMode} onChange={event => { if (typeof setVoiceMode === 'function') setVoiceMode(event.target.value); }}><option value="activity">Ses etkinliği</option><option value="push-to-talk">Bas konuş</option></SelectField>
          {voiceMode === 'push-to-talk' && <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">Bas-konuş tuşu</span><input readOnly value={pushToTalkKey} onKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (typeof setPushToTalkKey === 'function') setPushToTalkKey(event.code); }} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-center text-sm font-bold text-[#DBDEE1] outline-none focus:border-[#00A8FC]" title="Alanı seçip istediğin tuşa bas" /><span className="mt-1.5 block text-xs text-[#949BA4]">Alanı seç ve kullanmak istediğin tuşa bas.</span></label>}
          <SelectField label="Ses kalitesi" value={audioQuality} onChange={handleAudioQualityChange} disabled={voiceSettingBusy === 'quality'} help="Yüksek kalite daha fazla bağlantı ve işlem gücü kullanabilir."><option value="standard">Standart</option><option value="high">Yüksek</option><option value="studio">Stüdyo</option></SelectField>
        </div>
      </SettingsSection>

      <SettingsSection icon={Shield} title="Ses İzolasyonu" description="Mikrofonundaki arka plan seslerini temizler. RNNoise işlemi yalnızca cihazında yapılır; mikrofon sesin analiz için harici bir sunucuya gönderilmez.">
        <div className="grid gap-3 lg:grid-cols-3">
          {isolationOptions.map(option => {
            const selected = voiceIsolationMode === option.value;
            const unavailable = option.value === 'strong' && !rnnoiseSupported;
            return <button key={option.value} type="button" disabled={voiceSettingBusy === 'isolation' || unavailable} onClick={() => handleVoiceIsolationChange(option.value)} className={'relative rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ' + (selected ? 'border-[#5865F2] bg-[#5865F2]/15' : 'border-white/[0.07] bg-[#1E1F22] hover:border-white/[0.16]')}><span className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-[#F2F3F5]">{option.label}</span>{selected && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#5865F2] text-white"><Check className="h-3.5 w-3.5" /></span>}</span><span className="mt-2 block text-xs leading-5 text-[#949BA4]">{unavailable ? 'Bu tarayıcı gelişmiş ses işlemeyi desteklemiyor.' : option.description}</span></button>;
          })}
        </div>
        <div className={'mt-4 rounded-lg border px-4 py-3 text-xs leading-5 ' + (voiceProcessingStatus === 'error' ? 'border-[#DA373C]/30 bg-[#DA373C]/10 text-[#fca5a5]' : 'border-[#23A559]/25 bg-[#23A559]/10 text-[#b8e7c9]')}>
          <span className="font-bold">İşleme durumu: {processingLabels[voiceProcessingStatus] || voiceProcessingStatus}</span><span className="ml-2">Etkin mod: {effectiveVoiceIsolationMode === 'strong' ? 'RNNoise (Güçlü)' : effectiveVoiceIsolationMode === 'standard' ? 'Standart' : 'Kapalı'}.</span><span className="ml-2">Motor: {processingEngineLabels[voiceProcessingEngine] || voiceProcessingEngine}.</span>{!rnnoiseSupported && <span className="ml-2">Bu cihaz AudioWorklet/WebAssembly desteklemediği için RNNoise kullanılamıyor.</span>}{!audioProcessingSupported && <span className="ml-2">Gelişmiş ses işleme desteği bulunamadı.</span>}
        </div>
        <div className="mt-4"><ToggleRow checked={noiseSuppression} onChange={value => { if (typeof setNoiseSuppression === 'function') void setNoiseSuppression(value); }} label="Gürültü azaltmayı etkinleştir" description="Kapatıldığında izolasyon da kapanır; yeniden açıldığında Standart mod kullanılır." /></div>
      </SettingsSection>

      <SettingsSection icon={MonitorUp} title="Yayın Kalitesi" description="Ekran paylaşımında kullanılacak varsayılan çözünürlük ve kare hızını seç.">
        <SelectField label="Varsayılan yayın ön ayarı" value={screenSharePreset} onChange={event => { if (typeof setScreenSharePreset === 'function') setScreenSharePreset(event.target.value); }}><option value="720p30">720p / 30 FPS — dengeli</option><option value="1080p30">1080p / 30 FPS — yüksek kalite</option><option value="1080p60">1080p / 60 FPS — akıcı</option></SelectField>
      </SettingsSection>
    </div>
  );

  const renderNotifications = () => (
    <SettingsSection icon={Bell} title="Bildirim Tercihleri" description="Hangi olaylar için masaüstü ve sesli uyarı alacağını belirle.">
      <div className="space-y-3">
        <ToggleRow checked={Boolean(notificationPrefs.desktop)} onChange={value => setNotificationPrefs(current => ({ ...current, desktop: value }))} label="Masaüstü bildirimleri" description="Uygulama arka plandayken sistem bildirimi göster." />
        <ToggleRow checked={Boolean(notificationPrefs.sound)} onChange={value => setNotificationPrefs(current => ({ ...current, sound: value }))} label="Bildirim sesleri" description="Yeni bildirim geldiğinde ses çal." />
        <ToggleRow checked={Boolean(notificationPrefs.directMessages)} onChange={value => setNotificationPrefs(current => ({ ...current, directMessages: value }))} label="Doğrudan mesajlar" description="Yeni DM mesajları için bildirim al." />
        <ToggleRow checked={Boolean(notificationPrefs.mentions)} onChange={value => setNotificationPrefs(current => ({ ...current, mentions: value }))} label="Etiket bildirimleri" description="Bir kullanıcı seni etiketlediğinde uyar." />
        <ToggleRow checked={Boolean(notificationPrefs.suppressEveryone)} onChange={value => setNotificationPrefs(current => ({ ...current, suppressEveryone: value }))} label="@everyone ve @here etiketlerini bastır" description="Toplu etiketleri kişisel bildirim gibi gösterme." />
        <ToggleRow checked={Boolean(notificationPrefs.suppressRoles)} onChange={value => setNotificationPrefs(current => ({ ...current, suppressRoles: value }))} label="Rol etiketlerini bastır" description="Rolüne gönderilen toplu etiketlerin bildirimini kapat." />
        <SelectField label="Varsayılan sunucu bildirimi" value={notificationPrefs.serverMode} onChange={event => setNotificationPrefs(current => ({ ...current, serverMode: event.target.value }))}><option value="all">Tüm mesajlar</option><option value="mentions">Sadece etiketler</option><option value="nothing">Hiçbiri</option></SelectField>
        <div className="flex justify-end pt-2"><button type="button" onClick={() => saveNotificationPreferences(notificationPrefs).then(payload => { setNotificationPrefs(current => ({ ...current, ...(payload.preferences || payload) })); toast.success('Bildirim ayarları kaydedildi.'); }).catch(error => toast.error(error.message))} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4]">Bildirimleri Kaydet</button></div>
      </div>
    </SettingsSection>
  );

  const renderAppearance = () => (
    <SettingsSection icon={Palette} title="Uygulama Teması" description="Renk düzeni hesabına kaydedilir ve bu cihazda anında uygulanır.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[['dark', 'Koyu', '#313338', '#1E1F22'], ['midnight', 'Gece mavisi', '#0c1220', '#050914'], ['light', 'Açık', '#ffffff', '#e8edf5']].map(([value, label, surface, background]) => <button key={value} type="button" onClick={() => { setTheme(value); document.documentElement.dataset.theme = value; }} className={'rounded-xl border p-3 text-left transition ' + (theme === value ? 'border-[#5865F2] bg-[#5865F2]/10' : 'border-white/[0.07] bg-[#1E1F22] hover:border-white/[0.16]')}><span className="mb-3 flex h-16 overflow-hidden rounded-lg border border-black/10" style={{ backgroundColor: background }}><span className="m-2 w-1/3 rounded" style={{ backgroundColor: surface }} /><span className="my-2 mr-2 flex-1 rounded" style={{ backgroundColor: surface }} /></span><span className="flex items-center justify-between text-sm font-bold text-[#DBDEE1]">{label}{theme === value && <Check className="h-4 w-4 text-[#5865F2]" />}</span></button>)}
      </div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={() => handleSaveInterface('Görünüm ayarları kaydedildi.')} disabled={isInterfaceSaving} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:opacity-50">{isInterfaceSaving ? 'Kaydediliyor…' : 'Temayı Kaydet'}</button></div>
    </SettingsSection>
  );

  const renderAccessibility = () => (
    <div className="space-y-5">
      <SettingsSection icon={Settings} title="Okunabilirlik" description="Bu tercihler cihazında saklanır ve uygulamanın tamamına anında uygulanır.">
        <label className="block rounded-lg border border-white/[0.05] bg-[#1E1F22] p-4"><span className="flex items-center justify-between gap-4 text-sm font-semibold text-[#DBDEE1]"><span>Metin ölçeği</span><span className="rounded bg-[#5865F2]/15 px-2 py-1 text-xs text-[#aab4ff]">%{accessibilityPrefs.fontScale}</span></span><input type="range" min="85" max="125" step="5" value={accessibilityPrefs.fontScale} onChange={event => updateAccessibility('fontScale', Number(event.target.value))} className="mt-4 w-full accent-[#5865F2]" /><span className="mt-2 flex justify-between text-[11px] text-[#72767D]"><span>Küçük</span><span>Varsayılan</span><span>Büyük</span></span></label>
        <div className="mt-3 space-y-3"><ToggleRow checked={accessibilityPrefs.highContrast} onChange={value => updateAccessibility('highContrast', value)} label="Yüksek kontrast" description="Odak göstergelerini ve temel arayüz kontrastını güçlendir." /><ToggleRow checked={accessibilityPrefs.underlineLinks} onChange={value => updateAccessibility('underlineLinks', value)} label="Bağlantıların altını çiz" description="Metin içindeki bağlantıları renk dışında bir işaretle de ayırt et." /></div>
      </SettingsSection>
      <SettingsSection title="Hareket" description="Animasyonların ve geçişlerin nasıl çalışacağını belirle."><ToggleRow checked={accessibilityPrefs.reducedMotion} onChange={value => updateAccessibility('reducedMotion', value)} label="Azaltılmış hareket" description="Animasyonları ve yumuşak geçişleri en aza indir." /><div className="mt-4 flex justify-end"><button type="button" onClick={resetAccessibility} className="flex items-center gap-2 rounded-md bg-[#4E5058] px-3 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78]"><RotateCcw className="h-4 w-4" /> Varsayılanlara dön</button></div></SettingsSection>
    </div>
  );

  const renderLanguage = () => (
    <SettingsSection icon={Globe2} title="Uygulama Dili" description="Dil tercihin hesabına kaydedilir ve sayfanın dil bilgisine uygulanır.">
      <SelectField icon={Globe2} label="Dil" value={locale} onChange={event => setLocale(event.target.value)}><option value="tr">Türkçe</option><option value="en">English</option></SelectField>
      <div className="mt-5 rounded-lg border border-white/[0.05] bg-[#1E1F22] p-4 text-sm leading-6 text-[#949BA4]">Toplulukların ve kullanıcıların yazdığı içerikler çevrilmez. Bu seçim uygulamanın arayüz dili ve erişilebilirlik dil bilgisini belirler.</div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={() => handleSaveInterface('Dil tercihi kaydedildi.')} disabled={isInterfaceSaving} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:opacity-50">{isInterfaceSaving ? 'Kaydediliyor…' : 'Dili Kaydet'}</button></div>
    </SettingsSection>
  );

  const renderUpdates = () => {
    const statusLabels = {
      disabled: 'Kullanılamıyor',
      idle: 'Hazır',
      checking: 'Denetleniyor',
      available: 'Yeni sürüm bulundu',
      downloading: 'İndiriliyor',
      downloaded: 'Yüklemeye hazır',
      installing: 'Yükleniyor',
      'up-to-date': 'Güncel',
      error: 'Bağlantı hatası',
    };
    const lastChecked = desktopUpdateState.lastCheckedAt
      ? new Date(desktopUpdateState.lastCheckedAt).toLocaleString('tr-TR')
      : 'Henüz denetlenmedi';
    const busy = desktopUpdateBusy || ['checking', 'available', 'downloading', 'installing'].includes(desktopUpdateState.status);

    return (
      <div className="space-y-5">
        <SettingsSection icon={Download} title="Masaüstü Güncellemeleri" description="Yeni sürümler şifreli bağlantı üzerinden indirilir ve paket bütünlüğü yüklemeden önce doğrulanır.">
          {!desktopUpdateState.supported ? (
            <div className="rounded-lg border border-[#F0B232]/25 bg-[#F0B232]/10 p-4 text-sm leading-6 text-[#f8d58b]">
              Bu ekran yalnızca Windows'a kurulmuş tahosapp uygulamasında çalışır. Tarayıcı sürümü sunucu güncellendiğinde zaten otomatik yenilenir.
            </div>
          ) : (
            <div className="space-y-4">
              <ToggleRow disabled={desktopUpdateBusy} checked={desktopUpdateState.automaticChecks !== false} onChange={handleAutomaticUpdateChange} label="Güncellemeleri otomatik denetle ve indir" description="Uygulama açıldıktan sonra ve her 30 dakikada bir yeni sürümü denetler. İndirilen sürüm uygulama kapatıldığında otomatik yüklenir." />

              <div className="rounded-xl border border-white/[0.06] bg-[#1E1F22] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-[#F2F3F5]">{statusLabels[desktopUpdateState.status] || desktopUpdateState.status}</p>
                    <p className="mt-1 text-xs leading-5 text-[#949BA4]">{desktopUpdateState.message}</p>
                  </div>
                  <span className="rounded-full bg-[#5865F2]/15 px-3 py-1 text-xs font-bold text-[#aab4ff]">v{desktopUpdateState.currentVersion || '—'}</span>
                </div>

                {typeof desktopUpdateState.progress === 'number' && (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-[11px] text-[#949BA4]"><span>İndirme</span><span>%{Math.round(desktopUpdateState.progress)}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#111214]"><div className="h-full rounded-full bg-[#5865F2] transition-all" style={{ width: `${Math.max(0, Math.min(100, desktopUpdateState.progress))}%` }} /></div>
                  </div>
                )}

                <div className="mt-4 grid gap-2 text-xs text-[#949BA4] sm:grid-cols-2">
                  <span>Son denetim: <strong className="text-[#DBDEE1]">{lastChecked}</strong></span>
                  <span>Bulunan sürüm: <strong className="text-[#DBDEE1]">{desktopUpdateState.availableVersion ? `v${desktopUpdateState.availableVersion}` : '—'}</strong></span>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={handleDesktopUpdateCheck} disabled={busy} className="flex items-center gap-2 rounded-md bg-[#4E5058] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={'h-4 w-4 ' + (desktopUpdateState.status === 'checking' ? 'animate-spin' : '')} /> Güncellemeleri denetle</button>
                {desktopUpdateState.status === 'downloaded' && <button type="button" onClick={installDesktopUpdate} className="flex items-center gap-2 rounded-md bg-[#23A559] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a8f4b]"><Download className="h-4 w-4" /> Yeniden başlat ve yükle</button>}
              </div>
            </div>
          )}
        </SettingsSection>
        <SettingsSection title="Güncelleme Davranışı" description="Web ve masaüstü sürümlerinin nasıl güncellendiğini açıklar.">
          <ul className="space-y-2 text-sm leading-6 text-[#B5BAC1]">
            <li>• Web uygulaması sunucuya yeni sürüm gönderildiğinde sonraki açılışta güncellenir.</li>
            <li>• Masaüstü uygulaması yeni paketi arka planda indirir ve kapanışta yükler.</li>
            <li>• Sesli görüşmedeyken uygulama kendiliğinden kapanmaz; yeniden başlatma zamanını sen seçersin.</li>
          </ul>
        </SettingsSection>
      </div>
    );
  };

  const handlePlatformBan = async target => {
    const reason = window.prompt(`${target.username} kullanıcısının ban gerekçesini yaz:`, 'Topluluk kuralları ihlali');
    if (reason === null) return;
    if (reason.trim().length < 3) return toast.error('Ban gerekçesi en az 3 karakter olmalıdır.');
    if (!window.confirm(`${target.username} tahosapp genelinde banlansın mı? Aktif oturumları hemen kapatılacak.`)) return;

    setAdminBusy(target.id);
    try {
      await authenticatedRequest(`/admin/users/${encodeURIComponent(target.id)}/ban`, {
        method: 'PUT',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadAdminOverview(adminQuery);
      toast.success(`${target.username} tahosapp genelinde banlandı.`);
    } catch (error) {
      toast.error(error.message || 'Kullanıcı banlanamadı.');
    } finally {
      setAdminBusy('');
    }
  };

  const handlePlatformUnban = async target => {
    if (!window.confirm(`${target.username} kullanıcısının platform banı kaldırılsın mı?`)) return;
    setAdminBusy(target.id);
    try {
      await authenticatedRequest(`/admin/users/${encodeURIComponent(target.id)}/ban`, { method: 'DELETE' });
      await loadAdminOverview(adminQuery);
      toast.success(`${target.username} kullanıcısının banı kaldırıldı.`);
    } catch (error) {
      toast.error(error.message || 'Ban kaldırılamadı.');
    } finally {
      setAdminBusy('');
    }
  };

  const renderAdmin = () => (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsSection icon={User} title="Toplam kayıtlı kullanıcı" description="Silinmemiş tüm tahosapp hesapları">
          <p className="text-4xl font-black text-white">{adminOverview?.totalUsers ?? '—'}</p>
        </SettingsSection>
        <SettingsSection icon={UserX} title="Banlı kullanıcı" description="Platforma giriş yapması engellenen hesaplar">
          <p className="text-4xl font-black text-[#F23F42]">{adminOverview?.bannedUsers ?? '—'}</p>
        </SettingsSection>
      </div>

      <SettingsSection icon={Shield} title="Platform kullanıcı yönetimi" description="Banlanan hesapların API, mesajlaşma, arama ve ses bağlantıları hemen kesilir. İşlem geri alınabilir.">
        <form className="mb-4 flex gap-2" onSubmit={event => { event.preventDefault(); loadAdminOverview(adminQuery); }}>
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949BA4]" />
            <input value={adminQuery} onChange={event => setAdminQuery(event.target.value)} placeholder="Kullanıcı adı, e-posta veya kullanıcı kimliği ara" maxLength={100} className="w-full rounded-md border border-transparent bg-[#1E1F22] py-2.5 pl-10 pr-3 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" />
          </label>
          <button type="submit" disabled={adminBusy === 'load'} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50">Ara</button>
        </form>

        <div className="space-y-2">
          {(adminOverview?.users || []).map(target => {
            const avatar = resolveSafeAvatarUrl(target.avatar);
            return (
              <div key={target.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.05] bg-[#1E1F22] p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white" style={{ backgroundColor: getColorForString(target.username || target.id) }}>
                  {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : String(target.username || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-[#F2F3F5]">{target.username}</strong>{target.isPlatformAdmin && <span className="rounded bg-[#5865F2]/20 px-2 py-0.5 text-[10px] font-bold text-[#aab4ff]">YÖNETİCİ</span>}{target.banned && <span className="rounded bg-[#F23F42]/20 px-2 py-0.5 text-[10px] font-bold text-[#ff9a9c]">BANLI</span>}</div>
                  <p className="truncate text-xs text-[#949BA4]">{target.email} · {target.status === 'offline' ? 'Çevrimdışı' : 'Çevrimiçi'}</p>
                  {target.ban?.reason && <p className="mt-1 text-xs text-[#ff9a9c]">Gerekçe: {target.ban.reason}</p>}
                </div>
                {!target.isPlatformAdmin && (target.banned
                  ? <button type="button" disabled={adminBusy === target.id} onClick={() => handlePlatformUnban(target)} className="rounded-md bg-[#4E5058] px-3 py-2 text-xs font-bold text-white hover:bg-[#6D6F78] disabled:opacity-50">Banı kaldır</button>
                  : <button type="button" disabled={adminBusy === target.id} onClick={() => handlePlatformBan(target)} className="rounded-md bg-[#DA373C] px-3 py-2 text-xs font-bold text-white hover:bg-[#A1282C] disabled:opacity-50">Banla</button>)}
              </div>
            );
          })}
          {adminOverview && !adminOverview.users?.length && <p className="rounded-lg bg-[#1E1F22] p-5 text-center text-sm text-[#949BA4]">Aramayla eşleşen kullanıcı bulunamadı.</p>}
          {!adminOverview && <p className="rounded-lg bg-[#1E1F22] p-5 text-center text-sm text-[#949BA4]">Kullanıcı bilgileri yükleniyor…</p>}
        </div>
      </SettingsSection>
    </div>
  );

  const tabContent = { account: renderAccount, profile: renderProfile, 'rich-presence': renderRichPresence, privacy: renderPrivacy, voice: renderVoice, notifications: renderNotifications, appearance: renderAppearance, accessibility: renderAccessibility, language: renderLanguage, updates: renderUpdates, admin: renderAdmin };

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#313338] text-[#DBDEE1]">
      <div className="flex h-full min-h-0 w-full">
        <aside className="hidden w-[260px] shrink-0 justify-end bg-[#2B2D31] md:flex">
          <div className="custom-scrollbar h-full w-[230px] overflow-y-auto px-3 py-8">
            <div className="mb-6 px-2"><p className="text-lg font-extrabold text-[#F2F3F5]">Ayarlar</p><p className="mt-1 truncate text-xs text-[#949BA4]">{user.username}</p></div>
            {settingGroups.map((group, groupIndex) => <div key={group.label} className={groupIndex ? 'mt-6' : ''}><p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-[#949BA4]">{group.label}</p><div className="space-y-0.5">{group.items.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setActiveTab(item.id)} className={'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium transition ' + (activeTab === item.id ? 'bg-[#404249] text-white' : 'text-[#B5BAC1] hover:bg-[#35373C] hover:text-[#DBDEE1]')}><Icon className="h-[18px] w-[18px] shrink-0" /><span className="truncate">{item.label}</span></button>; })}</div></div>)}
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#313338]">
          <div className="flex h-full min-h-0">
            <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto">
              <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#313338]/95 px-5 py-4 backdrop-blur md:px-10">
                <div className="mx-auto flex max-w-4xl items-center justify-between gap-4"><div className="min-w-0"><h1 className="truncate text-xl font-bold text-[#F2F3F5]">{activeDefinition.label}</h1><p className="mt-0.5 hidden text-xs text-[#949BA4] sm:block">{activeDefinition.description}</p></div><button type="button" onClick={onClose} aria-label="Ayarları kapat" title="Kapat (ESC)" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#72767D] text-[#B5BAC1] transition hover:border-[#DBDEE1] hover:text-white"><X className="h-5 w-5" /></button></div>
                <select value={activeTab} onChange={event => setActiveTab(event.target.value)} className="mt-4 w-full rounded-md border border-white/[0.08] bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none md:hidden">{settingGroups.map(group => <optgroup key={group.label} label={group.label}>{group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select>
              </header>
              <div className="mx-auto max-w-4xl px-5 pb-16 pt-7 md:px-10">{tabContent[activeTab]?.()}</div>
            </div>
            <div className="hidden w-24 shrink-0 xl:block" />
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
