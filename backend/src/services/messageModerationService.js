const storage = require('../storage/inMemory');
const { emitAudit, emitToServerMembers } = require('../sockets/authorizedEmit');

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TRACKED_BUCKETS = 10000;
const TURKISH_LOCALE = 'tr-TR';
const DEFAULT_BLOCKED_WORDS = Object.freeze([
  'amk',
  'aq',
  'orospu',
  'piç',
  'siktir',
  'yarrak',
]);

let cachedPlatformService = null;

function getPlatformService() {
  if (cachedPlatformService) return cachedPlatformService;

  try {
    // platformService platform özellikleriyle birlikte eklenir. Bu modülün tek başına
    // da çalışabilmesi, eski kurulumların açılışta çökmemesini sağlar.
    const platformModule = require('./platformService');
    cachedPlatformService = platformModule.platformService || platformModule;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('platformService')) {
      console.error('Platform ayarları okunamadı:', error.message);
    }
  }

  return cachedPlatformService;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return !['false', '0', 'off', 'disabled'].includes(value.toLowerCase());
  return Boolean(value);
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function secondsToMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1000 : undefined;
}

function normalizeForComparison(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase(TURKISH_LOCALE)
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9çğıöşü]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function nestedRule(raw, type) {
  const direct = raw?.[type];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  const list = Array.isArray(raw?.rules) ? raw.rules : [];
  return list.find(rule => String(rule?.type || rule?.ruleType || '').toLowerCase() === type) || {};
}

function normalizeAction(rule, raw) {
  const action = String(firstDefined(rule.action, raw.action, raw.defaultAction, 'block')).toLowerCase();
  if (['timeout', 'mute'].includes(action)) return 'timeout';
  return action === 'warn' ? 'warn' : 'block';
}

function normalizeAutoModSettings(rawValue) {
  const raw = rawValue?.automod || rawValue?.autoMod || rawValue?.autoModeration || rawValue || {};
  const spam = nestedRule(raw, 'spam');
  const profanity = nestedRule(raw, 'profanity');
  const links = nestedRule(raw, 'links');
  const caps = nestedRule(raw, 'caps');
  const masterEnabled = asBoolean(firstDefined(raw.enabled, raw.isEnabled), Object.keys(raw).length > 0);

  const configuredBlockedWords = uniqueStrings(firstDefined(
    profanity.words,
    profanity.blockedWords,
    raw.blockedWords,
    raw.profanityWords,
  ));
  const allowedDomains = uniqueStrings(firstDefined(
    links.allowedDomains,
    links.whitelist,
    raw.allowedDomains,
    raw.linkWhitelist,
  )).map(domain => domain.toLowerCase().replace(/^www\./, ''));

  return {
    enabled: masterEnabled,
    exemptRoleIds: uniqueStrings(firstDefined(raw.exemptRoleIds, raw.exemptRoles)),
    exemptChannelIds: uniqueStrings(firstDefined(raw.exemptChannelIds, raw.exemptChannels)),
    spam: {
      enabled: masterEnabled && asBoolean(firstDefined(
        spam.enabled,
        raw.spamEnabled,
        raw.antiSpam,
        raw.antiSpamEnabled,
        raw.spamProtection,
      ), true),
      maxMessages: Math.round(clampNumber(firstDefined(
        spam.maxMessages,
        spam.limit,
        raw.maxMessagesPerInterval,
        raw.spamMessageCount,
        raw.spamMaxMessages,
      ), 6, 2, 100)),
      windowMs: Math.round(clampNumber(firstDefined(
        spam.windowMs,
        secondsToMs(spam.windowSeconds),
        secondsToMs(raw.intervalSeconds),
        secondsToMs(raw.spamIntervalSeconds),
        secondsToMs(raw.spamWindowSeconds),
      ), 8000, 1000, 60000)),
      duplicateLimit: Math.round(clampNumber(firstDefined(
        spam.duplicateLimit,
        raw.duplicateMessageLimit,
      ), 3, 2, 10)),
      action: normalizeAction(spam, raw),
      timeoutMs: Math.round(clampNumber(firstDefined(
        spam.timeoutMs,
        secondsToMs(spam.timeoutSeconds),
        secondsToMs(raw.timeoutSeconds),
        secondsToMs(Number(raw.timeoutMinutes) * 60),
      ), 5 * 60 * 1000, 10 * 1000, 28 * 24 * 60 * 60 * 1000)),
    },
    profanity: {
      enabled: masterEnabled && asBoolean(firstDefined(
        profanity.enabled,
        raw.profanityEnabled,
        raw.blockedWordsEnabled,
      ), configuredBlockedWords.length > 0),
      words: configuredBlockedWords.length ? configuredBlockedWords : [...DEFAULT_BLOCKED_WORDS],
      action: normalizeAction(profanity, raw),
      timeoutMs: Math.round(clampNumber(firstDefined(
        profanity.timeoutMs,
        secondsToMs(profanity.timeoutSeconds),
        secondsToMs(raw.timeoutSeconds),
        secondsToMs(Number(raw.timeoutMinutes) * 60),
      ), 5 * 60 * 1000, 10 * 1000, 28 * 24 * 60 * 60 * 1000)),
    },
    links: {
      enabled: masterEnabled && asBoolean(firstDefined(
        links.enabled,
        raw.linkFilter,
        raw.linksEnabled,
        raw.blockLinks,
        raw.linkFilterEnabled,
      ), false),
      blockInvites: masterEnabled && asBoolean(firstDefined(links.blockInvites, raw.blockInvites), false),
      allowedDomains,
      action: normalizeAction(links, raw),
      timeoutMs: Math.round(clampNumber(firstDefined(
        links.timeoutMs,
        secondsToMs(links.timeoutSeconds),
        secondsToMs(raw.timeoutSeconds),
        secondsToMs(Number(raw.timeoutMinutes) * 60),
      ), 5 * 60 * 1000, 10 * 1000, 28 * 24 * 60 * 60 * 1000)),
    },
    caps: {
      enabled: masterEnabled && asBoolean(firstDefined(
        caps.enabled,
        raw.capsEnabled,
        raw.capsFilterEnabled,
        raw.blockCaps,
      ), true),
      minimumLetters: Math.round(clampNumber(firstDefined(
        caps.minimumLetters,
        caps.minLength,
        raw.capsMinimumLetters,
        raw.capsMinimumLength,
      ), 18, 5, 500)),
      percentage: clampNumber(firstDefined(
        caps.percentage,
        caps.threshold,
        raw.capsThreshold,
        raw.capsPercentage,
      ), 80, 50, 100),
      action: normalizeAction(caps, raw),
      timeoutMs: Math.round(clampNumber(firstDefined(
        caps.timeoutMs,
        secondsToMs(caps.timeoutSeconds),
        secondsToMs(raw.timeoutSeconds),
        secondsToMs(Number(raw.timeoutMinutes) * 60),
      ), 5 * 60 * 1000, 10 * 1000, 28 * 24 * 60 * 60 * 1000)),
    },
    mentions: {
      enabled: masterEnabled,
      limit: Math.round(clampNumber(firstDefined(raw.mentionLimit, raw.maxMentions), 10, 1, 100)),
      action: normalizeAction(nestedRule(raw, 'mentions'), raw),
      timeoutMs: Math.round(clampNumber(firstDefined(
        nestedRule(raw, 'mentions').timeoutMs,
        secondsToMs(nestedRule(raw, 'mentions').timeoutSeconds),
        secondsToMs(raw.timeoutSeconds),
        secondsToMs(Number(raw.timeoutMinutes) * 60),
      ), 5 * 60 * 1000, 10 * 1000, 28 * 24 * 60 * 60 * 1000)),
    },
  };
}

function resolveAutoModSettings(server) {
  const platformService = getPlatformService();
  let raw = null;

  try {
    raw = platformService?.getAutomodConfig?.(server.id)
      || platformService?.getAutoModSettings?.(server.id)
      || platformService?.getServerSettings?.(server.id)?.automod
      || platformService?.getServerSettings?.(server.id)?.autoMod;
  } catch (error) {
    console.error('Otomatik moderasyon ayarları okunamadı:', error.message);
  }

  return normalizeAutoModSettings(raw || server.automod || server.autoMod || server.autoModeration);
}

function resolveChannelSettings(serverId, channel) {
  const platformService = getPlatformService();
  let settings = null;

  try {
    settings = platformService?.getChannelSettings?.(serverId, channel.id) || null;
  } catch (error) {
    console.error('Kanal ayarları okunamadı:', error.message);
  }

  const metadata = settings?.metadata || settings || channel.metadata || channel;
  return {
    slowModeSeconds: Math.round(clampNumber(firstDefined(
      metadata.slowModeSeconds,
      metadata.slowmodeSeconds,
      metadata.rateLimitPerUser,
      channel.slowModeSeconds,
      channel.slowmodeSeconds,
      channel.rateLimitPerUser,
    ), 0, 0, 21600)),
  };
}

function isUserBanned(serverId, userId) {
  const platformService = getPlatformService();
  try {
    if (typeof platformService?.isUserBanned === 'function') {
      return Boolean(platformService.isUserBanned(serverId, userId));
    }
    if (typeof platformService?.getServerBan === 'function') {
      return Boolean(platformService.getServerBan(serverId, userId));
    }
  } catch (error) {
    console.error('Sunucu yasak bilgisi okunamadı:', error.message);
  }

  const server = storage.getServerById(serverId);
  return Boolean(
    server?.bannedUserIds?.includes(userId)
    || server?.bans?.some?.(ban => (ban.userId || ban.id) === userId),
  );
}

function hasChannelPermission(channel, userId, permission) {
  const platformService = getPlatformService();
  try {
    if (typeof platformService?.hasChannelPermission === 'function') {
      return Boolean(platformService.hasChannelPermission(channel.id, userId, permission));
    }
  } catch (error) {
    console.error('Kanal izni kontrol edilemedi:', error.message);
    return false;
  }

  return storage.hasPermission(channel.serverId, userId, permission);
}

function containsBlockedWord(content, words) {
  const normalizedContent = ` ${normalizeForComparison(content)} `;
  if (normalizedContent.trim().length === 0) return false;

  return words.some(word => {
    const normalizedWord = normalizeForComparison(word);
    return normalizedWord && normalizedContent.includes(` ${normalizedWord} `);
  });
}

function extractDomains(content) {
  const matches = String(content || '').match(/(?:https?:\/\/|www\.)[^\s<>()]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?::\d{2,5})?(?:\/[^\s<>()]*)?/gi) || [];
  return matches.map(match => {
    try {
      const parsed = new URL(/^https?:\/\//i.test(match) ? match : `https://${match}`);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
}

function hasBlockedLink(content, allowedDomains) {
  return extractDomains(content).some(domain => !allowedDomains.some(allowed => (
    domain === allowed || domain.endsWith(`.${allowed}`)
  )));
}

function containsInvite(content) {
  return /(?:https?:\/\/)?(?:www\.)?tahosapp\.com\.tr\/(?:app\/\?invite=|(?:invite|davet)\/)[a-z0-9_-]+/i.test(String(content || ''));
}

function countMentions(content) {
  const matches = String(content || '').match(/(^|\s)@(?:everyone|here|[\p{L}\p{N}_.-]{1,64})/gu) || [];
  return matches.length;
}

function isMostlyCaps(content, minimumLetters, percentage) {
  const letters = String(content || '').match(/\p{L}/gu) || [];
  const casedLetters = letters.filter(letter => (
    letter.toLocaleUpperCase(TURKISH_LOCALE) !== letter.toLocaleLowerCase(TURKISH_LOCALE)
  ));
  if (casedLetters.length < minimumLetters) return false;

  const uppercaseCount = casedLetters.filter(letter => (
    letter === letter.toLocaleUpperCase(TURKISH_LOCALE)
    && letter !== letter.toLocaleLowerCase(TURKISH_LOCALE)
  )).length;
  return (uppercaseCount / casedLetters.length) * 100 >= percentage;
}

function violation(type, rule, overrides = {}) {
  const definitions = {
    spam: ['AUTOMOD_SPAM', 'Çok hızlı veya tekrarlı mesaj gönderiyorsun. Biraz bekleyip tekrar dene.'],
    profanity: ['AUTOMOD_PROFANITY', 'Bu mesaj sunucunun engellenen kelime filtresine takıldı.'],
    links: ['AUTOMOD_LINK', 'Bu kanalda izin verilmeyen bağlantılar gönderilemez.'],
    invite: ['AUTOMOD_INVITE', 'Bu sunucuda davet bağlantıları gönderilemez.'],
    caps: ['AUTOMOD_CAPS', 'Mesajın çok büyük oranda büyük harf içeriyor.'],
    mentions: ['AUTOMOD_MENTIONS', 'Mesaj çok fazla kullanıcı etiketi içeriyor.'],
  };
  const [code, message] = definitions[type];
  return {
    type,
    code,
    message,
    action: rule.action,
    timeoutMs: rule.timeoutMs,
    ...overrides,
  };
}

class MessageModerationService {
  constructor() {
    this.activityBuckets = new Map();
    this.lastAcceptedMessages = new Map();
  }

  getPlatformService() {
    return getPlatformService();
  }

  isUserBanned(serverId, userId) {
    return isUserBanned(serverId, userId);
  }

  hasChannelPermission(channel, userId, permission) {
    return hasChannelPermission(channel, userId, permission);
  }

  isExempt(server, channel, userId, settings) {
    if (storage.hasPermission(server.id, userId, 'ADMINISTRATOR')
      || this.hasChannelPermission(channel, userId, 'MANAGE_MESSAGES')) return true;

    if (!settings.exemptRoleIds.length || typeof storage.getMemberRoleIds !== 'function') return false;
    const memberRoleIds = storage.getMemberRoleIds(server.id, userId);
    return memberRoleIds.some(roleId => settings.exemptRoleIds.includes(roleId));
  }

  checkSlowMode(server, channel, userId, now = Date.now()) {
    const { slowModeSeconds } = resolveChannelSettings(server.id, channel);
    if (slowModeSeconds <= 0 || this.isExempt(server, channel, userId, { exemptRoleIds: [] })) return null;

    const key = `${server.id}:${channel.id}:${userId}`;
    const rememberedAt = this.lastAcceptedMessages.get(key);
    const persistedAt = rememberedAt === undefined
      ? storage.getChannelMessages(channel.id)
        .filter(message => message.userId === userId)
        .reduce((latest, message) => Math.max(latest, Number(message.timestamp) || 0), 0)
      : 0;
    const lastMessageAt = Math.max(rememberedAt || 0, persistedAt);
    const retryAfterMs = (lastMessageAt + (slowModeSeconds * 1000)) - now;

    if (retryAfterMs <= 0) return null;
    return {
      type: 'slowmode',
      code: 'SLOWMODE',
      message: `Yavaş mod açık. ${Math.ceil(retryAfterMs / 1000)} saniye sonra tekrar deneyebilirsin.`,
      action: 'block',
      retryAfterMs,
    };
  }

  checkSpam(server, channel, userId, content, rule, now = Date.now()) {
    if (!rule.enabled) return null;

    const key = `${server.id}:${channel.id}:${userId}`;
    const normalizedContent = normalizeForComparison(content);
    const previous = this.activityBuckets.get(key) || [];
    const recent = previous.filter(item => now - item.timestamp < rule.windowMs);
    recent.push({ timestamp: now, content: normalizedContent });
    this.activityBuckets.set(key, recent);

    if (recent.length > rule.maxMessages) {
      const oldestRelevant = recent[Math.max(0, recent.length - rule.maxMessages)];
      return violation('spam', rule, {
        retryAfterMs: Math.max(1000, rule.windowMs - (now - oldestRelevant.timestamp)),
      });
    }

    if (normalizedContent) {
      const duplicateCount = recent.filter(item => item.content === normalizedContent).length;
      if (duplicateCount >= rule.duplicateLimit) {
        return violation('spam', rule, { retryAfterMs: rule.windowMs });
      }
    }

    this.prune(now);
    return null;
  }

  inspect({ server, channel, userId, content, skipRateLimits = false, now = Date.now() }) {
    const cleanContent = String(content || '').trim();
    if (cleanContent.length > MAX_MESSAGE_LENGTH) {
      return {
        type: 'length',
        code: 'MESSAGE_TOO_LONG',
        message: `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`,
        action: 'block',
      };
    }

    if (!server || server.isDM) return null;
    const settings = resolveAutoModSettings(server);
    if (settings.exemptChannelIds.includes(channel.id) || this.isExempt(server, channel, userId, settings)) return null;

    if (!skipRateLimits) {
      const slowModeViolation = this.checkSlowMode(server, channel, userId, now);
      if (slowModeViolation) return slowModeViolation;
    }

    if (settings.enabled && cleanContent) {
      if (settings.profanity.enabled && containsBlockedWord(cleanContent, settings.profanity.words)) {
        return violation('profanity', settings.profanity);
      }
      if (settings.links.blockInvites && containsInvite(cleanContent)) {
        return violation('invite', settings.links);
      }
      if (settings.links.enabled && hasBlockedLink(cleanContent, settings.links.allowedDomains)) {
        return violation('links', settings.links);
      }
      if (settings.mentions.enabled && countMentions(cleanContent) > settings.mentions.limit) {
        return violation('mentions', settings.mentions);
      }
      if (settings.caps.enabled && isMostlyCaps(
        cleanContent,
        settings.caps.minimumLetters,
        settings.caps.percentage,
      )) {
        return violation('caps', settings.caps);
      }
      if (!skipRateLimits) {
        const spamViolation = this.checkSpam(server, channel, userId, cleanContent, settings.spam, now);
        if (spamViolation) return spamViolation;
      }
    }

    return null;
  }

  markMessageAccepted(serverId, channelId, userId, timestamp = Date.now()) {
    this.lastAcceptedMessages.set(`${serverId}:${channelId}:${userId}`, timestamp);
    this.prune(timestamp);
  }

  applyViolation(io, socket, { server, channel, userId, username }, result) {
    const now = Date.now();
    let action = ['timeout', 'warn'].includes(result.action) ? result.action : 'block';
    let timeoutUntil = null;

    if (action === 'timeout' && server && !server.isDM) {
      timeoutUntil = now + result.timeoutMs;
      const platformService = getPlatformService();
      if (typeof platformService?.setMemberTimeout === 'function') {
        platformService.setMemberTimeout(server.id, userId, {
          timeoutUntil,
          reason: result.code,
          createdBy: 'automod',
        });
      } else if (typeof storage.setMemberModerationState === 'function') {
        storage.setMemberModerationState(server.id, userId, { timeoutUntil }, 'automod');
      } else {
        action = 'block';
        timeoutUntil = null;
      }
    } else if (action !== 'warn') {
      action = 'block';
    }

    const payload = {
      serverId: server?.id || null,
      userId,
      channelId: channel?.id || null,
      action,
      ruleType: result.type,
      timeoutUntil,
      createdAt: now,
    };

    const auditAction = action === 'timeout'
      ? 'AUTOMOD_TIMEOUT'
      : (action === 'warn' ? 'AUTOMOD_WARN' : 'AUTOMOD_BLOCK');
    const baseEntry = {
      id: `automod-${now}-${Math.random().toString(36).slice(2, 10)}`,
      action: auditAction,
      actorId: 'automod',
      actorUsername: 'AutoMod',
      targetUserId: userId,
      targetUsername: username,
      channelId: channel?.id || null,
      ruleType: result.type,
      createdAt: now,
    };
    let entry = baseEntry;

    if (server && !server.isDM) {
      try {
        const persistedEntry = getPlatformService()?.addAuditLog?.(server.id, {
          action: baseEntry.action,
          actorId: 'automod',
          targetType: 'member',
          targetId: userId,
          reason: result.code,
          metadata: {
            targetUsername: username,
            channelId: channel?.id || null,
            ruleType: result.type,
            timeoutUntil,
          },
        });
        if (persistedEntry) entry = persistedEntry;
      } catch (error) {
        console.error('AutoMod denetim kaydı yazılamadı:', error.message);
      }
    }

    if (server && !server.isDM) {
      emitToServerMembers(io, server.id, 'moderation:action', payload, 'MODERATE_MEMBERS');
      emitAudit(io, server.id, entry);
      emitToServerMembers(io, server.id, 'platform:update', {
        serverId: server.id,
        scope: 'automod',
        action: 'blocked',
        data: payload,
      }, 'MANAGE_SERVER');
      if (timeoutUntil) {
        io.to(`server:${server.id}`).emit('server:members-changed', { serverId: server.id });
      }
    }

    socket.emit('message:error', {
      message: result.message,
      code: result.code,
      retryAfterMs: result.retryAfterMs,
      ruleType: result.type,
    });
    return payload;
  }

  prune(now = Date.now()) {
    if (this.activityBuckets.size > MAX_TRACKED_BUCKETS) {
      for (const [key, entries] of this.activityBuckets) {
        if (!entries.length || now - entries[entries.length - 1].timestamp > 60000) {
          this.activityBuckets.delete(key);
        }
      }
    }

    if (this.lastAcceptedMessages.size > MAX_TRACKED_BUCKETS) {
      for (const [key, timestamp] of this.lastAcceptedMessages) {
        if (now - timestamp > 6 * 60 * 60 * 1000) this.lastAcceptedMessages.delete(key);
      }
    }
  }
}

const messageModerationService = new MessageModerationService();

module.exports = {
  MAX_MESSAGE_LENGTH,
  MessageModerationService,
  messageModerationService,
  normalizeAutoModSettings,
};
