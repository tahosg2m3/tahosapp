const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SQLiteStateStore } = require('./sqliteStateStore');

// Electron paketinde uygulama kaynak klasörüne yazılamaz. APP_DATA_DIR verildiğinde
// kalıcı veriyi kullanıcının uygulama verisi klasöründe tutarız.
const DATA_DIRECTORY = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '../..');
const DATA_FILE = path.join(DATA_DIRECTORY, 'data.json');
const currentDesktopDatabase = path.join(DATA_DIRECTORY, 'tahosapp.sqlite');
const legacyDesktopDatabase = path.join(DATA_DIRECTORY, 'discord-clone.sqlite');
const DATABASE_FILE = process.env.APP_DATA_DIR
  ? (fs.existsSync(currentDesktopDatabase) || !fs.existsSync(legacyDesktopDatabase)
    ? currentDesktopDatabase
    : legacyDesktopDatabase)
  : path.join(DATA_DIRECTORY, 'data.sqlite');
const DATA_ENCRYPTION_KEY_FILE = path.join(
  DATA_DIRECTORY,
  process.env.APP_DATA_DIR ? 'data-encryption.key' : 'data.sqlite-key',
);

const PERMISSIONS = Object.freeze([
  'ADMINISTRATOR',
  'CREATE_INSTANT_INVITE',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'MANAGE_MESSAGES',
  'MANAGE_SERVER',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'MODERATE_MEMBERS',
  'VIEW_AUDIT_LOG',
  'MANAGE_EVENTS',
  'MANAGE_WEBHOOKS',
  'MANAGE_EMOJIS_AND_STICKERS',
  'MENTION_EVERYONE',
  'CREATE_PUBLIC_THREADS',
  'SEND_MESSAGES_IN_THREADS',
  'CONNECT',
  'SPEAK',
  'STREAM',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
]);

const DEFAULT_MEMBER_PERMISSIONS = Object.freeze([
  'CREATE_INSTANT_INVITE',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'CONNECT',
  'SPEAK',
  'STREAM',
]);

const ALL_PERMISSIONS = Object.freeze([...PERMISSIONS]);
const PRESENCE_STATUSES = Object.freeze(['online', 'idle', 'dnd', 'invisible']);
const SUPPORTED_LOCALES = Object.freeze(['tr', 'en', 'de', 'fr', 'es', 'pt-BR', 'it', 'ru', 'ar', 'ja', 'ko', 'zh-CN']);
const SUPPORTED_THEMES = Object.freeze([
  'dark',
  'midnight',
  'light',
  'ocean',
  'forest',
  'rose',
  'sunset',
  'cyber',
  'lavender',
  'coffee',
]);
const SUPPORTED_PROFILE_THEMES = Object.freeze([
  'default',
  'aurora',
  'ocean',
  'sunset',
  'forest',
  'rose',
  'midnight',
  'monochrome',
]);
const SUPPORTED_NAME_FONTS = Object.freeze(['default', 'rounded', 'serif', 'mono', 'handwritten', 'wide']);
const SUPPORTED_NAME_EFFECTS = Object.freeze(['none', 'gradient', 'glow', 'shimmer']);
const SUPPORTED_AVATAR_DECORATIONS = Object.freeze(['none', 'ring', 'sparkles', 'neon', 'orbit']);
const SUPPORTED_PROFILE_EFFECTS = Object.freeze(['none', 'soft-glow', 'waves', 'stars']);
const DEFAULT_PROFILE_ACCENT = '#7c5cff';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function sanitizeText(value, { field, maxLength, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') throw new Error(`${field || 'Field'} must be text.`);

  // NUL and diğer kontrol karakterleri JSON, log and istemci actione akışlarında
  // beklenmeyen davranışlara yol açabilir. Satır sonu and sekmeye izin verilir.
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (clean.length > maxLength) throw new Error(`${field || 'Field'} can contain at most ${maxLength} characters.`);
  return clean || (nullable ? null : '');
}

function sanitizeMediaUrl(value, field) {
  if (value === undefined) return undefined;
  const clean = sanitizeText(value, { field, maxLength: 2048, nullable: true });
  if (!clean) return null;
  if (/[\r\n\t]/.test(clean)) throw new Error(`${field} must be a valid address.`);

  // Yerel yüklemeler sadece uygulamanın uploads dizininden, uzaktaki görseller ise
  // yalnızca HTTP(S) üzerinden gelebilir. javascript:/file:/data: gibi şemalar reddedilir.
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(clean)) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.username || parsed.password) throw new Error('credentials are not allowed');
    const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localDevelopmentHost)) return parsed.href;
  } catch (_) {
    // Aşağıdaki ortak doğrulama hatası döndürülür.
  }
  throw new Error(`${field} must be a valid HTTP(S) or upload address.`);
}

function normalizeStoredUserProfile(user) {
  let changed = false;
  const defaults = {
    banner: null,
    bio: '',
    customStatus: '',
    presenceStatus: 'online',
    locale: 'tr',
    localeExplicit: false,
    theme: 'dark',
    profileTheme: 'default',
    profileAccentColor: DEFAULT_PROFILE_ACCENT,
    nameFont: 'default',
    nameEffect: 'none',
    avatarDecoration: 'none',
    profileEffect: 'none',
    emailVerified: Boolean(user.email),
  };

  Object.entries(defaults).forEach(([key, fallback]) => {
    if (user[key] === undefined) {
      user[key] = fallback;
      changed = true;
    }
  });
  if (!PRESENCE_STATUSES.includes(user.presenceStatus)) {
    user.presenceStatus = 'online';
    changed = true;
  }
  if (!SUPPORTED_LOCALES.includes(user.locale)) {
    user.locale = 'tr';
    changed = true;
  }
  if (!SUPPORTED_THEMES.includes(user.theme)) {
    user.theme = 'dark';
    changed = true;
  }
  if (!SUPPORTED_PROFILE_THEMES.includes(user.profileTheme)) {
    user.profileTheme = 'default';
    changed = true;
  }
  if (!/^#[0-9a-f]{6}$/i.test(String(user.profileAccentColor || ''))) {
    user.profileAccentColor = DEFAULT_PROFILE_ACCENT;
    changed = true;
  }
  if (!SUPPORTED_NAME_FONTS.includes(user.nameFont)) {
    user.nameFont = 'default';
    changed = true;
  }
  if (!SUPPORTED_NAME_EFFECTS.includes(user.nameEffect)) {
    user.nameEffect = 'none';
    changed = true;
  }
  if (!SUPPORTED_AVATAR_DECORATIONS.includes(user.avatarDecoration)) {
    user.avatarDecoration = 'none';
    changed = true;
  }
  if (!SUPPORTED_PROFILE_EFFECTS.includes(user.profileEffect)) {
    user.profileEffect = 'none';
    changed = true;
  }
  return changed;
}

function parsePersistedMap(value) {
  if (!value) return new Map();

  try {
    const entries = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(entries) ? new Map(entries) : new Map();
  } catch (error) {
    return new Map();
  }
}

function sanitizePermissions(permissions) {
  const values = Array.isArray(permissions) ? permissions : [];
  return [...new Set(values.filter(permission => PERMISSIONS.includes(permission)))];
}

function getDefaultRoleId(serverId) {
  return `@everyone:${serverId}`;
}

function createDefaultRole(serverId) {
  return {
    id: getDefaultRoleId(serverId),
    serverId,
    name: '@everyone',
    color: null,
    icon: null,
    hoist: false,
    mentionable: false,
    permissions: [...DEFAULT_MEMBER_PERMISSIONS],
    position: 0,
    isDefault: true,
    managed: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function copyRole(role) {
  return { ...role, permissions: [...(role.permissions || [])] };
}

function publicUser(user) {
  if (!user) return null;
  const { password, email, tokenVersion, platformRole, platformBan, platformBanClearedAt, platformBanClearedBy, ...safeUser } = user;
  // Invisiblelik tercihi başka kullanıcılara sızdırılmaz.
  if (safeUser.presenceStatus === 'invisible') safeUser.presenceStatus = 'offline';
  return safeUser;
}

class InMemoryStorage {
  constructor() {
    this.servers = [];
    this.channels = [];
    this.users = [];
    this.friendRequests = [];
    this.friendships = [];
    this.channelMessages = new Map();
    this.userStatuses = new Map();
    this.serverMembers = new Map();
    this.serverRoles = new Map();
    this.serverMemberRoles = new Map();
    this.serverModeration = new Map();
    this.serverMemberProfiles = new Map();
    this.userBlocks = new Map();
    // Notlar yalnızca notu yazan kullanıcıya aittir. Anahtar biçimi
    // `viewerUserId:targetUserId` olduğu has başka bir kullanıcı aynı profil
    // has yazılan notu okuyamaz.
    this.profileNotes = new Map();
    // Platform özellikleri kendi sürümlü alanında tutulur.
    // Düz obje kullanmak eski JSON/SQLite snapshot biçimiyle geriye uyumludur;
    // ayrıntılı normalizasyonu platformService üstlenir.
    this.platformState = {
      version: 1,
      servers: {},
      notificationPreferences: {},
      templates: [],
      backups: [],
      uninstallFeedback: { total: 0, reasons: {}, versions: {}, lastReceivedAt: null },
    };
    this.saveTimeout = null;
    this.isClosed = false;
    this.closeResult = null;
    this.stateStore = new SQLiteStateStore({
      databasePath: DATABASE_FILE,
      legacyDataFile: DATA_FILE,
      encryptionKeyFile: DATA_ENCRYPTION_KEY_FILE,
    });
    this.loadData();
  }

  loadData() {
    try {
      const data = this.stateStore.load();
      if (!data) {
        this.seedData();
        return;
      }

      this.servers = Array.isArray(data.servers) ? data.servers : [];
      this.channels = Array.isArray(data.channels) ? data.channels : [];
      this.users = Array.isArray(data.users) ? data.users : [];
      this.friendRequests = Array.isArray(data.friendRequests) ? data.friendRequests : [];
      this.friendships = Array.isArray(data.friendships) ? data.friendships : [];
      this.channelMessages = parsePersistedMap(data.channelMessages);
      // Online status kalıcı değildir: uygulama yeniden açıldığında herkes offline başlar.
      this.userStatuses = new Map(this.users.map(user => [user.id, 'offline']));
      this.serverMembers = parsePersistedMap(data.serverMembers);
      this.serverRoles = parsePersistedMap(data.serverRoles);
      this.serverMemberRoles = parsePersistedMap(data.serverMemberRoles);
      this.serverModeration = parsePersistedMap(data.serverModeration);
      this.serverMemberProfiles = parsePersistedMap(data.serverMemberProfiles);
      this.userBlocks = parsePersistedMap(data.userBlocks);
      this.profileNotes = parsePersistedMap(data.profileNotes);
      this.platformState = data.platformState && typeof data.platformState === 'object' && !Array.isArray(data.platformState)
        ? data.platformState
        : {
          version: 1,
          servers: {},
          notificationPreferences: {},
          templates: [],
          backups: [],
          uninstallFeedback: { total: 0, reasons: {}, versions: {}, lastReceivedAt: null },
        };

      if (!this.platformState.uninstallFeedback || typeof this.platformState.uninstallFeedback !== 'object') {
        this.platformState.uninstallFeedback = { total: 0, reasons: {}, versions: {}, lastReceivedAt: null };
      }

      const userProfilesChanged = this.users.reduce((changed, user) => (
        normalizeStoredUserProfile(user) || changed
      ), false);
      const roleDataChanged = this.migrateRoleData();
      const socialDataChanged = this.migrateSocialData();
      const platformOwnerChanged = this.ensurePlatformOwner();
      if (roleDataChanged || socialDataChanged || platformOwnerChanged || userProfilesChanged) this.saveData();
    } catch (error) {
      // Passwordleme anahtarı uyuşmazlığı, bozuk authentication tag veya okunamayan
      // kalıcı veri asla "boş kurulum" sayılmaz. Aksi halde seedData mevcut
      // verinin üzerine yazıp gerçek kaybı gizleyebilirdi. Başlangıcı fail-closed
      // durdurur and operatöre asıl hatayı açıkça gösteririz.
      console.error('Persistent application data could not be loaded safely; data was not reset:', error.message);
      throw error;
    }
  }

  saveData() {
    if (this.isClosed) {
      console.error('Data could not be saved because persistent storage was already closed.');
      return;
    }
    if (this.saveTimeout) clearTimeout(this.saveTimeout);

    this.saveTimeout = setTimeout(() => {
      try {
        const persisted = this.stateStore.save(this.createPersistedSnapshot());
        if (!persisted) {
          console.error('Data could not be saved because the persistent storage write failed.');
        }
      } catch (error) {
        console.error('Data could not be saved:', error.message);
      } finally {
        this.saveTimeout = null;
      }
    }, 500);
  }

  // Uygulama kapanırken son 500 ms içindeki değişikliklerin de kalıcı olmasını
  // sağlar. Bu yöntem özellikle Electron'un backend sürecine SIGTERM yolladığı
  // durumda çağrılır.
  flush() {
    if (this.isClosed) {
      console.error('Data could not be saved because persistent storage was already closed.');
      return false;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      const persisted = this.stateStore.save(this.createPersistedSnapshot());
      if (!persisted) {
        console.error('Data could not be saved during shutdown because the persistent storage write failed.');
      }
      return persisted;
    } catch (error) {
      console.error('Data could not be saved during shutdown:', error.message);
      return false;
    }
  }

  close() {
    // SQLiteStateStore.close() codec anahtarını bellekten sıfırlar. İkinci bir
    // close çağrısında sıfırlanmış anahtarla tekrar flush edip veriyi bozma.
    if (this.isClosed) return this.closeResult;
    const persisted = this.flush();
    let closed = true;
    try {
      this.stateStore.close();
    } catch (error) {
      console.error('Persistent storage could not be closed safely:', error.message);
      closed = false;
    }
    this.isClosed = true;
    this.closeResult = persisted && closed;
    return this.closeResult;
  }

  async transformArchivedSnapshots(transformer) {
    return this.stateStore.transformLegacySnapshots(transformer);
  }

  createPersistedSnapshot() {
    return {
      servers: this.servers,
      channels: this.channels,
      users: this.users,
      friendRequests: this.friendRequests,
      friendships: this.friendships,
      channelMessages: JSON.stringify(Array.from(this.channelMessages.entries())),
      userStatuses: JSON.stringify(Array.from(this.userStatuses.entries())),
      serverMembers: JSON.stringify(Array.from(this.serverMembers.entries())),
      serverRoles: JSON.stringify(Array.from(this.serverRoles.entries())),
      serverMemberRoles: JSON.stringify(Array.from(this.serverMemberRoles.entries())),
      serverModeration: JSON.stringify(Array.from(this.serverModeration.entries())),
      serverMemberProfiles: JSON.stringify(Array.from(this.serverMemberProfiles.entries())),
      userBlocks: JSON.stringify(Array.from(this.userBlocks.entries())),
      profileNotes: JSON.stringify(Array.from(this.profileNotes.entries())),
      platformState: this.platformState,
    };
  }

  seedData() {
    const defaultServer = {
      id: 'default-server',
      name: 'General Server',
      creatorId: 'system',
      inviteCode: 'PUBLIC',
      createdAt: Date.now(),
      isDM: false,
    };

    this.servers = [defaultServer];
    this.channels = [
      { id: uuidv4(), name: 'general', serverId: defaultServer.id, type: 'text', createdAt: Date.now() },
      { id: uuidv4(), name: 'voice-chat', serverId: defaultServer.id, type: 'voice', createdAt: Date.now() },
    ];
    this.serverMembers.set(defaultServer.id, []);
    this.ensureServerRoleData(defaultServer.id);
    this.saveData();
  }

  recordUninstallFeedback(reason, version) {
    const current = this.platformState.uninstallFeedback;
    const feedback = current && typeof current === 'object'
      ? current
      : { total: 0, reasons: {}, versions: {}, lastReceivedAt: null };
    feedback.reasons = feedback.reasons && typeof feedback.reasons === 'object' ? feedback.reasons : {};
    feedback.versions = feedback.versions && typeof feedback.versions === 'object' ? feedback.versions : {};
    feedback.total = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(feedback.total) || 0) + 1);
    feedback.reasons[reason] = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, Number(feedback.reasons[reason]) || 0) + 1,
    );
    feedback.versions[version] = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, Number(feedback.versions[version]) || 0) + 1,
    );
    feedback.lastReceivedAt = Date.now();
    this.platformState.uninstallFeedback = feedback;
    this.saveData();
    return { total: feedback.total };
  }

  migrateRoleData() {
    let changed = false;

    this.servers.filter(server => !server.isDM).forEach(server => {
      if (!this.serverMembers.has(server.id)) {
        this.serverMembers.set(server.id, []);
        changed = true;
      }

      // Eski demo sunucusunda sahip "system" idi and gerçek bir hesap olmadığı için
      // ayarlar/roller kilitli kalıyordu. İlk geçerli memberyi sahip yaparak eski veriyi taşırız.
      if (server.id === 'default-server' && server.creatorId === 'system') {
        const firstRealMember = (this.serverMembers.get(server.id) || []).find(userId => this.getUserById(userId));
        if (firstRealMember) {
          server.creatorId = firstRealMember;
          changed = true;
        }
      }

      changed = this.ensureServerRoleData(server.id) || changed;
    });

    return changed;
  }

  ensurePlatformOwner() {
    if (this.users.some(user => user.platformRole === 'owner')) return false;
    const firstAccount = this.users
      .filter(user => user.email && user.password)
      .sort((left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0))[0];
    if (!firstAccount) return false;
    firstAccount.platformRole = 'owner';
    return true;
  }

  migrateSocialData() {
    let changed = false;
    const validUserIds = new Set(this.users.map(user => user.id));

    for (const [serverId, memberList] of this.serverMembers.entries()) {
      const rawProfiles = this.serverMemberProfiles.get(serverId);
      const memberIds = new Set(this.serverMembers.get(serverId) || []);
      const server = this.getServerById(serverId);
      const profiles = rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles)
        ? rawProfiles
        : {};
      const cleaned = {};
      (Array.isArray(memberList) ? memberList : []).forEach(userId => {
        const profile = profiles[userId] && typeof profiles[userId] === 'object' ? profiles[userId] : {};
        if (!memberIds.has(userId) || !profile || typeof profile !== 'object') {
          changed = true;
          return;
        }
        const nickname = typeof profile.nickname === 'string' ? profile.nickname.trim().slice(0, 32) : '';
        let serverAvatar = null;
        let serverBanner = null;
        try {
          serverAvatar = sanitizeMediaUrl(profile.serverAvatar, 'Server avatar') || null;
          serverBanner = sanitizeMediaUrl(profile.serverBanner, 'Server banner') || null;
        } catch (_) {
          changed = true;
        }
        const serverBio = typeof profile.serverBio === 'string' ? profile.serverBio.trim().slice(0, 300) : '';
        const user = this.getUserById(userId);
        const joinedAt = Number(profile.joinedAt)
          || Math.max(Number(server?.createdAt) || 0, Number(user?.createdAt) || 0)
          || Date.now();
        cleaned[userId] = {
          nickname: nickname || null,
          serverAvatar,
          serverBanner,
          serverBio,
          joinedAt,
          updatedAt: Number(profile.updatedAt) || joinedAt,
        };
      });
      if (JSON.stringify(profiles) !== JSON.stringify(cleaned)) changed = true;
      this.serverMemberProfiles.set(serverId, cleaned);
    }

    for (const [key, rawNote] of this.profileNotes.entries()) {
      const [viewerId, targetId, ...extra] = String(key).split(':');
      if (extra.length || !validUserIds.has(viewerId) || !validUserIds.has(targetId) || viewerId === targetId) {
        this.profileNotes.delete(key);
        changed = true;
        continue;
      }
      const cleanNote = typeof rawNote === 'string' ? rawNote.trim().slice(0, 256) : '';
      if (!cleanNote) {
        this.profileNotes.delete(key);
        changed = true;
      } else if (cleanNote !== rawNote) {
        this.profileNotes.set(key, cleanNote);
        changed = true;
      }
    }

    for (const [userId, rawBlocks] of this.userBlocks.entries()) {
      if (!validUserIds.has(userId)) {
        this.userBlocks.delete(userId);
        changed = true;
        continue;
      }
      const seen = new Set();
      const cleaned = (Array.isArray(rawBlocks) ? rawBlocks : []).flatMap(entry => {
        const blockedUserId = typeof entry === 'string' ? entry : entry?.userId;
        if (!validUserIds.has(blockedUserId) || blockedUserId === userId || seen.has(blockedUserId)) {
          changed = true;
          return [];
        }
        seen.add(blockedUserId);
        return [{ userId: blockedUserId, createdAt: Number(entry?.createdAt) || Date.now() }];
      });
      if (JSON.stringify(rawBlocks) !== JSON.stringify(cleaned)) changed = true;
      this.userBlocks.set(userId, cleaned);
    }

    return changed;
  }

  ensureServerRoleData(serverId) {
    const server = this.getServerById(serverId);
    if (!server || server.isDM) return false;

    let changed = false;
    const defaultRoleId = getDefaultRoleId(serverId);
    const rawRoles = Array.isArray(this.serverRoles.get(serverId)) ? this.serverRoles.get(serverId) : [];
    const rolesById = new Map();

    rawRoles.forEach((role, index) => {
      if (!role || typeof role.id !== 'string' || rolesById.has(role.id)) {
        changed = true;
        return;
      }

      const isDefault = role.id === defaultRoleId || role.isDefault === true;
      const normalized = {
        id: isDefault ? defaultRoleId : role.id,
        serverId,
        name: isDefault ? '@everyone' : String(role.name || 'New role').trim().slice(0, 100) || 'New role',
        color: typeof role.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(role.color) ? role.color : null,
        icon: isDefault ? null : (role.icon ? String(role.icon).slice(0, 1000) : null),
        hoist: isDefault ? false : Boolean(role.hoist),
        mentionable: isDefault ? false : Boolean(role.mentionable),
        permissions: isDefault
          ? sanitizePermissions(role.permissions?.length ? role.permissions : DEFAULT_MEMBER_PERMISSIONS)
          : sanitizePermissions(role.permissions),
        position: Number.isFinite(Number(role.position)) ? Number(role.position) : index + 1,
        isDefault,
        managed: isDefault,
        createdAt: role.createdAt || Date.now(),
        updatedAt: role.updatedAt || role.createdAt || Date.now(),
      };

      if (isDefault && rolesById.has(defaultRoleId)) {
        changed = true;
        return;
      }

      rolesById.set(normalized.id, normalized);
    });

    if (!rolesById.has(defaultRoleId)) {
      rolesById.set(defaultRoleId, createDefaultRole(serverId));
      changed = true;
    }

    const orderedRoles = [...rolesById.values()]
      .filter(role => !role.isDefault)
      .sort((first, second) => first.position - second.position || first.createdAt - second.createdAt);
    const defaultRole = rolesById.get(defaultRoleId);
    defaultRole.position = 0;
    defaultRole.isDefault = true;
    defaultRole.managed = true;

    const normalizedRoles = [defaultRole, ...orderedRoles.map((role, index) => ({
      ...role,
      position: index + 1,
      isDefault: false,
      managed: false,
    }))];

    if (JSON.stringify(rawRoles) !== JSON.stringify(normalizedRoles)) changed = true;
    this.serverRoles.set(serverId, normalizedRoles);

    const memberIds = new Set(this.serverMembers.get(serverId) || []);
    const rawAssignments = this.serverMemberRoles.get(serverId);
    const assignments = rawAssignments && typeof rawAssignments === 'object' && !Array.isArray(rawAssignments)
      ? rawAssignments
      : {};
    const cleanedAssignments = {};

    Object.entries(assignments).forEach(([userId, roleIds]) => {
      if (!memberIds.has(userId)) {
        changed = true;
        return;
      }

      const cleanedRoleIds = [...new Set(Array.isArray(roleIds) ? roleIds : [])]
        .filter(roleId => roleId !== defaultRoleId && normalizedRoles.some(role => role.id === roleId && !role.isDefault));

      if (cleanedRoleIds.length) cleanedAssignments[userId] = cleanedRoleIds;
      if (JSON.stringify(roleIds || []) !== JSON.stringify(cleanedRoleIds)) changed = true;
    });

    if (JSON.stringify(assignments) !== JSON.stringify(cleanedAssignments)) changed = true;
    this.serverMemberRoles.set(serverId, cleanedAssignments);

    const rawModeration = this.serverModeration.get(serverId);
    const moderation = rawModeration && typeof rawModeration === 'object' && !Array.isArray(rawModeration)
      ? rawModeration
      : {};
    const cleanedModeration = {};

    Object.entries(moderation).forEach(([userId, state]) => {
      if (!memberIds.has(userId)) {
        changed = true;
        return;
      }

      const normalizedState = {
        serverMuted: Boolean(state?.serverMuted),
        serverDeafened: Boolean(state?.serverDeafened),
        timeoutUntil: Number(state?.timeoutUntil) > Date.now() ? Number(state.timeoutUntil) : null,
        updatedAt: state?.updatedAt || Date.now(),
        updatedBy: state?.updatedBy || null,
      };

      if (normalizedState.serverMuted || normalizedState.serverDeafened || normalizedState.timeoutUntil) {
        cleanedModeration[userId] = normalizedState;
      }
    });

    if (JSON.stringify(moderation) !== JSON.stringify(cleanedModeration)) changed = true;
    this.serverModeration.set(serverId, cleanedModeration);

    return changed;
  }

  getAllPermissions() { return [...ALL_PERMISSIONS]; }
  getDefaultRoleId(serverId) { return getDefaultRoleId(serverId); }

  getAllServers() { return [...this.servers]; }
  getServerById(id) { return this.servers.find(server => server.id === id); }
  getServerByInviteCode(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    return this.servers.find(server => (
      server.inviteCode?.toUpperCase() === normalizedCode
      || server.vanityCode?.toUpperCase() === normalizedCode
    ));
  }

  createUniqueServerInviteCode() {
    // Default davet kodu bir erişim anahtarıdır. Math.random hem tahmin
    // edilebilir hem de kısa kodlarda çakışma riski taşır. 80 bitlik CSPRNG
    // çıktı and benzersizlik kontrolü bu iki riski de ortadan kaldırır.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = crypto.randomBytes(10).toString('hex').toUpperCase();
      if (!this.getServerByInviteCode(code)) return code;
    }
    throw new Error('A unique server invite code could not be created.');
  }

  createServer(name, creatorId) {
    const server = {
      id: uuidv4(),
      name: String(name || '').trim(),
      creatorId,
      inviteCode: this.createUniqueServerInviteCode(),
      createdAt: Date.now(),
      isDM: false,
    };

    this.servers.push(server);
    this.serverMembers.set(server.id, []);
    this.ensureServerRoleData(server.id);
    this.addServerMember(server.id, creatorId);
    this.createChannel(server.id, 'general', 'text');
    this.saveData();
    return server;
  }

  updateServer(id, updates) {
    const server = this.getServerById(id);
    if (!server) return null;

    let nextVanityCode;
    if (updates.vanityCode !== undefined) {
      nextVanityCode = String(updates.vanityCode || '').trim().toLowerCase();
      const isValid = !nextVanityCode || /^[a-z0-9-]{3,32}$/.test(nextVanityCode);
      const isTaken = nextVanityCode && this.servers.some(item => (
        item.id !== id && String(item.vanityCode || '').toLowerCase() === nextVanityCode
      ));
      if (!isValid || isTaken) return null;
    }

    if (updates.name) server.name = String(updates.name).trim();
    if (updates.icon !== undefined) server.icon = updates.icon;
    if (updates.description !== undefined) server.description = String(updates.description || '').trim().slice(0, 1000);
    if (updates.banner !== undefined) server.banner = updates.banner ? String(updates.banner).slice(0, 1000) : null;
    if (updates.discoveryEnabled !== undefined) server.discoveryEnabled = Boolean(updates.discoveryEnabled);
    if (updates.defaultNotificationMode !== undefined
      && ['all', 'mentions', 'nothing'].includes(updates.defaultNotificationMode)) {
      server.defaultNotificationMode = updates.defaultNotificationMode;
    }
    if (updates.vanityCode !== undefined) server.vanityCode = nextVanityCode || null;
    if (updates.inviteCode) server.inviteCode = String(updates.inviteCode).trim().toUpperCase();
    this.saveData();
    return server;
  }

  transferServerOwnership(serverId, newOwnerId) {
    const server = this.getServerById(serverId);
    if (!server || !this.isServerMember(serverId, newOwnerId)) return null;
    server.creatorId = newOwnerId;
    this.saveData();
    return server;
  }

  deleteServer(id) {
    const index = this.servers.findIndex(server => server.id === id);
    if (index === -1) return false;

    const channelIds = this.channels.filter(channel => channel.serverId === id).map(channel => channel.id);
    this.servers.splice(index, 1);
    this.channels = this.channels.filter(channel => channel.serverId !== id);
    channelIds.forEach(channelId => this.channelMessages.delete(channelId));
    this.serverMembers.delete(id);
    this.serverRoles.delete(id);
    this.serverMemberRoles.delete(id);
    this.serverModeration.delete(id);
    this.serverMemberProfiles.delete(id);
    if (this.platformState?.servers && typeof this.platformState.servers === 'object') {
      delete this.platformState.servers[id];
    }
    this.saveData();
    return true;
  }

  isServerMember(serverId, userId) {
    return Boolean(userId) && (this.serverMembers.get(serverId) || []).includes(userId);
  }

  addServerMember(serverId, userId) {
    const server = this.getServerById(serverId);
    if (!server || !this.getUserById(userId)) return false;
    if (!this.serverMembers.has(serverId)) this.serverMembers.set(serverId, []);

    const members = this.serverMembers.get(serverId);
    if (members.includes(userId)) return false;

    members.push(userId);
    const profiles = this.serverMemberProfiles.get(serverId) || {};
    profiles[userId] = {
      nickname: null,
      serverAvatar: null,
      serverBanner: null,
      serverBio: '',
      joinedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.serverMemberProfiles.set(serverId, profiles);
    // Eski/temiz kurulumdaki Genel Sunucu sahipsiz kalmasın: ilk gerçek member
    // sahibi olur. Böylece roles and kanal ayarları kilitlenmez.
    if (server.id === 'default-server' && server.creatorId === 'system') {
      server.creatorId = userId;
    }
    this.ensureServerRoleData(serverId);
    this.saveData();
    return true;
  }

  removeServerMember(serverId, userId) {
    const members = this.serverMembers.get(serverId);
    if (!members) return false;

    const index = members.indexOf(userId);
    if (index === -1) return false;

    members.splice(index, 1);
    const assignments = this.serverMemberRoles.get(serverId) || {};
    const moderation = this.serverModeration.get(serverId) || {};
    delete assignments[userId];
    delete moderation[userId];
    const profiles = this.serverMemberProfiles.get(serverId) || {};
    delete profiles[userId];
    this.serverMemberRoles.set(serverId, assignments);
    this.serverModeration.set(serverId, moderation);
    this.serverMemberProfiles.set(serverId, profiles);
    const platformServer = this.platformState?.servers?.[serverId];
    if (platformServer?.memberVerifications && typeof platformServer.memberVerifications === 'object') {
      delete platformServer.memberVerifications[userId];
    }
    this.saveData();
    return true;
  }

  getServerMembers(serverId) {
    const memberIds = this.serverMembers.get(serverId) || [];
    return memberIds.map(id => publicUser(this.getUserById(id))).filter(Boolean);
  }

  getServerMemberProfile(serverId, userId) {
    if (!this.isServerMember(serverId, userId)) return null;
    const profile = (this.serverMemberProfiles.get(serverId) || {})[userId] || {};
    return {
      serverId,
      userId,
      nickname: profile.nickname || null,
      serverAvatar: profile.serverAvatar || null,
      serverBanner: profile.serverBanner || null,
      serverBio: profile.serverBio || '',
      joinedAt: Number(profile.joinedAt) || null,
      updatedAt: profile.updatedAt || null,
    };
  }

  updateServerMemberProfile(serverId, userId, updates = {}) {
    if (!this.isServerMember(serverId, userId)) return null;
    const profiles = this.serverMemberProfiles.get(serverId) || {};
    const current = profiles[userId] || {};
    const next = { ...current };

    if (hasOwn(updates, 'nickname') && updates.nickname !== undefined) {
      next.nickname = sanitizeText(updates.nickname, {
        field: 'Server nickname',
        maxLength: 32,
        nullable: true,
      });
      if (next.nickname && /[\r\n\t]/.test(next.nickname)) {
        throw new Error('The server nickname must be a single line.');
      }
    }
    if (hasOwn(updates, 'serverAvatar') && updates.serverAvatar !== undefined) {
      next.serverAvatar = sanitizeMediaUrl(updates.serverAvatar, 'Server avatar');
    }
    if (hasOwn(updates, 'serverBanner') && updates.serverBanner !== undefined) {
      next.serverBanner = sanitizeMediaUrl(updates.serverBanner, 'Server banner');
    }
    if (hasOwn(updates, 'serverBio') && updates.serverBio !== undefined) {
      next.serverBio = sanitizeText(updates.serverBio, { field: 'About this server', maxLength: 300 });
    }

    next.joinedAt = Number(current.joinedAt) || Date.now();
    next.updatedAt = Date.now();
    profiles[userId] = next;
    this.serverMemberProfiles.set(serverId, profiles);
    this.saveData();
    return this.getServerMemberProfile(serverId, userId);
  }

  getServerRoles(serverId) {
    this.ensureServerRoleData(serverId);
    return (this.serverRoles.get(serverId) || []).map(copyRole);
  }

  getServerRole(serverId, roleId) {
    return this.getServerRoles(serverId).find(role => role.id === roleId) || null;
  }

  createServerRole(serverId, {
    name,
    color = null,
    icon = null,
    hoist = false,
    mentionable = false,
    permissions = [],
  }) {
    if (!this.getServerById(serverId) || !String(name || '').trim()) return null;

    this.ensureServerRoleData(serverId);
    const roles = this.serverRoles.get(serverId);
    const role = {
      id: uuidv4(),
      serverId,
      name: String(name).trim().slice(0, 100),
      color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
      icon: icon ? String(icon).slice(0, 1000) : null,
      hoist: Boolean(hoist),
      mentionable: Boolean(mentionable),
      permissions: sanitizePermissions(permissions),
      position: roles.length,
      isDefault: false,
      managed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    roles.push(role);
    this.serverRoles.set(serverId, roles);
    this.ensureServerRoleData(serverId);
    this.saveData();
    return copyRole(this.getServerRole(serverId, role.id));
  }

  updateServerRole(serverId, roleId, updates) {
    this.ensureServerRoleData(serverId);
    const roles = this.serverRoles.get(serverId) || [];
    const role = roles.find(item => item.id === roleId);
    if (!role) return null;

    if (role.isDefault) {
      if (updates.permissions === undefined) return copyRole(role);
      role.permissions = sanitizePermissions(updates.permissions);
      role.updatedAt = Date.now();
      this.saveData();
      return copyRole(role);
    }

    if (updates.name !== undefined) {
      const name = String(updates.name || '').trim().slice(0, 100);
      if (!name) return null;
      role.name = name;
    }
    if (updates.color !== undefined) {
      role.color = typeof updates.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(updates.color)
        ? updates.color
        : null;
    }
    if (updates.icon !== undefined) role.icon = updates.icon ? String(updates.icon).slice(0, 1000) : null;
    if (updates.hoist !== undefined) role.hoist = Boolean(updates.hoist);
    if (updates.mentionable !== undefined) role.mentionable = Boolean(updates.mentionable);
    if (updates.permissions !== undefined) role.permissions = sanitizePermissions(updates.permissions);
    role.updatedAt = Date.now();
    this.saveData();
    return copyRole(role);
  }

  deleteServerRole(serverId, roleId) {
    this.ensureServerRoleData(serverId);
    const roles = this.serverRoles.get(serverId) || [];
    const role = roles.find(item => item.id === roleId);
    if (!role || role.isDefault) return false;

    this.serverRoles.set(serverId, roles.filter(item => item.id !== roleId));
    const assignments = this.serverMemberRoles.get(serverId) || {};
    Object.keys(assignments).forEach(userId => {
      assignments[userId] = (assignments[userId] || []).filter(id => id !== roleId);
      if (!assignments[userId].length) delete assignments[userId];
    });
    this.serverMemberRoles.set(serverId, assignments);
    this.ensureServerRoleData(serverId);
    this.saveData();
    return true;
  }

  reorderServerRoles(serverId, roleIds) {
    this.ensureServerRoleData(serverId);
    if (!Array.isArray(roleIds)) return null;

    const roles = this.serverRoles.get(serverId) || [];
    const defaultRole = roles.find(role => role.isDefault);
    const customRoles = roles.filter(role => !role.isDefault);
    const customRoleIds = new Set(customRoles.map(role => role.id));
    const requestedIds = roleIds.filter(roleId => customRoleIds.has(roleId));

    if (requestedIds.length !== customRoles.length || new Set(requestedIds).size !== customRoles.length) return null;

    const byId = new Map(customRoles.map(role => [role.id, role]));
    const reordered = requestedIds.map((roleId, index) => ({
      ...byId.get(roleId),
      position: index + 1,
      updatedAt: Date.now(),
    }));

    this.serverRoles.set(serverId, [defaultRole, ...reordered]);
    this.saveData();
    return this.getServerRoles(serverId);
  }

  getMemberRoleIds(serverId, userId) {
    if (!this.isServerMember(serverId, userId)) return [];

    this.ensureServerRoleData(serverId);
    const assigned = this.serverMemberRoles.get(serverId)?.[userId] || [];
    return [getDefaultRoleId(serverId), ...assigned];
  }

  setMemberRoles(serverId, userId, roleIds) {
    if (!this.isServerMember(serverId, userId) || !Array.isArray(roleIds)) return null;

    this.ensureServerRoleData(serverId);
    const defaultRoleId = getDefaultRoleId(serverId);
    const validRoleIds = new Set((this.serverRoles.get(serverId) || [])
      .filter(role => !role.isDefault)
      .map(role => role.id));
    const nextRoleIds = [...new Set(roleIds)].filter(roleId => roleId !== defaultRoleId && validRoleIds.has(roleId));

    if (nextRoleIds.length !== [...new Set(roleIds)].filter(roleId => roleId !== defaultRoleId).length) {
      return null;
    }

    const assignments = this.serverMemberRoles.get(serverId) || {};
    if (nextRoleIds.length) assignments[userId] = nextRoleIds;
    else delete assignments[userId];
    this.serverMemberRoles.set(serverId, assignments);
    this.saveData();
    return this.getServerMemberDetails(serverId, userId);
  }

  getMemberPermissions(serverId, userId) {
    const server = this.getServerById(serverId);
    if (!server || server.isDM || !this.isServerMember(serverId, userId)) return [];
    if (server.creatorId === userId) return [...ALL_PERMISSIONS];

    const roleIds = new Set(this.getMemberRoleIds(serverId, userId));
    const permissions = new Set();
    (this.serverRoles.get(serverId) || []).forEach(role => {
      if (!roleIds.has(role.id)) return;
      role.permissions.forEach(permission => permissions.add(permission));
    });

    if (permissions.has('ADMINISTRATOR')) return [...ALL_PERMISSIONS];
    return [...permissions];
  }

  hasPermission(serverId, userId, permission) {
    const permissions = this.getMemberPermissions(serverId, userId);
    return permissions.includes('ADMINISTRATOR') || permissions.includes(permission);
  }

  getHighestRolePosition(serverId, userId) {
    const server = this.getServerById(serverId);
    if (!server || !this.isServerMember(serverId, userId)) return -1;
    if (server.creatorId === userId) return Number.MAX_SAFE_INTEGER;

    const roleIds = new Set(this.getMemberRoleIds(serverId, userId));
    return (this.serverRoles.get(serverId) || [])
      .filter(role => roleIds.has(role.id))
      .reduce((highest, role) => Math.max(highest, role.position), 0);
  }

  canManageMember(serverId, actorId, targetUserId) {
    const server = this.getServerById(serverId);
    if (!server || actorId === targetUserId || !this.isServerMember(serverId, actorId) || !this.isServerMember(serverId, targetUserId)) {
      return false;
    }
    if (targetUserId === server.creatorId) return false;
    if (actorId === server.creatorId) return true;

    return this.getHighestRolePosition(serverId, actorId) > this.getHighestRolePosition(serverId, targetUserId);
  }

  canModerateMember(serverId, actorId, targetUserId, permission) {
    return this.hasPermission(serverId, actorId, permission)
      && this.canManageMember(serverId, actorId, targetUserId);
  }

  getMemberModerationState(serverId, userId) {
    const state = this.serverModeration.get(serverId)?.[userId];
    return {
      serverMuted: Boolean(state?.serverMuted),
      serverDeafened: Boolean(state?.serverDeafened),
      timeoutUntil: Number(state?.timeoutUntil) > Date.now() ? Number(state.timeoutUntil) : null,
      isTimedOut: Number(state?.timeoutUntil) > Date.now(),
      updatedAt: state?.updatedAt || null,
      updatedBy: state?.updatedBy || null,
    };
  }

  setMemberModerationState(serverId, userId, updates, updatedBy = null) {
    if (!this.isServerMember(serverId, userId)) return null;

    const moderation = this.serverModeration.get(serverId) || {};
    const current = this.getMemberModerationState(serverId, userId);
    const next = {
      serverMuted: updates.serverMuted === undefined ? current.serverMuted : Boolean(updates.serverMuted),
      serverDeafened: updates.serverDeafened === undefined ? current.serverDeafened : Boolean(updates.serverDeafened),
      timeoutUntil: updates.timeoutUntil === undefined
        ? current.timeoutUntil
        : (Number(updates.timeoutUntil) > Date.now() ? Number(updates.timeoutUntil) : null),
      updatedAt: Date.now(),
      updatedBy,
    };

    if (next.serverMuted || next.serverDeafened || next.timeoutUntil) moderation[userId] = next;
    else delete moderation[userId];
    this.serverModeration.set(serverId, moderation);
    this.saveData();
    return this.getMemberModerationState(serverId, userId);
  }

  isMemberTimedOut(serverId, userId) {
    return this.getMemberModerationState(serverId, userId).isTimedOut;
  }

  getServerMemberDetails(serverId, userId) {
    if (!this.isServerMember(serverId, userId)) return null;
    const user = publicUser(this.getUserById(userId));
    if (!user) return null;

    const roleIds = this.getMemberRoleIds(serverId, userId);
    const rolesById = new Map(this.getServerRoles(serverId).map(role => [role.id, role]));
    const moderation = this.getMemberModerationState(serverId, userId);
    const server = this.getServerById(serverId);

    const serverProfile = this.getServerMemberProfile(serverId, userId);

    return {
      ...user,
      status: this.getUserStatus(userId),
      serverProfile,
      nickname: serverProfile?.nickname || null,
      serverAvatar: serverProfile?.serverAvatar || null,
      serverBanner: serverProfile?.serverBanner || null,
      serverBio: serverProfile?.serverBio || '',
      roleIds,
      roles: roleIds.map(roleId => rolesById.get(roleId)).filter(Boolean),
      permissions: this.getMemberPermissions(serverId, userId),
      isOwner: server?.creatorId === userId,
      ...moderation,
    };
  }

  getServerMembersWithDetails(serverId) {
    return (this.serverMembers.get(serverId) || [])
      .map(userId => this.getServerMemberDetails(serverId, userId))
      .filter(Boolean);
  }

  getChannelsByServerId(serverId) { return this.channels.filter(channel => channel.serverId === serverId); }
  getChannelById(id) { return this.channels.find(channel => channel.id === id); }
  createChannel(serverId, name, type = 'text') {
    const channel = { id: uuidv4(), serverId, name, type, createdAt: Date.now() };
    this.channels.push(channel);
    this.saveData();
    return channel;
  }
  deleteChannel(id) {
    const index = this.channels.findIndex(channel => channel.id === id);
    if (index === -1) return false;
    const channel = this.channels[index];
    this.channels.splice(index, 1);
    this.channelMessages.delete(id);
    const platformServer = this.platformState?.servers?.[channel.serverId];
    if (platformServer && typeof platformServer === 'object') {
      if (platformServer.channels && typeof platformServer.channels === 'object') delete platformServer.channels[id];
      ['events', 'forumTags', 'forumPosts', 'threads', 'polls', 'webhooks'].forEach(key => {
        if (Array.isArray(platformServer[key])) {
          platformServer[key] = platformServer[key].filter(item => item.channelId !== id);
        }
      });
      if (Array.isArray(platformServer.onboarding?.defaultChannelIds)) {
        platformServer.onboarding.defaultChannelIds = platformServer.onboarding.defaultChannelIds.filter(channelId => channelId !== id);
      }
      if (Array.isArray(platformServer.settings?.autoMod?.exemptChannelIds)) {
        platformServer.settings.autoMod.exemptChannelIds = platformServer.settings.autoMod.exemptChannelIds.filter(channelId => channelId !== id);
      }
    }
    this.saveData();
    return true;
  }
  addChannelMessage(channelId, message) {
    if (!this.channelMessages.has(channelId)) this.channelMessages.set(channelId, []);
    const messages = this.channelMessages.get(channelId);
    messages.push(message);
    if (messages.length > 500) this.channelMessages.set(channelId, messages.slice(-500));
    this.saveData();
  }
  getChannelMessages(channelId) { return this.channelMessages.get(channelId) || []; }
  updateChannelMessage(channelId, messageId, newContent) {
    const message = this.getChannelMessages(channelId).find(item => item.id === messageId);
    if (!message) return null;
    if (message.content !== newContent) {
      message.editHistory = Array.isArray(message.editHistory) ? message.editHistory : [];
      message.editHistory.push({ content: message.content, editedAt: Date.now() });
      // Message geÃ§miÅŸi denetim iÃ§in tutulur fakat tek mesajÄ±n veriyi sÄ±nÄ±rsÄ±z bÃ¼yÃ¼tmesi engellenir.
      if (message.editHistory.length > 25) message.editHistory = message.editHistory.slice(-25);
    }
    message.content = newContent;
    message.isEdited = true;
    message.editedAt = Date.now();
    this.saveData();
    return message;
  }
  deleteChannelMessage(channelId, messageId) {
    const messages = this.getChannelMessages(channelId);
    const index = messages.findIndex(message => message.id === messageId);
    if (index === -1) return false;
    messages.splice(index, 1);
    this.saveData();
    return true;
  }

  createUser(username) {
    const user = {
      id: uuidv4(),
      username,
      banner: null,
      bio: '',
      customStatus: '',
      presenceStatus: 'online',
      locale: 'tr',
      localeExplicit: false,
      theme: 'dark',
      profileTheme: 'default',
      profileAccentColor: DEFAULT_PROFILE_ACCENT,
      nameFont: 'default',
      nameEffect: 'none',
      avatarDecoration: 'none',
      profileEffect: 'none',
      emailVerified: false,
      createdAt: Date.now(),
    };
    this.users.push(user);
    this.userStatuses.set(user.id, 'offline');
    this.saveData();
    return user;
  }

  createUserWithAuth({ username, email, password }) {
    if (this.getUserByUsername(username)) throw new Error('Username taken');
    if (this.getUserByEmail(email)) throw new Error('Email taken');

    const hasPlatformOwner = this.users.some(item => item.platformRole === 'owner');
    const user = {
      id: uuidv4(),
      username,
      email,
      password,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`,
      banner: null,
      bio: '',
      customStatus: '',
      presenceStatus: 'online',
      locale: 'tr',
      localeExplicit: false,
      theme: 'dark',
      profileTheme: 'default',
      profileAccentColor: DEFAULT_PROFILE_ACCENT,
      nameFont: 'default',
      nameEffect: 'none',
      avatarDecoration: 'none',
      profileEffect: 'none',
      emailVerified: true,
      status: 'offline',
      createdAt: Date.now(),
      tokenVersion: 0,
      platformRole: hasPlatformOwner ? null : 'owner',
    };
    this.users.push(user);
    this.userStatuses.set(user.id, 'offline');
    this.saveData();
    return user;
  }

  getUserById(id) { return this.users.find(user => user.id === id); }
  getUserByUsername(username) {
    return this.users.find(user => user.username?.trim().toLowerCase() === String(username || '').trim().toLowerCase());
  }
  getUserByEmail(email) {
    return this.users.find(user => user.email?.trim().toLowerCase() === String(email || '').trim().toLowerCase());
  }
  getAllUsers() { return [...this.users]; }
  getPublicUserById(id) { return publicUser(this.getUserById(id)); }
  getPublicUsers() { return this.users.map(publicUser); }

  getUserPlatformBan(userId) {
    const ban = this.getUserById(userId)?.platformBan;
    if (!ban || ban.active !== true) return null;
    return {
      reason: String(ban.reason || 'Community Guidelines violation').slice(0, 500),
      bannedAt: Number(ban.bannedAt) || null,
      bannedBy: ban.bannedBy || null,
    };
  }

  isUserPlatformBanned(userId) { return Boolean(this.getUserPlatformBan(userId)); }

  setUserPlatformBan(userId, { reason, bannedBy }) {
    const user = this.getUserById(userId);
    if (!user) return null;
    user.platformBan = {
      active: true,
      reason: sanitizeText(reason, { field: 'Ban reason', maxLength: 500 }),
      bannedAt: Date.now(),
      bannedBy: String(bannedBy || '').slice(0, 100) || null,
    };
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    this.updateUserStatus(user.id, 'offline');
    this.saveData();
    return this.getUserPlatformBan(user.id);
  }

  clearUserPlatformBan(userId, clearedBy = null) {
    const user = this.getUserById(userId);
    if (!user) return null;
    user.platformBan = null;
    user.platformBanClearedAt = Date.now();
    user.platformBanClearedBy = String(clearedBy || '').slice(0, 100) || null;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    this.saveData();
    return user;
  }

  updateUserStatus(id, status) { this.userStatuses.set(id, status); }
  getUserStatus(id) { return this.userStatuses.get(id) || 'offline'; }

  updateUserPassword(userId, passwordHash, { invalidateSessions = true } = {}) {
    const user = this.getUserById(userId);
    if (!user) return null;
    user.password = passwordHash;
    if (invalidateSessions) user.tokenVersion = (user.tokenVersion || 0) + 1;
    this.saveData();
    return user;
  }

  updateUserEmail(userId, email) {
    const user = this.getUserById(userId);
    const existingUser = this.getUserByEmail(email);
    if (!user || (existingUser && existingUser.id !== userId)) return null;
    user.email = String(email).trim().toLowerCase();
    this.saveData();
    return user;
  }

  updateUserProfile(userId, updates) {
    const user = this.getUserById(userId);
    if (!user) return null;
    const next = {};

    if (hasOwn(updates, 'username') && updates.username !== undefined) {
      const nextUsername = sanitizeText(updates.username, { field: 'Username', maxLength: 50 });
      if (nextUsername.length < 2) throw new Error('Username must be at least 2 characters.');
      if (/[\r\n\t]/.test(nextUsername)) throw new Error('Username must be a single line.');
      const existing = this.getUserByUsername(nextUsername);
      if (existing && existing.id !== userId) throw new Error('Username taken');
      next.username = nextUsername;
    }
    if (hasOwn(updates, 'avatar') && updates.avatar !== undefined) next.avatar = sanitizeMediaUrl(updates.avatar, 'Profile picture');
    if (hasOwn(updates, 'banner') && updates.banner !== undefined) next.banner = sanitizeMediaUrl(updates.banner, 'Profile banner');
    if (hasOwn(updates, 'bio') && updates.bio !== undefined) next.bio = sanitizeText(updates.bio, { field: 'About Me', maxLength: 300 });
    if (hasOwn(updates, 'customStatus') && updates.customStatus !== undefined) {
      next.customStatus = sanitizeText(updates.customStatus, { field: 'Custom status', maxLength: 128 });
      if (/[\r\n\t]/.test(next.customStatus)) throw new Error('The custom status must be a single line.');
    }
    if (hasOwn(updates, 'presenceStatus') && updates.presenceStatus !== undefined) {
      if (!PRESENCE_STATUSES.includes(updates.presenceStatus)) throw new Error('Invalid online status.');
      next.presenceStatus = updates.presenceStatus;
    }
    if (hasOwn(updates, 'locale') && updates.locale !== undefined) {
      if (!SUPPORTED_LOCALES.includes(updates.locale)) throw new Error('Unsupported language selection.');
      next.locale = updates.locale;
    }
    if (hasOwn(updates, 'localeExplicit') && updates.localeExplicit !== undefined) {
      next.localeExplicit = Boolean(updates.localeExplicit);
    }
    if (hasOwn(updates, 'theme') && updates.theme !== undefined) {
      if (!SUPPORTED_THEMES.includes(updates.theme)) throw new Error('Unsupported theme selection.');
      next.theme = updates.theme;
    }
    if (hasOwn(updates, 'profileTheme') && updates.profileTheme !== undefined) {
      if (!SUPPORTED_PROFILE_THEMES.includes(updates.profileTheme)) throw new Error('Unsupported profile theme.');
      next.profileTheme = updates.profileTheme;
    }
    if (hasOwn(updates, 'profileAccentColor') && updates.profileAccentColor !== undefined) {
      const accent = String(updates.profileAccentColor || '').trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(accent)) throw new Error('The profile accent color is invalid.');
      next.profileAccentColor = accent;
    }
    if (hasOwn(updates, 'nameFont') && updates.nameFont !== undefined) {
      if (!SUPPORTED_NAME_FONTS.includes(updates.nameFont)) throw new Error('Unsupported display name font.');
      next.nameFont = updates.nameFont;
    }
    if (hasOwn(updates, 'nameEffect') && updates.nameEffect !== undefined) {
      if (!SUPPORTED_NAME_EFFECTS.includes(updates.nameEffect)) throw new Error('Desteklenmeyen isim efekti.');
      next.nameEffect = updates.nameEffect;
    }
    if (hasOwn(updates, 'avatarDecoration') && updates.avatarDecoration !== undefined) {
      if (!SUPPORTED_AVATAR_DECORATIONS.includes(updates.avatarDecoration)) throw new Error('Desteklenmeyen avatar dekorasyonu.');
      next.avatarDecoration = updates.avatarDecoration;
    }
    if (hasOwn(updates, 'profileEffect') && updates.profileEffect !== undefined) {
      if (!SUPPORTED_PROFILE_EFFECTS.includes(updates.profileEffect)) throw new Error('Desteklenmeyen profil efekti.');
      next.profileEffect = updates.profileEffect;
    }
    Object.assign(user, next, { updatedAt: Date.now() });
    this.saveData();
    return user;
  }

  blockUser(userId, blockedUserId) {
    if (userId === blockedUserId || !this.getUserById(userId) || !this.getUserById(blockedUserId)) return null;
    const blocks = Array.isArray(this.userBlocks.get(userId)) ? this.userBlocks.get(userId) : [];
    let entry = blocks.find(item => item.userId === blockedUserId);
    if (!entry) {
      entry = { userId: blockedUserId, createdAt: Date.now() };
      blocks.push(entry);
      this.userBlocks.set(userId, blocks);
    }

    // Engelleme mevcut arkadaşlığı and iki yöndeki
    // bekleyen arkadaşlık isteklerini kaldırır.
    const [id1, id2] = [userId, blockedUserId].sort();
    this.friendships = this.friendships.filter(item => !(item.user1Id === id1 && item.user2Id === id2));
    this.friendRequests = this.friendRequests.filter(request => !(
      (request.fromUserId === userId && request.toUserId === blockedUserId)
      || (request.fromUserId === blockedUserId && request.toUserId === userId)
    ));
    this.saveData();
    return { ...entry, user: publicUser(this.getUserById(blockedUserId)) };
  }

  unblockUser(userId, blockedUserId) {
    const blocks = Array.isArray(this.userBlocks.get(userId)) ? this.userBlocks.get(userId) : [];
    const next = blocks.filter(item => item.userId !== blockedUserId);
    if (next.length === blocks.length) return false;
    if (next.length) this.userBlocks.set(userId, next);
    else this.userBlocks.delete(userId);
    this.saveData();
    return true;
  }

  isUserBlocked(userId, blockedUserId) {
    return (this.userBlocks.get(userId) || []).some(entry => entry.userId === blockedUserId);
  }

  isBlockedEitherDirection(userId1, userId2) {
    return this.isUserBlocked(userId1, userId2) || this.isUserBlocked(userId2, userId1);
  }

  getBlockedUsers(userId) {
    return (this.userBlocks.get(userId) || []).map(entry => {
      const user = publicUser(this.getUserById(entry.userId));
      return user ? { ...user, blockedAt: entry.createdAt } : null;
    }).filter(Boolean);
  }

  getOrCreateDMConversation(userId1, userId2) {
    const [id1, id2] = [userId1, userId2].sort();
    let dmServer = this.servers.find(server => (
      server.isDM
      && !server.isGroupDM
      && server.dmUserIds?.length === 2
      && server.dmUserIds.includes(id1)
      && server.dmUserIds.includes(id2)
    ));
    if (!dmServer) {
      const serverId = uuidv4();
      dmServer = { id: serverId, name: `DM-${id1}-${id2}`, isDM: true, dmUserIds: [id1, id2], createdAt: Date.now() };
      this.servers.push(dmServer);
      this.serverMembers.set(serverId, [id1, id2]);
      this.channels.push({ id: uuidv4(), serverId, name: 'dm-chat', type: 'text', createdAt: Date.now() });
      this.saveData();
    }
    const channel = this.channels.find(item => item.serverId === dmServer.id);
    return { id: dmServer.id, channelId: channel?.id, user1Id: id1, user2Id: id2 };
  }

  getUserDMConversations(userId) {
    return this.servers
      .filter(server => server.isDM && server.dmUserIds?.includes(userId))
      .map(server => {
        const otherUserId = server.dmUserIds.find(id => id !== userId);
        const channel = this.channels.find(item => item.serverId === server.id);
        return {
          id: server.id,
          channelId: channel?.id,
          user1Id: userId,
          user2Id: otherUserId,
          otherUser: publicUser(this.getUserById(otherUserId)),
        };
      })
      .filter(conversation => conversation.otherUser);
  }

  createFriendRequest(from, to) {
    if (this.isBlockedEitherDirection(from, to)) return null;
    if (this.friendships.some(friendship => (
      (friendship.user1Id === from && friendship.user2Id === to)
      || (friendship.user1Id === to && friendship.user2Id === from)
    ))) return null;
    if (this.friendRequests.find(request => (
      (request.fromUserId === from && request.toUserId === to)
      || (request.fromUserId === to && request.toUserId === from)
    ))) return null;

    const request = { id: uuidv4(), fromUserId: from, toUserId: to, status: 'pending', createdAt: Date.now() };
    this.friendRequests.push(request);
    this.saveData();
    return request;
  }
  getPendingFriendRequests(userId) {
    return this.friendRequests
      .filter(request => request.toUserId === userId && request.status === 'pending')
      .map(request => ({ ...request, fromUser: publicUser(this.getUserById(request.fromUserId)) }));
  }
  acceptFriendRequest(requestId) {
    const request = this.friendRequests.find(item => item.id === requestId);
    if (!request) return false;
    if (this.isBlockedEitherDirection(request.fromUserId, request.toUserId)) return false;
    request.status = 'accepted';
    const [id1, id2] = [request.fromUserId, request.toUserId].sort();
    this.friendships.push({ id: uuidv4(), user1Id: id1, user2Id: id2, createdAt: Date.now() });
    this.saveData();
    return true;
  }
  rejectFriendRequest(requestId) {
    const index = this.friendRequests.findIndex(request => request.id === requestId);
    if (index === -1) return false;
    this.friendRequests.splice(index, 1);
    this.saveData();
    return true;
  }
  getUserFriends(userId) {
    return this.friendships
      .filter(friendship => friendship.user1Id === userId || friendship.user2Id === userId)
      .map(friendship => {
        const friendId = friendship.user1Id === userId ? friendship.user2Id : friendship.user1Id;
        const user = publicUser(this.getUserById(friendId));
        return user ? { ...user, status: this.getUserStatus(friendId) } : null;
      })
      .filter(Boolean);
  }

  getFriendship(userId1, userId2) {
    const [id1, id2] = [userId1, userId2].sort();
    return this.friendships.find(friendship => friendship.user1Id === id1 && friendship.user2Id === id2) || null;
  }

  getPendingFriendRelationship(viewerUserId, targetUserId) {
    const request = this.friendRequests.find(item => (
      item.status === 'pending'
      && ((item.fromUserId === viewerUserId && item.toUserId === targetUserId)
        || (item.fromUserId === targetUserId && item.toUserId === viewerUserId))
    ));
    if (!request) return null;
    return {
      id: request.id,
      direction: request.fromUserId === viewerUserId ? 'outgoing' : 'incoming',
      createdAt: request.createdAt || null,
    };
  }

  getMutualFriends(viewerUserId, targetUserId) {
    const viewerFriendIds = new Set(this.friendships.flatMap(friendship => {
      if (friendship.user1Id === viewerUserId) return [friendship.user2Id];
      if (friendship.user2Id === viewerUserId) return [friendship.user1Id];
      return [];
    }));

    return this.friendships
      .flatMap(friendship => {
        if (friendship.user1Id === targetUserId) return [friendship.user2Id];
        if (friendship.user2Id === targetUserId) return [friendship.user1Id];
        return [];
      })
      .filter(friendId => viewerFriendIds.has(friendId))
      .map(friendId => {
        const user = publicUser(this.getUserById(friendId));
        return user ? { ...user, status: this.getUserStatus(friendId) } : null;
      })
      .filter(Boolean);
  }

  getMutualServers(viewerUserId, targetUserId) {
    return this.servers
      .filter(server => (
        !server.isDM
        && this.isServerMember(server.id, viewerUserId)
        && this.isServerMember(server.id, targetUserId)
      ))
      .map(server => ({
        id: server.id,
        name: server.name,
        icon: server.icon || null,
        banner: server.banner || null,
        memberCount: (this.serverMembers.get(server.id) || []).length,
        createdAt: server.createdAt || null,
      }));
  }

  getProfileNote(viewerUserId, targetUserId) {
    return this.profileNotes.get(`${viewerUserId}:${targetUserId}`) || '';
  }

  setProfileNote(viewerUserId, targetUserId, value) {
    if (!this.getUserById(viewerUserId) || !this.getUserById(targetUserId) || viewerUserId === targetUserId) {
      return null;
    }
    const note = sanitizeText(value, { field: 'Not', maxLength: 256, nullable: true });
    const key = `${viewerUserId}:${targetUserId}`;
    if (note) this.profileNotes.set(key, note);
    else this.profileNotes.delete(key);
    this.saveData();
    return note || '';
  }

  removeFriend(userId1, userId2) {
    const [id1, id2] = [userId1, userId2].sort();
    const index = this.friendships.findIndex(friendship => friendship.user1Id === id1 && friendship.user2Id === id2);
    if (index !== -1) {
      this.friendships.splice(index, 1);
      this.saveData();
    }
  }

  findUserById(id) { return this.getUserById(id); }
  findUserByUsername(username) { return this.getUserByUsername(username); }
  findUserByEmail(email) { return this.getUserByEmail(email); }
  getPendingRequests(userId) { return this.getPendingFriendRequests(userId); }
  sendFriendRequest(from, to) { return this.createFriendRequest(from, to); }
  addMemberToServer(serverId, userId) { return this.addServerMember(serverId, userId); }
}

const storage = new InMemoryStorage();
// Codec anahtarı constructor sırasında kendi Buffer'ına aldı. Child süreç tanı
// raporları veya sonradan yüklenen modüller ham anahtarı ortamdan okuyamasın.
delete process.env.DATA_ENCRYPTION_KEY;
delete process.env.ALLOW_PLAINTEXT_STATE_MIGRATION;
storage.PERMISSIONS = PERMISSIONS;
storage.DEFAULT_MEMBER_PERMISSIONS = DEFAULT_MEMBER_PERMISSIONS;
storage.ALL_PERMISSIONS = ALL_PERMISSIONS;
storage.PRESENCE_STATUSES = PRESENCE_STATUSES;
storage.SUPPORTED_LOCALES = SUPPORTED_LOCALES;
storage.SUPPORTED_THEMES = SUPPORTED_THEMES;

module.exports = storage;
