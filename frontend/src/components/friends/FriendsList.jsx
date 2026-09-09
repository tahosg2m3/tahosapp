// frontend/src/components/friends/FriendsList.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MessageSquare, MoreVertical, Check, X, UserPlus, Search } from 'lucide-react';
import { 
  fetchFriends, 
  fetchPendingRequests, 
  sendFriendRequest, 
  acceptFriendRequest, 
  rejectFriendRequest,
  createDMConversation 
} from '../../services/api';
import { useServer } from '../../context/ServerContext';
import { useDM } from '../../context/DMContext';
import toast from 'react-hot-toast';

export default function FriendsList() {
  const { user } = useAuth();
  const { setCurrentServer } = useServer();
  const { setActiveDM } = useDM();
  const [activeTab, setActiveTab] = useState('online'); 
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [addUsername, setAddUsername] = useState('');
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, activeTab]);

  const loadData = async () => {
    try {
      const [friendsData, requestsData] = await Promise.all([
        fetchFriends(user.id),
        fetchPendingRequests(user.id)
      ]);
      setFriends(friendsData);
      setPendingRequests(requestsData);
    } catch (error) {
      console.error('Failed to load friends data:', error);
    }
  };

  const handleSendRequest = async (e) => {
    e.preventDefault();
    if (!addUsername.trim()) return;

    try {
      await sendFriendRequest(user.id, addUsername.trim());
      setStatusMessage({ type: 'success', text: `Friend request sent to ${addUsername}` });
      setAddUsername('');
    } catch (error) {
      setStatusMessage({ type: 'error', text: error.message });
    }
  };

  const handleAccept = async (requestId) => {
    try {
      await acceptFriendRequest(requestId);
      loadData(); 
    } catch (error) {
      console.error('Failed to accept request:', error);
    }
  };

  const handleReject = async (requestId) => {
    try {
      await rejectFriendRequest(requestId);
      loadData();
    } catch (error) {
      console.error('Failed to reject request:', error);
    }
  };

  const handleMessageClick = async (friendId) => {
    try {
      const conversation = await createDMConversation(user.id, friendId);
      const otherUser = friends.find((friend) => friend.id === friendId);
      setActiveDM({ ...conversation, otherUser });
      setCurrentServer(null);
      window.dispatchEvent(new CustomEvent('tahosapp:navigate-to-dm', { detail: { conversation } }));
      toast.success('Direct message opened.');
    } catch (error) {
      console.error('Could not start DM:', error);
      toast.error('Could not start a direct message.');
    }
  };

  const filteredFriends = friends.filter(friend => {
    if (activeTab === 'online') return friend.status === 'online';
    return true; 
  });

  return (
    <div className="flex-1 flex flex-col bg-gray-700 min-w-0">
      {/* Header */}
      <div className="h-12 flex items-center px-4 shadow-md border-b border-gray-900 bg-gray-700 shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex items-center text-white font-semibold mr-4">
            <span className="mr-2">Friends</span>
          </div>
          
          <button 
            onClick={() => setActiveTab('online')}
            className={`px-2 py-1 rounded hover:bg-gray-600 text-sm font-medium transition-colors
              ${activeTab === 'online' ? 'text-white bg-gray-600' : 'text-gray-400'}`}
          >
            Online
          </button>
          <button 
            onClick={() => setActiveTab('all')}
            className={`px-2 py-1 rounded hover:bg-gray-600 text-sm font-medium transition-colors
              ${activeTab === 'all' ? 'text-white bg-gray-600' : 'text-gray-400'}`}
          >
            All
          </button>
          <button 
            onClick={() => setActiveTab('pending')}
            className={`px-2 py-1 rounded hover:bg-gray-600 text-sm font-medium transition-colors
              ${activeTab === 'pending' ? 'text-white bg-gray-600' : 'text-gray-400'}`}
          >
            Pending
            {pendingRequests.length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs px-1.5 rounded-full">
                {pendingRequests.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('add')}
            className={`px-2 py-1 rounded text-sm font-medium transition-colors
              ${activeTab === 'add' ? 'text-green-500 bg-transparent' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            Add Friend
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto">
        
        {/* ADD FRIEND TAB */}
        {activeTab === 'add' && (
          <div className="max-w-xl">
            <h2 className="text-white font-bold mb-2 uppercase text-sm">Add Friend</h2>
            <p className="text-gray-400 text-xs mb-4">You can add a friend with their username.</p>
            
            <form onSubmit={handleSendRequest} className="relative">
              <input
                type="text"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder="Enter a Username#0000"
                className="w-full bg-gray-900 text-white p-3 rounded-lg border border-black focus:border-blue-500 focus:outline-none"
              />
              <button 
                type="submit"
                disabled={!addUsername}
                className="absolute right-2 top-2 bg-blue-600 text-white px-4 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                Send Friend Request
              </button>
            </form>

            {statusMessage.text && (
              <div className={`mt-4 p-3 rounded text-sm ${
                statusMessage.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}>
                {statusMessage.text}
              </div>
            )}
          </div>
        )}

        {/* PENDING TAB */}
        {activeTab === 'pending' && (
          <div className="space-y-2">
            <h2 className="text-gray-400 text-xs font-bold uppercase mb-4">
              Pending Requests — {pendingRequests.length}
            </h2>
            
            {pendingRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-50">
                    <div className="bg-gray-600 p-4 rounded-full mb-4">
                        <UserPlus className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-400">There are no pending friend requests.</p>
                </div>
            ) : (
                pendingRequests.map(req => {
                  // --- KRİTİK DÜZELTME BURADA ---
                  // Eğer sunucu yeniden başlatıldıysa kullanıcı verisi silinmiş olabilir.
                  // Bu durumda fromUser 'undefined' olur and uygulama çöker.
                  // Bunu block has kontrol ekliyoruz:
                  if (!req.fromUser) return null;

                  return (
                    <div key={req.id} className="flex items-center justify-between p-3 hover:bg-gray-600/50 rounded group border-t border-gray-600">
                        <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                            {req.fromUser.username[0].toUpperCase()}
                        </div>
                        <div>
                            <div className="text-white font-semibold">{req.fromUser.username}</div>
                            <div className="text-gray-400 text-xs">Incoming Friend Request</div>
                        </div>
                        </div>
                        <div className="flex items-center space-x-2">
                        <button 
                            onClick={() => handleAccept(req.id)}
                            className="p-2 bg-gray-800 rounded-full hover:bg-gray-900 hover:text-green-500 transition-colors"
                            title="Accept"
                        >
                            <Check className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={() => handleReject(req.id)}
                            className="p-2 bg-gray-800 rounded-full hover:bg-gray-900 hover:text-red-500 transition-colors"
                            title="Ignore"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        </div>
                    </div>
                  );
                })
            )}
          </div>
        )}

        {/* FRIENDS LIST (ALL / ONLINE) */}
        {(activeTab === 'online' || activeTab === 'all') && (
          <div className="space-y-2">
            <h2 className="text-gray-400 text-xs font-bold uppercase mb-4">
              {activeTab === 'online' ? 'Online Friends' : 'All Friends'} — {filteredFriends.length}
            </h2>

            {filteredFriends.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-10 opacity-50">
                    <div className="bg-gray-600 p-4 rounded-full mb-4">
                        <Search className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-400">No friends found.</p>
                </div>
            ) : (
                filteredFriends.map(friend => (
                <div key={friend.id} className="flex items-center justify-between p-3 hover:bg-gray-600/50 rounded group border-t border-gray-600 cursor-pointer">
                    <div className="flex items-center space-x-3">
                    <div className="relative">
                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                        {friend.username[0].toUpperCase()}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 border-2 border-gray-700 rounded-full ${
                        friend.status === 'online' ? 'bg-green-500' : 'bg-gray-500'
                        }`} />
                    </div>
                    <div>
                        <div className="text-white font-semibold">{friend.username}</div>
                        <div className="text-gray-400 text-xs">{friend.status}</div>
                    </div>
                    </div>
                    <div className="flex items-center space-x-2 bg-gray-800 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={() => handleMessageClick(friend.id)}
                        className="p-2 hover:bg-gray-600 rounded-full text-gray-300 hover:text-white"
                        title="Message"
                    >
                        <MessageSquare className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-600 rounded-full text-gray-300 hover:text-white">
                        <MoreVertical className="w-5 h-5" />
                    </button>
                    </div>
                </div>
                ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
