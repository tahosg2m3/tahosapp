const { v4: uuidv4 } = require('uuid');
const storage = require('../storage/inMemory'); // Storage'ı dahil ettik

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function authorAppearanceFor(userId) {
  const author = storage.getPublicUserById(userId);
  if (!author) return null;
  return {
    profileAccentColor: author.profileAccentColor,
    nameFont: author.nameFont,
    nameEffect: author.nameEffect,
  };
}

function normalizeMediaUrl(value) {
  const raw = typeof value === 'string' ? value.trim().slice(0, 2048) : '';
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return null;
    const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localDevelopmentHost) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = normalizeMediaUrl(value.url);
  if (!url) return null;
  const previewUrl = normalizeMediaUrl(value.previewUrl);
  const size = Math.min(Math.max(Number(value.size) || 0, 0), MAX_ATTACHMENT_BYTES);
  const mimetype = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(value.mimetype || ''))
    ? String(value.mimetype).slice(0, 100).toLowerCase()
    : null;
  const type = ['image', 'gif', 'sticker', 'audio', 'video', 'file'].includes(value.type)
    ? value.type
    : 'file';
  const filename = String(value.filename || value.name || 'Dosya')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 255) || 'Dosya';
  return {
    url,
    ...(previewUrl ? { previewUrl } : {}),
    filename,
    type,
    ...(mimetype ? { mimetype } : {}),
    ...(size ? { size } : {}),
  };
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ATTACHMENTS).map(normalizeAttachment).filter(Boolean);
}

// User supplied URLs are never fetched by the backend.  Networked Open Graph
// scraping permits SSRF and DNS-rebinding attacks, so the message card below
// is built entirely from locally parsed URL data.
function createSafeLinkMetadata(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return {
      title: url.hostname.replace(/^www\./i, '') || url.href,
      url: url.href,
    };
  } catch {
    return null;
  }
}

// Mesajı regex kalıbına dönüştürmeden yalnız açık HTTP(S) şemalarını tarar.
// Böylece kullanıcı girdisi regex derlemesine giremez ve çalışma süresi
// mesaj uzunluğuyla doğrusal kalır.
function findFirstSafeLinkMetadata(value) {
  const content = typeof value === 'string' ? value.slice(0, 10_000) : '';
  const lowerContent = content.toLowerCase();
  const firstHttp = lowerContent.indexOf('http://');
  const firstHttps = lowerContent.indexOf('https://');
  const firstIndexes = [firstHttp, firstHttps].filter(index => index >= 0);
  let start = firstIndexes.length ? Math.min(...firstIndexes) : -1;

  while (start >= 0 && start < content.length) {
    let end = start;
    while (end < content.length) {
      const character = content[end];
      const code = content.charCodeAt(end);
      if (code <= 32 || character === '"' || character === "'" || character === '<' || character === '>' || character === '`') break;
      end += 1;
    }

    let candidate = content.slice(start, end);
    while (candidate && '.,!?;:)]}'.includes(candidate[candidate.length - 1])) {
      candidate = candidate.slice(0, -1);
    }
    const metadata = createSafeLinkMetadata(candidate);
    if (metadata) return metadata;

    const nextHttp = lowerContent.indexOf('http://', start + 1);
    const nextHttps = lowerContent.indexOf('https://', start + 1);
    const nextIndexes = [nextHttp, nextHttps].filter(index => index >= 0);
    start = nextIndexes.length ? Math.min(...nextIndexes) : -1;
  }

  return null;
}

function normalizeVoiceMessage(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string') return null;
  const url = normalizeMediaUrl(value.url);
  const durationMs = Math.min(Math.max(Number(value.durationMs) || 0, 100), 600_000);
  if (!url || !durationMs) return null;
  const waveform = Array.isArray(value.waveform)
    ? value.waveform.slice(0, 256).map(point => Math.min(1, Math.max(0, Number(point) || 0)))
    : [];
  const mimeType = /^audio\/[a-z0-9.+-]+$/i.test(String(value.mimeType || ''))
    ? String(value.mimeType).slice(0, 100)
    : 'audio/webm';
  return { url, durationMs, waveform, mimeType };
}

class MessageService {
  // Constructor'da artık veri tutmuyoruz, storage kullanacağız.

  async createMessage({ username, content, channelId, userId, attachments = [], replyTo = null, voiceMessage = null }) {
    const safeContent = String(content || '').trim();
    if (safeContent.length > MAX_MESSAGE_LENGTH) {
      const error = new Error(`Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`);
      error.code = 'MESSAGE_TOO_LONG';
      throw error;
    }
    const safeAttachments = normalizeAttachments(attachments);
    const safeVoiceMessage = normalizeVoiceMessage(voiceMessage);
    const message = {
      id: uuidv4(),
      username,
      userId,
      authorAppearance: authorAppearanceFor(userId),
      content: safeContent,
      channelId,
      timestamp: Date.now(),
      type: safeVoiceMessage ? 'voice' : 'user',
      isEdited: false,
      metadata: null,
      attachments: safeAttachments,
      replyTo: replyTo && typeof replyTo === 'object' ? {
        id: String(replyTo.id || ''),
        username: String(replyTo.username || ''),
        content: String(replyTo.content || '').slice(0, 500),
      } : null,
      reactions: {},
      isPinned: false,
      voiceMessage: safeVoiceMessage,
      editHistory: [],
    };

    // URL yerelde ayrıştırılır; backend hiçbir kullanıcı bağlantısına istek atmaz.
    message.metadata = findFirstSafeLinkMetadata(safeContent);

    // Storage'a kaydet (Bu sayede kalıcı olur)
    storage.addChannelMessage(channelId, message);

    return message;
  }

  getChannelMessages(channelId, limit = 50, before = null) {
    // Mesajları Storage'dan çek
    const allMessages = storage.getChannelMessages(channelId);
    
    // Sıralama ve Pagination işlemleri
    const sorted = [...allMessages].sort((a, b) => a.timestamp - b.timestamp);

    let endIndex = sorted.length;
    
    if (before) {
      const foundIndex = sorted.findIndex(m => m.timestamp >= parseInt(before));
      endIndex = foundIndex === -1 ? sorted.length : foundIndex;
    }

    const startIndex = Math.max(0, endIndex - limit);
    return sorted.slice(startIndex, endIndex).map(message => ({
      ...message,
      authorAppearance: authorAppearanceFor(message.userId) || message.authorAppearance || null,
    }));
  }

  updateMessage(messageId, newContent, userId) {
    // Storage üzerinden güncelleme yap
    // (Storage içinde updateChannelMessage fonksiyonunu kullanıyoruz)
    // Önce kanal ID'sini bulmamız lazım ama şu anki yapıda messageId ile kanal bulmak zor olabilir.
    // Performans için tüm kanalları aramak yerine, storage'a channelId'yi de gönderebiliriz.
    // Ancak socket handler'da channelId zaten var.
    // Şimdilik storage.updateChannelMessage çağırırken channelId gerekiyor.
    
    // NOT: Bu fonksiyonun çağrıldığı yerde (messageHandler.js) channelId zaten gönderiliyor.
    // Burayı güncelliyoruz:
    return null; // Aşağıdaki overloaded metoda bakın
  }
  
  // Overload: channelId parametresi eklendi
  updateMessageWithChannel(channelId, messageId, newContent, userId) {
      const safeContent = String(newContent || '').trim();
      if (safeContent.length > MAX_MESSAGE_LENGTH) return null;
      const msg = storage.getChannelMessages(channelId).find(m => m.id === messageId);
      if (msg) {
          if (msg.userId !== userId) return null; // Yetki kontrolü
          
          return storage.updateChannelMessage(channelId, messageId, safeContent);
      }
      return null;
  }

  deleteMessageWithChannel(channelId, messageId, userId) {
      const msg = storage.getChannelMessages(channelId).find(m => m.id === messageId);
      if (msg) {
          if (msg.userId !== userId) return false; // Yetki kontrolü
          
          return storage.deleteChannelMessage(channelId, messageId);
      }
      return false;
  }
}

const service = new MessageService();

// updateMessage ve deleteMessage için wrapper (eski kodlarla uyum için)
service.updateMessage = (messageId, content, userId) => {
    // Bu metod eski haliyle channelId bilmediği için verimsizdir.
    // Handler'ı güncellemek daha iyi. Ama uyumluluk için tüm kanalları tarayabiliriz:
    for (const channel of storage.channels) {
        const result = service.updateMessageWithChannel(channel.id, messageId, content, userId);
        if (result) return result;
    }
    return null;
};

service.deleteMessage = (messageId, userId) => {
    for (const channel of storage.channels) {
        const result = service.deleteMessageWithChannel(channel.id, messageId, userId);
        if (result) return { channelId: channel.id, messageId };
    }
    return null;
};

module.exports = {
  MAX_MESSAGE_LENGTH,
  messageService: service,
  normalizeAttachment,
  normalizeAttachments,
  normalizeMediaUrl,
  normalizeVoiceMessage,
};
