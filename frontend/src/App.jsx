import { useCallback, useEffect, useState } from 'react';
import { useRef } from 'react';
import { Menu, MessageSquare, Server, Users, X } from 'lucide-react';
import { SocketProvider, useSocket } from './context/SocketContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ServerProvider, useServer } from './context/ServerContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { DirectCallProvider } from './context/DirectCallContext';
import { DMProvider } from './context/DMContext';
import { FriendsProvider } from './context/FriendsContext';
import toast, { Toaster } from 'react-hot-toast';

import AuthScreen from './components/auth/AuthScreen';
import ServerList from './components/layout/ServerList';
import ChannelList from './components/layout/ChannelList';
import ChatArea from './components/layout/ChatArea';
import MemberList from './components/layout/MemberList';
import VoicePanel from './components/voice/VoicePanel';
import VoiceRoomView from './components/voice/VoiceRoomView';
import DMList from './components/dm/DMList';
import DMArea from './components/dm/DMArea';
import FriendsList from './components/friends/FriendsList';
import UserProfile from './components/profile/UserProfile';
import NotificationCenter from './components/notifications/NotificationCenter';
import ForumArea from './components/forum/ForumArea';
import OnboardingGate from './components/server/OnboardingGate';
import NsfwGate from './components/server/NsfwGate';
import DirectCallOverlay from './components/call/DirectCallOverlay';
import AutomaticRichPresence from './components/profile/AutomaticRichPresence';
import DesktopUpdateNotifier from './components/profile/DesktopUpdateNotifier';
import NativeMobileBridge from './components/mobile/NativeMobileBridge';
import { joinServer } from './services/api';
import { normalizeInviteCode } from './utils/inviteLinks';
import { useI18n } from './i18n/I18nContext';

function LocaleAccountSync() {
  const { user } = useAuth();
  const { setLocale } = useI18n();

  useEffect(() => {
    if (user?.localeExplicit && user.locale) setLocale(user.locale, { explicit: false });
  }, [setLocale, user?.locale, user?.localeExplicit]);

  return null;
}

function AppContent() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { currentServer, currentChannel, setCurrentServer, setCurrentChannel, setServers } = useServer();
  const { activeVoiceChannel, isInVoice, isVoiceViewOpen, setIsVoiceViewOpen, leaveVoiceChannel } = useVoice();
  const [viewMode, setViewMode] = useState('dms'); 
  const [mobilePanel, setMobilePanel] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const navigationRef = useRef(null);
  const membersRef = useRef(null);
  const handledInviteRef = useRef('');

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobilePanel(null);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isMobile || !mobilePanel) return undefined;
    const panel = mobilePanel === 'members' ? membersRef.current : navigationRef.current;
    const previousFocus = document.activeElement;
    panel?.querySelector('[data-panel-close]')?.focus();
    const close = event => {
      event.preventDefault();
      setMobilePanel(null);
    };
    const handleKey = event => {
      if (event.key === 'Escape') close(event);
      if (event.key !== 'Tab' || !panel?.contains(document.activeElement)) return;
      const focusable = [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
        .filter(element => !element.disabled && element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('tahosapp:back', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('tahosapp:back', close);
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isMobile, mobilePanel]);

  const closeVoiceViewForNavigation = useCallback(() => {
    setIsVoiceViewOpen(false);
    setMobilePanel(null);
  }, [setIsVoiceViewOpen]);

  const navigateToView = useCallback((nextViewMode) => {
    closeVoiceViewForNavigation();
    setViewMode(nextViewMode);
  }, [closeVoiceViewForNavigation]);

  // Choosing a server keeps its channel list visible; choosing a conversation
  // closes the drawer so the content receives the entire phone screen.
  const navigateFromServerList = useCallback((nextViewMode) => {
    setIsVoiceViewOpen(false);
    setViewMode(nextViewMode);
    setMobilePanel(nextViewMode === 'friends' ? null : 'navigation');
  }, [setIsVoiceViewOpen]);

  useEffect(() => {
    const openConversation = () => { setMobilePanel(null); };
    window.addEventListener('tahosapp:navigate-to-dm', openConversation);
    return () => window.removeEventListener('tahosapp:navigate-to-dm', openConversation);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const url = new URL(window.location.href);
    const inviteCode = normalizeInviteCode(url.searchParams.get('invite'));
    if (!inviteCode || handledInviteRef.current === inviteCode) return;
    handledInviteRef.current = inviteCode;

    joinServer(inviteCode, user.id)
      .then(server => {
        setServers(previous => previous.some(item => item.id === server.id)
          ? previous.map(item => item.id === server.id ? { ...item, ...server } : item)
          : [...previous, server]);
        setCurrentServer(server);
        setCurrentChannel(null);
        setViewMode('servers');
        url.searchParams.delete('invite');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        toast.success(`You joined ${server.name}.`);
      })
      .catch(error => {
        handledInviteRef.current = '';
        toast.error(error.message || 'The invite link could not be used.');
      });
  }, [setCurrentChannel, setCurrentServer, setServers, user?.id]);

  useEffect(() => {
    if (!socket) return undefined;

    const removeServerFromView = ({ serverId, reason }) => {
      setServers(previous => previous.filter(server => server.id !== serverId));
      if (currentServer?.id !== serverId) {
        if (reason) toast.error(reason);
        return;
      }

      if (activeVoiceChannel?.serverId === serverId) leaveVoiceChannel();
      setCurrentServer(null);
      setCurrentChannel(null);
      setViewMode('dms');
      if (reason) toast.error(reason);
    };

    const handleKicked = ({ serverId, reason }) => removeServerFromView({
      serverId,
      reason: reason ? `You were removed from the server: ${reason}` : 'A moderator removed you from the server.',
    });
    const handleBanned = ({ serverId, reason }) => removeServerFromView({
      serverId,
      reason: reason ? `You were banned from the server: ${reason}` : 'A moderator banned you from the server.',
    });
    const handleDeleted = ({ serverId }) => removeServerFromView({ serverId, reason: 'This server was deleted.' });
    const handleModerated = ({ serverId, action, byUsername }) => {
      if (currentServer?.id !== serverId) return;
      const labels = {
        timeout: 'timed you out',
        untimeout: 'removed your timeout',
        mute: 'muted your microphone',
        unmute: 'unmuted your microphone',
        deafen: 'deafened you',
        undeafen: 'undeafened you',
      };
      if (action === 'timeout' && activeVoiceChannel?.serverId === serverId) leaveVoiceChannel();
      toast(action === 'timeout' ? `A moderator ${labels[action] || 'took a moderation action'}.` : `${byUsername || 'A moderator'} ${labels[action] || 'took a moderation action'}.`);
    };
    const handleUpdated = ({ server }) => {
      if (!server?.id) return;
      setServers(previous => previous.map(item => item.id === server.id ? { ...item, ...server } : item));
      if (currentServer?.id === server.id) setCurrentServer(previous => ({ ...previous, ...server }));
    };

    socket.on('server:kicked', handleKicked);
    socket.on('server:banned', handleBanned);
    socket.on('server:deleted', handleDeleted);
    socket.on('server:updated', handleUpdated);
    socket.on('server:moderated', handleModerated);
    return () => {
      socket.off('server:kicked', handleKicked);
      socket.off('server:banned', handleBanned);
      socket.off('server:deleted', handleDeleted);
      socket.off('server:updated', handleUpdated);
      socket.off('server:moderated', handleModerated);
    };
  }, [socket, currentServer?.id, activeVoiceChannel?.serverId, leaveVoiceChannel, setCurrentChannel, setCurrentServer, setServers]);

  if (!user) return <AuthScreen />;

  return (
    <div className="app-shell flex w-full overflow-hidden bg-[#0f172a] text-[#e2e8f0] font-sans selection:bg-[#2563eb] selection:text-white">
      <NotificationCenter visible={viewMode !== 'friends' && !(isInVoice && isVoiceViewOpen)} />
      <OnboardingGate />
      
      <header className="mobile-header" aria-hidden={isMobile && Boolean(mobilePanel) ? true : undefined}>
        <button type="button" className="mobile-icon-button" onClick={() => setMobilePanel('navigation')} aria-label={t('mobile.openNavigation')} aria-controls="app-navigation" aria-expanded={mobilePanel === 'navigation'}><Menu className="h-5 w-5" /></button>
        <span className="min-w-0 flex-1 truncate text-sm font-bold" data-i18n-ignore>{viewMode === 'servers' ? currentServer?.name || 'tahosapp' : 'tahosapp'}</span>
        {viewMode === 'servers' && currentChannel && !isVoiceViewOpen && <button type="button" className="mobile-icon-button" onClick={() => setMobilePanel('members')} aria-label={t('mobile.members')} aria-controls="app-members" aria-expanded={mobilePanel === 'members'}><Users className="h-5 w-5" /></button>}
      </header>

      {mobilePanel && <button type="button" className="mobile-backdrop" onClick={() => setMobilePanel(null)} aria-label={t('common.close')} tabIndex={-1} />}

      <div id="app-navigation" ref={navigationRef} className={`app-navigation ${mobilePanel === 'navigation' ? 'is-open' : ''}`} role={isMobile && mobilePanel === 'navigation' ? 'dialog' : undefined} aria-modal={isMobile && mobilePanel === 'navigation' ? true : undefined} aria-label={t('mobile.navigation')}>
        <div className="mobile-panel-heading"><span>{t('mobile.navigation')}</span><button data-panel-close type="button" className="mobile-icon-button" onClick={() => setMobilePanel(null)} aria-label={t('common.close')}><X className="h-5 w-5" /></button></div>
        <div className="flex min-h-0 flex-1">
      <ServerList viewMode={viewMode} setViewMode={navigateFromServerList} onExternalNavigate={navigateToView} />

      <div className="app-channel-sidebar flex flex-col w-[256px] bg-[#151b27] flex-shrink-0 overflow-hidden border-r border-white/[0.06]">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {viewMode === 'servers' ? (
            currentServer ? <ChannelList onNavigate={closeVoiceViewForNavigation} /> : <p className="p-5 text-sm text-[#94a3b8]">{t('mobile.chooseServer')}</p>
          ) : (
            <DMList setViewMode={navigateToView} />
          )}
        </div>
        <UserProfile />
      </div>
        </div>
      </div>

      <main className="app-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#111827]" aria-hidden={isMobile && Boolean(mobilePanel) ? true : undefined}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isInVoice && isVoiceViewOpen ? (
            <VoiceRoomView />
          ) : viewMode === 'servers' ? (
            currentChannel ? (
              <NsfwGate channel={currentChannel}>{currentChannel.type === 'forum' ? <ForumArea /> : <ChatArea />}</NsfwGate>
            ) : (
              <div className="flex flex-1 select-none flex-col items-center justify-center px-6 text-center text-[#949BA4]">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#2B2D31] shadow-inner">
                  <span className="text-4xl font-bold text-[#404249]">#</span>
                </div>
                <h3 className="mb-2 text-xl font-bold text-[#F2F3F5]">{t('mobile.noChannel')}</h3>
                <p className="text-[15px]">{t('mobile.chooseChannel')}</p>
                <button type="button" onClick={() => setMobilePanel('navigation')} className="mt-5 rounded-xl bg-[#2563eb] px-5 py-3 text-sm font-semibold text-white md:hidden">{t('mobile.browseChannels')}</button>
              </div>
            )
          ) : viewMode === 'friends' ? (
            <FriendsList />
          ) : (
            <DMArea onBrowseConversations={() => setMobilePanel('navigation')} />
          )}
        </div>

        {/* Voice paneli görünümden bağımsız olarak orta sütunda kalır. Böylece
            kullanıcı DM veya Friendlar ekranına geçse de aramayı yönetebilir. */}
        <VoicePanel />
      </main>

      {!isVoiceViewOpen && viewMode === 'servers' && currentChannel && (
        <div id="app-members" ref={membersRef} className={`app-members flex flex-col w-[256px] bg-[#151b27] flex-shrink-0 border-l border-white/[0.06] ${mobilePanel === 'members' ? 'is-open' : ''}`} role={isMobile && mobilePanel === 'members' ? 'dialog' : undefined} aria-modal={isMobile && mobilePanel === 'members' ? true : undefined} aria-label={t('mobile.members')}>
          <div className="mobile-panel-heading"><span>{t('mobile.members')}</span><button data-panel-close type="button" className="mobile-icon-button" onClick={() => setMobilePanel(null)} aria-label={t('common.close')}><X className="h-5 w-5" /></button></div>
          <MemberList />
        </div>
      )}

      <nav className="mobile-tabs" aria-label={t('mobile.navigation')} aria-hidden={isMobile && Boolean(mobilePanel) ? true : undefined}>
        <button type="button" className={viewMode === 'servers' ? 'is-active' : ''} aria-current={viewMode === 'servers' ? 'page' : undefined} onClick={() => { setViewMode('servers'); setIsVoiceViewOpen(false); setMobilePanel('navigation'); }}><Server className="h-5 w-5" /><span>{t('mobile.servers')}</span></button>
        <button type="button" className={viewMode === 'dms' ? 'is-active' : ''} aria-current={viewMode === 'dms' ? 'page' : undefined} onClick={() => { setViewMode('dms'); setIsVoiceViewOpen(false); setMobilePanel('navigation'); }}><MessageSquare className="h-5 w-5" /><span>{t('mobile.messages')}</span></button>
        <button type="button" className={viewMode === 'friends' ? 'is-active' : ''} aria-current={viewMode === 'friends' ? 'page' : undefined} onClick={() => navigateToView('friends')}><Users className="h-5 w-5" /><span>{t('mobile.friends')}</span></button>
      </nav>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <LocaleAccountSync />
      <SocketProvider>
        <FriendsProvider>
          <DMProvider>
            <ServerProvider>
              <VoiceProvider>
                <DirectCallProvider>
                  <NativeMobileBridge />
                  <AutomaticRichPresence />
                  <DesktopUpdateNotifier />
                  <AppContent />
                  <DirectCallOverlay />
                  <Toaster position="bottom-right" toastOptions={{ style: { background: '#111214', color: '#DBDEE1', borderRadius: '8px', fontSize: '14px', fontWeight: '500' } }} />
                </DirectCallProvider>
              </VoiceProvider>
            </ServerProvider>
          </DMProvider>
        </FriendsProvider>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
