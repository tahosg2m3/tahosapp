import { useState, useEffect } from 'react';
import { Plus, Compass, MessageSquare, Users, LayoutGrid, RefreshCw } from 'lucide-react';
import { useServer } from '../../context/ServerContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { fetchChannelMessages, fetchChannels, fetchServerMembers } from '../../services/api';
import { getServerRoles } from '../server/serverManagementApi';
import ServerIcon from '../server/ServerIcon';
import CreateServerModal from '../server/CreateServerModal';
import DiscoveryModal from '../server/DiscoveryModal';
import CommunityHub from '../hub/CommunityHub';

export default function ServerList({ viewMode, setViewMode, onExternalNavigate = setViewMode }) {
  const { servers, setServers, serversLoading, serversError, refreshServers, currentServer, currentChannel, setCurrentServer, setCurrentChannel } = useServer();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showCommunityHub, setShowCommunityHub] = useState(false);

  const prefetchServer = (serverId) => {
    const channelsRequest = fetchChannels(serverId);
    Promise.allSettled([channelsRequest, fetchServerMembers(serverId), getServerRoles(serverId)]);
    channelsRequest.then((channels) => {
      const firstTextChannel = (Array.isArray(channels) ? channels : [])
        .find((channel) => ['text', 'announcement'].includes(channel.type || 'text'));
      if (firstTextChannel?.id) fetchChannelMessages(firstTextChannel.id).catch(() => {});
    }).catch(() => {});
  };

  useEffect(() => {
    const navigateToDM = () => {
      setCurrentServer(null);
      setCurrentChannel(null);
      onExternalNavigate('dms');
    };

    window.addEventListener('tahosapp:navigate-to-dm', navigateToDM);
    return () => window.removeEventListener('tahosapp:navigate-to-dm', navigateToDM);
  }, [setCurrentChannel, setCurrentServer, onExternalNavigate]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleServerUpdated = ({ server }) => {
      if (!server?.id) return;
      setServers((previous) => previous.map((candidate) => (candidate.id === server.id ? { ...candidate, ...server } : candidate)));
      setCurrentServer((current) => (current?.id === server.id ? { ...current, ...server } : current));
    };
    const handleServerDeleted = ({ serverId }) => {
      if (!serverId) return;
      setServers((previous) => previous.filter((server) => server.id !== serverId));
      setCurrentServer((current) => (current?.id === serverId ? null : current));
      if (currentServer?.id === serverId) setCurrentChannel(null);
    };

    socket.on('server:updated', handleServerUpdated);
    socket.on('server:deleted', handleServerDeleted);
    return () => {
      socket.off('server:updated', handleServerUpdated);
      socket.off('server:deleted', handleServerDeleted);
    };
  }, [currentServer?.id, setCurrentChannel, setCurrentServer, setServers, socket]);

  return (
    <div className="w-[72px] bg-[#1E1F22] flex flex-col items-center pt-3 space-y-0 h-full overflow-y-auto no-scrollbar shrink-0 relative z-20">
      
      <div className="relative group flex items-center justify-center w-[72px] h-[48px] mb-2 cursor-pointer">
        <div className={`absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 ease-in-out ${viewMode === 'dms' ? 'h-10 opacity-100' : 'h-2 opacity-0 group-hover:h-5 group-hover:opacity-100'}`} />
        <button
          onClick={() => { setViewMode('dms'); setCurrentServer(null); setCurrentChannel(null); }}
          className={`w-[48px] h-[48px] flex items-center justify-center transition-all duration-300 ease-in-out ${viewMode === 'dms' ? 'bg-[#5865F2] text-white rounded-[16px] shadow-sm' : 'bg-[#313338] text-[#DBDEE1] rounded-[24px] hover:rounded-[16px] hover:bg-[#5865F2] hover:text-white hover:shadow-sm'}`}
        >
          <MessageSquare className="w-6 h-6" />
        </button>
        <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
          Direct Messages
        </div>
      </div>

      <div className="relative group flex items-center justify-center w-[72px] h-[48px] mb-2 cursor-pointer">
        <div className="absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 h-2 opacity-0 group-hover:h-5 group-hover:opacity-100" />
        <button onClick={() => setShowCommunityHub(true)} className="w-[48px] h-[48px] bg-[#313338] hover:bg-[#7c3aed] rounded-[24px] hover:rounded-[16px] transition-all duration-300 flex items-center justify-center text-[#a78bfa] hover:text-white" aria-label="Topluluk Merkezi">
          <LayoutGrid className="w-6 h-6" />
        </button>
        <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
          Topluluk Merkezi
        </div>
      </div>

      <div className="relative group flex items-center justify-center w-[72px] h-[48px] mb-2 cursor-pointer">
        <div className={`absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 ease-in-out ${viewMode === 'friends' ? 'h-10 opacity-100' : 'h-2 opacity-0 group-hover:h-5 group-hover:opacity-100'}`} />
        <button
          onClick={() => { setViewMode('friends'); setCurrentServer(null); setCurrentChannel(null); }}
          className={`w-[48px] h-[48px] flex items-center justify-center transition-all duration-300 ease-in-out ${viewMode === 'friends' ? 'bg-[#23A559] text-white rounded-[16px] shadow-sm' : 'bg-[#313338] text-[#DBDEE1] rounded-[24px] hover:rounded-[16px] hover:bg-[#23A559] hover:text-white hover:shadow-sm'}`}
        >
          <Users className="w-6 h-6" />
        </button>
        <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
          Friends
        </div>
      </div>

      <div className="w-8 h-[2px] bg-[#313338] my-2 shrink-0 rounded-full" />

      {!servers.length && (serversLoading || serversError) && (
        <button
          type="button"
          onClick={() => refreshServers().catch(() => {})}
          disabled={serversLoading}
          className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#313338] text-[#b5bac1] transition-colors hover:bg-[#5865f2] hover:text-white disabled:cursor-wait"
          title={serversError ? 'Servers could not be loaded. Try again.' : 'Loading servers'}
          aria-label={serversError ? 'Retry loading servers' : 'Loading servers'}
        >
          <RefreshCw className={`h-5 w-5 ${serversLoading ? 'animate-spin' : ''}`} />
        </button>
      )}

      {servers.map((server) => (
        <ServerIcon
          key={server.id}
          server={server}
          active={viewMode === 'servers' && currentServer?.id === server.id} 
          onPrefetch={() => prefetchServer(server.id)}
          onClick={() => { setCurrentChannel(null); setCurrentServer(server); setViewMode('servers'); }}
        />
      ))}

      <div className="relative group flex items-center justify-center w-[72px] h-[48px] mt-2 mb-2 cursor-pointer">
        <div className="absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 h-2 opacity-0 group-hover:h-5 group-hover:opacity-100" />
        <button onClick={() => setShowCreateModal(true)} className="w-[48px] h-[48px] bg-[#313338] hover:bg-[#23A559] rounded-[24px] hover:rounded-[16px] transition-all duration-300 flex items-center justify-center text-[#23A559] hover:text-white">
          <Plus className="w-6 h-6 transition-colors" />
        </button>
        <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
          Add a Server
        </div>
      </div>

      <div className="relative group flex items-center justify-center w-[72px] h-[48px] mb-2 cursor-pointer">
        <div className="absolute left-0 w-1 bg-white rounded-r-md transition-all duration-300 h-2 opacity-0 group-hover:h-5 group-hover:opacity-100" />
        <button onClick={() => setShowDiscovery(true)} className="w-[48px] h-[48px] bg-[#313338] hover:bg-[#23A559] rounded-[24px] hover:rounded-[16px] transition-all duration-300 flex items-center justify-center text-[#23A559] hover:text-white">
          <Compass className="w-6 h-6 transition-colors" />
        </button>
        <div className="absolute left-[76px] px-3 py-2 bg-[#111214] text-[#DBDEE1] text-[14px] font-semibold rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-all duration-150 scale-95 group-hover:scale-100 shadow-xl flex items-center">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#111214] rotate-45" />
          Explore Servers
        </div>
      </div>

      {showCreateModal && <CreateServerModal onClose={() => setShowCreateModal(false)} onCreated={() => setViewMode('servers')} />}
      {showDiscovery && <DiscoveryModal onClose={() => setShowDiscovery(false)} onJoined={() => setViewMode('servers')} />}
      {showCommunityHub && <CommunityHub onClose={() => setShowCommunityHub(false)} server={currentServer} channel={currentChannel} user={user} socket={socket} />}
    </div>
  );
}
