import { useCallback, useEffect, useRef, useState } from 'react';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { Image as ImageIcon, Mic, SmilePlus, Square, X } from 'lucide-react';
import FileUpload, { uploadChatFile } from './FileUpload';
import GifPicker from './GifPicker';
import toast from 'react-hot-toast';

function attachmentLabel(attachment) {
  if (attachment.type === 'gif') return 'GIF';
  if (attachment.type === 'sticker') return attachment.name || 'Sticker';
  return attachment.filename || 'Dosya';
}

export default function MessageInput({
  onSendMessage,
  placeholder,
  onTypingStart,
  onTypingStop,
  replyTo,
  onCancelReply,
  disabled = false,
  draftKey,
  mentionSuggestions = [],
  serverEmojis = [],
  serverStickers = [],
  commandSuggestions = [],
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const typingRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    if (typingRef.current) onTypingStop?.();
    typingRef.current = false;
  }, [onTypingStop]);

  const refreshTypingTimer = useCallback(() => {
    if (!typingRef.current) {
      typingRef.current = true;
      onTypingStart?.();
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, 1600);
  }, [onTypingStart, stopTyping]);

  useEffect(() => () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!draftKey) {
      setMessage('');
      return;
    }

    try {
      setMessage(localStorage.getItem(`chat:draft:${draftKey}`) || '');
    } catch {
      setMessage('');
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    const storageKey = `chat:draft:${draftKey}`;
    try {
      if (message.trim()) localStorage.setItem(storageKey, message);
      else localStorage.removeItem(storageKey);
    } catch {
      // Depolama kapalıysa mesaj yazma akışı çalışmaya devam eder.
    }
  }, [draftKey, message]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const content = message.trim();
    if ((!content && attachments.length === 0) || disabled) return;

    // ZWSP, yalnızca ekli bir mesajın eski backend sürümlerinde reddedilmemesini sağlar.
    onSendMessage({
      content: content || '\u200B',
      attachments,
      replyTo: replyTo
        ? { id: replyTo.id, username: replyTo.username, content: replyTo.content }
        : null,
    });
    setMessage('');
    if (draftKey) {
      try { localStorage.removeItem(`chat:draft:${draftKey}`); } catch { /* noop */ }
    }
    setAttachments([]);
    setShowEmojiPicker(false);
    stopTyping();
    onCancelReply?.();
  };

  const handleChange = (event) => {
    const nextValue = event.target.value;
    setMessage(nextValue);
    if (nextValue.trim()) refreshTypingTimer();
    else stopTyping();
  };

  const mentionMatch = message.match(/(?:^|\s)@([^\s@]*)$/);
  const visibleMentions = mentionMatch
    ? mentionSuggestions.filter(item => (item.username || item.name || '').toLocaleLowerCase('tr-TR').startsWith(mentionMatch[1].toLocaleLowerCase('tr-TR'))).slice(0, 6)
    : [];
  const commandMatch = message.match(/^\/([^\s/]*)$/);
  const visibleCommands = commandMatch
    ? commandSuggestions.filter(item => item.enabled !== false && item.name?.toLocaleLowerCase('tr-TR').startsWith(commandMatch[1].toLocaleLowerCase('tr-TR'))).slice(0, 8)
    : [];

  const insertMention = (item) => {
    const username = item?.username || item?.name;
    if (!username || !mentionMatch) return;
    const matchStart = mentionMatch.index + mentionMatch[0].lastIndexOf('@');
    setMessage(current => `${current.slice(0, matchStart)}@${username} `);
    setMentionIndex(0);
    inputRef.current?.focus();
  };

  const insertCommand = (command) => {
    if (!command?.name) return;
    setMessage(`/${command.name} `);
    setCommandIndex(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (visibleCommands.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setCommandIndex(current => event.key === 'ArrowDown' ? (current + 1) % visibleCommands.length : (current - 1 + visibleCommands.length) % visibleCommands.length);
      return;
    }
    if (visibleCommands.length && (event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault();
      insertCommand(visibleCommands[commandIndex] || visibleCommands[0]);
      return;
    }
    if (visibleMentions.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setMentionIndex(current => event.key === 'ArrowDown' ? (current + 1) % visibleMentions.length : (current - 1 + visibleMentions.length) % visibleMentions.length);
      return;
    }
    if (visibleMentions.length && (event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault();
      insertMention(visibleMentions[mentionIndex] || visibleMentions[0]);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
    if (event.key === 'Escape') {
      setShowEmojiPicker(false);
      setShowGifPicker(false);
      if (replyTo) onCancelReply?.();
    }
  };

  const appendEmoji = (emojiData) => {
    setMessage((current) => `${current}${emojiData.emoji}`);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
    refreshTypingTimer();
  };

  const addAttachment = (attachment) => {
    setAttachments((current) => [...current, attachment]);
  };

  const toggleVoiceRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Bu cihaz ses kaydını desteklemiyor.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const recorder = new MediaRecorder(stream);
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        setIsRecording(false);
        stream.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null;
        if (!chunks.length) return;
        setIsUploadingRecording(true);
        try {
          const mime = recorder.mimeType || 'audio/webm';
          const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
          const file = new File([new Blob(chunks, { type: mime })], `sesli-mesaj-${Date.now()}.${extension}`, { type: mime });
          addAttachment(await uploadChatFile(file));
          toast.success('Sesli mesaj eklendi. Göndermek için Enter’a bas.');
        } catch (error) { toast.error(error.message); }
        finally { setIsUploadingRecording(false); }
      };
      recorder.start(250);
      setIsRecording(true);
    } catch { toast.error('Mikrofon izni verilmedi.'); }
  };

  return (
    <>
      {showGifPicker && (
        <GifPicker
          onClose={() => setShowGifPicker(false)}
          onSelectGif={addAttachment}
        />
      )}

      <div className="relative">
        {visibleCommands.length > 0 && (
          <div className="absolute bottom-[calc(100%+8px)] left-0 z-[76] w-80 overflow-hidden rounded-xl border border-white/[0.09] bg-[#151d2c] p-1.5 shadow-2xl shadow-black/40">
            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Uygulama komutları</p>
            {visibleCommands.map((command, index) => <button key={command.id || command.name} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertCommand(command)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${index === commandIndex ? 'bg-[#2563eb] text-white' : 'text-[#cbd5e1] hover:bg-white/[0.06]'}`}><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-sm font-bold">/</span><span className="min-w-0"><span className="block text-sm font-semibold">/{command.name}</span><span className={`block truncate text-[11px] ${index === commandIndex ? 'text-white/70' : 'text-[#64748b]'}`}>{command.description || 'Özel sunucu komutu'}</span></span></button>)}
          </div>
        )}
        {visibleMentions.length > 0 && (
          <div className="absolute bottom-[calc(100%+8px)] left-0 z-[75] w-72 overflow-hidden rounded-xl border border-white/[0.09] bg-[#151d2c] p-1.5 shadow-2xl shadow-black/40">
            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Üyeler</p>
            {visibleMentions.map((item, index) => {
              const username = item.username || item.name;
              return (
                <button key={item.id || item.userId || username} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertMention(item)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${index === mentionIndex ? 'bg-[#2563eb] text-white' : 'text-[#cbd5e1] hover:bg-white/[0.06]'}`}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#475569] text-xs font-bold text-white">{username?.[0]?.toUpperCase()}</span>
                  <span className="truncate">{username}</span>
                </button>
              );
            })}
          </div>
        )}
        {replyTo && (
          <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-white/[0.08] bg-[#1a2333] px-4 py-2.5 text-sm">
            <div className="min-w-0 truncate text-[#cbd5e1]">
              <span className="mr-2 font-semibold text-[#60a5fa]">{replyTo.username}</span>
              <span className="text-[#94a3b8]">{replyTo.content || 'Ekli mesaj'}</span>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Yanıtı iptal et"
              className="ml-3 rounded-md p-1 text-[#94a3b8] hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border border-b-0 border-white/[0.08] bg-[#1a2333] px-3 py-2">
            {attachments.map((attachment, index) => (
              <div key={`${attachment.url}-${index}`} className="group/attachment relative flex max-w-[220px] items-center gap-2 rounded-lg bg-[#111827] px-2 py-1.5 text-xs text-[#cbd5e1]">
                {attachment.type === 'image' || attachment.type === 'gif' ? (
                  <img src={attachment.previewUrl || attachment.url} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-[#26354b] font-semibold text-[#93c5fd]">FILE</span>
                )}
                <span className="truncate">{attachmentLabel(attachment)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  className="rounded p-0.5 text-[#94a3b8] hover:bg-white/[0.1] hover:text-white"
                  aria-label={`${attachmentLabel(attachment)} ekini kaldır`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className={`relative flex items-center border border-white/[0.07] bg-[#1e293b] px-3 py-2.5 shadow-lg shadow-black/10 transition-colors focus-within:border-[#3b82f6]/70 ${replyTo || attachments.length > 0 ? 'rounded-b-xl' : 'rounded-xl'}`}
        >
          <FileUpload onFileSelect={addAttachment} disabled={disabled} />

          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Bir emoji veya dosya düğmesine basarken yazıyor bilgisini hemen kapatma.
              window.setTimeout(stopTyping, 200);
            }}
            placeholder={placeholder || 'Mesaj gönder...'}
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent px-2 text-[15px] text-[#DBDEE1] outline-none placeholder:text-[#64748b] disabled:cursor-not-allowed"
            autoComplete="off"
            maxLength={4000}
          />

          {message.length >= 3500 && <span className={`mr-1 shrink-0 text-[10px] font-semibold ${message.length >= 3950 ? 'text-[#f87171]' : 'text-[#94a3b8]'}`}>{message.length}/4000</span>}

          <div className="ml-2 flex items-center gap-1">
            <button
              type="button"
              onClick={toggleVoiceRecording}
              disabled={disabled || isUploadingRecording}
              className={`rounded-lg p-1.5 transition-colors disabled:opacity-50 ${isRecording ? 'animate-pulse bg-[#ef4444] text-white' : 'text-[#B5BAC1] hover:bg-white/[0.08] hover:text-[#DBDEE1]'}`}
              aria-label={isRecording ? 'Ses kaydını bitir' : 'Sesli mesaj kaydet'}
              title={isRecording ? 'Kaydı bitir' : 'Sesli mesaj'}
            >
              {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowGifPicker(true);
                setShowEmojiPicker(false);
              }}
              disabled={disabled}
              className="rounded-lg p-1.5 text-[#B5BAC1] transition-colors hover:bg-white/[0.08] hover:text-[#DBDEE1] disabled:opacity-50"
              aria-label="GIF ekle"
              title="GIF ekle"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEmojiPicker((show) => !show);
                setShowGifPicker(false);
              }}
              disabled={disabled}
              className="rounded-lg p-1.5 text-[#B5BAC1] transition-colors hover:bg-white/[0.08] hover:text-[#DBDEE1] disabled:opacity-50"
              aria-label="Emoji ekle"
              title="Emoji ekle"
            >
              <SmilePlus className="h-5 w-5" />
            </button>
          </div>

          {showEmojiPicker && (
            <div className="absolute bottom-[calc(100%+10px)] right-0 z-[70] overflow-hidden rounded-xl border border-white/[0.1] bg-[#111827] shadow-2xl shadow-black/50">
              {(serverEmojis.length > 0 || serverStickers.length > 0) && <div className="max-h-32 w-[320px] overflow-y-auto border-b border-white/[0.08] p-2"><p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-[#64748b]">Sunucu içeriği</p><div className="grid grid-cols-8 gap-1">{serverEmojis.map(item => <button key={`emoji-${item.id}`} type="button" title={`:${item.name}:`} onClick={() => { setMessage(current => `${current} ![${item.name}](${item.url}) `); setShowEmojiPicker(false); inputRef.current?.focus(); }} className="rounded-lg p-1 hover:bg-white/[0.08]"><img src={item.url} alt={item.name} className="h-7 w-7 object-contain" /></button>)}{serverStickers.map(item => <button key={`sticker-${item.id}`} type="button" title={item.name} onClick={() => { addAttachment({ ...item, type: 'sticker', filename: item.name }); setShowEmojiPicker(false); }} className="rounded-lg p-1 hover:bg-white/[0.08]"><img src={item.url} alt={item.name} className="h-7 w-7 object-contain" /></button>)}</div></div>}
              <EmojiPicker
                theme="dark"
                emojiStyle={EmojiStyle.TWITTER}
                width={320}
                height={400}
                lazyLoadEmojis
                onEmojiClick={appendEmoji}
                searchPlaceholder="Emoji ara"
              />
            </div>
          )}
        </form>
      </div>
    </>
  );
}
