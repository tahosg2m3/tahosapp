import { useState } from 'react';
import { X, Compass } from 'lucide-react';
import { joinServer } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import toast from 'react-hot-toast';
import { normalizeInviteCode } from '../../utils/inviteLinks';

export default function JoinServerModal({ onClose, onJoined }) {
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  const { setServers, setCurrentServer, setCurrentChannel } = useServer();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setIsLoading(true);
    try {
      const server = await joinServer(normalizeInviteCode(inviteCode), user.id);
      
      // State'i güncelle and yeni sunucuya git
      setServers(prev => prev.some(item => item.id === server.id) ? prev.map(item => item.id === server.id ? { ...item, ...server } : item) : [...prev, server]);
      setCurrentChannel(null);
      setCurrentServer(server);
      
      toast.success(`Joined ${server.name}!`);
      onJoined?.(server);
      onClose?.();
    } catch (error) {
      toast.error(error.message || 'Failed to join server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-gray-800 rounded w-full max-w-md overflow-hidden shadow-2xl relative">
        
        {/* Close Button */}
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
        >
            <X className="w-6 h-6" />
        </button>

        {/* Header */}
        <div className="p-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Join a Server</h2>
          <p className="text-gray-400 text-sm">
            Paste an invite link or invite code below.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6">
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
              Invite link or code
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="https://tahosapp.com.tr/app/?invite=Xy9Az2"
              className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
              autoFocus
            />
          </div>

          <div className="bg-gray-700/50 p-3 rounded mb-6 flex items-start gap-3 border border-gray-700/50">
             <div className="bg-green-600/20 p-2 rounded-full shrink-0">
               <Compass className="w-5 h-5 text-green-500" />
             </div>
             <div className="text-sm">
                <h4 className="font-bold text-white">Where can I find an invite link?</h4>
                <p className="text-gray-400">Ask the server owner or a moderator for an invite link.</p>
             </div>
          </div>

          <div className="flex justify-between items-center bg-gray-700/30 -mx-6 -mb-6 p-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="text-gray-300 hover:underline text-sm px-4"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isLoading || !inviteCode}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg shadow-blue-900/20"
            >
              {isLoading ? 'Joining…' : 'Join a Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
