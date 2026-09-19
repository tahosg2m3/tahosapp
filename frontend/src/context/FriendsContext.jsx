// frontend/src/context/FriendsContext.jsx
import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import {
  acceptFriendRequest as acceptFriendRequestApi,
  fetchFriends,
  fetchPendingRequests,
  rejectFriendRequest as rejectFriendRequestApi,
  removeFriend as removeFriendApi,
  sendFriendRequest as sendFriendRequestApi,
} from '../services/api';
import { readUserResourceCache, writeUserResourceCache } from '../services/localResourceCache';

const FriendsContext = createContext(null);

export const useFriends = () => {
  const context = useContext(FriendsContext);
  if (!context) throw new Error('useFriends must be used within FriendsProvider');
  return context;
};

export const FriendsProvider = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);

  const loadFriends = useCallback(async () => {
    if (!user?.id) return [];
    setFriendsLoading(true);
    try {
      const data = await fetchFriends(user.id);
      const nextFriends = Array.isArray(data) ? data : [];
      setFriends(nextFriends);
      writeUserResourceCache('friends', user.id, nextFriends);
      setFriendsError(null);
      return nextFriends;
    } catch (error) {
      console.error('Failed to load friends:', error);
      setFriendsError(error);
      return [];
    } finally {
      setFriendsLoading(false);
    }
  }, [user?.id]);

  const loadPendingRequests = useCallback(async () => {
    if (!user?.id) return [];
    try {
      const data = await fetchPendingRequests(user.id);
      const nextRequests = Array.isArray(data) ? data : [];
      setPendingRequests(nextRequests);
      return nextRequests;
    } catch (error) {
      console.error('Failed to load pending requests:', error);
      return [];
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      const cachedFriends = readUserResourceCache('friends', user.id);
      setFriends(cachedFriends || []);
      loadFriends();
      loadPendingRequests();
    } else {
      setFriends([]);
      setPendingRequests([]);
      setFriendsError(null);
    }
  }, [loadFriends, loadPendingRequests, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const refreshAfterReconnect = () => {
      loadFriends();
      loadPendingRequests();
    };
    window.addEventListener('online', refreshAfterReconnect);
    window.addEventListener('focus', refreshAfterReconnect);
    return () => {
      window.removeEventListener('online', refreshAfterReconnect);
      window.removeEventListener('focus', refreshAfterReconnect);
    };
  }, [loadFriends, loadPendingRequests, user?.id]);

  useEffect(() => {
    if (!socket) return;

    // Listen for status updates
    const handleStatusUpdate = ({ userId, status, customStatus }) => {
      setFriends(prev => {
        const nextFriends = prev.map(friend =>
          friend.id === userId ? { ...friend, status, ...(customStatus !== undefined ? { customStatus } : {}) } : friend
        );
        writeUserResourceCache('friends', user?.id, nextFriends);
        return nextFriends;
      });
    };
    const handleRichPresenceUpdate = ({ userId, activities }) => {
      setFriends(previous => previous.map(friend => (
        String(friend.id) === String(userId) ? { ...friend, activities: activities || [] } : friend
      )));
    };
    const handleFriendsChanged = () => {
      loadFriends();
      loadPendingRequests();
    };
    const handleFriendRequest = () => loadPendingRequests();
    socket.on('status:update', handleStatusUpdate);
    socket.on('rich-presence:update', handleRichPresenceUpdate);
    socket.on('friends:changed', handleFriendsChanged);
    socket.on('friend:request', handleFriendRequest);

    return () => {
      socket.off('status:update', handleStatusUpdate);
      socket.off('rich-presence:update', handleRichPresenceUpdate);
      socket.off('friends:changed', handleFriendsChanged);
      socket.off('friend:request', handleFriendRequest);
    };
  }, [loadFriends, loadPendingRequests, socket]);

  const sendFriendRequest = async (targetUsername) => {
    try {
      await sendFriendRequestApi(user.id, targetUsername);
      return true;
    } catch (error) {
      console.error('Failed to send friend request:', error);
      throw error;
    }
  };

  const acceptFriendRequest = async (requestId) => {
    try {
      await acceptFriendRequestApi(requestId);

      await loadFriends();
      await loadPendingRequests();
    } catch (error) {
      console.error('Failed to accept friend request:', error);
      throw error;
    }
  };

  const rejectFriendRequest = async (requestId) => {
    try {
      await rejectFriendRequestApi(requestId);

      await loadPendingRequests();
    } catch (error) {
      console.error('Failed to reject friend request:', error);
      throw error;
    }
  };

  const removeFriend = async (friendId) => {
    try {
      await removeFriendApi(user.id, friendId);
      setFriends((previous) => {
        const nextFriends = previous.filter((friend) => friend.id !== friendId);
        writeUserResourceCache('friends', user.id, nextFriends);
        return nextFriends;
      });
      return true;
    } catch (error) {
      console.error('Failed to remove friend:', error);
      throw error;
    }
  };

  const value = {
    friends,
    pendingRequests,
    friendsLoading,
    friendsError,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    refreshFriends: loadFriends,
    refreshPendingRequests: loadPendingRequests,
  };

  return (
    <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
  );
};
