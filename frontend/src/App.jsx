import { useCallback, useEffect, useState } from 'react';
import { useRef } from 'react';
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
import { joinServer } from './services/api';
import { normalizeInviteCode } from './utils/inviteLinks';

function AppContent() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { currentServer, currentChannel, setCurrentServer, setCurrentChannel, setServers } = useServer();
  const { activeVoiceChannel, isInVoice, isVoiceViewOpen, setIsVoiceViewOpen, leaveVoiceChannel } = useVoice();
  const [viewMode, setViewMode] = useState('dms'); 
  const handledInviteRef = useRef('');

  const closeVoiceViewForNavigation = useCallback(() => {
    setIsVoiceViewOpen(false);
  }, [setIsVoiceViewOpen]);

  const navigateToView = useCallback((nextViewMode) => {
    closeVoiceViewForNavigation();
    setViewMode(nextViewMode);
  }, [closeVoiceViewForNavigation]);

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
        toast.success(`${server.name} sunucusuna katıldın.`);
      })
      .catch(error => {
        handledInviteRef.current = '';
        toast.error(error.message || 'Davet bağlantısı kullanılamadı.');
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
      reason: reason ? `Sunucudan çıkarıldın: ${reason}` : 'Bir moderatör seni sunucudan çıkardı.',
    });
    const handleBanned = ({ serverId, reason }) => removeServerFromView({
      serverId,
      reason: reason ? `Sunucudan yasaklandın: ${reason}` : 'Bir moderatör seni sunucudan yasakladı.',
    });
    const handleDeleted = ({ serverId }) => removeServerFromView({ serverId, reason: 'Bu sunucu silindi.' });
    const handleModerated = ({ serverId, action, byUsername }) => {
      if (currentServer?.id !== serverId) return;
      const labels = {
        timeout: 'zaman aşımı uyguladı',
        untimeout: 'zaman aşımını kaldırdı',
        mute: 'mikrofonunu susturdu',
        unmute: 'mikrofonunun sesini açtı',
        deafen: 'seni sağırlaştırdı',
        undeafen: 'sağırlaştırmayı kaldırdı',
      };
      if (action === 'timeout' && activeVoiceChannel?.serverId === serverId) leaveVoiceChannel();
      toast(action === 'timeout' ? `Bir moderatör ${labels[action] || 'işlem uyguladı'}.` : `${byUsername || 'Bir moderatör'} ${labels[action] || 'işlem uyguladı'}.`);
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#0f172a] text-[#e2e8f0] font-sans selection:bg-[#2563eb] selection:text-white">
      <NotificationCenter />
      <OnboardingGate />
      
      <ServerList viewMode={viewMode} setViewMode={navigateToView} />

      <div className="flex flex-col w-[256px] bg-[#151b27] flex-shrink-0 overflow-hidden border-r border-white/[0.06]">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {viewMode === 'servers' ? (
            currentServer ? <ChannelList onNavigate={closeVoiceViewForNavigation} /> : null
          ) : (
            <DMList setViewMode={navigateToView} />
          )}
        </div>
        <UserProfile />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#111827]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isInVoice && isVoiceViewOpen ? (
            <VoiceRoomView />
          ) : viewMode === 'servers' ? (
            currentChannel ? (
              <NsfwGate channel={currentChannel}>{currentChannel.type === 'forum' ? <ForumArea /> : <ChatArea />}</NsfwGate>
            ) : (
              <div className="flex flex-1 select-none flex-col items-center justify-center text-[#949BA4]">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#2B2D31] shadow-inner">
                  <span className="text-4xl font-bold text-[#404249]">#</span>
                </div>
                <h3 className="mb-2 text-xl font-bold text-[#F2F3F5]">Kanal Seçilmedi</h3>
                <p className="text-[15px]">Sohbete başlamak için sol taraftan bir metin veya ses kanalı seçin.</p>
              </div>
            )
          ) : viewMode === 'friends' ? (
            <FriendsList />
          ) : (
            <DMArea />
          )}
        </div>

        {/* Ses paneli görünümden bağımsız olarak orta sütunda kalır. Böylece
            kullanıcı DM veya Arkadaşlar ekranına geçse de aramayı yönetebilir. */}
        <VoicePanel />
      </div>

      {!isVoiceViewOpen && viewMode === 'servers' && currentChannel && (
        <div className="flex flex-col w-[256px] bg-[#151b27] flex-shrink-0 border-l border-white/[0.06]">
          <MemberList />
        </div>
      )}

    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <FriendsProvider>
          <DMProvider>
            <ServerProvider>
              <VoiceProvider>
                <DirectCallProvider>
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
