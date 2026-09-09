const crypto = require('crypto');

const storage = require('../storage/inMemory');

const SPOTIFY_ACCOUNTS_ORIGIN = 'https://accounts.spotify.com';
const SPOTIFY_API_ORIGIN = 'https://api.spotify.com';
const SPOTIFY_OPEN_ORIGIN = 'https://open.spotify.com';
const SPOTIFY_LINK_ORIGIN = 'https://spotify.link';
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const OEMBED_TIMEOUT_MS = 8 * 1000;
const MAX_OEMBED_RESPONSE_BYTES = 64 * 1024;
const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, maximum = 256) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function spotifyError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function configuredRedirectUri() {
  const candidate = text(process.env.SPOTIFY_REDIRECT_URI, 2048);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return '';
    const loopback = ['127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback) ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function spotifyShareUrl(value) {
  const candidate = text(value, 2048);
  if (/^spotify:track:[A-Za-z0-9]{10,64}$/.test(candidate)) {
    return `https://open.spotify.com/track/${candidate.split(':')[2]}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password || parsed.protocol !== 'https:') return '';
    if (parsed.origin === SPOTIFY_LINK_ORIGIN && /^\/[A-Za-z0-9_-]{2,128}\/?$/.test(parsed.pathname)) {
      return parsed.href;
    }
    if (parsed.origin !== SPOTIFY_OPEN_ORIGIN) return '';
    const match = parsed.pathname.match(/(?:^|\/)track\/([A-Za-z0-9]{10,64})(?:\/|$)/);
    return match ? `https://open.spotify.com/track/${match[1]}` : '';
  } catch (_) {
    return '';
  }
}

function normalizeSpotifyInvite(value) {
  if (!isRecord(value)) return null;
  const uri = text(value.uri, 80);
  const trackId = text(value.trackId || uri.split(':')[2], 64);
  if (!/^spotify:track:[A-Za-z0-9]{10,64}$/.test(uri) || !/^[A-Za-z0-9]{10,64}$/.test(trackId)) return null;
  const durationMs = Math.min(Math.max(Number(value.durationMs) || 0, 1), 24 * 60 * 60 * 1000);
  const positionMs = Math.min(Math.max(Number(value.positionMs) || 0, 0), durationMs);
  const capturedAt = Math.min(Math.max(Number(value.capturedAt) || Date.now(), 0), Date.now() + 30_000);
  const imageUrl = text(value.imageUrl, 2048);
  let safeImageUrl = null;
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) safeImageUrl = parsed.href;
  } catch (_) {
    safeImageUrl = null;
  }
  return {
    trackId,
    uri,
    url: `https://open.spotify.com/track/${trackId}`,
    name: text(value.name, 160) || 'Spotify track',
    artist: text(value.artist, 160),
    album: text(value.album, 160),
    imageUrl: safeImageUrl,
    durationMs,
    positionMs,
    capturedAt,
    canListenAlong: value.canListenAlong === true,
  };
}

class SpotifyService {
  constructor(storageInstance = storage) {
    this.storage = storageInstance;
    this.pendingAuthorizations = new Map();
  }

  configuration() {
    return {
      clientId: text(process.env.SPOTIFY_CLIENT_ID, 256),
      clientSecret: text(process.env.SPOTIFY_CLIENT_SECRET, 512),
      redirectUri: configuredRedirectUri(),
    };
  }

  isConfigured() {
    const configuration = this.configuration();
    return Boolean(configuration.clientId && configuration.clientSecret && configuration.redirectUri);
  }

  ensureState() {
    const root = isRecord(this.storage.platformState) ? this.storage.platformState : { version: 1 };
    const spotify = isRecord(root.spotify) ? root.spotify : {};
    root.spotify = {
      connections: isRecord(spotify.connections) ? spotify.connections : {},
    };
    this.storage.platformState = root;
    return root.spotify;
  }

  getConnection(userId) {
    return this.ensureState().connections[String(userId)] || null;
  }

  status(userId) {
    const connection = this.getConnection(userId);
    return {
      configured: this.isConfigured(),
      connected: Boolean(connection?.refreshToken),
      connectedAt: connection?.connectedAt || null,
      scope: connection?.scope || '',
    };
  }

  createAuthorization(userId) {
    const configuration = this.configuration();
    if (!this.isConfigured()) {
      throw spotifyError('Spotify integration is not configured on this server.', 'SPOTIFY_NOT_CONFIGURED', 503);
    }
    const state = crypto.randomBytes(32).toString('base64url');
    this.pendingAuthorizations.set(state, {
      userId: String(userId),
      expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
    });
    this.prunePendingAuthorizations();

    const authorizationUrl = new URL('/authorize', SPOTIFY_ACCOUNTS_ORIGIN);
    authorizationUrl.search = new URLSearchParams({
      client_id: configuration.clientId,
      response_type: 'code',
      redirect_uri: configuration.redirectUri,
      scope: SPOTIFY_SCOPES.join(' '),
      state,
      show_dialog: 'true',
    }).toString();
    return { authorizationUrl: authorizationUrl.href, expiresAt: Date.now() + AUTHORIZATION_TTL_MS };
  }

  prunePendingAuthorizations() {
    const now = Date.now();
    for (const [state, authorization] of this.pendingAuthorizations) {
      if (authorization.expiresAt <= now) this.pendingAuthorizations.delete(state);
    }
  }

  takePendingAuthorization(state) {
    this.prunePendingAuthorizations();
    const key = text(state, 128);
    const pending = this.pendingAuthorizations.get(key);
    this.pendingAuthorizations.delete(key);
    return pending?.expiresAt > Date.now() ? pending : null;
  }

  async tokenRequest(parameters) {
    const configuration = this.configuration();
    if (!this.isConfigured()) {
      throw spotifyError('Spotify integration is not configured on this server.', 'SPOTIFY_NOT_CONFIGURED', 503);
    }
    const response = await fetch(`${SPOTIFY_ACCOUNTS_ORIGIN}/api/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(parameters),
    });
    const responseText = await response.text();
    const payload = parseJsonSafely(responseText);
    if (!response.ok) {
      throw spotifyError(
        text(payload.error_description || payload.error || 'Spotify authorization failed.', 300),
        'SPOTIFY_AUTHORIZATION_FAILED',
        response.status >= 500 ? 502 : 400,
      );
    }
    return payload;
  }

  async completeAuthorization({ code, state, error }) {
    if (error) throw spotifyError('Spotify authorization was cancelled.', 'SPOTIFY_AUTHORIZATION_CANCELLED', 400);
    const pending = this.takePendingAuthorization(state);
    if (!pending || !code) throw spotifyError('Spotify authorization request expired or is invalid.', 'SPOTIFY_AUTHORIZATION_INVALID', 400);
    const configuration = this.configuration();
    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      code: text(code, 2048),
      redirect_uri: configuration.redirectUri,
    });
    if (!token.refresh_token || !token.access_token) {
      throw spotifyError('Spotify did not return the required authorization tokens.', 'SPOTIFY_AUTHORIZATION_FAILED', 502);
    }
    const connections = this.ensureState().connections;
    connections[pending.userId] = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
      scope: text(token.scope, 512),
      tokenType: text(token.token_type, 32) || 'Bearer',
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.storage.saveData();
    return this.status(pending.userId);
  }

  disconnect(userId) {
    const connections = this.ensureState().connections;
    const removed = Boolean(connections[String(userId)]);
    delete connections[String(userId)];
    if (removed) this.storage.saveData();
    return removed;
  }

  async accessToken(userId, forceRefresh = false) {
    const connection = this.getConnection(userId);
    if (!connection?.refreshToken) throw spotifyError('Connect Spotify in User Settings first.', 'SPOTIFY_NOT_CONNECTED', 409);
    if (!forceRefresh && connection.accessToken && Number(connection.expiresAt) > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return connection.accessToken;
    }
    const token = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    });
    connection.accessToken = token.access_token;
    connection.refreshToken = token.refresh_token || connection.refreshToken;
    connection.expiresAt = Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000;
    connection.scope = text(token.scope || connection.scope, 512);
    connection.updatedAt = Date.now();
    this.storage.saveData();
    return connection.accessToken;
  }

  async apiRequest(userId, path, options = {}, allowRefresh = true) {
    const accessToken = await this.accessToken(userId);
    const response = await fetch(`${SPOTIFY_API_ORIGIN}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 401 && allowRefresh) {
      await this.accessToken(userId, true);
      return this.apiRequest(userId, path, options, false);
    }
    if (response.status === 204) return null;
    const responseText = await response.text();
    const payload = parseJsonSafely(responseText);
    if (!response.ok) {
      const spotifyMessage = text(payload.error?.message || payload.error_description || payload.error, 300);
      const premiumRequired = response.status === 403 && path === '/v1/me/player/play';
      const message = premiumRequired
        ? 'Spotify Premium is required for automatic Listen Along playback. You can still open the shared track in Spotify.'
        : response.status === 404
          ? 'Open Spotify on a device and start playback before joining.'
          : spotifyMessage || 'Spotify request failed.';
      throw spotifyError(
        message,
        premiumRequired ? 'SPOTIFY_PREMIUM_REQUIRED' : 'SPOTIFY_REQUEST_FAILED',
        response.status === 429 ? 429 : 502,
      );
    }
    return payload;
  }

  async currentlyPlaying(userId) {
    const payload = await this.apiRequest(userId, '/v1/me/player/currently-playing?additional_types=track');
    if (!payload?.item || payload.currently_playing_type !== 'track') {
      return { isPlaying: false, invite: null };
    }
    const track = payload.item;
    const invite = normalizeSpotifyInvite({
      trackId: track.id,
      uri: track.uri,
      name: track.name,
      artist: Array.isArray(track.artists) ? track.artists.map(artist => artist.name).filter(Boolean).join(', ') : '',
      album: track.album?.name,
      imageUrl: track.album?.images?.[0]?.url,
      durationMs: track.duration_ms,
      positionMs: payload.progress_ms,
      capturedAt: Date.now(),
      canListenAlong: true,
    });
    return { isPlaying: Boolean(payload.is_playing), invite };
  }

  async inviteFromUrl(input) {
    const shareUrl = spotifyShareUrl(input);
    if (!shareUrl) {
      throw spotifyError('Paste a valid Spotify track link.', 'INVALID_SPOTIFY_URL', 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
    let response;
    try {
      const oEmbedUrl = new URL('/oembed', SPOTIFY_OPEN_ORIGIN);
      oEmbedUrl.searchParams.set('url', shareUrl);
      response = await fetch(oEmbedUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Spotify took too long to validate this link.'
        : 'Spotify could not validate this link.';
      throw spotifyError(message, 'SPOTIFY_OEMBED_UNAVAILABLE', 502);
    } finally {
      clearTimeout(timeout);
    }

    const declaredLength = Number(response.headers.get('content-length')) || 0;
    if (declaredLength > MAX_OEMBED_RESPONSE_BYTES) {
      throw spotifyError('Spotify returned an invalid link preview.', 'SPOTIFY_OEMBED_INVALID', 502);
    }
    const responseText = (await response.text()).slice(0, MAX_OEMBED_RESPONSE_BYTES);
    const payload = parseJsonSafely(responseText);
    if (!response.ok) {
      throw spotifyError('Spotify could not find a track at this link.', 'SPOTIFY_TRACK_NOT_FOUND', 404);
    }

    const source = `${shareUrl} ${text(payload.html, 8192)}`;
    const trackId = source.match(/(?:track\/|spotify:track:)([A-Za-z0-9]{10,64})/)?.[1];
    const invite = normalizeSpotifyInvite({
      trackId,
      uri: trackId ? `spotify:track:${trackId}` : '',
      name: payload.title,
      imageUrl: payload.thumbnail_url,
      durationMs: 1,
      positionMs: 0,
      capturedAt: Date.now(),
      canListenAlong: false,
    });
    if (!invite) {
      throw spotifyError('Spotify could not identify a track at this link.', 'SPOTIFY_TRACK_NOT_FOUND', 404);
    }
    return { invite };
  }

  async startInvite(userId, input) {
    const invite = normalizeSpotifyInvite(input);
    if (!invite) throw spotifyError('The Spotify listening invite is invalid.', 'INVALID_SPOTIFY_INVITE', 400);
    const elapsed = Math.max(0, Date.now() - invite.capturedAt);
    const positionMs = Math.min(invite.durationMs - 1, invite.positionMs + elapsed);
    await this.apiRequest(userId, '/v1/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ uris: [invite.uri], position_ms: positionMs }),
    });
    return { success: true, positionMs, invite };
  }
}

const spotifyService = new SpotifyService();

module.exports = {
  SPOTIFY_SCOPES,
  SpotifyService,
  normalizeSpotifyInvite,
  spotifyService,
};
