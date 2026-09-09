import { useEffect, useMemo, useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { createGroupDM, fetchFriends, fetchUsers } from '../../services/api';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';

function UserAvatar({ member }) {
  const avatarUrl = resolveSafeAvatarUrl(member.avatar);
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: getColorForString(member.username || member.id) }}
    >
      {(member.username || '?')[0].toUpperCase()}
    </div>
  );
}

export default function CreateGroupDMModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [people, setPeople] = useState([]);
  const [friendIds, setFriendIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetchFriends(user.id), fetchUsers()])
      .then(([friends, users]) => {
        if (!active) return;
        const nextFriendIds = new Set((friends || []).map((friend) => String(friend.id)));
        const byId = new Map();
        [...(friends || []), ...(users || [])].forEach((person) => {
          if (!person?.id || String(person.id) === String(user.id)) return;
          byId.set(String(person.id), person);
        });
        setFriendIds(nextFriendIds);
        setPeople([...byId.values()].sort((a, b) => {
          const friendDifference = Number(nextFriendIds.has(String(b.id))) - Number(nextFriendIds.has(String(a.id)));
          return friendDifference || String(a.username).localeCompare(String(b.username), 'tr');
        }));
      })
      .catch((error) => toast.error(error.message || 'Users could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [user.id]);

  const filteredPeople = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    if (!normalized) return people;
    return people.filter((person) => String(person.username || '').toLocaleLowerCase('en-US').includes(normalized));
  }, [people, query]);

  const selectedPeople = people.filter((person) => selectedIds.has(String(person.id)));

  const togglePerson = (personId) => {
    const id = String(personId);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 9) next.add(id);
      else toast.error('A group DM can contain at most 10 people.');
      return next;
    });
  };

  const handleCreate = async () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least two people besides yourself.');
      return;
    }
    setSubmitting(true);
    try {
      const fallbackName = selectedPeople.slice(0, 3).map((person) => person.username).join(', ');
      const conversation = await createGroupDM({
        name: name.trim() || fallbackName || 'New Group',
        icon: icon.trim() || null,
        memberIds: [...selectedIds],
      });
      toast.success('Group conversation created.');
      onCreated(conversation);
    } catch (error) {
      toast.error(error.message || 'Could not create the group.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#172033] shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between border-b border-white/[0.08] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">Create a group conversation</h2>
            <p className="mt-1 text-sm text-[#94a3b8]">Select at least two friends or other users.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#94a3b8] hover:bg-white/[0.08] hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 border-b border-white/[0.08] p-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-[#94a3b8]">
            Group name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="For example, Gaming crew" className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm font-normal normal-case text-white outline-none focus:border-[#3b82f6]" />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[#94a3b8]">
            Group image URL <span className="font-normal normal-case">(optional)</span>
            <input value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="https://..." className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm font-normal normal-case text-white outline-none focus:border-[#3b82f6]" />
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users" className="w-full rounded-lg border border-white/[0.08] bg-[#0f172a] py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-[#3b82f6]" />
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? <p className="p-5 text-center text-sm text-[#94a3b8]">Loading users…</p> : filteredPeople.length === 0 ? <p className="p-5 text-center text-sm text-[#94a3b8]">No matching users found.</p> : filteredPeople.map((person) => {
            const personId = String(person.id);
            const selected = selectedIds.has(personId);
            return (
              <button key={personId} type="button" onClick={() => togglePerson(personId)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${selected ? 'bg-[#2563eb]/20' : 'hover:bg-white/[0.06]'}`}>
                <UserAvatar member={person} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#e2e8f0]">{person.username}</span>
                  <span className="block text-xs text-[#64748b]">{friendIds.has(personId) ? 'Friend' : 'User'}</span>
                </span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${selected ? 'border-[#3b82f6] bg-[#3b82f6] text-white' : 'border-[#64748b] text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#111827] px-5 py-4">
          <span className="text-sm text-[#94a3b8]">{selectedIds.size}/9 people selected</span>
          <button type="button" disabled={submitting || selectedIds.size < 2} onClick={handleCreate} className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50"><UserPlus className="h-4 w-4" />{submitting ? 'Creating…' : 'Create group'}</button>
        </div>
      </div>
    </div>
  );
}
