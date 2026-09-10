import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createPoll, listPolls, votePoll } from '../../services/platformApi';
import { useSocket } from '../../context/SocketContext';

function unwrap(payload) { return Array.isArray(payload) ? payload : payload?.polls || []; }

export default function PollPanel({ channelId, userId, onClose, canSendMessages = false }) {
  const { socket } = useSocket();
  const [polls, setPolls] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);

  const load = useCallback(() => {
    if (!channelId) return;
    listPolls(channelId).then(payload => setPolls(unwrap(payload))).catch(error => toast.error(error.message));
  }, [canSendMessages, channelId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setShowCreate(false);
    setQuestion('');
    setOptions(['', '']);
  }, [channelId]);
  useEffect(() => {
    if (!socket) return undefined;
    const update = payload => {
      if (payload?.scope !== 'polls') return;
      if (payload?.data?.channelId && String(payload.data.channelId) !== String(channelId)) return;
      load();
    };
    socket.on('platform:update', update);
    return () => socket.off('platform:update', update);
  }, [channelId, load, socket]);

  const submit = async event => {
    event.preventDefault();
    if (!canSendMessages) return;
    const normalized = options.map(value => value.trim()).filter(Boolean);
    if (!question.trim() || normalized.length < 2) return;
    try {
      await createPoll(channelId, { question: question.trim(), options: normalized, allowMultiple: multiple });
      setQuestion(''); setOptions(['', '']); setShowCreate(false); load(); toast.success('Poll created.');
    } catch (error) { toast.error(error.message); }
  };

  const castVote = async (poll, option) => {
    if (!canSendMessages || poll.closed) return;
    const optionId = option.id;
    if (!optionId) return;
    const currentIds = (poll.options || []).filter(item => item.voted).map(item => item.id);
    const optionIds = poll.allowMultiple
      ? (option.voted ? currentIds.filter(id => id !== optionId) : [...currentIds, optionId])
      : [optionId];
    if (!optionIds.length) return;
    try { await votePoll(channelId, poll.id, optionIds); await load(); }
    catch (error) { toast.error(error.message); }
  };

  return (
    <aside className="absolute right-4 top-16 z-50 flex max-h-[calc(100%-5rem)] w-[390px] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#151d2c] shadow-2xl shadow-black/40">
      <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[#60a5fa]" /><span className="text-sm font-bold text-white">Channel polls</span></div><div className="flex gap-1">{canSendMessages && <button type="button" onClick={() => setShowCreate(show => !show)} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><Plus className="h-4 w-4" /></button>}<button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><X className="h-4 w-4" /></button></div></header>
      {showCreate && <form onSubmit={submit} className="space-y-2 border-b border-white/[0.07] bg-[#0f172a] p-4"><input required maxLength="200" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Enter your question" className="w-full rounded-lg border border-white/[0.08] bg-[#111827] px-3 py-2 text-sm text-white outline-none focus:border-[#3b82f6]" />{options.map((option, index) => <div key={index} className="flex gap-1"><input required value={option} onChange={event => setOptions(current => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={`${index + 1}. option`} className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#111827] px-3 py-2 text-sm text-white outline-none focus:border-[#3b82f6]" />{options.length > 2 && <button type="button" onClick={() => setOptions(current => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg p-2 text-[#f87171] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /></button>}</div>)}<div className="flex items-center justify-between"><button type="button" onClick={() => setOptions(current => current.length < 10 ? [...current, ''] : current)} className="text-xs font-semibold text-[#60a5fa]">+ Add option</button><label className="flex items-center gap-2 text-xs text-[#94a3b8]"><input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} /> Allow multiple choices</label></div><button className="w-full rounded-lg bg-[#2563eb] py-2 text-sm font-bold text-white hover:bg-[#1d4ed8]">Publish poll</button></form>}
      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3">{polls.length === 0 ? <p className="py-10 text-center text-sm text-[#64748b]">There are no polls in this channel.</p> : polls.map(poll => { const total = poll.totalVotes ?? (poll.options || []).reduce((sum, item) => sum + (typeof item.votes === 'number' ? item.votes : item.voteCount || item.votes?.length || 0), 0); return <article key={poll.id} className="rounded-xl border border-white/[0.07] bg-[#0f172a] p-4"><h3 className="font-bold text-white">{poll.question}</h3><p className="mt-1 text-[11px] text-[#64748b]">{total} votes · {poll.allowMultiple ? 'Multiple choice' : 'Single choice'}</p><div className="mt-3 space-y-2">{(poll.options || []).map((option, index) => { const count = typeof option.votes === 'number' ? option.votes : option.voteCount || option.votes?.length || 0; const percent = total ? Math.round((count / total) * 100) : 0; const selected = Boolean(option.voted || option.userIds?.includes?.(userId) || option.votes?.includes?.(userId)); return <button key={option.id || index} type="button" onClick={() => castVote(poll, option)} className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition ${selected ? 'border-[#3b82f6] text-white' : 'border-white/[0.08] text-[#cbd5e1] hover:border-white/[0.16]'}`}><span className="absolute inset-y-0 left-0 bg-[#2563eb]/20" style={{ width: `${percent}%` }} /><span className="relative flex items-center justify-between gap-2"><span className="flex items-center gap-2">{selected && <Check className="h-3.5 w-3.5 text-[#60a5fa]" />}{option.text || option.label || option}</span><strong className="text-xs">{percent}%</strong></span></button>; })}</div></article>; })}</div>
    </aside>
  );
}
