import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass, Search, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { discoverServers } from '../../services/platformApi';
import { joinServer } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useServer } from '../../context/ServerContext';
import JoinServerModal from './JoinServerModal';
import { getColorForString } from '../../utils/colors';
import { resolveSafeMediaUrl } from '../../utils/safeMediaUrl';

function unwrapServers(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.servers || payload?.results || [];
}

export default function DiscoveryModal({ onClose, onJoined }) {
  const { user } = useAuth();
  const { setServers, setCurrentServer, setCurrentChannel } = useServer();
  const [query, setQuery] = useState('');
  const [servers, setDiscoveryServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [showCodeJoin, setShowCodeJoin] = useState(false);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      discoverServers(query.trim())
        .then(payload => { if (live) setDiscoveryServers(unwrapServers(payload)); })
        .catch(error => { if (live) toast.error(error.message); })
        .finally(() => { if (live) setLoading(false); });
    }, query ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);

  const sorted = useMemo(() => [...servers].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)), [servers]);

  const join = async server => {
    const code = server.joinCode || server.inviteCode || server.code || server.defaultInviteCode;
    if (!code) { toast.error('There is no available invite for this server.'); return; }
    setJoiningId(server.id);
    try {
      const joined = await joinServer(code, user?.id);
      setServers(current => current.some(item => item.id === joined.id) ? current : [...current, joined]);
      setCurrentChannel(null);
      setCurrentServer(joined);
      toast.success(`You joined ${joined.name}.`);
      onJoined?.(joined);
      onClose?.();
    } catch (error) { toast.error(error.message); }
    finally { setJoiningId(null); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm">
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f172a] shadow-2xl">
        <header className="border-b border-white/[0.07] bg-gradient-to-r from-[#1d4ed8]/30 to-[#7c3aed]/20 px-7 py-6">
          <div className="flex items-start justify-between gap-4">
            <div><div className="mb-3 inline-flex rounded-xl bg-[#2563eb] p-2.5 text-white"><Compass className="h-6 w-6" /></div><h2 className="text-2xl font-bold text-white">Discover Servers</h2><p className="mt-1 text-sm text-[#cbd5e1]">Find communities or join with an invite code.</p></div>
            <button type="button" onClick={onClose} className="rounded-full bg-black/20 p-2 text-[#cbd5e1] hover:bg-black/30 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-5 flex gap-2"><label className="flex min-w-0 flex-1 items-center rounded-xl border border-white/[0.09] bg-[#0b1220]/80 px-3"><Search className="h-4 w-4 text-[#64748b]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or category" className="w-full bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-[#64748b]" autoFocus /></label><button type="button" onClick={() => setShowCodeJoin(true)} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#0f172a] hover:bg-[#e2e8f0]">Join with Code</button></div>
        </header>
        <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
          {loading ? <p className="py-16 text-center text-[#94a3b8]">Searching for servers…</p> : sorted.length === 0 ? <div className="rounded-2xl border border-dashed border-white/[0.1] py-16 text-center"><Compass className="mx-auto h-9 w-9 text-[#475569]" /><p className="mt-3 text-sm text-[#94a3b8]">No public servers found.</p></div> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{sorted.map(server => {
            const bannerUrl = resolveSafeMediaUrl(server.banner);
            const iconUrl = resolveSafeMediaUrl(server.icon);
            return <article key={server.id} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#151d2c] transition hover:-translate-y-0.5 hover:border-[#3b82f6]/50"><div className="relative h-20 overflow-hidden bg-gradient-to-br from-[#1e3a8a] to-[#4c1d95]">{bannerUrl && <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}</div><div className="p-4"><div className="-mt-10 mb-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border-4 border-[#151d2c] text-xl font-bold text-white" style={{ backgroundColor: getColorForString(server.name) }}>{iconUrl ? <img src={iconUrl} alt="" className="h-full w-full object-cover" /> : server.name?.[0]?.toUpperCase()}</div><h3 className="truncate font-bold text-white">{server.name}</h3><p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-[#94a3b8]">{server.description || 'A community where you can meet new people.'}</p><div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-1 text-xs text-[#64748b]"><Users className="h-3.5 w-3.5" /> {server.memberCount || 0} member</span><button type="button" disabled={joiningId === server.id || server.joined} onClick={() => join(server)} className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1d4ed8] disabled:bg-[#334155]">{server.joined ? 'Joined' : joiningId === server.id ? 'Joining…' : 'Join'}</button></div></div></article>;
          })}</div>}
        </div>
      </section>
      {showCodeJoin && <JoinServerModal onClose={() => setShowCodeJoin(false)} onJoined={joined => { setShowCodeJoin(false); onJoined?.(joined); onClose?.(); }} />}
    </div>,
    document.body,
  );
}
