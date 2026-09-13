import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock, Bookmark, BookOpen, CalendarClock, Gamepad2, KeyRound, LifeBuoy,
  Loader2, Paintbrush, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, Users, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  addWhiteboardStroke, cancelReminder, cancelScheduledMessage, clearWhiteboard,
  closeLfg, createLfg, createReminder, createTicket, createWikiPage,
  deletePasskey, deleteSavedMessage, deleteWikiPage, disableWebPush, enableWebPush,
  getCatchUp, getHubOverview, joinLfg, registerPasskey, replyTicket, revokeSession,
  scheduleMessage, updateTicket, updateWikiPage,
} from '../../services/communityHubApi';

const inputClass = 'w-full rounded-lg border border-white/[0.08] bg-[#0f172a] px-3 py-2.5 text-sm text-[#e2e8f0] outline-none focus:border-[#3b82f6]';
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50';
const secondaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm font-semibold text-[#cbd5e1] hover:bg-white/[0.08] disabled:opacity-50';

function dateInputValue(minutes = 60) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-white/[0.1] px-4 py-10 text-center text-sm text-[#64748b]">{children}</div>;
}

function Card({ children, className = '' }) {
  return <section className={`rounded-xl border border-white/[0.07] bg-[#151d2c] p-4 ${className}`}>{children}</section>;
}

function FormTitle({ children }) {
  return <h3 className="mb-3 text-sm font-bold text-white">{children}</h3>;
}

export default function CommunityHub({ onClose, server, channel, user, socket }) {
  const [activeTab, setActiveTab] = useState(server ? 'lfg' : 'saved');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({ content: '', sendAt: dateInputValue() });
  const [reminderDraft, setReminderDraft] = useState({ note: '', remindAt: dateInputValue() });
  const [lfgDraft, setLfgDraft] = useState({ game: '', title: '', details: '', rank: '', language: 'Türkçe', maxPlayers: 5 });
  const [ticketDraft, setTicketDraft] = useState({ subject: '', message: '' });
  const [wikiDraft, setWikiDraft] = useState({ id: '', title: '', content: '' });
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [drawDraft, setDrawDraft] = useState(null);
  const [strokeColor, setStrokeColor] = useState('#60a5fa');
  const boardRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getHubOverview({ serverId: server?.id, channelId: channel?.id }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [channel?.id, server?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => load();
    const addStroke = stroke => setData(current => current ? ({ ...current, whiteboard: { ...(current.whiteboard || {}), strokes: [...(current.whiteboard?.strokes || []), stroke].slice(-1000) } }) : current);
    const clear = payload => {
      if (payload?.channelId === channel?.id) setData(current => current ? ({ ...current, whiteboard: { channelId: channel.id, strokes: [] } }) : current);
    };
    socket.on('hub:lfg-update', refresh);
    socket.on('hub:ticket-update', refresh);
    socket.on('hub:wiki-update', refresh);
    socket.on('scheduled-message:sent', refresh);
    socket.on('whiteboard:stroke', addStroke);
    socket.on('whiteboard:cleared', clear);
    return () => {
      socket.off('hub:lfg-update', refresh);
      socket.off('hub:ticket-update', refresh);
      socket.off('hub:wiki-update', refresh);
      socket.off('scheduled-message:sent', refresh);
      socket.off('whiteboard:stroke', addStroke);
      socket.off('whiteboard:cleared', clear);
    };
  }, [channel?.id, load, socket]);

  useEffect(() => {
    if (activeTab !== 'summary' || !channel?.id) return;
    setSummaryLoading(true);
    getCatchUp(channel.id, Date.now() - 24 * 60 * 60 * 1000)
      .then(setSummary)
      .catch(error => toast.error(error.message))
      .finally(() => setSummaryLoading(false));
  }, [activeTab, channel?.id]);

  const tabs = useMemo(() => [
    { id: 'saved', label: 'Kayıtlarım', icon: Bookmark },
    { id: 'scheduled', label: 'Planlayıcı', icon: CalendarClock },
    ...(server ? [
      { id: 'lfg', label: 'Ekip Bul', icon: Gamepad2 },
      { id: 'support', label: 'Destek', icon: LifeBuoy },
      { id: 'wiki', label: 'Wiki', icon: BookOpen },
    ] : []),
    ...(channel ? [
      { id: 'whiteboard', label: 'Ortak Tahta', icon: Paintbrush },
      { id: 'summary', label: 'Neler Oldu?', icon: Sparkles },
    ] : []),
    { id: 'security', label: 'Güvenlik', icon: ShieldCheck },
  ], [channel, server]);

  const run = async (operation, success) => {
    setBusy(true);
    try {
      await operation();
      if (success) toast.success(success);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const boardStrokes = data?.whiteboard?.strokes || [];
  const pointerPoint = event => {
    const rect = boardRef.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const startDraw = event => { event.currentTarget.setPointerCapture(event.pointerId); setDrawDraft({ color: strokeColor, width: 3, points: [pointerPoint(event)] }); };
  const moveDraw = event => setDrawDraft(current => current && event.buttons ? ({ ...current, points: [...current.points, pointerPoint(event)].slice(-200) }) : current);
  const finishDraw = async () => {
    const stroke = drawDraft;
    setDrawDraft(null);
    if (!stroke || stroke.points.length < 2 || !channel?.id) return;
    try { await addWhiteboardStroke(channel.id, stroke); } catch (error) { toast.error(error.message); }
  };
  const polyline = stroke => (stroke.points || []).map(point => `${point.x * 1000},${point.y * 500}`).join(' ');

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="flex h-[min(780px,94vh)] w-[min(1180px,96vw)] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f172a] shadow-2xl">
        <aside className="w-52 shrink-0 border-r border-white/[0.07] bg-[#111827] p-3">
          <div className="mb-4 px-2 pt-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#60a5fa]">Tahosapp</p>
            <h2 className="mt-1 font-bold text-white">Topluluk Merkezi</h2>
            <p className="mt-1 truncate text-xs text-[#64748b]">{server?.name || 'Kişisel araçlar'}</p>
          </div>
          <nav className="space-y-1">{tabs.map(tab => {
            const Icon = tab.icon;
            return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${activeTab === tab.id ? 'bg-[#2563eb] text-white' : 'text-[#94a3b8] hover:bg-white/[0.06] hover:text-white'}`}><Icon className="h-4 w-4" />{tab.label}</button>;
          })}</nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
          <header className="mb-5 flex items-center justify-between">
            <div><h1 className="text-xl font-bold text-white">{tabs.find(tab => tab.id === activeTab)?.label}</h1><p className="mt-1 text-xs text-[#64748b]">{channel ? `#${channel.name}` : server?.name || user?.username}</p></div>
            <div className="flex gap-2"><button type="button" onClick={load} className={secondaryClass} title="Yenile"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={onClose} className={secondaryClass}><X className="h-4 w-4" /></button></div>
          </header>

          {loading && !data ? <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#60a5fa]" /></div> : null}

          {data && activeTab === 'saved' && <div className="space-y-5">
            <Card><FormTitle>Kişisel hatırlatıcı oluştur</FormTitle><div className="grid gap-2 md:grid-cols-[1fr_220px_auto]"><input className={inputClass} placeholder="Hatırlatma notu" value={reminderDraft.note} onChange={event => setReminderDraft(current => ({ ...current, note: event.target.value }))} /><input type="datetime-local" className={inputClass} value={reminderDraft.remindAt} onChange={event => setReminderDraft(current => ({ ...current, remindAt: event.target.value }))} /><button disabled={busy || !reminderDraft.note.trim()} className={primaryClass} onClick={() => run(() => createReminder({ ...reminderDraft, remindAt: new Date(reminderDraft.remindAt).toISOString() }), 'Hatırlatıcı oluşturuldu.').then(() => setReminderDraft({ note: '', remindAt: dateInputValue() }))}><AlarmClock className="h-4 w-4" />Ekle</button></div></Card>
            <div><h3 className="mb-2 text-sm font-bold text-white">Kaydedilen mesajlar</h3><div className="grid gap-2">{data.bookmarks.length ? data.bookmarks.map(item => <Card key={item.id} className="flex items-start gap-3"><Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-[#fbbf24]" /><div className="min-w-0 flex-1"><div className="flex gap-2 text-xs"><span className="font-bold text-[#93c5fd]">{item.collection}</span><span className="text-[#64748b]">{item.authorName}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-[#cbd5e1]">{item.content || 'Dosyalı mesaj'}</p>{item.note && <p className="mt-1 text-xs text-[#94a3b8]">Not: {item.note}</p>}</div><button className="p-1.5 text-[#64748b] hover:text-[#fb7185]" onClick={() => run(() => deleteSavedMessage(item.id))}><Trash2 className="h-4 w-4" /></button></Card>) : <Empty>Henüz kişisel koleksiyonunuza mesaj kaydetmediniz.</Empty>}</div></div>
            <div><h3 className="mb-2 text-sm font-bold text-white">Hatırlatıcılar</h3><div className="grid gap-2">{data.reminders.filter(item => item.status === 'pending').length ? data.reminders.filter(item => item.status === 'pending').map(item => <Card key={item.id} className="flex items-center gap-3"><AlarmClock className="h-4 w-4 text-[#a78bfa]" /><div className="flex-1"><p className="text-sm text-white">{item.note}</p><p className="text-xs text-[#64748b]">{formatDate(item.remindAt)}</p></div><button className="p-1.5 text-[#64748b] hover:text-[#fb7185]" onClick={() => run(() => cancelReminder(item.id))}><X className="h-4 w-4" /></button></Card>) : <Empty>Bekleyen hatırlatıcı yok.</Empty>}</div></div>
          </div>}

          {data && activeTab === 'scheduled' && <div className="space-y-5">
            <Card><FormTitle>Mesajı daha sonra gönder</FormTitle>{channel ? <div className="space-y-2"><textarea rows="3" className={inputClass} placeholder={`#${channel.name} kanalına gönderilecek mesaj`} value={scheduleDraft.content} onChange={event => setScheduleDraft(current => ({ ...current, content: event.target.value }))} /><div className="flex gap-2"><input type="datetime-local" className={inputClass} value={scheduleDraft.sendAt} onChange={event => setScheduleDraft(current => ({ ...current, sendAt: event.target.value }))} /><button disabled={busy || !scheduleDraft.content.trim()} className={primaryClass} onClick={() => run(() => scheduleMessage({ channelId: channel.id, content: scheduleDraft.content, sendAt: new Date(scheduleDraft.sendAt).toISOString() }), 'Mesaj zamanlandı.').then(() => setScheduleDraft({ content: '', sendAt: dateInputValue() }))}><CalendarClock className="h-4 w-4" />Zamanla</button></div></div> : <p className="text-sm text-[#94a3b8]">Mesaj zamanlamak için önce bir kanal açın.</p>}</Card>
            <div className="grid gap-2">{data.scheduledMessages.length ? data.scheduledMessages.map(item => <Card key={item.id} className="flex gap-3"><CalendarClock className={`mt-1 h-4 w-4 ${item.status === 'failed' ? 'text-[#fb7185]' : item.status === 'sent' ? 'text-[#4ade80]' : 'text-[#60a5fa]'}`} /><div className="flex-1"><p className="text-sm text-[#e2e8f0]">{item.content}</p><p className="mt-1 text-xs text-[#64748b]">{formatDate(item.sendAt)} · {item.status}</p>{item.error && <p className="text-xs text-[#fb7185]">{item.error}</p>}</div>{item.status === 'pending' && <button className="p-1.5 text-[#64748b] hover:text-[#fb7185]" onClick={() => run(() => cancelScheduledMessage(item.id))}><X className="h-4 w-4" /></button>}</Card>) : <Empty>Planlanmış mesaj yok.</Empty>}</div>
          </div>}

          {data && activeTab === 'lfg' && <div className="space-y-5">
            <Card><FormTitle>Oyun ekibi ilanı aç</FormTitle><div className="grid gap-2 md:grid-cols-2"><input className={inputClass} placeholder="Oyun (örn. Valorant)" value={lfgDraft.game} onChange={event => setLfgDraft(current => ({ ...current, game: event.target.value }))} /><input className={inputClass} placeholder="Başlık" value={lfgDraft.title} onChange={event => setLfgDraft(current => ({ ...current, title: event.target.value }))} /><input className={inputClass} placeholder="Rütbe / seviye" value={lfgDraft.rank} onChange={event => setLfgDraft(current => ({ ...current, rank: event.target.value }))} /><div className="flex gap-2"><input type="number" min="2" max="20" className={inputClass} value={lfgDraft.maxPlayers} onChange={event => setLfgDraft(current => ({ ...current, maxPlayers: event.target.value }))} /><button disabled={busy || !lfgDraft.game || !lfgDraft.title} className={primaryClass} onClick={() => run(() => createLfg({ ...lfgDraft, serverId: server.id }), 'Ekip ilanı açıldı.').then(() => setLfgDraft({ game: '', title: '', details: '', rank: '', language: 'Türkçe', maxPlayers: 5 }))}><Plus className="h-4 w-4" />Yayınla</button></div><textarea className={`${inputClass} md:col-span-2`} placeholder="Detaylar" value={lfgDraft.details} onChange={event => setLfgDraft(current => ({ ...current, details: event.target.value }))} /></div></Card>
            <div className="grid gap-3 md:grid-cols-2">{data.lfgPosts.length ? data.lfgPosts.map(post => <Card key={post.id}><div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-widest text-[#60a5fa]">{post.game}</p><h3 className="mt-1 font-bold text-white">{post.title}</h3></div><span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-[#cbd5e1]">{post.memberIds.length}/{post.maxPlayers}</span></div><p className="mt-2 text-sm text-[#94a3b8]">{post.details || 'Açıklama yok.'}</p><p className="mt-2 text-xs text-[#64748b]">{post.rank || 'Her seviye'} · {post.language} · {post.ownerName}</p><div className="mt-3 flex gap-2"><button disabled={busy || post.memberIds.includes(user.id) || post.status === 'full'} className={primaryClass} onClick={() => run(() => joinLfg(post.id), 'Ekibe katıldınız.')}>{post.status === 'full' ? 'Ekip tamamlandı' : post.memberIds.includes(user.id) ? 'Katıldınız' : 'Katıl'}</button>{post.ownerId === user.id && <button className={secondaryClass} onClick={() => run(() => closeLfg(post.id))}>Kapat</button>}</div></Card>) : <Empty>Aktif ekip ilanı yok.</Empty>}</div>
          </div>}

          {data && activeTab === 'support' && <div className="space-y-5">
            <Card><FormTitle>Özel destek talebi aç</FormTitle><div className="space-y-2"><input className={inputClass} placeholder="Konu" value={ticketDraft.subject} onChange={event => setTicketDraft(current => ({ ...current, subject: event.target.value }))} /><textarea className={inputClass} rows="3" placeholder="Sorununuzu açıklayın" value={ticketDraft.message} onChange={event => setTicketDraft(current => ({ ...current, message: event.target.value }))} /><button disabled={busy || !ticketDraft.subject || !ticketDraft.message} className={primaryClass} onClick={() => run(() => createTicket({ ...ticketDraft, serverId: server.id }), 'Destek talebi açıldı.').then(() => setTicketDraft({ subject: '', message: '' }))}><LifeBuoy className="h-4 w-4" />Talep aç</button></div></Card>
            <div className="grid gap-3">{data.tickets.length ? data.tickets.map(ticket => <Card key={ticket.id}><div className="flex items-center justify-between"><div><span className="text-xs font-bold text-[#60a5fa]">#{ticket.id.slice(0, 8)}</span><h3 className="font-bold text-white">{ticket.subject}</h3></div><span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-[#cbd5e1]">{ticket.status}</span></div><div className="mt-3 max-h-40 space-y-2 overflow-y-auto">{ticket.messages.map(message => <div key={message.id} className="rounded-lg bg-[#0f172a] px-3 py-2"><p className="text-xs font-bold text-[#93c5fd]">{message.username}</p><p className="text-sm text-[#cbd5e1]">{message.content}</p></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><button disabled={ticket.status === 'resolved'} className={secondaryClass} onClick={() => { const message = window.prompt('Yanıtınız'); if (message?.trim()) run(() => replyTicket(ticket.id, message), 'Yanıt gönderildi.'); }}>Yanıtla</button>{data.permissions?.manageTickets && <><button disabled={ticket.status === 'resolved'} className={secondaryClass} onClick={() => run(() => updateTicket(ticket.id, { assignToMe: true, status: 'pending' }), 'Talep üstlenildi.')}>Üstlen</button><button disabled={ticket.status === 'resolved'} className={secondaryClass} onClick={() => run(() => updateTicket(ticket.id, { status: 'resolved' }), 'Talep çözüldü.')}>Çözüldü</button></>}</div></Card>) : <Empty>Görüntüleyebileceğiniz destek talebi yok.</Empty>}</div>
          </div>}

          {data && activeTab === 'wiki' && <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2"><button className={`${primaryClass} w-full`} onClick={() => setWikiDraft({ id: '', title: '', content: '' })}><Plus className="h-4 w-4" />Yeni sayfa</button>{data.wikiPages.length ? data.wikiPages.map(page => <button key={page.id} className={`block w-full rounded-lg border px-3 py-3 text-left ${wikiDraft.id === page.id ? 'border-[#3b82f6] bg-[#2563eb]/10' : 'border-white/[0.07] bg-[#151d2c]'}`} onClick={() => setWikiDraft({ id: page.id, title: page.title, content: page.content })}><span className="block truncate text-sm font-bold text-white">{page.title}</span><span className="text-xs text-[#64748b]">{formatDate(page.updatedAt)}</span></button>) : <Empty>Wiki boş.</Empty>}</div>
            <Card><FormTitle>{wikiDraft.id ? 'Sayfayı düzenle' : 'Yeni wiki sayfası'}</FormTitle><div className="space-y-2"><input className={inputClass} placeholder="Başlık" value={wikiDraft.title} onChange={event => setWikiDraft(current => ({ ...current, title: event.target.value }))} /><textarea rows="16" className={`${inputClass} font-mono`} placeholder="İçerik (Markdown kullanabilirsiniz)" value={wikiDraft.content} onChange={event => setWikiDraft(current => ({ ...current, content: event.target.value }))} /><div className="flex gap-2"><button disabled={busy || !wikiDraft.title || !wikiDraft.content || (wikiDraft.id && data.wikiPages.find(page => page.id === wikiDraft.id)?.authorId !== user.id && !data.permissions?.manageWiki)} className={primaryClass} onClick={() => run(() => wikiDraft.id ? updateWikiPage(wikiDraft.id, wikiDraft) : createWikiPage({ ...wikiDraft, serverId: server.id }), 'Wiki sayfası kaydedildi.')}><BookOpen className="h-4 w-4" />Kaydet</button>{wikiDraft.id && (data.wikiPages.find(page => page.id === wikiDraft.id)?.authorId === user.id || data.permissions?.manageWiki) && <button className={secondaryClass} onClick={() => run(() => deleteWikiPage(wikiDraft.id), 'Wiki sayfası silindi.').then(() => setWikiDraft({ id: '', title: '', content: '' }))}><Trash2 className="h-4 w-4" />Sil</button>}</div></div></Card>
          </div>}

          {data && activeTab === 'whiteboard' && <div className="space-y-3"><div className="flex items-center gap-2"><span className="text-sm text-[#94a3b8]">Renk</span>{['#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#c084fc', '#ffffff'].map(color => <button key={color} aria-label={color} onClick={() => setStrokeColor(color)} className={`h-7 w-7 rounded-full border-2 ${strokeColor === color ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: color }} />)}{data.permissions?.clearWhiteboard && <button className={`${secondaryClass} ml-auto`} onClick={() => run(() => clearWhiteboard(channel.id), 'Tahta temizlendi.')}><Trash2 className="h-4 w-4" />Temizle</button>}</div><svg ref={boardRef} viewBox="0 0 1000 500" className="h-auto w-full touch-none rounded-xl border border-white/[0.1] bg-white" onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={finishDraw} onPointerCancel={() => setDrawDraft(null)}>{[...boardStrokes, ...(drawDraft ? [drawDraft] : [])].map((stroke, index) => <polyline key={stroke.id || `draft-${index}`} points={polyline(stroke)} fill="none" stroke={stroke.color} strokeWidth={stroke.width * 2} strokeLinecap="round" strokeLinejoin="round" />)}</svg><p className="text-xs text-[#64748b]">Bu kanalı görebilen üyeler aynı tahtada gerçek zamanlı çizim yapabilir.</p></div>}

          {activeTab === 'summary' && <div>{summaryLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#60a5fa]" /></div> : summary ? <div className="space-y-4"><Card><p className="text-3xl font-black text-white">{summary.messageCount}</p><p className="text-sm text-[#94a3b8]">Son 24 saatteki mesaj</p><div className="mt-3 flex flex-wrap gap-2">{summary.participants.map(person => <span key={person.username} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#cbd5e1]">{person.username} · {person.count}</span>)}</div></Card>{[['Sana yazılanlar', summary.mentions], ['Sorular', summary.questions], ['Kararlar ve planlar', summary.decisions], ['Öne çıkanlar', summary.highlights]].map(([title, items]) => <Card key={title}><FormTitle>{title}</FormTitle>{items.length ? <div className="space-y-2">{items.map(item => <button key={item.id} className="block w-full rounded-lg bg-[#0f172a] px-3 py-2 text-left" onClick={() => { onClose(); window.setTimeout(() => document.getElementById(`message-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }}><span className="text-xs font-bold text-[#93c5fd]">{item.username}</span><p className="line-clamp-2 text-sm text-[#cbd5e1]">{item.content}</p></button>)}</div> : <p className="text-sm text-[#64748b]">Bu bölümde bir şey yok.</p>}</Card>)}</div> : <Empty>Özet oluşturulamadı.</Empty>}</div>}

          {data && activeTab === 'security' && <div className="space-y-5">
            <Card><div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-white">Passkey ile giriş</h3><p className="mt-1 text-sm text-[#94a3b8]">Cihaz kilidi, parmak izi veya güvenlik anahtarıyla e-posta kodu beklemeden giriş yapın.</p></div><button disabled={busy || !window.PublicKeyCredential} className={primaryClass} onClick={() => run(() => registerPasskey(`${navigator.platform || 'Cihaz'} passkey`), 'Passkey kaydedildi.')}><KeyRound className="h-4 w-4" />Passkey ekle</button></div><div className="mt-3 space-y-2">{data.passkeys.map(item => <div key={item.id} className="flex items-center rounded-lg bg-[#0f172a] px-3 py-2"><KeyRound className="mr-3 h-4 w-4 text-[#a78bfa]" /><div className="flex-1"><p className="text-sm font-semibold text-white">{item.name}</p><p className="text-xs text-[#64748b]">{formatDate(item.createdAt)} · {item.deviceType}</p></div><button className="p-1.5 text-[#64748b] hover:text-[#fb7185]" onClick={() => run(() => deletePasskey(item.id))}><Trash2 className="h-4 w-4" /></button></div>)}</div></Card>
            <Card><div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-white">Arka plan bildirimleri</h3><p className="mt-1 text-sm text-[#94a3b8]">Web uygulaması kapalıyken DM, etiketlenme ve hatırlatıcıları alın.</p></div><button disabled={busy} className={data.pushEnabled ? secondaryClass : primaryClass} onClick={() => run(() => data.pushEnabled ? disableWebPush() : enableWebPush(data.vapidPublicKey), data.pushEnabled ? 'Arka plan bildirimleri kapatıldı.' : 'Arka plan bildirimleri açıldı.')}>{data.pushEnabled ? 'Kapat' : 'Etkinleştir'}</button></div></Card>
            <Card><FormTitle>Açık cihazlar ve oturumlar</FormTitle><div className="space-y-2">{data.sessions.length ? data.sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-lg bg-[#0f172a] px-3 py-2"><Users className="h-4 w-4 text-[#60a5fa]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{session.userAgent}</p><p className="text-xs text-[#64748b]">{session.ip} · {formatDate(session.lastSeenAt)} · {session.method}</p></div>{session.id === data.currentSessionId ? <span className="text-xs font-bold text-[#4ade80]">Bu cihaz</span> : <button className={secondaryClass} onClick={() => run(() => revokeSession(session.id), 'Oturum kapatıldı.')}>Çıkış yap</button>}</div>) : <Empty>Bu sürümden oluşturulmuş cihaz oturumu yok.</Empty>}</div></Card>
          </div>}
        </main>
      </div>
    </div>
  );
}
