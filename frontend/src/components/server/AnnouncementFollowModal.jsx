import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Radio, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useServer } from '../../context/ServerContext';
import { fetchChannels } from '../../services/api';
import {
  followAnnouncementChannel,
  listAnnouncementFollowers,
  unfollowAnnouncementChannel,
} from '../../services/platformApi';

export default function AnnouncementFollowModal({ channel, onClose }) {
  const { servers, currentServer } = useServer();
  const [destinations, setDestinations] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [targetChannelId, setTargetChannelId] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshFollowers = () => listAnnouncementFollowers(channel.id)
    .then(payload => setFollowers(Array.isArray(payload) ? payload : payload.followers || []));

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.allSettled([
      listAnnouncementFollowers(channel.id),
      Promise.all((servers || []).filter(server => server.id !== currentServer?.id).map(async server => ({
        server,
        channels: await fetchChannels(server.id),
      }))),
    ]).then(([followerResult, groupResult]) => {
      if (!live) return;
      if (followerResult.status === 'fulfilled') {
        const payload = followerResult.value;
        setFollowers(Array.isArray(payload) ? payload : payload.followers || []);
      } else {
        setFollowers([]);
      }
      const groups = groupResult.status === 'fulfilled' ? groupResult.value : [];
      setDestinations(groups.flatMap(({ server, channels }) => (Array.isArray(channels) ? channels : channels.channels || [])
        .filter(item => ['text', 'announcement'].includes(item.type))
        .map(item => ({ ...item, serverName: server.name }))));
      if (followerResult.status === 'rejected' && groupResult.status === 'rejected') {
        toast.error(groupResult.reason?.message || followerResult.reason?.message || 'Could not load channels.');
      }
    }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [channel.id, currentServer?.id, servers]);

  const followedTargets = useMemo(() => new Set(followers.map(item => item.targetChannelId)), [followers]);

  const follow = async () => {
    if (!targetChannelId) return;
    try {
      const created = await followAnnouncementChannel(channel.id, targetChannelId);
      const followItem = created.follow || created;
      if (followItem?.id) setFollowers(current => current.some(item => item.id === followItem.id) ? current : [...current, followItem]);
      setTargetChannelId('');
      await refreshFollowers().catch(() => {});
      toast.success('Announcements will be sent to the target channel.');
    } catch (error) { toast.error(error.message); }
  };

  const unfollow = async (followId) => {
    try {
      await unfollowAnnouncementChannel(channel.id, followId);
      await refreshFollowers();
      toast.success('Announcement follow removed.');
    } catch (error) { toast.error(error.message); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onMouseDown={onClose}>
      <section className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#151d2c] p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        <header className="mb-5 flex items-start justify-between"><div className="flex gap-3"><span className="rounded-xl bg-[#2563eb]/15 p-2.5 text-[#60a5fa]"><Radio className="h-5 w-5" /></span><div><h2 className="font-bold text-white">Follow announcement channel</h2><p className="text-xs text-[#94a3b8]">#{channel.name} Forward announcements to another server you manage.</p></div></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/[0.06]"><X className="h-4 w-4" /></button></header>
        {loading ? <p className="py-8 text-center text-sm text-[#94a3b8]">Loading channels…</p> : <><div className="flex gap-2"><select value={targetChannelId} onChange={event => setTargetChannelId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-white outline-none"><option value="">Choose a target channel</option>{destinations.filter(item => !followedTargets.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.serverName} · #{item.name}</option>)}</select><button type="button" disabled={!targetChannelId} onClick={follow} className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-40">Follow</button></div><div className="mt-5 space-y-2"><p className="text-[10px] font-bold uppercase text-[#64748b]">Active destinations</p>{followers.length === 0 ? <p className="rounded-xl border border-dashed border-white/[0.1] p-5 text-center text-sm text-[#64748b]">This channel is not connected to another channel yet.</p> : followers.map(followItem => { const destination = destinations.find(item => item.id === followItem.targetChannelId); return <div key={followItem.id} className="flex items-center gap-3 rounded-xl bg-[#0f172a] px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{destination ? `${destination.serverName} · #${destination.name}` : followItem.targetChannelId}</p><p className="text-[11px] text-[#64748b]">New announcements are forwarded automatically</p></div><button type="button" onClick={() => unfollow(followItem.id)} className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /></button></div>; })}</div></>}
      </section>
    </div>,
    document.body,
  );
}
