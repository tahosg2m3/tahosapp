import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { Mic, Headphones, PhoneOff, Settings, LogOut, User } from 'lucide-react';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';
import UserSettingsModal from './UserSettingsModal'; // YENİ MODALI İÇE AKTARDIK
import { useVoice } from '../../context/VoiceContext';
import { getRichPresenceSettings } from '../../services/api';

function activityLabel(type) {
  return ({ listening: 'Dinliyor', watching: 'İzliyor', working: 'Çalışıyor', competing: 'Yarışıyor', custom: 'Etkin' })[type] || 'Oynuyor';
}


function activityText(activity) {
  if (activity?.playbackStatus === 'paused') return `Duraklatıldı: ${activity.name}`;
  return `${activityLabel(activity?.type)}: ${activity?.name}`;
}

export default function UserProfile() {
  const { user, logout, updateUserData } = useAuth();
  const { socket, isPresenceReady } = useSocket();
  const {
    isInVoice,
    isMuted,
    isDeafened,
    voiceChannelMembers,
    toggleMute,
    toggleDeafen,
    leaveVoiceChannel,
  } = useVoice();
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false); // AYARLAR MODAL STATE'İ
  const [settingsInitialTab, setSettingsInitialTab] = useState('account');
  const [richPresenceActivities, setRichPresenceActivities] = useState([]);

  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        (menuRef.current && menuRef.current.contains(event.target)) ||
        (buttonRef.current && buttonRef.current.contains(event.target))
      ) {
        return;
      }
      setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    getRichPresenceSettings()
      .then(payload => { if (active) setRichPresenceActivities(payload.activities || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!socket || !user?.id) return undefined;
    const handleRichPresence = payload => {
      if (String(payload?.userId || '') === String(user.id)) setRichPresenceActivities(payload.activities || []);
    };
    socket.on('rich-presence:update', handleRichPresence);
    return () => socket.off('rich-presence:update', handleRichPresence);
  }, [socket, user?.id]);

  if (!user) return null;

  const avatarColor = getColorForString(user.username || 'U');
  const initial = user.username ? user.username[0].toUpperCase() : '?';
  const avatarUrl = resolveSafeAvatarUrl(user.avatar);
  const presence = user.presenceStatus || user.status || (isPresenceReady ? 'online' : 'offline');
  const presenceLabels = { online: 'Çevrimiçi', idle: 'Boşta', dnd: 'Rahatsız etmeyin', invisible: 'Görünmez', offline: 'Çevrimdışı' };
  const presenceColor = presence === 'online' ? 'bg-[#34d399]' : presence === 'idle' ? 'bg-[#f59e0b]' : presence === 'dnd' ? 'bg-[#ef4444]' : 'bg-[#64748b]';
  const isListedInVoice = Object.values(voiceChannelMembers || {}).some(channelMembers => (
    Array.isArray(channelMembers) && channelMembers.some(member => (
      String(member?.userId || member?.id || '') === String(user.id)
    ))
  ));
  const hasVoiceConnection = isInVoice || isListedInVoice;
  const primaryActivity = richPresenceActivities[0];

  const changePresence = (nextStatus) => {
    updateUserData({ presenceStatus: nextStatus });
    socket?.emit('status:change', { status: nextStatus, customStatus: user.customStatus || '' });
  };

  return (
    <>
      <div className="h-[64px] bg-[#111827] flex items-center px-3 shrink-0 justify-between relative z-50 border-t border-white/[0.06]">

        {/* SOL KISIM: Avatar */}
        <div
          ref={buttonRef}
          onClick={() => setShowMenu((prev) => !prev)}
          className="flex items-center space-x-2 p-1 hover:bg-[#313338] rounded-md cursor-pointer transition-colors max-w-[120px] select-none"
        >
          <div className="relative shrink-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[14px] font-semibold overflow-hidden"
              style={{ backgroundColor: avatarColor }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 border-[3px] border-[#111827] rounded-full ${presenceColor}`}></div>
          </div>

          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold text-[#F2F3F5] truncate block leading-tight">{user.username}</span>
            <span className="text-[12px] text-[#94a3b8] truncate block leading-tight">{primaryActivity ? activityText(primaryActivity) : user.customStatus || presenceLabels[presence] || 'Bağlanıyor…'}</span>
          </div>
        </div>

        {/* SAĞ KISIM: İkonlar */}
        <div className="flex items-center text-[#B5BAC1]">
          <button type="button" onClick={toggleMute} disabled={!isInVoice} title={isInVoice ? (isMuted ? 'Mikrofonu aç' : 'Mikrofonu kapat') : 'Bir ses kanalında değilsin'} className={`p-1.5 hover:bg-[#313338] rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isMuted ? 'text-[#ef4444]' : 'hover:text-[#DBDEE1]'}`}>
            {isMuted ? <Mic className="w-[18px] h-[18px] opacity-50" /> : <Mic className="w-[18px] h-[18px]" />}
          </button>
          <button type="button" onClick={toggleDeafen} disabled={!isInVoice} title={isInVoice ? (isDeafened ? 'Sesi aç' : 'Kendini sağırlaştır') : 'Bir ses kanalında değilsin'} className={`p-1.5 hover:bg-[#313338] rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isDeafened ? 'text-[#ef4444]' : 'hover:text-[#DBDEE1]'}`}>
            <Headphones className="w-[18px] h-[18px]" />
          </button>
          {hasVoiceConnection && (
            <button
              type="button"
              onClick={() => leaveVoiceChannel()}
              title="Ses kanalından ayrıl"
              aria-label="Ses kanalından ayrıl"
              className="rounded-md p-1.5 text-[#ef4444] transition-colors hover:bg-[#ef4444]/15 hover:text-[#f87171]"
            >
              <PhoneOff className="h-[18px] w-[18px]" />
            </button>
          )}
          {/* DİŞLİ ÇARK İKONU DA AYARLARI AÇAR */}
          <button
            type="button"
            onClick={() => { setSettingsInitialTab('account'); setShowSettings(true); }}
            title="Kullanıcı ayarları"
            aria-label="Kullanıcı ayarlarını aç"
            className="p-1.5 hover:bg-[#313338] hover:text-[#DBDEE1] rounded-md transition-colors"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* PORTAL: Menü */}
        {showMenu && createPortal(
          <div
            ref={menuRef}
            className="fixed bottom-[60px] left-[80px] w-[300px] bg-[#111214] rounded-lg shadow-2xl border border-[#1E1F22] overflow-hidden z-[9999] animate-in slide-in-from-bottom-2 duration-200 text-[#DBDEE1] font-sans"
          >
            <div className="p-4 border-b border-[#1E1F22] bg-[#2B2D31]">
              <div className="flex items-center space-x-3 mb-2">
                 <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg overflow-hidden" style={{ backgroundColor: avatarColor }}>
                   {avatarUrl ? (
                     <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                   ) : (
                     initial
                   )}
                 </div>
                 <div>
                   <div className="font-bold text-[#F2F3F5] text-[16px]">{user.username}</div>
                   <div className="text-[13px] text-[#949BA4]">{user.email || 'tahosapp kullanıcısı'}</div>
                 </div>
              </div>
            </div>

            <div className="p-2 space-y-0.5">
              <div className="mb-1 grid grid-cols-4 gap-1 px-1">
                {[['online', 'Çevrimiçi', 'bg-[#34d399]'], ['idle', 'Boşta', 'bg-[#f59e0b]'], ['dnd', 'Rahatsız etmeyin', 'bg-[#ef4444]'], ['invisible', 'Görünmez', 'bg-[#64748b]']].map(([status, label, color]) => (
                  <button key={status} type="button" onClick={() => changePresence(status)} title={label} className={`flex items-center justify-center rounded p-2 transition hover:bg-[#35373C] ${presence === status ? 'bg-[#35373C]' : ''}`}><span className={`h-3 w-3 rounded-full ${color}`} /></button>
                ))}
              </div>
              <button
                onClick={() => { setShowMenu(false); setSettingsInitialTab('profile'); setShowSettings(true); }}
                className="w-full flex items-center px-2 py-2 text-[14px] text-[#B5BAC1] hover:bg-[#5865F2] hover:text-white rounded transition-colors group"
              >
                <User className="w-[18px] h-[18px] mr-3" />
                Profili Düzenle
              </button>

              <div className="h-[1px] bg-[#1E1F22] my-1" />

              <button
                onClick={() => { if (window.confirm('Çıkış yapmak istediğine emin misin?')) logout(); }}
                className="w-full flex items-center px-2 py-2 text-[14px] text-[#DA373C] hover:bg-[#DA373C] hover:text-white rounded transition-colors group"
              >
                <LogOut className="w-[18px] h-[18px] mr-3" />
                Hesaptan Çıkış Yap
              </button>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* YENİ MODAL (State true olunca render edilir) */}
      {showSettings && <UserSettingsModal initialTab={settingsInitialTab} onClose={() => setShowSettings(false)} />}
    </>
  );
}
