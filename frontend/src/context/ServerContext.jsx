import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchServers } from '../services/api';
import { readUserResourceCache, writeUserResourceCache } from '../services/localResourceCache';
import { useAuth } from './AuthContext';

const ServerContext = createContext(null);

export const useServer = () => {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServer must be used within ServerProvider');
  return context;
};

export const ServerProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [serverState, setServerState] = useState({ userId: null, items: [] });
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState(null);
  const [currentServer, setCurrentServer] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);

  const servers = serverState.userId === userId ? serverState.items : [];

  const setServers = useCallback((update) => {
    if (!userId) return;
    setServerState((current) => {
      const currentItems = current.userId === userId ? current.items : [];
      const nextItems = typeof update === 'function' ? update(currentItems) : update;
      const safeItems = Array.isArray(nextItems) ? nextItems : [];
      writeUserResourceCache('servers', userId, safeItems);
      return { userId, items: safeItems };
    });
  }, [userId]);

  const refreshServers = useCallback(async () => {
    if (!userId) return [];
    setServersLoading(true);
    try {
      const payload = await fetchServers(userId);
      const nextServers = Array.isArray(payload) ? payload : [];
      setServers(nextServers);
      setServersError(null);
      return nextServers;
    } catch (error) {
      setServersError(error);
      throw error;
    } finally {
      setServersLoading(false);
    }
  }, [setServers, userId]);

  useEffect(() => {
    setCurrentServer(null);
    setCurrentChannel(null);
    setServersError(null);
    if (!userId) {
      setServerState({ userId: null, items: [] });
      return undefined;
    }

    const cached = readUserResourceCache('servers', userId);
    setServerState({ userId, items: cached || [] });
    refreshServers().catch((error) => console.error('Failed to load servers:', error));

    const refreshAfterReconnect = () => refreshServers().catch(() => {});
    window.addEventListener('online', refreshAfterReconnect);
    window.addEventListener('focus', refreshAfterReconnect);
    return () => {
      window.removeEventListener('online', refreshAfterReconnect);
      window.removeEventListener('focus', refreshAfterReconnect);
    };
  }, [refreshServers, userId]);

  const value = useMemo(() => ({
    servers,
    setServers,
    serversLoading,
    serversError,
    refreshServers,
    currentServer,
    setCurrentServer,
    currentChannel,
    setCurrentChannel,
  }), [currentChannel, currentServer, refreshServers, servers, serversError, serversLoading, setServers]);

  return (
    <ServerContext.Provider value={value}>
      {children}
    </ServerContext.Provider>
  );
};
