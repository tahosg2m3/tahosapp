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
  ImagePlus,
  KeyRound,
  Lock,
  Mail,
  Mic,
  MonitorUp,
  Music2,
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
  APP_THEME_OPTIONS,
  AVATAR_DECORATION_OPTIONS,
  NAME_EFFECT_OPTIONS,
  NAME_FONT_OPTIONS,
  PROFILE_EFFECT_OPTIONS,
  PROFILE_THEME_OPTIONS,
  getAvatarDecoration,
  getNameAppearance,
  getProfileSurface,
} from '../../utils/profileAppearance';
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
  createSpotifyAuthorization,
  createRichPresenceToken,
  disconnectSpotify,
  getSpotifyStatus,
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
import { API_ORIGIN, API_URL } from '../../config/runtimeConfig';
import { apiFetch } from '../../services/httpClient';

const SETTING_GROUPS = [
  {
    label: 'USER SETTINGS',
    items: [
      { id: 'account', label: 'My Account', icon: User, description: 'Login details and account summary' },
      { id: 'profile', label: 'Profiles', icon: Palette, description: 'Edit your public profile' },
      { id: 'rich-presence', label: 'Rich Presence', icon: Activity, description: 'Automatic game and music activity' },
      { id: 'privacy', label: 'Privacy & Safety', icon: Shield, description: 'Manage blocked users' },
    ],
  },
  {
    label: 'APP SETTINGS',
    items: [
      { id: 'voice', label: 'Voice & Video', icon: Headphones, description: 'Devices, quality, and voice isolation' },
      { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Alert and sound preferences' },
      { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Choose the app theme' },
      { id: 'accessibility', label: 'Accessibility', icon: Settings, description: 'Readability and motion options' },
      { id: 'language', label: 'Language', icon: Globe2, description: 'Choose the app language' },
      { id: 'updates', label: 'Updates', icon: Download, description: 'Keep the desktop app up to date' },
    ],
  },
  {
    label: 'TAHOSAPP ADMINISTRATION',
    items: [
      { id: 'admin', label: 'User Management', icon: UserX, description: 'View registered users and manage platform bans', adminOnly: true },
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
  if (!response.ok) throw new Error(payload.error || payload.message || 'The operation could not be completed.');
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

function OptionGrid({ label, options, value, onChange, renderPreview }) {
  return (
    <fieldset>
      <legend className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-w-0 rounded-xl border p-3 text-left transition ${value === option.value ? 'border-[#5865F2] bg-[#5865F2]/10' : 'border-white/[0.07] bg-[#1E1F22] hover:border-white/[0.16]'}`}
          >
            <span className="mb-2 block min-h-10">{renderPreview?.(option)}</span>
            <span className="flex items-center justify-between gap-2 text-xs font-bold text-[#DBDEE1]">{option.label}{value === option.value && <Check className="h-3.5 w-3.5 shrink-0 text-[#8b93ff]" />}</span>
          </button>
        ))}
      </div>
    </fieldset>
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
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [banner, setBanner] = useState(user.banner || '');
  const [bio, setBio] = useState(user.bio || '');
  const [customStatus, setCustomStatus] = useState(user.customStatus || '');
  const [presenceStatus, setPresenceStatus] = useState(user.presenceStatus || user.status || 'online');
  const [locale, setLocale] = useState(user.locale || localStorage.getItem('chat:locale') || 'en');
  const [theme, setTheme] = useState(user.theme || localStorage.getItem('chat:theme') || 'dark');
  const [profileTheme, setProfileTheme] = useState(user.profileTheme || 'default');
  const [profileAccentColor, setProfileAccentColor] = useState(user.profileAccentColor || '#7c5cff');
  const [nameFont, setNameFont] = useState(user.nameFont || 'default');
  const [nameEffect, setNameEffect] = useState(user.nameEffect || 'none');
  const [avatarDecoration, setAvatarDecoration] = useState(user.avatarDecoration || 'none');
  const [profileEffect, setProfileEffect] = useState(user.profileEffect || 'none');
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
  const [spotifyState, setSpotifyState] = useState({ configured: false, connected: false, connectedAt: null });
  const [spotifyBusy, setSpotifyBusy] = useState('');
  const [desktopUpdateState, setDesktopUpdateState] = useState({
    supported: false,
    status: 'disabled',
    currentVersion: '',
    availableVersion: null,
    progress: null,
    automaticChecks: true,
    lastCheckedAt: null,
    message: 'Loading update information…',
  });
  const [desktopUpdateBusy, setDesktopUpdateBusy] = useState(false);
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminQuery, setAdminQuery] = useState('');
  const [adminBusy, setAdminBusy] = useState('');
  const [testPresence, setTestPresence] = useState({
    name: 'Example Game',
    type: 'playing',
    details: 'Chapter 4 — Crystal Caverns',
    state: 'Score: 12,450',
    imageUrl: '',
  });

  const avatarColor = getColorForString(username || user.username || 'U');
  const initial = (username || user.username || '?').slice(0, 1).toUpperCase();
  const safeAvatarUrl = resolveSafeAvatarUrl(avatarUrl);
  const safeBannerUrl = resolveSafeMediaUrl(banner);
  const safeProfileAccentColor = /^#[0-9a-f]{6}$/i.test(profileAccentColor) ? profileAccentColor : '#7c5cff';
  const previewProfile = { profileTheme, profileAccentColor: safeProfileAccentColor, nameFont, nameEffect, avatarDecoration, profileEffect };
  const previewNameAppearance = getNameAppearance(previewProfile);
  const previewSurface = getProfileSurface(previewProfile);
  const previewAvatarDecoration = getAvatarDecoration(previewProfile);
  const isVerifyingEmail = Boolean(emailChangeTicket);
  const activeDefinition = allSettings.find(item => item.id === activeTab) || allSettings[0];

  const loadAdminOverview = async (query = adminQuery) => {
    if (!user.isPlatformAdmin) return;
    setAdminBusy('load');
    try {
      const payload = await authenticatedRequest(`/admin/overview?query=${encodeURIComponent(query.trim())}&limit=100`);
      setAdminOverview(payload);
    } catch (error) {
      toast.error(error.message || 'The user list could not be loaded.');
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
    getSpotifyStatus()
      .then(setSpotifyState)
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
    // Administrator status comes from session verification and is loaded only at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.isPlatformAdmin]);

  const handleUnblock = async targetUserId => {
    try {
      await unblockUser(targetUserId);
      setBlockedUsers(current => current.filter(item => (item.user?.id || item.id || item.userId) !== targetUserId));
      toast.success('The user was unblocked.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleCreatePresenceToken = async () => {
    if (richPresenceState.token?.exists && !window.confirm('The current integration key will stop working. Create a new key?')) return;
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
      toast.success('A new Rich Presence key was created. It is shown only once.');
    } catch (error) {
      toast.error(error.message || 'The integration key could not be created.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleRevokePresenceToken = async () => {
    if (!window.confirm('Revoke the integration key and close all active Rich Presence sessions?')) return;
    setPresenceBusy('token');
    try {
      await revokeRichPresenceToken();
      setGeneratedPresenceToken('');
      setRichPresenceState(current => ({ ...current, token: { exists: false }, activities: [] }));
      toast.success('The integration key was revoked.');
    } catch (error) {
      toast.error(error.message || 'The key could not be revoked.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleToggleRichPresence = async enabled => {
    setPresenceBusy('toggle');
    try {
      const payload = await updateRichPresenceSettings(enabled);
      setRichPresenceState(payload);
      toast.success(enabled ? 'Rich Presence sharing enabled.' : 'Rich Presence sharing disabled.');
    } catch (error) {
      toast.error(error.message || 'The Rich Presence preference could not be updated.');
    } finally {
      setPresenceBusy('');
    }
  };

  const refreshSpotifyStatus = async () => {
    setSpotifyBusy('refresh');
    try {
      setSpotifyState(await getSpotifyStatus());
    } catch (error) {
      toast.error(error.message || 'Could not refresh the Spotify connection.');
    } finally {
      setSpotifyBusy('');
    }
  };

  const handleConnectSpotify = async () => {
    setSpotifyBusy('connect');
    try {
      const payload = await createSpotifyAuthorization();
      window.open(payload.authorizationUrl, '_blank', 'noopener,noreferrer');
      toast.success('Spotify authorization opened. Return here and refresh after approving it.');
    } catch (error) {
      toast.error(error.message || 'Could not start Spotify authorization.');
    } finally {
      setSpotifyBusy('');
    }
  };

  const handleDisconnectSpotify = async () => {
    if (!window.confirm('Disconnect Spotify from tahosapp? Listening invites will stop working for this account.')) return;
    setSpotifyBusy('disconnect');
    try {
      setSpotifyState(await disconnectSpotify());
      toast.success('Spotify disconnected.');
    } catch (error) {
      toast.error(error.message || 'Could not disconnect Spotify.');
    } finally {
      setSpotifyBusy('');
    }
  };

  const handlePublishTestPresence = async () => {
    if (!testPresence.name.trim()) return toast.error('An app or game name is required.');
    setPresenceBusy('test');
    try {
      const payload = await setRichPresenceActivity({
        ...testPresence,
        sessionId: 'settings-preview',
        startedAt: Date.now(),
        ttlSeconds: 900,
        metadata: testPresence.type === 'playing' ? { Level: '24', Mod: 'Dereceli' } : {},
        music: testPresence.type === 'listening' ? {
          song: testPresence.details || 'Example Track',
          artist: testPresence.state || 'Example Artist',
          durationMs: 240000,
          positionMs: 45000,
        } : undefined,
      });
      setRichPresenceState(current => ({ ...current, activities: payload.activities || [] }));
      toast.success('The test activity is now visible on your profile.');
    } catch (error) {
      toast.error(error.message || 'The test activity could not be published.');
    } finally {
      setPresenceBusy('');
    }
  };

  const handleClearTestPresence = async () => {
    setPresenceBusy('test');
    try {
      const payload = await clearRichPresenceActivity('settings-preview');
      setRichPresenceState(current => ({ ...current, activities: payload.activities || [] }));
      toast.success('The test activity was removed.');
    } catch (error) {
      toast.error(error.message || 'The test activity could not be removed.');
    } finally {
      setPresenceBusy('');
    }
  };

  const copyPresenceToken = async () => {
    if (!generatedPresenceToken) return;
    try {
      await navigator.clipboard.writeText(generatedPresenceToken);
      toast.success('The integration key was copied.');
    } catch (_) {
      toast.error('The key could not be copied to the clipboard.');
    }
  };

  const handleSaveProfile = async () => {
    if (!username.trim()) {
      toast.error('Username cannot be empty.');
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(profileAccentColor)) {
      toast.error('The profile accent color must use the #RRGGBB format.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await platformRequest('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          username: username.trim(),
          avatar: avatarUrl.trim(),
          banner: banner.trim(),
          bio: bio.trim(),
          customStatus: customStatus.trim(),
          presenceStatus,
          locale,
          theme,
          profileTheme,
          profileAccentColor,
          nameFont,
          nameEffect,
          avatarDecoration,
          profileEffect,
        }),
      });
      updateUserData(result.user || result);
      localStorage.setItem('chat:locale', locale);
      localStorage.setItem('chat:theme', theme);
      document.documentElement.lang = locale;
      document.documentElement.dataset.theme = theme;
      socket?.emit('status:change', { status: presenceStatus, customStatus: customStatus.trim() });
      toast.success('Your profile was updated.');
    } catch (error) {
      toast.error(error.message || 'An error occurred while updating your profile.');
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
      toast.error(error.message || 'Preferences could not be saved.');
    } finally {
      setIsInterfaceSaving(false);
    }
  };

  const updateAccessibility = (key, value) => {
    setAccessibilityPrefs(current => saveAccessibilityPreferences({ ...current, [key]: value }));
  };

  const handleAvatarUpload = async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif']);
    if (!allowedTypes.has(file.type)) {
      toast.error('The avatar must be a JPG, PNG, or GIF image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('The avatar file can be at most 10 MB.');
      return;
    }

    setIsAvatarUploading(true);
    try {
      const body = new FormData();
      body.append('avatar', file, file.name);
      const response = await apiFetch(`${API_URL}/upload/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('chat_token')}` },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The avatar could not be uploaded.');
      const uploadedUrl = String(payload.url || '');
      if (!uploadedUrl) throw new Error('The server did not return an avatar URL.');
      setAvatarUrl(uploadedUrl.startsWith('/uploads/') ? `${API_ORIGIN}${uploadedUrl}` : uploadedUrl);
      toast.success(file.type === 'image/gif'
        ? 'Animated avatar uploaded. Save your changes.'
        : 'Avatar uploaded. Save your changes.');
    } catch (error) {
      toast.error(error.message || 'The avatar could not be uploaded.');
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const updateAutomaticPresencePreference = (key, value) => {
    setAutomaticPresencePrefs(current => saveAutomaticPresencePreferences({ ...current, [key]: value }));
  };

  const resetAccessibility = () => {
    setAccessibilityPrefs(saveAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES));
    toast.success('Accessibility settings were reset.');
  };

  const handleVoiceIsolationChange = async mode => {
    if (typeof setVoiceIsolationMode !== 'function') return;
    setVoiceSettingBusy('isolation');
    try {
      const applied = await setVoiceIsolationMode(mode);
      if (!applied) {
        toast.error('Voice isolation could not be applied to the active call. The previous setting was kept.');
        return;
      }
      toast.success('Voice isolation updated.');
    } catch (error) {
      toast.error(error.message || 'Voice isolation could not be applied.');
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
        toast.error('Audio quality could not be applied to the active call. The previous setting was kept.');
        return;
      }
      toast.success('Audio quality updated.');
    } catch (error) {
      toast.error(error.message || 'Audio quality could not be applied.');
    } finally {
      setVoiceSettingBusy('');
    }
  };

  const handleRequestEmailChange = async event => {
    event.preventDefault();
    if (!newEmail.trim() || !currentPassword) {
      toast.error('Enter your new email address and current password.');
      return;
    }
    setIsEmailLoading(true);
    try {
      const result = await authenticatedRequest('/auth/request-email-change', { method: 'POST', body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword }) });
      setEmailChangeTicket(result.emailChangeTicket);
      setEmailCode('');
      toast.success('A verification code was sent to your new email address.');
    } catch (error) {
      toast.error(error.message || 'The verification email could not be sent.');
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
      toast.success('Your email address was updated.');
    } catch (error) {
      toast.error(error.message || 'The code could not be verified.');
    } finally {
      setIsEmailLoading(false);
    }
  };

  const handleResendEmailCode = async () => {
    setIsEmailLoading(true);
    try {
      await authenticatedRequest('/auth/resend-email-change', { method: 'POST', body: JSON.stringify({ emailChangeTicket }) });
      toast.success('A new verification code was sent.');
    } catch (error) {
      toast.error(error.message || 'The code could not be resent.');
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
      toast.error('The update check could not be started.');
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
      toast.success(enabled ? 'Automatic update checks enabled.' : 'Automatic update checks disabled.');
    } catch (_) {
      toast.error('The update preference could not be saved.');
    } finally {
      setDesktopUpdateBusy(false);
    }
  };

  const installDesktopUpdate = async () => {
    const bridge = globalThis.electron?.desktopUpdater;
    if (!bridge) return;
    const result = await bridge.install().catch(() => ({ started: false }));
    if (!result?.started) toast.error('The downloaded update is not ready yet.');
  };

  const renderAccount = () => (
    <div className="space-y-5">
      <section className="relative mt-12 overflow-visible rounded-xl border border-white/[0.07] bg-[#2B2D31]">
        <div className="relative h-24 overflow-hidden rounded-t-xl bg-gradient-to-r from-[#5865F2] via-[#7c5ce7] to-[#9256EA]">
          {safeBannerUrl && <img src={safeBannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          {safeBannerUrl && <div className="absolute inset-0 bg-black/25" />}
        </div>
        <div className="absolute left-6 top-10 flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full border-[6px] border-[#2B2D31] text-4xl font-bold text-white shadow-lg" style={{ backgroundColor: safeAvatarUrl ? 'transparent' : avatarColor }}>
          {safeAvatarUrl ? <img src={safeAvatarUrl} alt="Profile picture" className="h-full w-full object-cover" /> : initial}
        </div>
        <div className="flex flex-col gap-4 px-6 pb-6 pt-16 sm:flex-row sm:items-end sm:justify-between">
          <div><h3 className="text-2xl font-bold text-[#F2F3F5]">{username || user.username}</h3><p className="mt-1 text-sm text-[#949BA4]">{user.email}</p></div>
          <button type="button" onClick={() => setActiveTab('profile')} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752C4]">Edit Profile</button>
        </div>
      </section>

      <SettingsSection icon={Mail} title="Email Address" description="Email changes are verified with a six-digit code sent to the new address.">
        {!isVerifyingEmail ? (
          <form className="space-y-4" onSubmit={handleRequestEmailChange}>
            <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">New email address</span><input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
            <label className="block"><span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-[#B5BAC1]"><Lock className="h-3.5 w-3.5" /> Current password</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password to confirm" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
            <div className="flex justify-end"><button type="submit" disabled={isEmailLoading || !newEmail.trim() || !currentPassword} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50">{isEmailLoading ? 'Sending code…' : 'Send Verification Code'}</button></div>
          </form>
        ) : (
          <form onSubmit={handleConfirmEmailChange}>
            <div className="rounded-md border border-[#23A559]/30 bg-[#23A559]/10 p-3 text-sm text-[#C4F1D1]"><Shield className="mr-2 inline h-4 w-4" /> Kod <strong>{newEmail}</strong> The code was sent to this address and is valid for 10 minutes.</div>
            <label className="mt-4 block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Six-digit verification code</span><input value={emailCode} onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-3 text-center font-mono text-lg tracking-[0.35em] text-[#F2F3F5] outline-none focus:border-[#00A8FC]" /></label>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={cancelEmailChange} disabled={isEmailLoading} className="flex items-center gap-1.5 rounded px-2 py-2 text-sm text-[#B5BAC1] hover:bg-[#35373C] hover:text-white"><ArrowLeft className="h-4 w-4" /> Cancel</button><div className="flex items-center gap-2"><button type="button" onClick={handleResendEmailCode} disabled={isEmailLoading} className="flex items-center gap-1.5 rounded px-2 py-2 text-sm text-[#B5BAC1] hover:bg-[#35373C] hover:text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Resend</button><button type="submit" disabled={isEmailLoading || emailCode.length !== 6} className="flex items-center gap-1.5 rounded-md bg-[#23A559] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D8046] disabled:opacity-50"><Check className="h-4 w-4" /> {isEmailLoading ? 'Verifying…' : 'Verify'}</button></div></div>
          </form>
        )}
      </SettingsSection>
    </div>
  );

  const renderProfile = () => (
    <div className="space-y-5">
      <SettingsSection icon={User} title="User Profile" description="Edit the profile information and online status that other users see.">
       <div className="space-y-5">
        <div className={`relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#111214] ${previewSurface.className}`} style={previewSurface.style}>
          <div className="relative h-24 overflow-hidden" style={{ background: `linear-gradient(135deg, ${safeProfileAccentColor}, #111214)` }}>
            {safeBannerUrl && <img src={safeBannerUrl} alt="Profile banner preview" className="absolute inset-0 h-full w-full object-cover" />}
          </div>
          <div className="relative px-5 pb-5">
            <div className={`relative -mt-10 inline-flex ${previewAvatarDecoration.className}`} style={previewAvatarDecoration.style}>
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-[6px] border-[#111214] text-2xl font-black text-white" style={{ backgroundColor: safeAvatarUrl ? 'transparent' : avatarColor }}>
                {safeAvatarUrl ? <img src={safeAvatarUrl} alt="Profile picture preview" className="h-full w-full object-cover" /> : initial}
              </div>
            </div>
            <h3 className={`mt-2 text-2xl font-black text-white ${previewNameAppearance.className}`} style={previewNameAppearance.style}>{username || user.username}</h3>
            <p className="mt-1 text-sm text-[#b5bac1]">{customStatus || 'Profile customization preview'}</p>
          </div>
        </div>
        <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Username <span className="text-[#DA373C]">*</span></span><input value={username} onChange={event => setUsername(event.target.value)} maxLength={50} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Profile picture</span><div className="flex gap-2"><input value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="Paste an HTTPS URL or upload a file" className="min-w-0 flex-1 rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /><label className={'flex shrink-0 cursor-pointer items-center gap-2 rounded-md bg-[#4E5058] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#6D6F78] ' + (isAvatarUploading ? 'pointer-events-none opacity-50' : '')}><ImagePlus className="h-4 w-4" />{isAvatarUploading ? 'Uploading…' : 'Upload'}<input type="file" accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif" className="sr-only" disabled={isAvatarUploading} onChange={handleAvatarUpload} /></label></div><span className="mt-1.5 block text-xs text-[#949BA4]">JPG, PNG, or animated GIF · up to 10 MB</span></div>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Profile banner URL</span><input value={banner} onChange={event => setBanner(event.target.value)} placeholder="https://example.com/banner.jpg" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        </div>
        <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">About Me</span><textarea rows="5" value={bio} onChange={event => setBio(event.target.value.slice(0, 300))} placeholder="Tell people about yourself" className="w-full resize-none rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /><span className="mt-1 block text-right text-[11px] text-[#72767D]">{bio.length}/300</span></label>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Custom status</span><input value={customStatus} onChange={event => setCustomStatus(event.target.value.slice(0, 128))} placeholder="What are you doing right now?" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <SelectField label="Online status" value={presenceStatus} onChange={event => setPresenceStatus(event.target.value)}><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">Do Not Disturb</option><option value="invisible">Invisible</option></SelectField>
        </div>
       </div>
      </SettingsSection>

      <SettingsSection icon={Palette} title="Profile Customization" description="All themes, name styles, and profile effects are free.">
        <div className="space-y-6">
          <div><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Profile accent color</span><div className="flex items-center gap-3"><input type="color" value={profileAccentColor} onChange={event => setProfileAccentColor(event.target.value)} className="h-11 w-16 cursor-pointer rounded-lg border border-white/[0.1] bg-[#1E1F22] p-1" /><input value={profileAccentColor} onChange={event => { const value = event.target.value.slice(0, 7); setProfileAccentColor(value); }} maxLength={7} aria-label="Profile accent color code" className="w-32 rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 font-mono text-sm uppercase text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /><span className="text-xs text-[#949BA4]">Used for the profile card, name effect, and decorations.</span></div></div>

          <OptionGrid label="Profile theme" options={PROFILE_THEME_OPTIONS} value={profileTheme} onChange={setProfileTheme} renderPreview={option => <span className="block h-10 rounded-lg" style={{ background: `linear-gradient(135deg, ${option.colors[0]}, ${option.colors[1]})` }} />} />
          <OptionGrid label="Name font" options={NAME_FONT_OPTIONS} value={nameFont} onChange={setNameFont} renderPreview={option => <span className={`block truncate text-lg font-bold text-white profile-name-font-${option.value}`}>{username || 'tahosapp'}</span>} />
          <OptionGrid label="Name effect" options={NAME_EFFECT_OPTIONS} value={nameEffect} onChange={setNameEffect} renderPreview={option => <span className={`block truncate text-lg font-black profile-name-effect-${option.value}`} style={{ '--profile-accent': safeProfileAccentColor }}>{username || 'tahosapp'}</span>} />
          <OptionGrid label="Avatar decoration" options={AVATAR_DECORATION_OPTIONS} value={avatarDecoration} onChange={setAvatarDecoration} renderPreview={option => <span className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#334155] text-sm font-black text-white profile-avatar-decoration profile-avatar-decoration-${option.value}`} style={{ '--profile-accent': safeProfileAccentColor }}><span className="flex h-full w-full items-center justify-center rounded-full">{initial}</span></span>} />
          <OptionGrid label="Profile effect" options={PROFILE_EFFECT_OPTIONS} value={profileEffect} onChange={setProfileEffect} renderPreview={option => <span className={`block h-10 rounded-lg bg-[#111214] profile-surface profile-effect-${option.value}`} style={{ '--profile-accent': safeProfileAccentColor }} />} />
        </div>
      </SettingsSection>

      <div className="flex justify-end"><button type="button" onClick={handleSaveProfile} disabled={isSaving} className="rounded-md bg-[#5865F2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'Saving…' : 'Save Profile & Effects'}</button></div>
    </div>
  );

  const renderRichPresence = () => (
    <div className="space-y-5">
      <SettingsSection icon={Activity} title="Automatic activity status" description="Running games and Spotify or YouTube Music sessions are detected automatically on Windows. No account link, key, or game plugin is required.">
        <ToggleRow
          checked={richPresenceState.enabled !== false}
          disabled={presenceBusy === 'toggle'}
          onChange={handleToggleRichPresence}
          label="Allow activity sharing"
          description="Turning this off immediately removes all active sessions and prevents integrations from publishing until you enable it again."
        />
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#1E1F22] p-4 text-sm text-[#949BA4]">
          <p><strong className="text-[#DBDEE1]">Live sessions:</strong> {richPresenceState.activities?.length || 0} / {richPresenceState.limits?.maxSessions || 5}</p>
          <p className="mt-1 text-xs">Windows media information refreshes about every three seconds. Detailed options affect automatic detection on this device only.</p>
        </div>
      </SettingsSection>

      <SettingsSection icon={Settings} title="Automatic Detection" description="Control automatic game and media sharing on this computer. Changes apply immediately.">
        <div className="space-y-3">
          <ToggleRow checked={automaticPresencePrefs.enabled} onChange={value => updateAutomaticPresencePreference('enabled', value)} label="Use automatic detection on this device" description="When off, automatic game, music, and video activities are removed; custom integrations are unaffected." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showGames} onChange={value => updateAutomaticPresencePreference('showGames', value)} label="Show games I play" description="Publish detected game processes as Playing on your profile." />
        </div>
      </SettingsSection>

      <div className="grid gap-5 xl:grid-cols-2">
        <SettingsSection icon={Activity} title="Game Privacy" description="Choose which details appear in game activity.">
          <div className="space-y-3">
            <ToggleRow disabled={!automaticPresencePrefs.enabled || !automaticPresencePrefs.showGames} checked={automaticPresencePrefs.showGamePlatform} onChange={value => updateAutomaticPresencePreference('showGamePlatform', value)} label="Show game platform" description="Share Steam, Xbox, Epic Games, or another detected store name." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled || !automaticPresencePrefs.showGames} checked={automaticPresencePrefs.showGameElapsed} onChange={value => updateAutomaticPresencePreference('showGameElapsed', value)} label="Show elapsed game time" description="Show how long the game has been running on the profile card." />
          </div>
        </SettingsSection>

        <SettingsSection icon={Headphones} title="Music Services" description="Choose which music sources may appear on your profile.">
          <div className="space-y-3">
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showSpotify} onChange={value => updateAutomaticPresencePreference('showSpotify', value)} label="Spotify" description="Show music from the Spotify desktop app." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showYouTubeMusic} onChange={value => updateAutomaticPresencePreference('showYouTubeMusic', value)} label="YouTube Music" description="Show only the YouTube Music app; regular YouTube videos are excluded." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showOtherMusic} onChange={value => updateAutomaticPresencePreference('showOtherMusic', value)} label="Other music players" description="Show other standalone music apps connected to Windows media controls." />
            <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showPausedMusic} onChange={value => updateAutomaticPresencePreference('showPausedMusic', value)} label="Show paused music" description="Keep the activity as Paused instead of removing it when playback stops." />
          </div>
        </SettingsSection>
      </div>

      <SettingsSection icon={Music2} title="Spotify listening invites" description="Share Spotify tracks as rich invitations. Every listener opens the track with their own account.">
        {!spotifyState.configured ? (
          <div className="rounded-lg border border-[#1ed760]/30 bg-[#1ed760]/10 p-4 text-sm leading-6 text-[#bff5cf]">Link-based invitations are ready and do not require Premium. Use the green music button beside the message box and paste a Spotify track link.</div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[#1E1F22] p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#DBDEE1]"><span className={`h-2.5 w-2.5 rounded-full ${spotifyState.connected ? 'bg-[#1ed760]' : 'bg-[#72767D]'}`} /> {spotifyState.connected ? 'Spotify connected' : 'Spotify is not connected'}</p>
              <p className="mt-1 text-xs leading-5 text-[#949BA4]">{spotifyState.connectedAt ? `Connected ${new Date(spotifyState.connectedAt).toLocaleString('en-US')}` : 'A free account can share and open invites; automatic Listen Along requires Premium.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={refreshSpotifyStatus} disabled={Boolean(spotifyBusy)} className="flex items-center gap-2 rounded-md bg-[#4E5058] px-3 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${spotifyBusy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh</button>
              {spotifyState.connected ? <button type="button" onClick={handleDisconnectSpotify} disabled={Boolean(spotifyBusy)} className="rounded-md bg-[#DA373C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#b92d32] disabled:opacity-50">Disconnect</button> : <button type="button" onClick={handleConnectSpotify} disabled={Boolean(spotifyBusy)} className="flex items-center gap-2 rounded-md bg-[#1ed760] px-3 py-2 text-sm font-extrabold text-[#07130b] hover:bg-[#3be477] disabled:opacity-50"><Music2 className="h-4 w-4" /> Connect Spotify</button>}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-[#949BA4]">Use the green music button beside the message box to send a track link. When OAuth is available, connected users can share their currently playing track; Premium listeners can also use “Listen along.”</p>
      </SettingsSection>

      <SettingsSection icon={Headphones} title="Music Details" description="Choose each field shared in music activity.">
        <div className="grid gap-3 lg:grid-cols-2">
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showSongTitle} onChange={value => updateAutomaticPresencePreference('showSongTitle', value)} label="Track title" description="When off, a generic track description replaces the real title." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showArtist} onChange={value => updateAutomaticPresencePreference('showArtist', value)} label="Artist" description="Show the track artist or channel." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showAlbum} onChange={value => updateAutomaticPresencePreference('showAlbum', value)} label="Album" description="Show the album name when Windows provides it." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showMusicProgress} onChange={value => updateAutomaticPresencePreference('showMusicProgress', value)} label="Track progress bar" description="Show the current time, total duration, and progress bar." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showMusicElapsed} onChange={value => updateAutomaticPresencePreference('showMusicElapsed', value)} label="Listening time" description="Also show how long the activity has been active." />
        </div>
      </SettingsSection>

      <SettingsSection icon={Video} title="Video & Browser Activity" description="Regular YouTube and other browser videos are managed separately from music. Browser video sharing is off by default for privacy.">
        <div className="grid gap-3 lg:grid-cols-2">
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showBrowserVideos} onChange={value => updateAutomaticPresencePreference('showBrowserVideos', value)} label="Show browser videos" description="Publish Chrome, Edge, Firefox, Opera, and Vivaldi media sessions as Watching." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showOtherVideos} onChange={value => updateAutomaticPresencePreference('showOtherVideos', value)} label="Show other video apps" description="Allow activity from video players outside the browser." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showPausedVideos} onChange={value => updateAutomaticPresencePreference('showPausedVideos', value)} label="Show paused videos" description="Keep paused video activity on your profile." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoTitle} onChange={value => updateAutomaticPresencePreference('showVideoTitle', value)} label="Video title" description="Show the title of the video being watched." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoCreator} onChange={value => updateAutomaticPresencePreference('showVideoCreator', value)} label="Channel or creator" description="Show the artist/channel field from Windows media information." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoProgress} onChange={value => updateAutomaticPresencePreference('showVideoProgress', value)} label="Video progress bar" description="Show the current time and total duration." />
          <ToggleRow disabled={!automaticPresencePrefs.enabled} checked={automaticPresencePrefs.showVideoElapsed} onChange={value => updateAutomaticPresencePreference('showVideoElapsed', value)} label="Watch time" description="Also show how long the activity has been active." />
        </div>
      </SettingsSection>

      <SettingsSection icon={KeyRound} title="Optional Advanced Integration" description="Not required for automatic detection. This is only for apps that publish custom scores, levels, or party information, and it cannot access messages, friends, or account settings.">
        {generatedPresenceToken && (
          <div className="mb-4 rounded-lg border border-[#f0b232]/35 bg-[#f0b232]/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#f0b232]">Save this somewhere secure now — it will not be shown again</p>
            <div className="mt-3 flex gap-2"><input readOnly value={generatedPresenceToken} className="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-[#111214] px-3 py-2 font-mono text-xs text-[#DBDEE1] outline-none" /><button type="button" onClick={copyPresenceToken} className="flex items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold text-white hover:bg-[#4752C4]"><Copy className="h-4 w-4" /> Copy</button></div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1E1F22] p-4">
          <div><p className="text-sm font-bold text-[#DBDEE1]">{richPresenceState.token?.exists ? `Key active ••••${richPresenceState.token.lastFour || ''}` : 'No integration key yet'}</p><p className="mt-1 text-xs text-[#949BA4]">{richPresenceState.token?.createdAt ? `Created: ${new Date(richPresenceState.token.createdAt).toLocaleString('en-US')}` : 'Create a key and add it to your game or app.'}</p></div>
          <div className="flex gap-2"><button type="button" disabled={presenceBusy === 'token'} onClick={handleCreatePresenceToken} className="flex items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] disabled:opacity-50"><KeyRound className="h-4 w-4" /> {richPresenceState.token?.exists ? 'Rotate' : 'Create Key'}</button>{richPresenceState.token?.exists && <button type="button" disabled={presenceBusy === 'token'} onClick={handleRevokePresenceToken} className="flex items-center gap-2 rounded-md bg-[#DA373C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#b92d32] disabled:opacity-50"><Trash2 className="h-4 w-4" /> Revoke</button>}</div>
        </div>
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-[#111214] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#949BA4]">HTTP endpoint</p>
          <pre className="custom-scrollbar overflow-x-auto whitespace-pre-wrap break-all text-xs leading-5 text-[#b5bac1]">{`PUT ${API_URL}/rich-presence\nAuthorization: Presence YOUR_INTEGRATION_KEY\nContent-Type: application/json`}</pre>
        </div>
      </SettingsSection>

      <SettingsSection icon={Play} title="Test on Profile" description="Preview the layout without an SDK. The test activity expires after 15 minutes.">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">App or game</span><input value={testPresence.name} onChange={event => setTestPresence(current => ({ ...current, name: event.target.value.slice(0, 80) }))} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <SelectField label="Activity type" value={testPresence.type} onChange={event => setTestPresence(current => ({ ...current, type: event.target.value }))}><option value="playing">Playing</option><option value="listening">Listening</option><option value="watching">Watching</option><option value="working">Working</option><option value="competing">Competing</option><option value="custom">Custom</option></SelectField>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Details</span><input value={testPresence.details} onChange={event => setTestPresence(current => ({ ...current, details: event.target.value.slice(0, 160) }))} placeholder="Chapter, track, or work details" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <label className="block"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">State</span><input value={testPresence.state} onChange={event => setTestPresence(current => ({ ...current, state: event.target.value.slice(0, 160) }))} placeholder="Score, artist, or party information" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
          <label className="block lg:col-span-2"><span className="mb-2 block text-xs font-bold uppercase text-[#B5BAC1]">Image URL (optional)</span><input value={testPresence.imageUrl} onChange={event => setTestPresence(current => ({ ...current, imageUrl: event.target.value.slice(0, 2048) }))} placeholder="https://example.com/game-cover.png" className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={handleClearTestPresence} disabled={presenceBusy === 'test'} className="rounded-md bg-[#4E5058] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78] disabled:opacity-50">Remove Test</button><button type="button" onClick={handlePublishTestPresence} disabled={presenceBusy === 'test' || richPresenceState.enabled === false} className="flex items-center gap-2 rounded-md bg-[#23A559] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D8046] disabled:opacity-50"><Play className="h-4 w-4" /> Publish on Profile</button></div>
      </SettingsSection>

      {richPresenceState.activities?.length > 0 && <SettingsSection icon={Activity} title="Currently Published" description="Changes appear immediately for friends and users in shared servers."><div className="space-y-3">{richPresenceState.activities.map(activity => <RichPresenceCard key={activity.sessionId || activity.id} activity={activity} />)}</div></SettingsSection>}
    </div>
  );

  const renderPrivacy = () => (
    <SettingsSection icon={UserX} title="Blocked Users" description="Blocked people cannot send you direct messages or interact with you.">
      <div className="space-y-2">
        {blockedUsers.length === 0 ? <div className="rounded-lg border border-dashed border-white/[0.08] bg-[#1E1F22] p-6 text-center"><Shield className="mx-auto h-8 w-8 text-[#5865F2]" /><p className="mt-3 text-sm font-semibold text-[#DBDEE1]">You have not blocked anyone</p><p className="mt-1 text-xs text-[#949BA4]">Blocked accounts appear here.</p></div> : blockedUsers.map(entry => {
          const blocked = entry.user || entry;
          const targetId = blocked.id || entry.userId;
          return <div key={targetId} className="flex items-center gap-3 rounded-lg bg-[#1E1F22] px-4 py-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#5865F2] text-sm font-bold text-white">{(blocked.username || '?')[0].toUpperCase()}</div><span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#DBDEE1]">{blocked.username || 'User'}</span><button type="button" onClick={() => handleUnblock(targetId)} className="rounded-md bg-[#4E5058] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6D6F78]">Unblock</button></div>;
        })}
      </div>
    </SettingsSection>
  );

  const isolationOptions = [
    { value: 'off', label: 'Off', description: 'Raw microphone audio with the lowest processing load.' },
    { value: 'standard', label: 'Standard', description: 'Reduces steady background noise while preserving speech.' },
    { value: 'strong', label: 'RNNoise (Strong)', description: 'The AI model removes keyboard, fan, and room noise locally in real time.' },
  ];
  const processingLabels = { idle: 'Ready', starting: voiceIsolationMode === 'strong' ? 'Preparing RNNoise…' : 'Starting…', active: 'Active', fallback: 'Safe fallback mode', error: 'Processing error' };
  const processingEngineLabels = { none: 'Off', rnnoise: 'RNNoise / WebAssembly', 'web-audio': 'Web Audio + browser', 'browser-fallback': 'Browser noise reduction' };

  const renderVoice = () => (
    <div className="space-y-5">
      <SettingsSection icon={Mic} title="Audio Devices" description="These settings are available outside a voice channel and apply immediately during an active call.">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#1E1F22] px-4 py-3">
          <p className="min-w-0 flex-1 text-xs leading-5 text-[#949BA4]">If actual microphone and speaker names are hidden, grant device permission and scan again.</p>
          <button type="button" disabled={deviceRefreshBusy} onClick={async () => {
            if (typeof refreshAvailableDevices !== 'function') return;
            setDeviceRefreshBusy(true);
            try {
              const result = await refreshAvailableDevices({ requestPermission: true });
              if (result?.success) toast.success('Audio devices refreshed.');
              else toast.error(result?.error || 'Audio devices could not be read.');
            } finally {
              setDeviceRefreshBusy(false);
            }
          }} className="flex shrink-0 items-center gap-2 rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold text-white hover:bg-[#4752C4] disabled:cursor-wait disabled:opacity-60">
            <RefreshCw className={'h-4 w-4 ' + (deviceRefreshBusy ? 'animate-spin' : '')} />
            {deviceRefreshBusy ? 'Scanning…' : 'Scan devices and grant permission'}
          </button>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <SelectField icon={Mic} label="Input device" value={inputDeviceId} onChange={event => { if (typeof changeInputDevice === 'function') void changeInputDevice(event.target.value); }}><option value="">System default</option>{availableDevices.audioinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone ' + (index + 1)}</option>)}</SelectField>
          <SelectField icon={Volume2} label="Output device" value={outputDeviceId} onChange={event => { if (typeof setOutputDeviceId === 'function') setOutputDeviceId(event.target.value); }}><option value="">System default</option>{availableDevices.audiooutput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker ' + (index + 1)}</option>)}</SelectField>
          <SelectField icon={Video} label="Camera" value={cameraDeviceId} onChange={event => { if (typeof changeCameraDevice === 'function') void changeCameraDevice(event.target.value); }}><option value="">System default</option>{availableDevices.videoinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera ' + (index + 1)}</option>)}</SelectField>
          <SelectField label="Input mode" value={voiceMode} onChange={event => { if (typeof setVoiceMode === 'function') setVoiceMode(event.target.value); }}><option value="activity">Voice activity</option><option value="push-to-talk">Push to talk</option></SelectField>
          {voiceMode === 'push-to-talk' && <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#B5BAC1]">Push-to-talk key</span><input readOnly value={pushToTalkKey} onKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (typeof setPushToTalkKey === 'function') setPushToTalkKey(event.code); }} className="w-full rounded-md border border-transparent bg-[#1E1F22] px-3 py-2.5 text-center text-sm font-bold text-[#DBDEE1] outline-none focus:border-[#00A8FC]" title="Select the field and press the key you want" /><span className="mt-1.5 block text-xs text-[#949BA4]">Select the field and press the key you want to use.</span></label>}
          <SelectField label="Audio quality" value={audioQuality} onChange={handleAudioQualityChange} disabled={voiceSettingBusy === 'quality'} help="High quality may use more bandwidth and processing power."><option value="standard">Standard</option><option value="high">High</option><option value="studio">Studio</option></SelectField>
        </div>
      </SettingsSection>

      <SettingsSection icon={Shield} title="Voice Isolation" description="Removes background noise from your microphone. RNNoise runs entirely on your device; microphone audio is never sent to an external server for analysis.">
        <div className="grid gap-3 lg:grid-cols-3">
          {isolationOptions.map(option => {
            const selected = voiceIsolationMode === option.value;
            const unavailable = option.value === 'strong' && !rnnoiseSupported;
            return <button key={option.value} type="button" disabled={voiceSettingBusy === 'isolation' || unavailable} onClick={() => handleVoiceIsolationChange(option.value)} className={'relative rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ' + (selected ? 'border-[#5865F2] bg-[#5865F2]/15' : 'border-white/[0.07] bg-[#1E1F22] hover:border-white/[0.16]')}><span className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-[#F2F3F5]">{option.label}</span>{selected && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#5865F2] text-white"><Check className="h-3.5 w-3.5" /></span>}</span><span className="mt-2 block text-xs leading-5 text-[#949BA4]">{unavailable ? 'This browser does not support advanced audio processing.' : option.description}</span></button>;
          })}
        </div>
        <div className={'mt-4 rounded-lg border px-4 py-3 text-xs leading-5 ' + (voiceProcessingStatus === 'error' ? 'border-[#DA373C]/30 bg-[#DA373C]/10 text-[#fca5a5]' : 'border-[#23A559]/25 bg-[#23A559]/10 text-[#b8e7c9]')}>
          <span className="font-bold">Processing status: {processingLabels[voiceProcessingStatus] || voiceProcessingStatus}</span><span className="ml-2">Active mode: {effectiveVoiceIsolationMode === 'strong' ? 'RNNoise (Strong)' : effectiveVoiceIsolationMode === 'standard' ? 'Standard' : 'Off'}.</span><span className="ml-2">Engine: {processingEngineLabels[voiceProcessingEngine] || voiceProcessingEngine}.</span>{!rnnoiseSupported && <span className="ml-2">RNNoise is unavailable because this device does not support AudioWorklet/WebAssembly.</span>}{!audioProcessingSupported && <span className="ml-2">Advanced audio processing is unavailable.</span>}
        </div>
        <div className="mt-4"><ToggleRow checked={noiseSuppression} onChange={value => { if (typeof setNoiseSuppression === 'function') void setNoiseSuppression(value); }} label="Enable noise reduction" description="Turning this off also disables isolation; Standard mode is used when enabled again." /></div>
      </SettingsSection>

      <SettingsSection icon={MonitorUp} title="Stream Quality" description="Choose the default resolution and frame rate for screen sharing.">
        <SelectField label="Default stream preset" value={screenSharePreset} onChange={event => { if (typeof setScreenSharePreset === 'function') setScreenSharePreset(event.target.value); }} help="4K requires a 4K source display and a strong connection; WebRTC lowers quality automatically when needed."><option value="720p30">720p / 30 FPS — balanced</option><option value="1080p30">1080p / 30 FPS — high quality</option><option value="1080p60">1080p / 60 FPS — smooth</option><option value="2160p30">4K / 30 FPS — ultra sharp</option></SelectField>
      </SettingsSection>
    </div>
  );

  const renderNotifications = () => (
    <SettingsSection icon={Bell} title="Notification Preferences" description="Choose which events produce desktop and sound alerts.">
      <div className="space-y-3">
        <ToggleRow checked={Boolean(notificationPrefs.desktop)} onChange={value => setNotificationPrefs(current => ({ ...current, desktop: value }))} label="Desktop notifications" description="Show a system notification while the app is in the background." />
        <ToggleRow checked={Boolean(notificationPrefs.sound)} onChange={value => setNotificationPrefs(current => ({ ...current, sound: value }))} label="Notification sounds" description="Play a sound for new notifications." />
        <ToggleRow checked={Boolean(notificationPrefs.directMessages)} onChange={value => setNotificationPrefs(current => ({ ...current, directMessages: value }))} label="Direct messages" description="Receive notifications for new DMs." />
        <ToggleRow checked={Boolean(notificationPrefs.mentions)} onChange={value => setNotificationPrefs(current => ({ ...current, mentions: value }))} label="Mention notifications" description="Notify you when someone mentions you." />
        <ToggleRow checked={Boolean(notificationPrefs.suppressEveryone)} onChange={value => setNotificationPrefs(current => ({ ...current, suppressEveryone: value }))} label="Suppress @everyone and @here mentions" description="Do not treat mass mentions as personal notifications." />
        <ToggleRow checked={Boolean(notificationPrefs.suppressRoles)} onChange={value => setNotificationPrefs(current => ({ ...current, suppressRoles: value }))} label="Suppress role mentions" description="Mute notifications for mentions sent to your role." />
        <SelectField label="Default server notifications" value={notificationPrefs.serverMode} onChange={event => setNotificationPrefs(current => ({ ...current, serverMode: event.target.value }))}><option value="all">All messages</option><option value="mentions">Mentions only</option><option value="nothing">Nothing</option></SelectField>
        <div className="flex justify-end pt-2"><button type="button" onClick={() => saveNotificationPreferences(notificationPrefs).then(payload => { setNotificationPrefs(current => ({ ...current, ...(payload.preferences || payload) })); toast.success('Notification settings saved.'); }).catch(error => toast.error(error.message))} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4]">Save Notifications</button></div>
      </div>
    </SettingsSection>
  );

  const renderAppearance = () => (
    <SettingsSection icon={Palette} title="App Themes" description="All ten color themes are free; your choice is saved to your account and applied immediately.">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {APP_THEME_OPTIONS.map(({ value, label, surface, background }) => <button key={value} type="button" onClick={() => { setTheme(value); document.documentElement.dataset.theme = value; }} className={'rounded-xl border p-3 text-left transition ' + (theme === value ? 'border-[#5865F2] bg-[#5865F2]/10' : 'border-white/[0.07] bg-[#1E1F22] hover:border-white/[0.16]')}><span className="mb-3 flex h-16 overflow-hidden rounded-lg border border-black/10" style={{ backgroundColor: background }}><span className="m-2 w-1/3 rounded" style={{ backgroundColor: surface }} /><span className="my-2 mr-2 flex-1 rounded" style={{ backgroundColor: surface }} /></span><span className="flex items-center justify-between text-sm font-bold text-[#DBDEE1]">{label}{theme === value && <Check className="h-4 w-4 text-[#5865F2]" />}</span></button>)}
      </div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={() => handleSaveInterface('Appearance settings saved.')} disabled={isInterfaceSaving} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:opacity-50">{isInterfaceSaving ? 'Saving…' : 'Save Theme'}</button></div>
    </SettingsSection>
  );

  const renderAccessibility = () => (
    <div className="space-y-5">
      <SettingsSection icon={Settings} title="Readability" description="These preferences are stored on your device and apply across the app immediately.">
        <label className="block rounded-lg border border-white/[0.05] bg-[#1E1F22] p-4"><span className="flex items-center justify-between gap-4 text-sm font-semibold text-[#DBDEE1]"><span>Text scale</span><span className="rounded bg-[#5865F2]/15 px-2 py-1 text-xs text-[#aab4ff]">%{accessibilityPrefs.fontScale}</span></span><input type="range" min="85" max="125" step="5" value={accessibilityPrefs.fontScale} onChange={event => updateAccessibility('fontScale', Number(event.target.value))} className="mt-4 w-full accent-[#5865F2]" /><span className="mt-2 flex justify-between text-[11px] text-[#72767D]"><span>Small</span><span>Default</span><span>Large</span></span></label>
        <div className="mt-3 space-y-3"><ToggleRow checked={accessibilityPrefs.highContrast} onChange={value => updateAccessibility('highContrast', value)} label="High contrast" description="Strengthen focus indicators and core interface contrast." /><ToggleRow checked={accessibilityPrefs.underlineLinks} onChange={value => updateAccessibility('underlineLinks', value)} label="Underline links" description="Distinguish links with an underline as well as color." /></div>
      </SettingsSection>
      <SettingsSection title="Motion" description="Control how animations and transitions behave."><ToggleRow checked={accessibilityPrefs.reducedMotion} onChange={value => updateAccessibility('reducedMotion', value)} label="Reduced motion" description="Minimize animations and smooth transitions." /><div className="mt-4 flex justify-end"><button type="button" onClick={resetAccessibility} className="flex items-center gap-2 rounded-md bg-[#4E5058] px-3 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78]"><RotateCcw className="h-4 w-4" /> Restore Defaults</button></div></SettingsSection>
    </div>
  );

  const renderLanguage = () => (
    <SettingsSection icon={Globe2} title="App Language" description="Your language preference is saved to your account and applied to page language metadata.">
      <SelectField icon={Globe2} label="Language" value={locale} onChange={event => setLocale(event.target.value)}><option value="en">English</option></SelectField>
      <div className="mt-5 rounded-lg border border-white/[0.05] bg-[#1E1F22] p-4 text-sm leading-6 text-[#949BA4]">Community and user-written content is not translated. This choice controls interface language and accessibility metadata.</div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={() => handleSaveInterface('Language preference saved.')} disabled={isInterfaceSaving} className="rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752C4] disabled:opacity-50">{isInterfaceSaving ? 'Saving…' : 'Save Language'}</button></div>
    </SettingsSection>
  );

  const renderUpdates = () => {
    const statusLabels = {
      disabled: 'Unavailable',
      idle: 'Ready',
      checking: 'Denetleniyor',
      available: 'New version available',
      downloading: 'Downloading',
      downloaded: 'Ready to install',
      installing: 'Uploadniyor',
      'up-to-date': 'Up to date',
      error: 'Connection error',
    };
    const lastChecked = desktopUpdateState.lastCheckedAt
      ? new Date(desktopUpdateState.lastCheckedAt).toLocaleString('en-US')
      : 'Not checked yet';
    const busy = desktopUpdateBusy || ['checking', 'available', 'downloading', 'installing'].includes(desktopUpdateState.status);

    return (
      <div className="space-y-5">
        <SettingsSection icon={Download} title="Desktop Updates" description="New versions are downloaded over an encrypted connection and package integrity is checked before installation.">
          {!desktopUpdateState.supported ? (
            <div className="rounded-lg border border-[#F0B232]/25 bg-[#F0B232]/10 p-4 text-sm leading-6 text-[#f8d58b]">
              This screen works only in the installed Windows app. The browser app refreshes automatically when the server is updated.
            </div>
          ) : (
            <div className="space-y-4">
              <ToggleRow disabled={desktopUpdateBusy} checked={desktopUpdateState.automaticChecks !== false} onChange={handleAutomaticUpdateChange} label="Automatically check for and download updates" description="Checks after launch and every 30 minutes. A downloaded version installs automatically after the app closes." />

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
                    <div className="mb-1 flex justify-between text-[11px] text-[#949BA4]"><span>Download</span><span>%{Math.round(desktopUpdateState.progress)}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#111214]"><div className="h-full rounded-full bg-[#5865F2] transition-all" style={{ width: `${Math.max(0, Math.min(100, desktopUpdateState.progress))}%` }} /></div>
                  </div>
                )}

                <div className="mt-4 grid gap-2 text-xs text-[#949BA4] sm:grid-cols-2">
                  <span>Son denetim: <strong className="text-[#DBDEE1]">{lastChecked}</strong></span>
                  <span>Available version: <strong className="text-[#DBDEE1]">{desktopUpdateState.availableVersion ? `v${desktopUpdateState.availableVersion}` : '—'}</strong></span>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={handleDesktopUpdateCheck} disabled={busy} className="flex items-center gap-2 rounded-md bg-[#4E5058] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D6F78] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={'h-4 w-4 ' + (desktopUpdateState.status === 'checking' ? 'animate-spin' : '')} /> Check for Updates</button>
                {desktopUpdateState.status === 'downloaded' && <button type="button" onClick={installDesktopUpdate} className="flex items-center gap-2 rounded-md bg-[#23A559] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a8f4b]"><Download className="h-4 w-4" /> Restart and Install</button>}
              </div>
            </div>
          )}
        </SettingsSection>
        <SettingsSection title="Update Behavior" description="Explains how the web and desktop apps are updated.">
          <ul className="space-y-2 text-sm leading-6 text-[#B5BAC1]">
            <li>• The web app updates on the next launch after a new server version is deployed.</li>
            <li>• The desktop app downloads new packages in the background and installs them when it closes.</li>
            <li>• The app never closes itself during a voice call; you choose when to restart.</li>
          </ul>
        </SettingsSection>
      </div>
    );
  };

  const handlePlatformBan = async target => {
    const reason = window.prompt(`${target.username} Enter the ban reason for`, 'Community Guidelines violation');
    if (reason === null) return;
    if (reason.trim().length < 3) return toast.error('The ban reason must be at least three characters.');
    if (!window.confirm(`${target.username} Ban this user from tahosapp? Their active sessions will end immediately.`)) return;

    setAdminBusy(target.id);
    try {
      await authenticatedRequest(`/admin/users/${encodeURIComponent(target.id)}/ban`, {
        method: 'PUT',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await loadAdminOverview(adminQuery);
      toast.success(`${target.username} was banned from tahosapp.`);
    } catch (error) {
      toast.error(error.message || 'The user could not be banned.');
    } finally {
      setAdminBusy('');
    }
  };

  const handlePlatformUnban = async target => {
    if (!window.confirm(`${target.username} Remove this user’s platform ban?`)) return;
    setAdminBusy(target.id);
    try {
      await authenticatedRequest(`/admin/users/${encodeURIComponent(target.id)}/ban`, { method: 'DELETE' });
      await loadAdminOverview(adminQuery);
      toast.success(`${target.username} user was unbanned.`);
    } catch (error) {
      toast.error(error.message || 'The ban could not be removed.');
    } finally {
      setAdminBusy('');
    }
  };

  const renderAdmin = () => (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsSection icon={User} title="Total registered users" description="All tahosapp accounts that have not been deleted">
          <p className="text-4xl font-black text-white">{adminOverview?.totalUsers ?? '—'}</p>
        </SettingsSection>
        <SettingsSection icon={UserX} title="Banned users" description="Accounts blocked from signing in to the platform">
          <p className="text-4xl font-black text-[#F23F42]">{adminOverview?.bannedUsers ?? '—'}</p>
        </SettingsSection>
      </div>

      <SettingsSection icon={Shield} title="Platform user management" description="Banned accounts immediately lose API, messaging, call, and voice access. This action can be reversed.">
        <form className="mb-4 flex gap-2" onSubmit={event => { event.preventDefault(); loadAdminOverview(adminQuery); }}>
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949BA4]" />
            <input value={adminQuery} onChange={event => setAdminQuery(event.target.value)} placeholder="Search by username, email, or user ID" maxLength={100} className="w-full rounded-md border border-transparent bg-[#1E1F22] py-2.5 pl-10 pr-3 text-sm text-[#DBDEE1] outline-none focus:border-[#00A8FC]" />
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
                  <div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-[#F2F3F5]">{target.username}</strong>{target.isPlatformAdmin && <span className="rounded bg-[#5865F2]/20 px-2 py-0.5 text-[10px] font-bold text-[#aab4ff]">ADMIN</span>}{target.banned && <span className="rounded bg-[#F23F42]/20 px-2 py-0.5 text-[10px] font-bold text-[#ff9a9c]">BANNED</span>}</div>
                  <p className="truncate text-xs text-[#949BA4]">{target.email} · {target.status === 'offline' ? 'Offline' : 'Online'}</p>
                  {target.ban?.reason && <p className="mt-1 text-xs text-[#ff9a9c]">Reason: {target.ban.reason}</p>}
                </div>
                {!target.isPlatformAdmin && (target.banned
                  ? <button type="button" disabled={adminBusy === target.id} onClick={() => handlePlatformUnban(target)} className="rounded-md bg-[#4E5058] px-3 py-2 text-xs font-bold text-white hover:bg-[#6D6F78] disabled:opacity-50">Remove ban</button>
                  : <button type="button" disabled={adminBusy === target.id} onClick={() => handlePlatformBan(target)} className="rounded-md bg-[#DA373C] px-3 py-2 text-xs font-bold text-white hover:bg-[#A1282C] disabled:opacity-50">Banla</button>)}
              </div>
            );
          })}
          {adminOverview && !adminOverview.users?.length && <p className="rounded-lg bg-[#1E1F22] p-5 text-center text-sm text-[#949BA4]">No users match your search.</p>}
          {!adminOverview && <p className="rounded-lg bg-[#1E1F22] p-5 text-center text-sm text-[#949BA4]">Loading user information…</p>}
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
            <div className="mb-6 px-2"><p className="text-lg font-extrabold text-[#F2F3F5]">Settings</p><p className="mt-1 truncate text-xs text-[#949BA4]">{user.username}</p></div>
            {settingGroups.map((group, groupIndex) => <div key={group.label} className={groupIndex ? 'mt-6' : ''}><p className="mb-2 px-2 text-[11px] font-bold tracking-wide text-[#949BA4]">{group.label}</p><div className="space-y-0.5">{group.items.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setActiveTab(item.id)} className={'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium transition ' + (activeTab === item.id ? 'bg-[#404249] text-white' : 'text-[#B5BAC1] hover:bg-[#35373C] hover:text-[#DBDEE1]')}><Icon className="h-[18px] w-[18px] shrink-0" /><span className="truncate">{item.label}</span></button>; })}</div></div>)}
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#313338]">
          <div className="flex h-full min-h-0">
            <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto">
              <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#313338]/95 px-5 py-4 backdrop-blur md:px-10">
                <div className="mx-auto flex max-w-4xl items-center justify-between gap-4"><div className="min-w-0"><h1 className="truncate text-xl font-bold text-[#F2F3F5]">{activeDefinition.label}</h1><p className="mt-0.5 hidden text-xs text-[#949BA4] sm:block">{activeDefinition.description}</p></div><button type="button" onClick={onClose} aria-label="Close settings" title="Close (Esc)" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#72767D] text-[#B5BAC1] transition hover:border-[#DBDEE1] hover:text-white"><X className="h-5 w-5" /></button></div>
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
