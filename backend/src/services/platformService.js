const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage/inMemory');

const PLATFORM_STATE_VERSION = 1;
const MAX_AUDIT_LOGS_PER_SERVER = 2500;
const MAX_DAILY_STAT_DAYS = 120;
const NOTIFICATION_LEVELS = new Set(['all', 'mentions', 'nothing']);
const NOTIFICATION_OVERRIDE_LEVELS = new Set([...NOTIFICATION_LEVELS, 'inherit']);
const REPORT_STATUSES = new Set(['open', 'reviewing', 'resolved', 'dismissed']);
const EVENT_STATUSES = new Set(['scheduled', 'active', 'completed', 'cancelled']);
const RSVP_STATUSES = new Set(['interested', 'going', 'not_going']);
const OVERRIDE_TYPES = new Set(['role', 'member']);
const VERIFICATION_LEVELS = new Set(['none', 'email', 'rules', 'high']);
const STAT_METRICS = new Set([
  'membersJoined',
  'membersLeft',
  'messagesSent',
  'voiceMinutes',
  'eventsCreated',
  'reportsCreated',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maxLength = 500, fallback = '') {
  const normalized = String(value ?? '').trim();
  return (normalized || fallback).slice(0, maxLength);
}

function nullableText(value, maxLength = 500) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return text(value, maxLength);
}

function nullableMediaUrl(value) {
  const raw = nullableText(value, 1000);
  if (!raw) return null;
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function notificationLevel(value, fallback = 'all') {
  const normalized = value === 'none' ? 'nothing' : value;
  return NOTIFICATION_LEVELS.has(normalized) ? normalized : fallback;
}

function notificationOverrideLevel(value, fallback = 'inherit') {
  const normalized = value === 'none' ? 'nothing' : value;
  return NOTIFICATION_OVERRIDE_LEVELS.has(normalized) ? normalized : fallback;
}

function integer(value, minimum, maximum, fallback = minimum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function timestamp(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringList(value, { maxItems = 100, maxLength = 100 } = {}) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function idList(value, maxItems = 100) {
  return stringList(value, { maxItems, maxLength: 128 });
}

function dateKey(value = Date.now()) {
  const date = new Date(timestamp(value, Date.now()));
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function createDefaultAutoModSettings() {
  return {
    enabled: false,
    blockInvites: false,
    blockLinks: false,
    linkFilter: false,
    antiSpam: true,
    spamEnabled: true,
    maxMessagesPerInterval: 8,
    spamMessageCount: 8,
    intervalSeconds: 5,
    spamIntervalSeconds: 5,
    mentionLimit: 10,
    capsPercentage: 80,
    capsThreshold: 80,
    capsMinimumLength: 10,
    blockedWords: [],
    exemptRoleIds: [],
    exemptChannelIds: [],
    action: 'block',
    timeoutSeconds: 300,
    timeoutMinutes: 5,
  };
}

function createDefaultServerSettings() {
  return {
    verificationLevel: 'none',
    defaultNotifications: 'all',
    explicitContentFilter: 'disabled',
    preferredLocale: 'tr',
    autoMod: createDefaultAutoModSettings(),
  };
}

function createDefaultOnboarding() {
  return {
    enabled: false,
    welcomeMessage: '',
    defaultChannelIds: [],
    prompts: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function createDefaultRulesScreening() {
  return {
    enabled: false,
    requireVerifiedEmail: false,
    rules: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function createDefaultDiscovery() {
  return {
    enabled: false,
    category: null,
    description: '',
    keywords: [],
    language: 'tr',
    nsfw: false,
    updatedAt: null,
  };
}

function createDefaultStats() {
  return {
    totals: Object.fromEntries([...STAT_METRICS].map(metric => [metric, 0])),
    daily: {},
    updatedAt: null,
  };
}

function createDefaultServerPlatformState() {
  return {
    settings: createDefaultServerSettings(),
    invites: [],
    auditLogs: [],
    bans: [],
    reports: [],
    timeouts: [],
    onboarding: createDefaultOnboarding(),
    rulesScreening: createDefaultRulesScreening(),
    memberVerifications: {},
    events: [],
    forumTags: [],
    forumPosts: [],
    threads: [],
    polls: [],
    discovery: createDefaultDiscovery(),
    stats: createDefaultStats(),
    webhooks: [],
    slashCommands: [],
    emojis: [],
    stickers: [],
    announcementFollows: [],
    trash: [],
    channels: {},
  };
}

function normalizeAutoModSettings(current, updates = {}) {
  const base = { ...createDefaultAutoModSettings(), ...(isRecord(current) ? current : {}) };
  const action = ['block', 'warn', 'timeout'].includes(updates.action) ? updates.action : base.action;
  const spamEnabled = updates.spamEnabled !== undefined
    ? Boolean(updates.spamEnabled)
    : (updates.antiSpam !== undefined ? Boolean(updates.antiSpam) : Boolean(base.spamEnabled ?? base.antiSpam));
  const linkFilter = updates.linkFilter !== undefined
    ? Boolean(updates.linkFilter)
    : (updates.blockLinks !== undefined ? Boolean(updates.blockLinks) : Boolean(base.linkFilter ?? base.blockLinks));
  const capsThreshold = updates.capsThreshold !== undefined
    ? integer(updates.capsThreshold, 1, 100, 80)
    : (updates.capsPercentage !== undefined
      ? integer(updates.capsPercentage, 1, 100, 80)
      : integer(base.capsThreshold ?? base.capsPercentage, 1, 100, 80));
  const maxMessagesPerInterval = integer(
    updates.maxMessagesPerInterval ?? updates.spamMessageCount ?? base.maxMessagesPerInterval ?? base.spamMessageCount,
    2,
    100,
    8,
  );
  const intervalSeconds = integer(
    updates.intervalSeconds ?? updates.spamIntervalSeconds ?? base.intervalSeconds ?? base.spamIntervalSeconds,
    1,
    60,
    5,
  );
  const timeoutSeconds = updates.timeoutMinutes !== undefined
    ? integer(updates.timeoutMinutes, 1, 40_320, 5) * 60
    : integer(updates.timeoutSeconds ?? base.timeoutSeconds, 10, 2_419_200, 300);
  return {
    enabled: updates.enabled === undefined ? Boolean(base.enabled) : Boolean(updates.enabled),
    blockInvites: updates.blockInvites === undefined ? Boolean(base.blockInvites) : Boolean(updates.blockInvites),
    blockLinks: linkFilter,
    linkFilter,
    antiSpam: spamEnabled,
    spamEnabled,
    maxMessagesPerInterval,
    spamMessageCount: maxMessagesPerInterval,
    intervalSeconds,
    spamIntervalSeconds: intervalSeconds,
    mentionLimit: updates.mentionLimit === undefined
      ? integer(base.mentionLimit, 1, 100, 10)
      : integer(updates.mentionLimit, 1, 100, 10),
    capsPercentage: capsThreshold,
    capsThreshold,
    capsMinimumLength: integer(updates.capsMinimumLength ?? base.capsMinimumLength, 1, 1000, 10),
    blockedWords: updates.blockedWords === undefined
      ? stringList(base.blockedWords, { maxItems: 500, maxLength: 100 })
      : stringList(updates.blockedWords, { maxItems: 500, maxLength: 100 }),
    exemptRoleIds: updates.exemptRoleIds === undefined ? idList(base.exemptRoleIds) : idList(updates.exemptRoleIds),
    exemptChannelIds: updates.exemptChannelIds === undefined ? idList(base.exemptChannelIds) : idList(updates.exemptChannelIds),
    action,
    timeoutSeconds,
    timeoutMinutes: Math.ceil(timeoutSeconds / 60),
  };
}

function publicWebhook(webhook) {
  if (!webhook) return null;
  const { tokenHash, ...safe } = webhook;
  return clone(safe);
}

function timingSafeHexEquals(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(first) || !/^[a-f0-9]{64}$/i.test(second)) return false;
  const expected = Buffer.from(first, 'hex');
  const supplied = Buffer.from(second, 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function publicPoll(poll, userId = null, includeVoters = false) {
  if (!poll) return null;
  const result = clone(poll);
  result.options = result.options.map(option => {
    const voters = Array.isArray(option.voterIds) ? option.voterIds : [];
    const output = {
      id: option.id,
      text: option.text,
      votes: voters.length,
      voted: Boolean(userId && voters.includes(userId)),
    };
    if (includeVoters) output.voterIds = voters;
    return output;
  });
  result.totalVotes = result.options.reduce((sum, option) => sum + option.votes, 0);
  return result;
}

class PlatformService {
  constructor(storageInstance = storage) {
    this.storage = storageInstance;
    this.ensureRootState();
  }

  ensureRootState() {
    const current = isRecord(this.storage.platformState) ? this.storage.platformState : {};
    this.storage.platformState = {
      ...current,
      version: PLATFORM_STATE_VERSION,
      servers: isRecord(current.servers) ? current.servers : {},
      notificationPreferences: isRecord(current.notificationPreferences) ? current.notificationPreferences : {},
      templates: Array.isArray(current.templates) ? current.templates : [],
      backups: Array.isArray(current.backups) ? current.backups : [],
    };
    return this.storage.platformState;
  }

  ensureServerState(serverId) {
    const normalizedServerId = text(serverId, 128);
    if (!normalizedServerId) return null;
    const root = this.ensureRootState();
    const defaults = createDefaultServerPlatformState();
    const existing = isRecord(root.servers[normalizedServerId]) ? root.servers[normalizedServerId] : {};

    const state = { ...defaults, ...existing };
    Object.keys(defaults).forEach(key => {
      if (Array.isArray(defaults[key])) state[key] = Array.isArray(existing[key]) ? existing[key] : [];
    });
    state.settings = {
      ...defaults.settings,
      ...(isRecord(existing.settings) ? existing.settings : {}),
      autoMod: normalizeAutoModSettings(existing.settings?.autoMod),
    };
    state.onboarding = { ...defaults.onboarding, ...(isRecord(existing.onboarding) ? existing.onboarding : {}) };
    state.rulesScreening = {
      ...defaults.rulesScreening,
      ...(isRecord(existing.rulesScreening) ? existing.rulesScreening : {}),
    };
    state.memberVerifications = isRecord(existing.memberVerifications) ? existing.memberVerifications : {};
    state.discovery = { ...defaults.discovery, ...(isRecord(existing.discovery) ? existing.discovery : {}) };
    state.stats = {
      ...defaults.stats,
      ...(isRecord(existing.stats) ? existing.stats : {}),
      totals: { ...defaults.stats.totals, ...(isRecord(existing.stats?.totals) ? existing.stats.totals : {}) },
      daily: isRecord(existing.stats?.daily) ? existing.stats.daily : {},
    };
    state.channels = isRecord(existing.channels) ? existing.channels : {};
    root.servers[normalizedServerId] = state;
    return state;
  }

  save() {
    this.storage.saveData();
  }

  deleteServerData(serverId) {
    const root = this.ensureRootState();
    const normalizedServerId = text(serverId, 128);
    if (!normalizedServerId || !root.servers[normalizedServerId]) return false;
    delete root.servers[normalizedServerId];
    Object.values(root.servers).forEach(state => {
      state.announcementFollows = (state.announcementFollows || []).filter(follow => (
        follow.sourceServerId !== normalizedServerId && follow.targetServerId !== normalizedServerId
      ));
    });
    this.save();
    return true;
  }

  deleteChannelData(channelId) {
    const channel = this.storage.getChannelById(channelId);
    if (channel) {
      const state = this.ensureServerState(channel.serverId);
      if (state.channels[channel.id]) delete state.channels[channel.id];
      state.events = state.events.filter(event => event.channelId !== channel.id);
      state.forumTags = state.forumTags.filter(tag => tag.channelId !== channel.id);
      state.forumPosts = state.forumPosts.filter(post => post.channelId !== channel.id);
      state.threads = state.threads.filter(thread => thread.channelId !== channel.id);
      state.polls = state.polls.filter(poll => poll.channelId !== channel.id);
      state.webhooks = state.webhooks.filter(webhook => webhook.channelId !== channel.id);
      Object.values(this.ensureRootState().servers).forEach(serverState => {
        serverState.announcementFollows = (serverState.announcementFollows || []).filter(follow => (
          follow.sourceChannelId !== channel.id && follow.targetChannelId !== channel.id
        ));
      });
      this.save();
      return true;
    }

    let changed = false;
    Object.values(this.ensureRootState().servers).forEach(state => {
      if (isRecord(state?.channels) && state.channels[channelId]) {
        delete state.channels[channelId];
        changed = true;
      }
    });
    if (changed) this.save();
    return changed;
  }

  trashChannel(channelId, deletedBy = null) {
    const channel = this.storage.getChannelById(channelId);
    if (!channel || this.storage.getServerById(channel.serverId)?.isDM) return null;
    const metadata = clone(this.getChannelMetadata(channel.id) || {});
    const permissionOverrides = this.listChannelPermissionOverrides(channel.id);
    const featureState = this.ensureServerState(channel.serverId);
    const now = Date.now();
    const item = {
      id: uuidv4(),
      type: 'channel',
      serverId: channel.serverId,
      deletedBy: nullableText(deletedBy, 128),
      deletedAt: now,
      expiresAt: now + (7 * 24 * 60 * 60 * 1000),
      snapshot: {
        channel: clone(channel),
        metadata,
        permissionOverrides,
        // Storage already bounds a channel to 500 regular messages; retain all
        // messages that still exist instead of silently applying a second cap.
        messages: clone(this.storage.getChannelMessages(channel.id) || []),
        features: {
          forumTags: clone((featureState.forumTags || []).filter(tag => tag.channelId === channel.id)),
          forumPosts: clone((featureState.forumPosts || []).filter(post => post.channelId === channel.id)),
          threads: clone((featureState.threads || []).filter(thread => thread.channelId === channel.id)),
          polls: clone((featureState.polls || []).filter(poll => poll.channelId === channel.id)),
          events: clone((featureState.events || []).filter(event => event.channelId === channel.id)),
        },
      },
    };
    const state = this.ensureServerState(channel.serverId);
    state.trash = (state.trash || []).filter(entry => Number(entry.expiresAt) > now);
    state.trash.push(item);
    if (state.trash.length > 100) state.trash = state.trash.slice(-100);
    this.save();
    return this.publicTrashItem(item);
  }

  publicTrashItem(item) {
    if (!item) return null;
    return clone({
      id: item.id,
      type: item.type,
      serverId: item.serverId,
      deletedBy: item.deletedBy,
      deletedAt: item.deletedAt,
      expiresAt: item.expiresAt,
      channel: item.snapshot?.channel ? {
        id: item.snapshot.channel.id,
        name: item.snapshot.channel.name,
        type: item.snapshot.channel.type,
      } : null,
      messageCount: item.snapshot?.messages?.length || 0,
      forumPostCount: item.snapshot?.features?.forumPosts?.length || 0,
      threadCount: item.snapshot?.features?.threads?.length || 0,
      pollCount: item.snapshot?.features?.polls?.length || 0,
    });
  }

  listTrash(serverId) {
    const state = this.ensureServerState(serverId);
    if (!state) return [];
    const now = Date.now();
    const current = state.trash || [];
    state.trash = current.filter(item => Number(item.expiresAt) > now);
    if (state.trash.length !== current.length) this.save();
    return state.trash
      .sort((first, second) => second.deletedAt - first.deletedAt)
      .map(item => this.publicTrashItem(item));
  }

  restoreTrash(serverId, trashId) {
    const state = this.ensureServerState(serverId);
    const index = state?.trash?.findIndex(item => item.id === String(trashId)) ?? -1;
    if (index === -1) return null;
    const item = state.trash[index];
    if (Number(item.expiresAt) <= Date.now() || item.type !== 'channel' || !item.snapshot?.channel) {
      state.trash.splice(index, 1);
      this.save();
      return null;
    }
    const source = item.snapshot.channel;
    if (this.storage.getChannelById(source.id)) return null;
    const restored = this.storage.createChannel(serverId, text(source.name, 100, 'restored-channel'), source.type);
    if (!restored) return null;
    if (source.temporary !== undefined) restored.temporary = Boolean(source.temporary);
    this.updateChannelMetadata(restored.id, item.snapshot.metadata || {});
    (item.snapshot.permissionOverrides || []).forEach(override => {
      this.setChannelPermissionOverride(restored.id, {
        ...override,
        overrideId: undefined,
        updatedBy: null,
      });
    });
    const messages = (item.snapshot.messages || []).map(message => ({
      ...clone(message),
      channelId: restored.id,
    }));
    if (this.storage.channelMessages instanceof Map && messages.length) {
      this.storage.channelMessages.set(restored.id, messages);
    }
    const features = isRecord(item.snapshot.features) ? item.snapshot.features : {};
    const tagSources = Array.isArray(features.forumTags) ? features.forumTags : [];
    const postSources = Array.isArray(features.forumPosts) ? features.forumPosts : [];
    const threadSources = Array.isArray(features.threads) ? features.threads : [];
    const pollSources = Array.isArray(features.polls) ? features.polls : [];
    const eventSources = Array.isArray(features.events) ? features.events : [];
    const tagIds = new Map(tagSources.map(tag => [tag.id, uuidv4()]));
    const postIds = new Map(postSources.map(post => [post.id, uuidv4()]));
    const threadIds = new Map(threadSources.map(thread => [thread.id, uuidv4()]));
    const isCurrentMember = userId => (
      typeof this.storage.isServerMember !== 'function'
      || this.storage.isServerMember(serverId, userId)
    );

    const restoredTags = tagSources.map(tag => ({
      ...clone(tag),
      id: tagIds.get(tag.id),
      serverId,
      channelId: restored.id,
    }));
    const restoredPosts = postSources.map(post => ({
      ...clone(post),
      id: postIds.get(post.id),
      serverId,
      channelId: restored.id,
      threadId: threadIds.get(post.threadId) || null,
      tagIds: (post.tagIds || []).map(id => tagIds.get(id)).filter(Boolean),
    }));
    const restoredThreads = threadSources.map(thread => ({
      ...clone(thread),
      id: threadIds.get(thread.id),
      serverId,
      channelId: restored.id,
      forumPostId: postIds.get(thread.forumPostId) || null,
      memberIds: (thread.memberIds || []).filter(isCurrentMember),
      messages: (thread.messages || []).map(message => ({ ...clone(message), id: uuidv4() })),
    }));
    const restoredPolls = pollSources.map(poll => ({
      ...clone(poll),
      id: uuidv4(),
      serverId,
      channelId: restored.id,
      options: (poll.options || []).map(option => ({
        ...clone(option),
        id: uuidv4(),
        voterIds: (option.voterIds || []).filter(isCurrentMember),
      })),
    }));
    const restoredEvents = eventSources.map(event => ({
      ...clone(event),
      id: uuidv4(),
      serverId,
      channelId: restored.id,
      rsvps: Object.fromEntries(Object.entries(isRecord(event.rsvps) ? event.rsvps : {})
        .filter(([userId]) => isCurrentMember(userId))),
    }));
    state.forumTags.push(...restoredTags);
    state.forumPosts.push(...restoredPosts);
    state.threads.push(...restoredThreads);
    state.polls.push(...restoredPolls);
    state.events.push(...restoredEvents);
    state.trash.splice(index, 1);
    this.save();
    return {
      trashId: item.id,
      channel: { ...clone(restored), ...(this.getChannelMetadata(restored.id) || {}) },
      restoredMessages: messages.length,
      restoredFeatures: {
        forumTags: restoredTags.length,
        forumPosts: restoredPosts.length,
        threads: restoredThreads.length,
        polls: restoredPolls.length,
        events: restoredEvents.length,
      },
    };
  }

  purgeTrash(serverId, trashId) {
    const state = this.ensureServerState(serverId);
    const index = state?.trash?.findIndex(item => item.id === String(trashId)) ?? -1;
    if (index === -1) return false;
    state.trash.splice(index, 1);
    this.save();
    return true;
  }

  getServerSettings(serverId) {
    return clone(this.ensureServerState(serverId)?.settings || createDefaultServerSettings());
  }

  updateServerSettings(serverId, updates = {}) {
    const state = this.ensureServerState(serverId);
    if (!state || !isRecord(updates)) return null;
    const current = state.settings;
    if (updates.verificationLevel !== undefined && VERIFICATION_LEVELS.has(updates.verificationLevel)) {
      current.verificationLevel = updates.verificationLevel;
    }
    if (updates.defaultNotifications !== undefined) {
      current.defaultNotifications = notificationLevel(updates.defaultNotifications, current.defaultNotifications);
    }
    if (updates.explicitContentFilter !== undefined && ['disabled', 'members', 'all'].includes(updates.explicitContentFilter)) {
      current.explicitContentFilter = updates.explicitContentFilter;
    }
    if (updates.preferredLocale !== undefined) current.preferredLocale = text(updates.preferredLocale, 10, 'tr');
    if (isRecord(updates.autoMod)) current.autoMod = normalizeAutoModSettings(current.autoMod, updates.autoMod);
    current.updatedAt = Date.now();
    this.save();
    return clone(current);
  }

  getAutoModSettings(serverId) {
    return clone(this.ensureServerState(serverId)?.settings.autoMod || createDefaultAutoModSettings());
  }

  updateAutoModSettings(serverId, updates = {}) {
    const state = this.ensureServerState(serverId);
    if (!state || !isRecord(updates)) return null;
    state.settings.autoMod = normalizeAutoModSettings(state.settings.autoMod, updates);
    state.settings.updatedAt = Date.now();
    this.save();
    return clone(state.settings.autoMod);
  }

  createInvite(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const state = this.ensureServerState(serverId);
    if (!state) return null;
    let code = text(input.code, 32).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!code) code = crypto.randomBytes(8).toString('base64url');
    if (this.getInviteByCode(code)) return null;
    const now = Date.now();
    const maxAgeSeconds = input.maxAgeSeconds === undefined
      ? null
      : integer(input.maxAgeSeconds, 0, 31_536_000, 0);
    const invite = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      code,
      channelId: nullableText(input.channelId, 128),
      createdBy: nullableText(input.createdBy, 128),
      createdAt: now,
      expiresAt: timestamp(input.expiresAt) || (maxAgeSeconds ? now + (maxAgeSeconds * 1000) : null),
      maxUses: integer(input.maxUses, 0, 1_000_000, 0),
      uses: 0,
      temporary: Boolean(input.temporary),
      revokedAt: null,
      revokedBy: null,
      usage: [],
    };
    if (invite.expiresAt && invite.expiresAt <= now) return null;
    state.invites.push(invite);
    this.save();
    return clone(invite);
  }

  listInvites(serverId, { includeExpired = true, includeRevoked = true } = {}) {
    const now = Date.now();
    return clone((this.ensureServerState(serverId)?.invites || []).filter(invite => (
      (includeExpired || !invite.expiresAt || invite.expiresAt > now)
      && (includeRevoked || !invite.revokedAt)
    )));
  }

  getInvite(serverId, idOrCode) {
    const key = text(idOrCode, 128);
    const invite = this.ensureServerState(serverId)?.invites.find(item => item.id === key || item.code === key);
    return clone(invite || null);
  }

  getInviteByCode(code) {
    const normalized = text(code, 128);
    if (!normalized) return null;
    for (const [serverId, state] of Object.entries(this.ensureRootState().servers)) {
      const invite = Array.isArray(state?.invites) ? state.invites.find(item => item.code === normalized) : null;
      if (invite) return clone({ ...invite, serverId: invite.serverId || serverId });
    }
    return null;
  }

  useInvite(code, userId = null) {
    const normalized = text(code, 128);
    const now = Date.now();
    for (const [serverId, state] of Object.entries(this.ensureRootState().servers)) {
      const invite = Array.isArray(state?.invites) ? state.invites.find(item => item.code === normalized) : null;
      if (!invite) continue;
      if (invite.revokedAt || (invite.expiresAt && invite.expiresAt <= now)) return null;
      if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return null;
      if (userId && this.isUserBanned(serverId, userId)) return null;
      invite.uses = integer(invite.uses, 0, 1_000_000_000, 0) + 1;
      invite.usage = Array.isArray(invite.usage) ? invite.usage : [];
      invite.usage.push({ userId: nullableText(userId, 128), usedAt: now });
      if (invite.usage.length > 1000) invite.usage = invite.usage.slice(-1000);
      this.save();
      return clone({ ...invite, serverId });
    }
    return null;
  }

  revokeInvite(serverId, idOrCode, revokedBy = null) {
    const state = this.ensureServerState(serverId);
    const key = text(idOrCode, 128);
    const invite = state?.invites.find(item => item.id === key || item.code === key);
    if (!invite || invite.revokedAt) return null;
    invite.revokedAt = Date.now();
    invite.revokedBy = nullableText(revokedBy, 128);
    this.save();
    return clone(invite);
  }

  addAuditLog(serverId, input = {}) {
    const state = this.ensureServerState(serverId);
    const action = text(input.action, 100);
    if (!state || !action) return null;
    const entry = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      action,
      actorId: nullableText(input.actorId, 128),
      targetType: nullableText(input.targetType, 50),
      targetId: nullableText(input.targetId, 128),
      reason: nullableText(input.reason, 500),
      changes: Array.isArray(input.changes) ? clone(input.changes.slice(0, 100)) : [],
      metadata: isRecord(input.metadata) ? clone(input.metadata) : {},
      createdAt: Date.now(),
    };
    state.auditLogs.push(entry);
    if (state.auditLogs.length > MAX_AUDIT_LOGS_PER_SERVER) {
      state.auditLogs = state.auditLogs.slice(-MAX_AUDIT_LOGS_PER_SERVER);
    }
    this.save();
    return clone(entry);
  }

  listAuditLogs(serverId, filters = {}) {
    const limit = integer(filters.limit, 1, 200, 50);
    const before = timestamp(filters.before);
    const after = timestamp(filters.after);
    return clone((this.ensureServerState(serverId)?.auditLogs || [])
      .filter(entry => !filters.action || entry.action === filters.action)
      .filter(entry => !filters.actorId || entry.actorId === filters.actorId)
      .filter(entry => !filters.targetId || entry.targetId === filters.targetId)
      .filter(entry => !before || entry.createdAt < before)
      .filter(entry => !after || entry.createdAt > after)
      .sort((first, second) => second.createdAt - first.createdAt)
      .slice(0, limit));
  }

  createBan(serverId, input = {}) {
    const state = this.ensureServerState(serverId);
    const userId = text(input.userId, 128);
    if (!state || !userId || state.bans.some(ban => ban.userId === userId && !ban.removedAt)) return null;
    const ban = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      userId,
      reason: nullableText(input.reason, 500),
      createdBy: nullableText(input.createdBy ?? input.actorId, 128),
      createdAt: Date.now(),
      expiresAt: timestamp(input.expiresAt),
      deleteMessageSeconds: integer(input.deleteMessageSeconds, 0, 604_800, 0),
      removedAt: null,
      removedBy: null,
    };
    state.bans.push(ban);
    this.save();
    return clone(ban);
  }

  listBans(serverId, { includeRemoved = false, includeExpired = false } = {}) {
    const now = Date.now();
    return clone((this.ensureServerState(serverId)?.bans || []).filter(ban => (
      (includeRemoved || !ban.removedAt) && (includeExpired || !ban.expiresAt || ban.expiresAt > now)
    )));
  }

  getServerBan(serverId, userId) {
    const now = Date.now();
    const ban = (this.ensureServerState(serverId)?.bans || [])
      .find(item => item.userId === String(userId) && !item.removedAt && (!item.expiresAt || item.expiresAt > now));
    return clone(ban || null);
  }

  isUserBanned(serverId, userId) {
    return Boolean(this.getServerBan(serverId, userId));
  }

  removeBan(serverId, userId, removedBy = null) {
    const state = this.ensureServerState(serverId);
    const ban = state?.bans.find(item => item.userId === String(userId) && !item.removedAt);
    if (!ban) return null;
    ban.removedAt = Date.now();
    ban.removedBy = nullableText(removedBy, 128);
    this.save();
    return clone(ban);
  }

  createReport(serverId, reporterIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(reporterIdOrInput)
      ? reporterIdOrInput
      : { ...suppliedInput, reporterId: suppliedInput.reporterId || reporterIdOrInput };
    const state = this.ensureServerState(serverId);
    const reporterId = text(input.reporterId, 128);
    const reason = text(input.reason, 1000);
    if (!state || !reporterId || !reason) return null;
    const report = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      reporterId,
      targetUserId: nullableText(input.targetUserId, 128),
      channelId: nullableText(input.channelId, 128),
      messageId: nullableText(input.messageId, 128),
      category: text(input.category, 50, 'other'),
      reason,
      evidence: Array.isArray(input.evidence) ? clone(input.evidence.slice(0, 20)) : [],
      status: 'open',
      resolution: null,
      assignedTo: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.reports.push(report);
    this.recordServerStat(serverId, 'reportsCreated', 1);
    return clone(report);
  }

  getReport(serverId, reportId) {
    return clone(this.ensureServerState(serverId)?.reports.find(report => report.id === String(reportId)) || null);
  }

  listReports(serverId, filters = {}) {
    const limit = integer(filters.limit, 1, 200, 50);
    return clone((this.ensureServerState(serverId)?.reports || [])
      .filter(report => !filters.status || report.status === filters.status)
      .filter(report => !filters.reporterId || report.reporterId === filters.reporterId)
      .filter(report => !filters.targetUserId || report.targetUserId === filters.targetUserId)
      .sort((first, second) => second.createdAt - first.createdAt)
      .slice(0, limit));
  }

  updateReport(serverId, reportId, updates = {}) {
    const state = this.ensureServerState(serverId);
    const report = state?.reports.find(item => item.id === String(reportId));
    if (!report || !isRecord(updates)) return null;
    if (updates.status !== undefined && REPORT_STATUSES.has(updates.status)) report.status = updates.status;
    if (updates.resolution !== undefined) report.resolution = nullableText(updates.resolution, 1000);
    if (updates.assignedTo !== undefined || updates.moderatorId !== undefined) {
      report.assignedTo = nullableText(updates.assignedTo ?? updates.moderatorId, 128);
    }
    report.updatedAt = Date.now();
    this.save();
    return clone(report);
  }

  deleteReport(serverId, reportId) {
    const state = this.ensureServerState(serverId);
    if (!state) return false;
    const index = state.reports.findIndex(report => report.id === String(reportId));
    if (index === -1) return false;
    state.reports.splice(index, 1);
    this.save();
    return true;
  }

  setMemberTimeout(serverId, userId, input = {}) {
    const state = this.ensureServerState(serverId);
    const normalizedUserId = text(userId, 128);
    const until = timestamp(input.until || input.timeoutUntil);
    if (!state || !normalizedUserId || !until || until <= Date.now()) return null;
    state.timeouts = state.timeouts.filter(item => item.userId !== normalizedUserId || item.clearedAt);
    const timeoutRecord = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      userId: normalizedUserId,
      until,
      reason: nullableText(input.reason, 500),
      createdBy: nullableText(input.createdBy, 128),
      createdAt: Date.now(),
      clearedAt: null,
      clearedBy: null,
    };
    state.timeouts.push(timeoutRecord);
    if (typeof this.storage.setMemberModerationState === 'function') {
      this.storage.setMemberModerationState(serverId, normalizedUserId, { timeoutUntil: until }, input.createdBy || null);
    }
    this.save();
    return clone(timeoutRecord);
  }

  getMemberTimeout(serverId, userId) {
    const now = Date.now();
    const record = (this.ensureServerState(serverId)?.timeouts || [])
      .find(item => item.userId === String(userId) && !item.clearedAt && item.until > now);
    return clone(record || null);
  }

  isMemberTimedOut(serverId, userId) {
    return Boolean(this.getMemberTimeout(serverId, userId) || this.storage.isMemberTimedOut?.(serverId, userId));
  }

  listTimeouts(serverId, { activeOnly = true } = {}) {
    const now = Date.now();
    return clone((this.ensureServerState(serverId)?.timeouts || []).filter(item => (
      !activeOnly || (!item.clearedAt && item.until > now)
    )));
  }

  clearMemberTimeout(serverId, userId, clearedBy = null) {
    const state = this.ensureServerState(serverId);
    const record = state?.timeouts.find(item => item.userId === String(userId) && !item.clearedAt);
    if (!record) return null;
    record.clearedAt = Date.now();
    record.clearedBy = nullableText(clearedBy, 128);
    if (typeof this.storage.setMemberModerationState === 'function') {
      this.storage.setMemberModerationState(serverId, String(userId), { timeoutUntil: null }, clearedBy);
    }
    this.save();
    return clone(record);
  }

  getOnboarding(serverId) {
    const state = this.ensureServerState(serverId);
    return clone({
      ...(state?.onboarding || createDefaultOnboarding()),
      rulesScreening: state?.rulesScreening || createDefaultRulesScreening(),
      rules: state?.rulesScreening?.rules || [],
      questions: state?.onboarding?.prompts || [],
      verificationLevel: state?.settings?.verificationLevel || 'none',
    });
  }

  updateOnboarding(serverId, updates = {}, updatedBy = null) {
    const state = this.ensureServerState(serverId);
    if (!state || !isRecord(updates)) return null;
    const current = state.onboarding;
    if (updates.enabled !== undefined) current.enabled = Boolean(updates.enabled);
    if (updates.welcomeMessage !== undefined) current.welcomeMessage = text(updates.welcomeMessage, 1000);
    if (updates.defaultChannelIds !== undefined) current.defaultChannelIds = idList(updates.defaultChannelIds, 25);
    const prompts = updates.prompts ?? updates.questions;
    if (prompts !== undefined && Array.isArray(prompts)) {
      current.prompts = prompts.slice(0, 20).map(prompt => ({
        id: text(prompt.id, 128) || uuidv4(),
        title: text(prompt.title ?? prompt.question, 100),
        required: Boolean(prompt.required),
        multiple: Boolean(prompt.multiple),
        options: Array.isArray(prompt.options) ? prompt.options.slice(0, 20).map(option => ({
          id: text(option.id, 128) || uuidv4(),
          title: text(option.title, 100),
          description: text(option.description, 300),
          channelIds: idList(option.channelIds, 20),
          roleIds: idList(option.roleIds, 20),
        })) : [],
      })).filter(prompt => prompt.title);
    }
    current.updatedAt = Date.now();
    current.updatedBy = nullableText(updatedBy || updates.updatedBy, 128);
    if (Array.isArray(updates.rules)) {
      state.rulesScreening.rules = updates.rules.slice(0, 50).map(rule => ({
        id: text(rule?.id, 128) || uuidv4(),
        title: text(rule?.title, 100),
        description: text(rule?.description ?? (typeof rule === 'string' ? rule : ''), 1000),
      })).filter(rule => rule.title || rule.description);
      state.rulesScreening.enabled = Boolean(state.rulesScreening.rules.length);
      state.rulesScreening.updatedAt = Date.now();
      state.rulesScreening.updatedBy = current.updatedBy;
    }
    if (updates.verificationLevel !== undefined && VERIFICATION_LEVELS.has(updates.verificationLevel)) {
      state.settings.verificationLevel = updates.verificationLevel;
    }
    this.save();
    return this.getOnboarding(serverId);
  }

  getRulesScreening(serverId) {
    return clone(this.ensureServerState(serverId)?.rulesScreening || createDefaultRulesScreening());
  }

  updateRulesScreening(serverId, updates = {}, updatedBy = null) {
    const state = this.ensureServerState(serverId);
    if (!state || !isRecord(updates)) return null;
    const current = state.rulesScreening;
    if (updates.enabled !== undefined) current.enabled = Boolean(updates.enabled);
    if (updates.requireVerifiedEmail !== undefined) current.requireVerifiedEmail = Boolean(updates.requireVerifiedEmail);
    if (Array.isArray(updates.rules)) {
      current.rules = updates.rules.slice(0, 50).map(rule => ({
        id: text(rule?.id, 128) || uuidv4(),
        title: text(rule?.title, 100),
        description: text(rule?.description ?? (typeof rule === 'string' ? rule : ''), 1000),
      })).filter(rule => rule.title || rule.description);
    }
    current.updatedAt = Date.now();
    current.updatedBy = nullableText(updatedBy || updates.updatedBy, 128);
    this.save();
    return clone(current);
  }

  acknowledgeRules(serverId, userId, input = {}) {
    const state = this.ensureServerState(serverId);
    const normalizedUserId = text(userId, 128);
    if (!state || !normalizedUserId) return null;
    const requiredRuleIds = idList(state.rulesScreening.rules.map(rule => rule.id), 50);
    const acceptedRuleIds = idList(input.acceptedRuleIds, 50);
    if (state.rulesScreening.enabled && requiredRuleIds.some(id => !acceptedRuleIds.includes(id))) return null;
    const record = {
      userId: normalizedUserId,
      acceptedRuleIds,
      onboardingResponses: isRecord(input.onboardingResponses) ? clone(input.onboardingResponses) : {},
      emailVerified: Boolean(input.emailVerified),
      acceptedAt: Date.now(),
    };
    state.memberVerifications[normalizedUserId] = record;
    this.save();
    return clone(record);
  }

  revokeRulesAcknowledgement(serverId, userId) {
    const state = this.ensureServerState(serverId);
    if (!state?.memberVerifications?.[userId]) return false;
    delete state.memberVerifications[userId];
    this.save();
    return true;
  }

  getMemberVerification(serverId, userId) {
    return clone(this.ensureServerState(serverId)?.memberVerifications?.[userId] || null);
  }

  isMemberVerified(serverId, userId) {
    const state = this.ensureServerState(serverId);
    if (!state) return false;
    const rules = state.rulesScreening;
    if (!rules.enabled) return true;
    const record = state.memberVerifications[userId];
    if (!record) return false;
    if (rules.requireVerifiedEmail && !record.emailVerified) return false;
    return rules.rules.every(rule => record.acceptedRuleIds?.includes(rule.id));
  }

  createEvent(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const state = this.ensureServerState(serverId);
    const name = text(input.name, 100);
    const startsAt = timestamp(input.startsAt ?? input.scheduledStartAt);
    if (!state || !name || !startsAt) return null;
    const event = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      name,
      description: text(input.description, 2000),
      type: ['voice', 'stage', 'external'].includes(input.type) ? input.type : 'external',
      channelId: nullableText(input.channelId, 128),
      location: nullableText(input.location, 300),
      startsAt,
      endsAt: timestamp(input.endsAt ?? input.scheduledEndAt),
      image: nullableMediaUrl(input.image),
      status: 'scheduled',
      createdBy: nullableText(input.createdBy, 128),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rsvps: {},
    };
    if (event.endsAt && event.endsAt <= event.startsAt) return null;
    state.events.push(event);
    this.recordServerStat(serverId, 'eventsCreated', 1);
    return clone(event);
  }

  getEvent(serverId, eventId) {
    return clone(this.ensureServerState(serverId)?.events.find(event => event.id === String(eventId)) || null);
  }

  listEvents(serverId, { status = null, upcomingOnly = false, includeCompleted = true } = {}) {
    const now = Date.now();
    return clone((this.ensureServerState(serverId)?.events || [])
      .filter(event => !status || event.status === status)
      .filter(event => includeCompleted || !['completed', 'cancelled'].includes(event.status))
      .filter(event => !upcomingOnly || event.startsAt >= now)
      .sort((first, second) => first.startsAt - second.startsAt));
  }

  updateEvent(serverId, eventId, updates = {}) {
    const state = this.ensureServerState(serverId);
    const event = state?.events.find(item => item.id === String(eventId));
    if (!event || !isRecord(updates)) return null;
    const next = { ...event, rsvps: isRecord(event.rsvps) ? event.rsvps : {} };
    if (updates.name !== undefined && text(updates.name, 100)) next.name = text(updates.name, 100);
    if (updates.description !== undefined) next.description = text(updates.description, 2000);
    if (updates.channelId !== undefined) next.channelId = nullableText(updates.channelId, 128);
    if (updates.location !== undefined) next.location = nullableText(updates.location, 300);
    const nextStartsAt = updates.startsAt ?? updates.scheduledStartAt;
    const nextEndsAt = updates.endsAt ?? updates.scheduledEndAt;
    if (nextStartsAt !== undefined && timestamp(nextStartsAt)) next.startsAt = timestamp(nextStartsAt);
    if (nextEndsAt !== undefined) next.endsAt = timestamp(nextEndsAt);
    if (updates.image !== undefined) next.image = nullableMediaUrl(updates.image);
    if (updates.type !== undefined && ['voice', 'stage', 'external'].includes(updates.type)) next.type = updates.type;
    if (updates.status !== undefined && EVENT_STATUSES.has(updates.status)) next.status = updates.status;
    if (next.endsAt && next.endsAt <= next.startsAt) return null;
    next.updatedAt = Date.now();
    Object.assign(event, next);
    this.save();
    return clone(event);
  }

  deleteEvent(serverId, eventId) {
    const state = this.ensureServerState(serverId);
    const index = state?.events.findIndex(event => event.id === String(eventId)) ?? -1;
    if (index === -1) return false;
    state.events.splice(index, 1);
    this.save();
    return true;
  }

  setEventRsvp(serverId, eventId, userId, status) {
    const state = this.ensureServerState(serverId);
    const event = state?.events.find(item => item.id === String(eventId));
    const normalizedUserId = text(userId, 128);
    if (!event || !normalizedUserId) return null;
    if (!isRecord(event.rsvps)) event.rsvps = {};
    if (status === null || status === 'none') delete event.rsvps[normalizedUserId];
    else if (RSVP_STATUSES.has(status)) event.rsvps[normalizedUserId] = { status, updatedAt: Date.now() };
    else return null;
    event.updatedAt = Date.now();
    this.save();
    return clone(event);
  }

  resolveFeatureScope(serverOrChannelId, explicitChannelId = null) {
    const directChannel = this.storage.getChannelById(String(serverOrChannelId));
    if (directChannel) return { serverId: directChannel.serverId, channelId: directChannel.id };
    const server = this.storage.getServerById(String(serverOrChannelId));
    if (!server) return null;
    const channelId = explicitChannelId ? text(explicitChannelId, 128) : null;
    if (channelId) {
      const channel = this.storage.getChannelById(channelId);
      if (!channel || channel.serverId !== server.id) return null;
    }
    return { serverId: server.id, channelId };
  }

  createForumTag(serverOrChannelId, input = {}) {
    const scope = this.resolveFeatureScope(serverOrChannelId, input.channelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const name = text(input.name, 50);
    if (!state || !name) return null;
    const tag = {
      id: uuidv4(),
      serverId: scope.serverId,
      channelId: scope.channelId,
      name,
      color: /^#[0-9a-fA-F]{6}$/.test(String(input.color || '')) ? input.color : null,
      emoji: nullableText(input.emoji, 100),
      moderated: Boolean(input.moderated),
      createdAt: Date.now(),
    };
    state.forumTags.push(tag);
    this.save();
    return clone(tag);
  }

  listForumTags(serverOrChannelId, channelId = null) {
    const scope = this.resolveFeatureScope(serverOrChannelId, channelId);
    if (!scope) return [];
    return clone((this.ensureServerState(scope.serverId)?.forumTags || [])
      .filter(tag => !scope.channelId || !tag.channelId || tag.channelId === scope.channelId));
  }

  updateForumTag(serverOrChannelId, tagId, updates = {}) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const tag = scope ? this.ensureServerState(scope.serverId)?.forumTags.find(item => (
      item.id === String(tagId) && (!scope.channelId || !item.channelId || item.channelId === scope.channelId)
    )) : null;
    if (!tag) return null;
    if (updates.name !== undefined && text(updates.name, 50)) tag.name = text(updates.name, 50);
    if (updates.color !== undefined) tag.color = /^#[0-9a-fA-F]{6}$/.test(String(updates.color || '')) ? updates.color : null;
    if (updates.emoji !== undefined) tag.emoji = nullableText(updates.emoji, 100);
    if (updates.moderated !== undefined) tag.moderated = Boolean(updates.moderated);
    this.save();
    return clone(tag);
  }

  deleteForumTag(serverOrChannelId, tagId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const index = state?.forumTags.findIndex(tag => (
      tag.id === String(tagId) && (!scope.channelId || !tag.channelId || tag.channelId === scope.channelId)
    )) ?? -1;
    if (index === -1) return false;
    state.forumTags.splice(index, 1);
    state.forumPosts.forEach(post => { post.tagIds = (post.tagIds || []).filter(id => id !== String(tagId)); });
    this.save();
    return true;
  }

  createForumPost(serverOrChannelId, authorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(authorIdOrInput)
      ? authorIdOrInput
      : { ...suppliedInput, authorId: suppliedInput.authorId || authorIdOrInput };
    const scope = this.resolveFeatureScope(serverOrChannelId, input.channelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const title = text(input.title, 100);
    const channelId = scope?.channelId;
    const authorId = text(input.authorId, 128);
    if (!state || !title || !channelId || !authorId) return null;
    const validTagIds = new Set(state.forumTags
      .filter(tag => !tag.channelId || tag.channelId === channelId)
      .map(tag => tag.id));
    const threadId = uuidv4();
    const now = Date.now();
    const post = {
      id: uuidv4(),
      serverId: scope.serverId,
      channelId,
      threadId,
      authorId,
      title,
      content: text(input.content, 10_000),
      attachments: Array.isArray(input.attachments) ? clone(input.attachments.slice(0, 10)) : [],
      tagIds: idList(input.tagIds, 5).filter(id => validTagIds.has(id)),
      pinned: Boolean(input.pinned),
      locked: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const thread = {
      id: threadId,
      serverId: scope.serverId,
      channelId,
      forumPostId: post.id,
      parentMessageId: null,
      ownerId: authorId,
      name: title,
      archived: false,
      locked: false,
      autoArchiveDuration: integer(input.autoArchiveDuration, 60, 10_080, 1440),
      messages: [],
      memberIds: [authorId],
      createdAt: now,
      updatedAt: now,
    };
    state.forumPosts.push(post);
    state.threads.push(thread);
    this.save();
    return clone(post);
  }

  getForumPost(serverOrChannelId, postId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    if (!scope) return null;
    return clone(this.ensureServerState(scope.serverId)?.forumPosts.find(post => (
      post.id === String(postId) && (!scope.channelId || post.channelId === scope.channelId)
    )) || null);
  }

  listForumPosts(serverOrChannelId, filters = {}) {
    const scope = this.resolveFeatureScope(serverOrChannelId, filters.channelId);
    if (!scope) return [];
    const query = text(filters.query, 100).toLocaleLowerCase('en-US');
    const limit = integer(filters.limit, 1, 100, 50);
    return clone((this.ensureServerState(scope.serverId)?.forumPosts || [])
      .filter(post => !scope.channelId || post.channelId === scope.channelId)
      .filter(post => filters.archived === undefined || post.archived === Boolean(filters.archived))
      .filter(post => !filters.tagId || post.tagIds?.includes(filters.tagId))
      .filter(post => !query || `${post.title} ${post.content}`.toLocaleLowerCase('en-US').includes(query))
      .sort((first, second) => Number(second.pinned) - Number(first.pinned) || second.updatedAt - first.updatedAt)
      .slice(0, limit));
  }

  updateForumPost(serverOrChannelId, postId, updates = {}) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const post = state?.forumPosts.find(item => (
      item.id === String(postId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    if (!post) return null;
    if (updates.title !== undefined && text(updates.title, 100)) post.title = text(updates.title, 100);
    if (updates.content !== undefined) post.content = text(updates.content, 10_000);
    if (updates.tagIds !== undefined) {
      const valid = new Set(state.forumTags
        .filter(tag => !tag.channelId || tag.channelId === post.channelId)
        .map(tag => tag.id));
      post.tagIds = idList(updates.tagIds, 5).filter(id => valid.has(id));
    }
    ['pinned', 'locked', 'archived'].forEach(key => {
      if (updates[key] !== undefined) post[key] = Boolean(updates[key]);
    });
    post.updatedAt = Date.now();
    const thread = state.threads.find(item => item.id === post.threadId);
    if (thread) {
      thread.name = post.title;
      thread.locked = post.locked;
      thread.archived = post.archived;
      thread.updatedAt = post.updatedAt;
    }
    this.save();
    return clone(post);
  }

  deleteForumPost(serverOrChannelId, postId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const index = state?.forumPosts.findIndex(post => (
      post.id === String(postId) && (!scope.channelId || post.channelId === scope.channelId)
    )) ?? -1;
    if (index === -1) return false;
    const [post] = state.forumPosts.splice(index, 1);
    state.threads = state.threads.filter(thread => thread.id !== post.threadId);
    this.save();
    return true;
  }

  addForumReply(serverOrChannelId, postId, authorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(authorIdOrInput)
      ? authorIdOrInput
      : { ...suppliedInput, authorId: suppliedInput.authorId || authorIdOrInput };
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const post = state?.forumPosts.find(item => (
      item.id === String(postId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    const content = text(input.content, 10_000);
    const authorId = text(input.authorId, 128);
    if (!post || post.locked || !content || !authorId) return null;
    const thread = state.threads.find(item => item.id === post.threadId);
    if (!thread) return null;
    const reply = {
      id: uuidv4(),
      authorId,
      content,
      attachments: Array.isArray(input.attachments) ? clone(input.attachments.slice(0, 10)) : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    thread.messages.push(reply);
    if (!thread.memberIds.includes(authorId)) thread.memberIds.push(authorId);
    thread.updatedAt = reply.createdAt;
    post.updatedAt = reply.createdAt;
    this.save();
    return clone(reply);
  }

  listForumReplies(serverOrChannelId, postId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const post = state?.forumPosts.find(item => (
      item.id === String(postId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    return clone(state?.threads.find(thread => thread.id === post?.threadId)?.messages || []);
  }

  updateForumReply(serverOrChannelId, postId, replyId, authorId, content) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const post = state?.forumPosts.find(item => (
      item.id === String(postId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    const thread = state?.threads.find(item => item.id === post?.threadId);
    const reply = thread?.messages.find(item => item.id === String(replyId));
    if (!reply || reply.authorId !== String(authorId) || !text(content, 10_000)) return null;
    reply.content = text(content, 10_000);
    reply.updatedAt = Date.now();
    this.save();
    return clone(reply);
  }

  deleteForumReply(serverOrChannelId, postId, replyId, actorId = null, canModerate = false) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const post = state?.forumPosts.find(item => (
      item.id === String(postId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    const thread = state?.threads.find(item => item.id === post?.threadId);
    const index = thread?.messages.findIndex(item => item.id === String(replyId)) ?? -1;
    if (index === -1) return false;
    if (!canModerate && thread.messages[index].authorId !== String(actorId)) return false;
    thread.messages.splice(index, 1);
    thread.updatedAt = Date.now();
    this.save();
    return true;
  }

  createThread(serverId, input = {}) {
    const state = this.ensureServerState(serverId);
    const channelId = text(input.channelId, 128);
    const ownerId = text(input.ownerId, 128);
    const name = text(input.name, 100);
    if (!state || !channelId || !ownerId || !name) return null;
    const now = Date.now();
    const thread = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      channelId,
      forumPostId: null,
      parentMessageId: nullableText(input.parentMessageId, 128),
      ownerId,
      name,
      archived: false,
      locked: false,
      autoArchiveDuration: integer(input.autoArchiveDuration, 60, 10_080, 1440),
      messages: [],
      memberIds: [ownerId],
      createdAt: now,
      updatedAt: now,
    };
    state.threads.push(thread);
    this.save();
    return clone(thread);
  }

  getThread(serverId, threadId) {
    return clone(this.ensureServerState(serverId)?.threads.find(thread => thread.id === String(threadId)) || null);
  }

  listThreads(serverId, filters = {}) {
    return clone((this.ensureServerState(serverId)?.threads || [])
      .filter(thread => !filters.channelId || thread.channelId === filters.channelId)
      .filter(thread => filters.archived === undefined || thread.archived === Boolean(filters.archived))
      .sort((first, second) => second.updatedAt - first.updatedAt));
  }

  updateThread(serverId, threadId, updates = {}) {
    const thread = this.ensureServerState(serverId)?.threads.find(item => item.id === String(threadId));
    if (!thread) return null;
    if (updates.name !== undefined && text(updates.name, 100)) thread.name = text(updates.name, 100);
    if (updates.archived !== undefined) thread.archived = Boolean(updates.archived);
    if (updates.locked !== undefined) thread.locked = Boolean(updates.locked);
    if (updates.autoArchiveDuration !== undefined) {
      thread.autoArchiveDuration = integer(updates.autoArchiveDuration, 60, 10_080, 1440);
    }
    thread.updatedAt = Date.now();
    this.save();
    return clone(thread);
  }

  deleteThread(serverId, threadId) {
    const state = this.ensureServerState(serverId);
    const index = state?.threads.findIndex(thread => thread.id === String(threadId)) ?? -1;
    if (index === -1) return false;
    const [thread] = state.threads.splice(index, 1);
    if (thread.forumPostId) state.forumPosts = state.forumPosts.filter(post => post.id !== thread.forumPostId);
    this.save();
    return true;
  }

  listThreadMessages(serverId, threadId) {
    const thread = this.ensureServerState(serverId)?.threads.find(item => item.id === String(threadId));
    return clone(thread?.messages || []);
  }

  addThreadMessage(serverId, threadId, input = {}) {
    const thread = this.ensureServerState(serverId)?.threads.find(item => item.id === String(threadId));
    const authorId = text(input.authorId, 128);
    const content = text(input.content, 10_000);
    if (!thread || thread.locked || thread.archived || !authorId || !content) return null;
    const message = {
      id: uuidv4(),
      threadId: thread.id,
      authorId,
      content,
      attachments: Array.isArray(input.attachments) ? clone(input.attachments.slice(0, 10)) : [],
      createdAt: Date.now(),
      updatedAt: null,
    };
    thread.messages.push(message);
    if (thread.messages.length > 1000) thread.messages = thread.messages.slice(-1000);
    if (!thread.memberIds.includes(authorId)) thread.memberIds.push(authorId);
    thread.updatedAt = message.createdAt;
    this.save();
    return clone(message);
  }

  createPoll(serverOrChannelId, creatorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(creatorIdOrInput)
      ? creatorIdOrInput
      : { ...suppliedInput, creatorId: suppliedInput.creatorId || creatorIdOrInput };
    const scope = this.resolveFeatureScope(serverOrChannelId, input.channelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const question = text(input.question, 300);
    const rawOptions = Array.isArray(input.options) ? input.options : [];
    const options = rawOptions.slice(0, 10).map(option => ({
      id: uuidv4(),
      text: text(isRecord(option) ? option.text : option, 100),
      voterIds: [],
    })).filter(option => option.text);
    if (!state || !question || options.length < 2) return null;
    const poll = {
      id: uuidv4(),
      serverId: scope.serverId,
      channelId: scope.channelId,
      messageId: nullableText(input.messageId, 128),
      threadId: nullableText(input.threadId, 128),
      creatorId: nullableText(input.creatorId, 128),
      question,
      options,
      allowMultiple: Boolean(input.allowMultiple),
      anonymous: Boolean(input.anonymous),
      expiresAt: timestamp(input.expiresAt),
      closedAt: null,
      createdAt: Date.now(),
    };
    state.polls.push(poll);
    this.save();
    return publicPoll(poll, input.creatorId);
  }

  getPoll(serverOrChannelId, pollId, userId = null, includeVoters = false) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const poll = scope ? this.ensureServerState(scope.serverId)?.polls.find(item => (
      item.id === String(pollId) && (!scope.channelId || item.channelId === scope.channelId)
    )) : null;
    return publicPoll(poll, userId, includeVoters);
  }

  listPolls(serverOrChannelId, filtersOrUserId = {}, maybeUserId = null) {
    const filters = isRecord(filtersOrUserId) ? filtersOrUserId : {};
    const userId = isRecord(filtersOrUserId) ? maybeUserId : filtersOrUserId;
    const scope = this.resolveFeatureScope(serverOrChannelId, filters.channelId);
    if (!scope) return [];
    return (this.ensureServerState(scope.serverId)?.polls || [])
      .filter(poll => !scope.channelId || poll.channelId === scope.channelId)
      .filter(poll => !filters.messageId || poll.messageId === filters.messageId)
      .map(poll => publicPoll(poll, userId));
  }

  votePoll(serverOrChannelId, pollId, userId, optionIds) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const poll = state?.polls.find(item => (
      item.id === String(pollId) && (!scope.channelId || item.channelId === scope.channelId)
    ));
    const normalizedUserId = text(userId, 128);
    const selected = idList(Array.isArray(optionIds) ? optionIds : [optionIds], 10);
    const validIds = new Set(poll?.options.map(option => option.id) || []);
    if (!poll || !normalizedUserId || poll.closedAt || (poll.expiresAt && poll.expiresAt <= Date.now())) return null;
    if (!selected.length || selected.some(id => !validIds.has(id)) || (!poll.allowMultiple && selected.length !== 1)) return null;
    poll.options.forEach(option => {
      option.voterIds = (option.voterIds || []).filter(id => id !== normalizedUserId);
      if (selected.includes(option.id)) option.voterIds.push(normalizedUserId);
    });
    this.save();
    return publicPoll(poll, normalizedUserId);
  }

  removePollVote(serverOrChannelId, pollId, userId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const poll = scope ? this.ensureServerState(scope.serverId)?.polls.find(item => (
      item.id === String(pollId) && (!scope.channelId || item.channelId === scope.channelId)
    )) : null;
    if (!poll || poll.closedAt) return null;
    poll.options.forEach(option => { option.voterIds = (option.voterIds || []).filter(id => id !== String(userId)); });
    this.save();
    return publicPoll(poll, userId);
  }

  closePoll(serverOrChannelId, pollId, closedBy = null) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const poll = scope ? this.ensureServerState(scope.serverId)?.polls.find(item => (
      item.id === String(pollId) && (!scope.channelId || item.channelId === scope.channelId)
    )) : null;
    if (!poll || poll.closedAt) return null;
    poll.closedAt = Date.now();
    poll.closedBy = nullableText(closedBy, 128);
    this.save();
    return publicPoll(poll);
  }

  deletePoll(serverOrChannelId, pollId) {
    const scope = this.resolveFeatureScope(serverOrChannelId);
    const state = scope ? this.ensureServerState(scope.serverId) : null;
    const index = state?.polls.findIndex(poll => (
      poll.id === String(pollId) && (!scope.channelId || poll.channelId === scope.channelId)
    )) ?? -1;
    if (index === -1) return false;
    state.polls.splice(index, 1);
    this.save();
    return true;
  }

  getNotificationPreferences(userId) {
    const normalizedUserId = text(userId, 128);
    const existing = this.ensureRootState().notificationPreferences[normalizedUserId];
    const preferences = {
      level: 'all',
      desktop: true,
      sound: true,
      dmNotifications: true,
      mentions: true,
      suppressEveryone: false,
      suppressRoles: false,
      mutedUntil: null,
      servers: {},
      channels: {},
      ...(isRecord(existing) ? existing : {}),
    };
    preferences.level = notificationLevel(preferences.level, 'all');
    Object.values(preferences.servers || {}).forEach(value => {
      if (isRecord(value)) value.level = notificationOverrideLevel(value.level, 'inherit');
    });
    Object.values(preferences.channels || {}).forEach(value => {
      if (isRecord(value)) value.level = notificationOverrideLevel(value.level, 'inherit');
    });
    preferences.directMessages = preferences.dmNotifications;
    preferences.serverMode = preferences.level;
    return clone(preferences);
  }

  updateNotificationPreferences(userId, updates = {}) {
    const root = this.ensureRootState();
    const normalizedUserId = text(userId, 128);
    if (!normalizedUserId || !isRecord(updates)) return null;
    const prefs = this.getNotificationPreferences(normalizedUserId);
    const requestedLevel = updates.level ?? updates.serverMode;
    if (requestedLevel !== undefined) prefs.level = notificationLevel(requestedLevel, prefs.level);
    if (updates.directMessages !== undefined && updates.dmNotifications === undefined) {
      updates = { ...updates, dmNotifications: updates.directMessages };
    }
    ['desktop', 'sound', 'dmNotifications', 'mentions', 'suppressEveryone', 'suppressRoles'].forEach(key => {
      if (updates[key] !== undefined) prefs[key] = Boolean(updates[key]);
    });
    if (updates.mutedUntil !== undefined) prefs.mutedUntil = timestamp(updates.mutedUntil);
    prefs.updatedAt = Date.now();
    prefs.directMessages = prefs.dmNotifications;
    prefs.serverMode = prefs.level;
    root.notificationPreferences[normalizedUserId] = prefs;
    this.save();
    return clone(prefs);
  }

  setServerNotificationPreferences(userId, serverId, updates = {}) {
    const root = this.ensureRootState();
    const prefs = this.getNotificationPreferences(userId);
    const key = text(serverId, 128);
    if (!key) return null;
    const current = isRecord(prefs.servers[key]) ? prefs.servers[key] : {};
    prefs.servers[key] = {
      level: notificationOverrideLevel(updates.level, notificationOverrideLevel(current.level, 'inherit')),
      mutedUntil: updates.mutedUntil === undefined ? (current.mutedUntil || null) : timestamp(updates.mutedUntil),
      suppressEveryone: updates.suppressEveryone === undefined
        ? Boolean(current.suppressEveryone)
        : Boolean(updates.suppressEveryone),
      suppressRoles: updates.suppressRoles === undefined ? Boolean(current.suppressRoles) : Boolean(updates.suppressRoles),
    };
    prefs.updatedAt = Date.now();
    root.notificationPreferences[text(userId, 128)] = prefs;
    this.save();
    return clone(prefs.servers[key]);
  }

  setChannelNotificationPreferences(userId, channelId, updates = {}) {
    const root = this.ensureRootState();
    const prefs = this.getNotificationPreferences(userId);
    const key = text(channelId, 128);
    if (!key) return null;
    const current = isRecord(prefs.channels[key]) ? prefs.channels[key] : {};
    prefs.channels[key] = {
      level: notificationOverrideLevel(updates.level, notificationOverrideLevel(current.level, 'inherit')),
      mutedUntil: updates.mutedUntil === undefined ? (current.mutedUntil || null) : timestamp(updates.mutedUntil),
    };
    prefs.updatedAt = Date.now();
    root.notificationPreferences[text(userId, 128)] = prefs;
    this.save();
    return clone(prefs.channels[key]);
  }

  resetNotificationPreferences(userId) {
    const root = this.ensureRootState();
    const key = text(userId, 128);
    if (!root.notificationPreferences[key]) return false;
    delete root.notificationPreferences[key];
    this.save();
    return true;
  }

  createServerTemplate(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, creatorId: suppliedInput.creatorId || actorIdOrInput };
    const root = this.ensureRootState();
    const server = this.storage.getServerById(serverId);
    const name = text(input.name, 100);
    if (!server || server.isDM || !name) return null;
    const roles = this.storage.getServerRoles(serverId).filter(role => !role.isDefault).map(role => ({
      sourceId: role.id,
      name: role.name,
      color: role.color,
      icon: role.icon || null,
      hoist: Boolean(role.hoist),
      mentionable: Boolean(role.mentionable),
      permissions: clone(role.permissions || []),
      position: role.position,
    }));
    const channels = this.storage.getChannelsByServerId(serverId).map(channel => ({
      sourceId: channel.id,
      name: channel.name,
      type: channel.type,
      settings: this.getChannelSettings(serverId, channel.id),
    }));
    const template = {
      id: uuidv4(),
      sourceServerId: serverId,
      name,
      description: text(input.description, 1000),
      creatorId: nullableText(input.creatorId, 128),
      public: Boolean(input.public ?? input.isPublic),
      uses: 0,
      roles,
      channels,
      serverSettings: this.getServerSettings(serverId),
      onboarding: this.getOnboarding(serverId),
      rulesScreening: this.getRulesScreening(serverId),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    root.templates.push(template);
    this.save();
    return clone(template);
  }

  getServerTemplate(templateId) {
    return clone(this.ensureRootState().templates.find(template => template.id === String(templateId)) || null);
  }

  listServerTemplates({ publicOnly = false, creatorId = null } = {}) {
    return clone(this.ensureRootState().templates
      .filter(template => !publicOnly || template.public)
      .filter(template => !creatorId || template.creatorId === creatorId)
      .sort((first, second) => second.updatedAt - first.updatedAt));
  }

  updateServerTemplate(templateId, updates = {}) {
    const template = this.ensureRootState().templates.find(item => item.id === String(templateId));
    if (!template) return null;
    if (updates.name !== undefined && text(updates.name, 100)) template.name = text(updates.name, 100);
    if (updates.description !== undefined) template.description = text(updates.description, 1000);
    if (updates.public !== undefined) template.public = Boolean(updates.public);
    template.updatedAt = Date.now();
    this.save();
    return clone(template);
  }

  deleteServerTemplate(templateId) {
    const root = this.ensureRootState();
    const index = root.templates.findIndex(template => template.id === String(templateId));
    if (index === -1) return false;
    root.templates.splice(index, 1);
    this.save();
    return true;
  }

  applyServerTemplate(serverId, templateId) {
    // API ayrıca `(templateId, creatorId, { name })` biçiminde yeni sunucu
    // oluşturmayı destekler. İlk argüman mevcut bir sunucuysa eski uygulama
    // biçimi `(serverId, templateId)` korunur.
    if (!this.storage.getServerById(serverId)) {
      const requestedTemplate = this.getServerTemplate(serverId);
      const creatorId = text(templateId, 128);
      const options = isRecord(arguments[2]) ? arguments[2] : {};
      if (!requestedTemplate || !creatorId) return null;
      const createdServer = this.storage.createServer(
        text(options.name, 100, requestedTemplate.name || 'New server'),
        creatorId,
      );
      const templateResult = this.applyServerTemplate(createdServer.id, requestedTemplate.id);
      return templateResult ? { ...clone(createdServer), templateResult } : null;
    }
    const template = this.ensureRootState().templates.find(item => item.id === String(templateId));
    const server = this.storage.getServerById(serverId);
    if (!template || !server || server.isDM) return null;
    const roleMap = new Map();
    template.roles.forEach(role => {
      const created = this.storage.createServerRole(serverId, role);
      if (created) roleMap.set(role.sourceId, created.id);
    });
    const channels = [];
    template.channels.forEach(channelTemplate => {
      const created = this.storage.createChannel(serverId, channelTemplate.name, channelTemplate.type);
      channels.push(created);
      const settings = clone(channelTemplate.settings || {});
      this.updateChannelMetadata(serverId, created.id, settings.metadata || {});
      (settings.permissionOverrides || []).filter(override => override.targetType === 'role').forEach(override => {
        const targetId = roleMap.get(override.targetId);
        if (targetId) this.setChannelPermissionOverride(created.id, { ...override, targetId });
      });
    });
    this.updateServerSettings(serverId, template.serverSettings || {});
    this.updateOnboarding(serverId, template.onboarding || {});
    this.updateRulesScreening(serverId, template.rulesScreening || {});
    template.uses = integer(template.uses, 0, 1_000_000_000, 0) + 1;
    template.updatedAt = Date.now();
    this.save();
    return { serverId, rolesCreated: roleMap.size, channels: clone(channels) };
  }

  createServerFromTemplate(templateId, { name, creatorId } = {}) {
    const template = this.getServerTemplate(templateId);
    if (!template || !text(name, 100) || !text(creatorId, 128)) return null;
    const server = this.storage.createServer(text(name, 100), text(creatorId, 128));
    const result = this.applyServerTemplate(server.id, templateId);
    return result ? { ...clone(server), templateResult: result } : null;
  }

  getDiscoverySettings(serverId) {
    const discovery = this.ensureServerState(serverId)?.discovery || createDefaultDiscovery();
    return clone({ ...discovery, tags: discovery.keywords || [] });
  }

  updateDiscoverySettings(serverId, updates = {}) {
    const state = this.ensureServerState(serverId);
    if (!state || !isRecord(updates)) return null;
    const current = state.discovery;
    if (updates.enabled !== undefined) current.enabled = Boolean(updates.enabled);
    if (updates.category !== undefined) current.category = nullableText(updates.category, 50);
    if (updates.description !== undefined) current.description = text(updates.description, 1000);
    const keywords = updates.keywords ?? updates.tags;
    if (keywords !== undefined) current.keywords = stringList(keywords, { maxItems: 10, maxLength: 30 });
    if (updates.language !== undefined) current.language = text(updates.language, 10, 'tr');
    if (updates.nsfw !== undefined) current.nsfw = Boolean(updates.nsfw);
    if (updates.banner !== undefined) current.banner = nullableMediaUrl(updates.banner);
    current.updatedAt = Date.now();
    this.save();
    return clone({ ...current, tags: current.keywords || [] });
  }

  listDiscoverableServers(filters = {}) {
    const query = text(filters.query, 100).toLocaleLowerCase('en-US');
    const result = this.storage.getAllServers().filter(server => !server.isDM).map(server => {
      const discovery = this.ensureServerState(server.id).discovery;
      if (!discovery.enabled) return null;
      const haystack = `${server.name} ${discovery.description} ${(discovery.keywords || []).join(' ')}`.toLocaleLowerCase('en-US');
      if (query && !haystack.includes(query)) return null;
      if (filters.category && discovery.category !== filters.category) return null;
      if (filters.language && discovery.language !== filters.language) return null;
      if (filters.nsfw === false && discovery.nsfw) return null;
      return {
        id: server.id,
        name: server.name,
        icon: server.icon || null,
        inviteCode: server.vanityCode || server.inviteCode,
        joinCode: server.vanityCode || server.inviteCode,
        defaultInviteCode: server.vanityCode || server.inviteCode,
        memberCount: this.storage.getServerMembers(server.id).length,
        ...clone(discovery),
        tags: clone(discovery.keywords || []),
      };
    }).filter(Boolean);
    return result.slice(0, integer(filters.limit, 1, 100, 30));
  }

  recordServerStat(serverId, metric, amount = 1, at = Date.now()) {
    const state = this.ensureServerState(serverId);
    if (!state || !STAT_METRICS.has(metric)) return null;
    const delta = Number(amount);
    if (!Number.isFinite(delta)) return null;
    const key = dateKey(at);
    state.stats.daily[key] = { ...Object.fromEntries([...STAT_METRICS].map(item => [item, 0])), ...(state.stats.daily[key] || {}) };
    state.stats.daily[key][metric] = Number(state.stats.daily[key][metric] || 0) + delta;
    state.stats.totals[metric] = Number(state.stats.totals[metric] || 0) + delta;
    state.stats.updatedAt = Date.now();
    const keys = Object.keys(state.stats.daily).sort();
    keys.slice(0, Math.max(0, keys.length - MAX_DAILY_STAT_DAYS)).forEach(oldKey => delete state.stats.daily[oldKey]);
    this.save();
    return this.getServerStats(serverId);
  }

  getServerStats(serverId, { from = null, to = null } = {}) {
    const state = this.ensureServerState(serverId);
    if (!state) return null;
    const fromKey = from ? dateKey(from) : null;
    const toKey = to ? dateKey(to) : null;
    const daily = Object.fromEntries(Object.entries(state.stats.daily).filter(([key]) => (
      (!fromKey || key >= fromKey) && (!toKey || key <= toKey)
    )));
    return clone({
      ...state.stats,
      daily,
      currentMembers: this.storage.getServerMembers(serverId).length,
      currentChannels: this.storage.getChannelsByServerId(serverId).length,
    });
  }

  exportServer(serverId, { includeAuditLogs = false, includeMembers = false } = {}) {
    const server = this.storage.getServerById(serverId);
    const state = this.ensureServerState(serverId);
    if (!server || server.isDM || !state) return null;
    return clone({
      exportVersion: PLATFORM_STATE_VERSION,
      exportedAt: Date.now(),
      server: { id: server.id, name: server.name, icon: server.icon || null, createdAt: server.createdAt },
      channels: this.storage.getChannelsByServerId(serverId),
      roles: this.storage.getServerRoles(serverId),
      members: includeMembers ? this.storage.getServerMembers(serverId) : undefined,
      settings: state.settings,
      onboarding: state.onboarding,
      rulesScreening: state.rulesScreening,
      events: state.events,
      forumTags: state.forumTags,
      forumPosts: state.forumPosts,
      threads: state.threads,
      polls: state.polls,
      channelSettings: state.channels,
      emojis: state.emojis,
      stickers: state.stickers,
      announcementFollows: state.announcementFollows,
      slashCommands: state.slashCommands,
      discovery: state.discovery,
      stats: state.stats,
      reports: state.reports,
      bans: state.bans,
      timeouts: state.timeouts,
      memberVerifications: includeMembers ? state.memberVerifications : undefined,
      auditLogs: includeAuditLogs ? state.auditLogs : undefined,
    });
  }

  exportServerData(serverId, options = {}) {
    return this.exportServer(serverId, options);
  }

  createBackup(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput)
      ? maybeInput
      : (typeof maybeInput === 'string' ? { name: maybeInput } : {});
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const snapshot = this.exportServer(serverId, {
      includeAuditLogs: Boolean(input.includeAuditLogs),
      includeMembers: false,
    });
    if (!snapshot) return null;
    const root = this.ensureRootState();
    const backup = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      name: text(input.name, 100, `Yedek ${new Date().toISOString().slice(0, 10)}`),
      description: text(input.description, 500),
      createdBy: nullableText(input.createdBy, 128),
      createdAt: Date.now(),
      snapshot,
    };
    root.backups.push(backup);
    // Yerel yedeklerin sınırsız büymemberrek ana state'i şişirmesini engeller.
    const serverBackups = root.backups.filter(item => item.serverId === backup.serverId);
    if (serverBackups.length > 25) {
      const removeIds = new Set(serverBackups.sort((a, b) => b.createdAt - a.createdAt).slice(25).map(item => item.id));
      root.backups = root.backups.filter(item => !removeIds.has(item.id));
    }
    this.save();
    return this.getBackup(backup.id);
  }

  getBackup(backupId, { includeSnapshot = false } = {}) {
    const backup = this.ensureRootState().backups.find(item => item.id === String(backupId));
    if (!backup) return null;
    if (includeSnapshot) return clone(backup);
    const { snapshot, ...metadata } = backup;
    return clone({
      ...metadata,
      sourceServerName: snapshot?.server?.name || null,
      channelCount: snapshot?.channels?.length || 0,
      roleCount: snapshot?.roles?.length || 0,
    });
  }

  listBackups(serverId = null) {
    return this.ensureRootState().backups
      .filter(backup => !serverId || backup.serverId === String(serverId))
      .sort((first, second) => second.createdAt - first.createdAt)
      .map(backup => this.getBackup(backup.id));
  }

  deleteBackup(backupId) {
    const root = this.ensureRootState();
    const index = root.backups.findIndex(backup => backup.id === String(backupId));
    if (index === -1) return false;
    root.backups.splice(index, 1);
    this.save();
    return true;
  }

  restoreBackup(serverIdOrBackupId, backupIdOrOptions = {}, maybeOptions = {}) {
    const explicitTarget = typeof backupIdOrOptions === 'string';
    const backupId = explicitTarget ? backupIdOrOptions : serverIdOrBackupId;
    const options = explicitTarget ? maybeOptions : (isRecord(backupIdOrOptions) ? backupIdOrOptions : {});
    const backup = this.ensureRootState().backups.find(item => item.id === String(backupId));
    if (!backup?.snapshot) return null;

    let serverId = explicitTarget ? String(serverIdOrBackupId) : text(options.serverId, 128);
    if (explicitTarget && backup.serverId !== serverId) return null;
    let server = serverId ? this.storage.getServerById(serverId) : null;
    if (!server) {
      const creatorId = text(options.creatorId, 128);
      if (!creatorId) return null;
      server = this.storage.createServer(
        text(options.name, 100, backup.snapshot.server?.name || 'Restored server'),
        creatorId,
      );
      serverId = server.id;
    }
    if (server.isDM) return null;

    const snapshot = backup.snapshot;
    if (options.restoreIdentity !== false) {
      this.storage.updateServer(serverId, {
        name: text(options.name, 100, snapshot.server?.name || server.name),
        icon: snapshot.server?.icon ?? server.icon,
      });
    }

    const currentRoles = this.storage.getServerRoles(serverId);
    const roleMap = new Map();
    (snapshot.roles || []).forEach(role => {
      if (role.isDefault) {
        const defaultRole = currentRoles.find(item => item.isDefault);
        if (defaultRole) {
          this.storage.updateServerRole(serverId, defaultRole.id, { permissions: role.permissions || [] });
          roleMap.set(role.id, defaultRole.id);
        }
        return;
      }
      const existing = currentRoles.find(item => item.id === role.id || item.name === role.name);
      const restored = existing
        ? this.storage.updateServerRole(serverId, existing.id, role)
        : this.storage.createServerRole(serverId, role);
      if (restored) roleMap.set(role.id, restored.id);
    });

    const channelMap = new Map();
    const currentChannels = this.storage.getChannelsByServerId(serverId);
    (snapshot.channels || []).forEach(channel => {
      const existing = currentChannels.find(item => item.id === channel.id || (item.name === channel.name && item.type === channel.type));
      const restored = existing || this.storage.createChannel(serverId, channel.name, channel.type);
      channelMap.set(channel.id, restored.id);
      const savedSettings = snapshot.channelSettings?.[channel.id];
      if (savedSettings?.metadata) this.updateChannelMetadata(serverId, restored.id, savedSettings.metadata);
      (savedSettings?.permissionOverrides || []).forEach(override => {
        if (override.targetType === 'member') return;
        const targetId = roleMap.get(override.targetId);
        if (targetId) this.setChannelPermissionOverride(restored.id, { ...override, targetId });
      });
    });

    this.updateServerSettings(serverId, snapshot.settings || {});
    this.updateOnboarding(serverId, snapshot.onboarding || {});
    this.updateRulesScreening(serverId, snapshot.rulesScreening || {});
    this.updateDiscoverySettings(serverId, snapshot.discovery || {});

    const targetState = this.ensureServerState(serverId);
    ['events', 'forumTags', 'forumPosts', 'threads', 'polls', 'emojis', 'stickers', 'slashCommands', 'reports', 'bans', 'timeouts', 'announcementFollows'].forEach(key => {
      if (Array.isArray(snapshot[key])) targetState[key] = clone(snapshot[key]);
    });
    if (isRecord(snapshot.stats)) targetState.stats = clone(snapshot.stats);
    targetState.events.forEach(event => {
      if (event.channelId && channelMap.has(event.channelId)) event.channelId = channelMap.get(event.channelId);
      event.serverId = serverId;
    });
    targetState.forumTags.forEach(tag => {
      if (tag.channelId && channelMap.has(tag.channelId)) tag.channelId = channelMap.get(tag.channelId);
      tag.serverId = serverId;
    });
    targetState.announcementFollows = (targetState.announcementFollows || [])
      .filter(follow => channelMap.has(follow.sourceChannelId) && channelMap.has(follow.targetChannelId))
      .map(follow => ({
        ...follow,
        id: uuidv4(),
        sourceServerId: serverId,
        targetServerId: serverId,
        sourceChannelId: channelMap.get(follow.sourceChannelId),
        targetChannelId: channelMap.get(follow.targetChannelId),
      }));
    [...targetState.forumPosts, ...targetState.threads, ...targetState.polls].forEach(item => {
      if (item.channelId && channelMap.has(item.channelId)) item.channelId = channelMap.get(item.channelId);
      item.serverId = serverId;
    });
    [...targetState.emojis, ...targetState.stickers, ...targetState.slashCommands].forEach(item => { item.serverId = serverId; });
    this.addAuditLog(serverId, {
      action: 'SERVER_BACKUP_RESTORED',
      actorId: options.restoredBy || options.creatorId || null,
      targetType: 'server',
      targetId: serverId,
      metadata: { backupId: backup.id, sourceServerId: backup.serverId },
    });
    this.save();
    return {
      server: clone(this.storage.getServerById(serverId)),
      backup: this.getBackup(backup.id),
      rolesRestored: roleMap.size,
      channelsRestored: channelMap.size,
    };
  }

  createWebhook(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const state = this.ensureServerState(serverId);
    const name = text(input.name, 80);
    const channelId = text(input.channelId, 128);
    if (!state || !name || !channelId) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const webhook = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      channelId,
      name,
      avatar: nullableMediaUrl(input.avatar),
      createdBy: nullableText(input.createdBy, 128),
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: null,
    };
    state.webhooks.push(webhook);
    this.save();
    return { ...publicWebhook(webhook), token };
  }

  listWebhooks(serverId, channelId = null) {
    return (this.ensureServerState(serverId)?.webhooks || [])
      .filter(webhook => !channelId || webhook.channelId === channelId)
      .map(publicWebhook);
  }

  getWebhook(serverId, webhookId) {
    return publicWebhook(this.ensureServerState(serverId)?.webhooks.find(webhook => webhook.id === String(webhookId)));
  }

  getWebhookByToken(webhookIdOrToken, maybeToken = null) {
    const token = maybeToken === null ? webhookIdOrToken : maybeToken;
    const webhookId = maybeToken === null ? null : String(webhookIdOrToken);
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    for (const [serverId, state] of Object.entries(this.ensureRootState().servers)) {
      const webhook = state.webhooks?.find(item => (
        timingSafeHexEquals(item.tokenHash, hash) && item.enabled && (!webhookId || item.id === webhookId)
      ));
      if (webhook) return publicWebhook({ ...webhook, serverId });
    }
    return null;
  }

  touchWebhook(serverIdOrWebhookId, maybeWebhookId = null) {
    let serverId = maybeWebhookId === null ? null : serverIdOrWebhookId;
    const webhookId = String(maybeWebhookId ?? serverIdOrWebhookId);
    let webhook = serverId
      ? this.ensureServerState(serverId)?.webhooks.find(item => item.id === webhookId)
      : null;
    if (!webhook) {
      for (const [candidateServerId, state] of Object.entries(this.ensureRootState().servers)) {
        webhook = state.webhooks?.find(item => item.id === webhookId);
        if (webhook) {
          serverId = candidateServerId;
          break;
        }
      }
    }
    if (!webhook) return null;
    webhook.lastUsedAt = Date.now();
    this.save();
    return publicWebhook(webhook);
  }

  updateWebhook(serverId, webhookId, updates = {}) {
    const webhook = this.ensureServerState(serverId)?.webhooks.find(item => item.id === String(webhookId));
    if (!webhook) return null;
    if (updates.name !== undefined && text(updates.name, 80)) webhook.name = text(updates.name, 80);
    if (updates.channelId !== undefined && text(updates.channelId, 128)) webhook.channelId = text(updates.channelId, 128);
    if (updates.avatar !== undefined) webhook.avatar = nullableMediaUrl(updates.avatar);
    if (updates.enabled !== undefined) webhook.enabled = Boolean(updates.enabled);
    webhook.updatedAt = Date.now();
    this.save();
    return publicWebhook(webhook);
  }

  rotateWebhookToken(serverId, webhookId) {
    const webhook = this.ensureServerState(serverId)?.webhooks.find(item => item.id === String(webhookId));
    if (!webhook) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    webhook.tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    webhook.updatedAt = Date.now();
    this.save();
    return { ...publicWebhook(webhook), token };
  }

  deleteWebhook(serverId, webhookId) {
    const state = this.ensureServerState(serverId);
    const index = state?.webhooks.findIndex(webhook => webhook.id === String(webhookId)) ?? -1;
    if (index === -1) return false;
    state.webhooks.splice(index, 1);
    this.save();
    return true;
  }

  createSlashCommand(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const state = this.ensureServerState(serverId);
    const name = text(input.name, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!state || !name || state.slashCommands.some(command => command.name === name)) return null;
    const command = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      name,
      description: text(input.description, 100),
      response: text(input.response, 2000),
      options: Array.isArray(input.options) ? clone(input.options.slice(0, 25)) : [],
      handlerType: ['builtin', 'webhook'].includes(input.handlerType) ? input.handlerType : 'builtin',
      webhookId: nullableText(input.webhookId, 128),
      requiredPermissions: this.normalizePermissions(input.requiredPermissions ?? input.permissions),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      createdBy: nullableText(input.createdBy, 128),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.slashCommands.push(command);
    this.save();
    return clone(command);
  }

  listSlashCommands(serverId, { enabledOnly = false } = {}) {
    return clone((this.ensureServerState(serverId)?.slashCommands || [])
      .filter(command => !enabledOnly || command.enabled));
  }

  getSlashCommand(serverId, idOrName) {
    const key = text(idOrName, 128).toLowerCase();
    return clone(this.ensureServerState(serverId)?.slashCommands
      .find(command => command.id === key || command.name === key) || null);
  }

  updateSlashCommand(serverId, commandId, updates = {}) {
    const state = this.ensureServerState(serverId);
    const command = state?.slashCommands.find(item => item.id === String(commandId));
    if (!command) return null;
    if (updates.description !== undefined) command.description = text(updates.description, 100);
    if (updates.response !== undefined) command.response = text(updates.response, 2000);
    if (Array.isArray(updates.options)) command.options = clone(updates.options.slice(0, 25));
    if (updates.handlerType !== undefined && ['builtin', 'webhook'].includes(updates.handlerType)) command.handlerType = updates.handlerType;
    if (updates.webhookId !== undefined) command.webhookId = nullableText(updates.webhookId, 128);
    if (updates.requiredPermissions !== undefined || updates.permissions !== undefined) {
      command.requiredPermissions = this.normalizePermissions(updates.requiredPermissions ?? updates.permissions);
    }
    if (updates.enabled !== undefined) command.enabled = Boolean(updates.enabled);
    command.updatedAt = Date.now();
    this.save();
    return clone(command);
  }

  deleteSlashCommand(serverId, commandId) {
    const state = this.ensureServerState(serverId);
    const index = state?.slashCommands.findIndex(command => command.id === String(commandId)) ?? -1;
    if (index === -1) return false;
    state.slashCommands.splice(index, 1);
    this.save();
    return true;
  }

  executeCommand(serverId, name, context = {}) {
    const command = this.ensureServerState(serverId)?.slashCommands
      .find(item => item.name === text(name, 32).toLowerCase() && item.enabled);
    if (!command) return null;
    if (context.userId && command.requiredPermissions?.length) {
      const hasEveryPermission = command.requiredPermissions.every(permission => (
        context.channelId
          ? this.hasChannelPermission(context.channelId, context.userId, permission)
          : this.storage.hasPermission(serverId, context.userId, permission)
      ));
      if (!hasEveryPermission) return null;
    }
    return {
      commandId: command.id,
      name: command.name,
      response: command.response || '',
      options: isRecord(context.options) ? clone(context.options) : {},
      ephemeral: Boolean(command.ephemeral),
    };
  }

  createEmoji(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, uploadedBy: suppliedInput.uploadedBy || actorIdOrInput };
    return this.createMediaAsset(serverId, 'emojis', input, 32);
  }

  listEmojis(serverId) {
    return clone(this.ensureServerState(serverId)?.emojis || []);
  }

  updateEmoji(serverId, emojiId, updates = {}) {
    return this.updateMediaAsset(serverId, 'emojis', emojiId, updates, 32);
  }

  deleteEmoji(serverId, emojiId) {
    return this.deleteMediaAsset(serverId, 'emojis', emojiId);
  }

  createSticker(serverId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, uploadedBy: suppliedInput.uploadedBy || actorIdOrInput };
    return this.createMediaAsset(serverId, 'stickers', input, 30);
  }

  listStickers(serverId) {
    return clone(this.ensureServerState(serverId)?.stickers || []);
  }

  updateSticker(serverId, stickerId, updates = {}) {
    return this.updateMediaAsset(serverId, 'stickers', stickerId, updates, 30);
  }

  deleteSticker(serverId, stickerId) {
    return this.deleteMediaAsset(serverId, 'stickers', stickerId);
  }

  createMediaAsset(serverId, collection, input, maxNameLength) {
    const state = this.ensureServerState(serverId);
    const name = text(input.name, maxNameLength).replace(/\s+/g, '_');
    const url = nullableMediaUrl(input.url);
    if (!state || !name || !url || state[collection].some(asset => asset.name.toLowerCase() === name.toLowerCase())) return null;
    const asset = {
      id: uuidv4(),
      serverId: text(serverId, 128),
      name,
      url,
      description: text(input.description, 100),
      contentType: nullableText(input.contentType, 100),
      animated: Boolean(input.animated),
      roleIds: idList(input.roleIds, 100),
      uploadedBy: nullableText(input.uploadedBy, 128),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state[collection].push(asset);
    this.save();
    return clone(asset);
  }

  updateMediaAsset(serverId, collection, assetId, updates, maxNameLength) {
    const state = this.ensureServerState(serverId);
    const asset = state?.[collection].find(item => item.id === String(assetId));
    if (!asset) return null;
    if (updates.name !== undefined && text(updates.name, maxNameLength)) asset.name = text(updates.name, maxNameLength).replace(/\s+/g, '_');
    if (updates.description !== undefined) asset.description = text(updates.description, 100);
    if (updates.roleIds !== undefined) asset.roleIds = idList(updates.roleIds, 100);
    asset.updatedAt = Date.now();
    this.save();
    return clone(asset);
  }

  deleteMediaAsset(serverId, collection, assetId) {
    const state = this.ensureServerState(serverId);
    const index = state?.[collection].findIndex(asset => asset.id === String(assetId)) ?? -1;
    if (index === -1) return false;
    state[collection].splice(index, 1);
    this.save();
    return true;
  }

  resolveChannel(serverIdOrChannelId, maybeChannelId = null) {
    const channelId = text(maybeChannelId || serverIdOrChannelId, 128);
    const channel = this.storage.getChannelById(channelId);
    if (!channel) return null;
    if (maybeChannelId && channel.serverId !== String(serverIdOrChannelId)) return null;
    return channel;
  }

  ensureChannelState(serverId, channelId) {
    const state = this.ensureServerState(serverId);
    if (!state) return null;
    const existing = isRecord(state.channels[channelId]) ? state.channels[channelId] : {};
    if (!isRecord(existing.metadata)) existing.metadata = {};
    if (!Array.isArray(existing.permissionOverrides)) existing.permissionOverrides = [];
    state.channels[channelId] = existing;
    return existing;
  }

  getChannelSettings(serverIdOrChannelId, maybeChannelId = null) {
    const channel = this.resolveChannel(serverIdOrChannelId, maybeChannelId);
    if (!channel) return null;
    const settings = this.ensureChannelState(channel.serverId, channel.id);
    return clone({
      channelId: channel.id,
      serverId: channel.serverId,
      metadata: {
        topic: '',
        nsfw: false,
        slowModeSeconds: 0,
        position: null,
        categoryId: null,
        announcement: false,
        archived: false,
        locked: false,
        bitrate: 64_000,
        userLimit: 0,
        ...settings.metadata,
      },
      permissionOverrides: settings.permissionOverrides,
    });
  }

  getChannelMetadata(channelId) {
    return this.getChannelSettings(channelId)?.metadata || null;
  }

  updateChannelMetadata(serverIdOrChannelId, channelIdOrUpdates, maybeUpdates = null) {
    const overloaded = isRecord(channelIdOrUpdates) && maybeUpdates === null;
    const channel = overloaded
      ? this.resolveChannel(serverIdOrChannelId)
      : this.resolveChannel(serverIdOrChannelId, channelIdOrUpdates);
    const updates = overloaded ? channelIdOrUpdates : maybeUpdates;
    if (!channel || !isRecord(updates)) return null;
    const settings = this.ensureChannelState(channel.serverId, channel.id);
    const metadata = {
      topic: '',
      nsfw: false,
      slowModeSeconds: 0,
      position: null,
      categoryId: null,
      announcement: false,
      archived: false,
      locked: false,
      bitrate: 64_000,
      userLimit: 0,
      ...settings.metadata,
    };
    if (updates.name !== undefined && text(updates.name, 100)) channel.name = text(updates.name, 100);
    if (updates.type !== undefined && ['text', 'voice', 'category', 'announcement', 'forum', 'stage', 'media'].includes(updates.type)) {
      channel.type = updates.type;
    }
    if (updates.topic !== undefined) metadata.topic = text(updates.topic, 1024);
    if (updates.nsfw !== undefined) metadata.nsfw = Boolean(updates.nsfw);
    const slowModeValue = updates.slowModeSeconds ?? updates.slowmodeSeconds;
    if (slowModeValue !== undefined) metadata.slowModeSeconds = integer(slowModeValue, 0, 21_600, 0);
    if (updates.position !== undefined) metadata.position = Number.isFinite(Number(updates.position)) ? Number(updates.position) : null;
    if (updates.categoryId !== undefined) metadata.categoryId = nullableText(updates.categoryId, 128);
    ['announcement', 'archived', 'locked'].forEach(key => {
      if (updates[key] !== undefined) metadata[key] = Boolean(updates[key]);
    });
    if (updates.bitrate !== undefined) metadata.bitrate = integer(updates.bitrate, 8_000, 384_000, 64_000);
    if (updates.userLimit !== undefined) metadata.userLimit = integer(updates.userLimit, 0, 99, 0);
    if (updates.tags !== undefined) metadata.tags = idList(updates.tags, 20);
    metadata.updatedAt = Date.now();
    settings.metadata = metadata;
    this.save();
    return clone({
      ...channel,
      ...metadata,
      slowmodeSeconds: metadata.slowModeSeconds,
      metadata,
      permissionOverrides: settings.permissionOverrides,
    });
  }

  listChannelPermissionOverrides(channelId) {
    return clone(this.getChannelSettings(channelId)?.permissionOverrides || []);
  }

  normalizePermissions(permissions) {
    const allowed = new Set(this.storage.ALL_PERMISSIONS || this.storage.PERMISSIONS || []);
    return idList(permissions, allowed.size || 100).filter(permission => allowed.has(permission));
  }

  setChannelPermissionOverride(channelId, input = {}) {
    const channel = this.resolveChannel(channelId);
    const targetType = input.targetType || input.type;
    const targetId = text(input.targetId || input.id, 128);
    if (!channel || !OVERRIDE_TYPES.has(targetType) || !targetId) return null;
    const settings = this.ensureChannelState(channel.serverId, channel.id);
    const allow = this.normalizePermissions(input.allow);
    const deny = this.normalizePermissions(input.deny).filter(permission => !allow.includes(permission));
    const override = {
      id: input.overrideId ? text(input.overrideId, 128) : uuidv4(),
      targetType,
      targetId,
      allow,
      deny,
      updatedAt: Date.now(),
      updatedBy: nullableText(input.updatedBy, 128),
    };
    const index = settings.permissionOverrides.findIndex(item => item.targetType === targetType && item.targetId === targetId);
    if (index === -1) settings.permissionOverrides.push(override);
    else settings.permissionOverrides[index] = { ...settings.permissionOverrides[index], ...override, id: settings.permissionOverrides[index].id };
    this.save();
    return clone(index === -1 ? override : settings.permissionOverrides[index]);
  }

  deleteChannelPermissionOverride(channelId, targetTypeOrOverrideId, maybeTargetId = null) {
    const channel = this.resolveChannel(channelId);
    if (!channel) return false;
    const settings = this.ensureChannelState(channel.serverId, channel.id);
    const index = settings.permissionOverrides.findIndex(override => (
      maybeTargetId
        ? override.targetType === targetTypeOrOverrideId && override.targetId === String(maybeTargetId)
        : override.id === String(targetTypeOrOverrideId)
    ));
    if (index === -1) return false;
    settings.permissionOverrides.splice(index, 1);
    this.save();
    return true;
  }

  getEffectiveChannelPermissions(channelId, userId) {
    const channel = this.resolveChannel(channelId);
    if (!channel || !this.storage.isServerMember(channel.serverId, userId)) return [];
    const base = new Set(this.storage.getMemberPermissions(channel.serverId, userId));
    if (base.has('ADMINISTRATOR')) return clone(this.storage.ALL_PERMISSIONS || [...base]);
    const overrides = this.ensureChannelState(channel.serverId, channel.id).permissionOverrides;
    const everyoneId = this.storage.getDefaultRoleId(channel.serverId);
    const everyone = overrides.find(item => item.targetType === 'role' && item.targetId === everyoneId);
    (everyone?.deny || []).forEach(permission => base.delete(permission));
    (everyone?.allow || []).forEach(permission => base.add(permission));

    const roleIds = new Set(this.storage.getMemberRoleIds(channel.serverId, userId));
    const roleOverrides = overrides.filter(item => item.targetType === 'role' && roleIds.has(item.targetId));
    const roleDeny = new Set(roleOverrides.flatMap(item => item.deny || []));
    const roleAllow = new Set(roleOverrides.flatMap(item => item.allow || []));
    roleDeny.forEach(permission => base.delete(permission));
    roleAllow.forEach(permission => base.add(permission));

    const member = overrides.find(item => item.targetType === 'member' && item.targetId === String(userId));
    (member?.deny || []).forEach(permission => base.delete(permission));
    (member?.allow || []).forEach(permission => base.add(permission));
    return [...base];
  }

  hasChannelPermission(channelId, userId, permission) {
    return this.getEffectiveChannelPermissions(channelId, userId).includes(permission);
  }

  createAnnouncementFollow(sourceChannelId, targetChannelId, createdBy = null) {
    const source = this.storage.getChannelById(sourceChannelId);
    const target = this.storage.getChannelById(targetChannelId);
    if (!source || !target || source.type !== 'announcement' || source.serverId === target.serverId
      || !['text', 'announcement'].includes(target.type)) return null;
    const state = this.ensureServerState(source.serverId);
    state.announcementFollows = Array.isArray(state.announcementFollows) ? state.announcementFollows : [];
    const existing = state.announcementFollows.find(item => (
      item.sourceChannelId === source.id && item.targetChannelId === target.id
    ));
    if (existing) return clone(existing);
    const follow = {
      id: uuidv4(),
      sourceServerId: source.serverId,
      sourceChannelId: source.id,
      targetServerId: target.serverId,
      targetChannelId: target.id,
      createdBy: nullableText(createdBy, 128),
      createdAt: Date.now(),
    };
    state.announcementFollows.push(follow);
    this.save();
    return clone(follow);
  }

  listAnnouncementFollows(sourceChannelId) {
    const source = this.storage.getChannelById(sourceChannelId);
    if (!source) return [];
    return clone((this.ensureServerState(source.serverId)?.announcementFollows || [])
      .filter(item => item.sourceChannelId === source.id));
  }

  getAnnouncementFollowers(sourceChannelId) {
    return this.listAnnouncementFollows(sourceChannelId);
  }

  deleteAnnouncementFollow(sourceChannelId, followId) {
    const source = this.storage.getChannelById(sourceChannelId);
    const state = source && this.ensureServerState(source.serverId);
    const index = state?.announcementFollows?.findIndex(item => (
      item.id === String(followId) && item.sourceChannelId === source.id
    )) ?? -1;
    if (index === -1) return false;
    state.announcementFollows.splice(index, 1);
    this.save();
    return true;
  }

  // Route katmanında kullanılan kısa uyumluluk adları. Asıl metotları
  // koruduğumuz has daha önce yazılmış çağrılar da çalışmaya devam eder.
  consumeInvite(code, userId) {
    return this.useInvite(code, userId);
  }

  getAuditLogs(serverId, options = {}) {
    return this.listAuditLogs(serverId, options);
  }

  getAutomodConfig(serverId) {
    return this.getAutoModSettings(serverId);
  }

  updateAutomodConfig(serverId, updates = {}) {
    return this.updateAutoModSettings(serverId, updates);
  }

  banUser(serverId, userId, actorIdOrInput = {}, maybeInput = {}) {
    const suppliedInput = isRecord(maybeInput) ? maybeInput : {};
    const input = isRecord(actorIdOrInput)
      ? actorIdOrInput
      : { ...suppliedInput, createdBy: suppliedInput.createdBy || actorIdOrInput };
    const ban = this.createBan(serverId, { ...input, userId });
    if (ban && this.storage.isServerMember(serverId, userId)) this.storage.removeServerMember(serverId, userId);
    return ban;
  }

  unbanUser(serverId, userId, actorId = null) {
    return this.removeBan(serverId, userId, actorId);
  }

  isBanned(serverId, userId) {
    return this.isUserBanned(serverId, userId);
  }

  acknowledgeOnboarding(serverId, userId, input = {}) {
    const rules = this.ensureServerState(serverId)?.rulesScreening?.rules || [];
    return this.acknowledgeRules(serverId, userId, {
      ...input,
      acceptedRuleIds: input.acceptedRuleIds || rules.map(rule => rule.id),
      onboardingResponses: input.onboardingResponses || input.answers || {},
    });
  }

  rsvpEvent(serverId, eventId, userId, status) {
    return this.setEventRsvp(serverId, eventId, userId, status);
  }

  getDiscovery(serverIdOrFilters = {}) {
    return isRecord(serverIdOrFilters)
      ? this.listDiscoverableServers(serverIdOrFilters)
      : this.getDiscoverySettings(serverIdOrFilters);
  }

  createCommand(serverId, actorIdOrInput = {}, maybeInput = {}) {
    return this.createSlashCommand(serverId, actorIdOrInput, maybeInput);
  }

  listCommands(serverId, options = {}) {
    return this.listSlashCommands(serverId, options);
  }

  getCommand(serverId, idOrName) {
    return this.getSlashCommand(serverId, idOrName);
  }

  updateCommand(serverId, commandId, updates = {}) {
    return this.updateSlashCommand(serverId, commandId, updates);
  }

  deleteCommand(serverId, commandId) {
    return this.deleteSlashCommand(serverId, commandId);
  }

  listChannelOverrides(serverIdOrChannelId, maybeChannelId = null) {
    const channel = this.resolveChannel(serverIdOrChannelId, maybeChannelId);
    return channel ? this.listChannelPermissionOverrides(channel.id) : [];
  }

  setChannelOverride(serverIdOrChannelId, channelIdOrType = {}, targetIdOrInput = null, maybeInput = {}) {
    const directObject = isRecord(channelIdOrType);
    const channelScopedTuple = !directObject
      && typeof targetIdOrInput === 'string'
      && isRecord(maybeInput)
      && OVERRIDE_TYPES.has(channelIdOrType);
    const channel = directObject || channelScopedTuple
      ? this.resolveChannel(serverIdOrChannelId)
      : this.resolveChannel(serverIdOrChannelId, channelIdOrType);
    let input;
    if (directObject) input = channelIdOrType;
    else if (channelScopedTuple) input = { ...maybeInput, targetType: channelIdOrType, targetId: targetIdOrInput };
    else input = isRecord(targetIdOrInput) ? targetIdOrInput : maybeInput;
    return channel ? this.setChannelPermissionOverride(channel.id, input) : null;
  }

  deleteChannelOverride(serverIdOrChannelId, channelIdOrTarget, targetOrMaybeTargetId = null, maybeTargetId = null) {
    const hasServerId = Boolean(this.resolveChannel(serverIdOrChannelId, channelIdOrTarget));
    const channel = hasServerId
      ? this.resolveChannel(serverIdOrChannelId, channelIdOrTarget)
      : this.resolveChannel(serverIdOrChannelId);
    if (!channel) return false;
    return hasServerId
      ? this.deleteChannelPermissionOverride(channel.id, targetOrMaybeTargetId, maybeTargetId)
      : this.deleteChannelPermissionOverride(channel.id, channelIdOrTarget, targetOrMaybeTargetId);
  }

  createTag(serverId, input = {}) {
    return this.createForumTag(serverId, input);
  }

  listTags(serverId, channelId = null) {
    return this.listForumTags(serverId, channelId);
  }

  addReply(serverId, postId, input = {}) {
    return this.addForumReply(serverId, postId, input);
  }

  vote(serverId, pollId, userId, optionIds) {
    return this.votePoll(serverId, pollId, userId, optionIds);
  }
}

const platformService = new PlatformService();

module.exports = {
  PlatformService,
  platformService,
  PLATFORM_STATE_VERSION,
};
