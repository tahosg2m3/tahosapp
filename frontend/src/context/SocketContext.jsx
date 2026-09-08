import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { SOCKET_URL } from '../config/runtimeConfig';

const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const { user, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isPresenceReady, setIsPresenceReady] = useState(false);

  useEffect(() => {
    // Kullanıcı giriş yapmadıysa boşuna bağlanmaya çalışma
    if (!user) {
       setSocket(null);
       setIsPresenceReady(false);
       return;
    }

    const token = localStorage.getItem('chat_token');
    const newSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    newSocket.on('connect', () => {
      console.log('🟢 Soket Hesabına Bağlandı:', newSocket.id);
      newSocket.emit('authenticate', { userId: user.id, username: user.username });
    });

    newSocket.on('presence:ready', () => setIsPresenceReady(true));
    newSocket.on('disconnect', () => setIsPresenceReady(false));
    newSocket.on('platform:account-banned', ({ reason } = {}) => {
      toast.error(reason ? `Hesabın banlandı: ${reason}` : 'Hesabın tahosapp genelinde banlandı.');
      logout();
    });

    newSocket.on('connect_error', (err) => {
      console.error('🔴 Soket Hatası:', err.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, isPresenceReady }}>
      {children}
    </SocketContext.Provider>
  );
};
