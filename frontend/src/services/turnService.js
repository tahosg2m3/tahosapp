import { API_URL } from '../config/runtimeConfig';
import { apiFetch } from './httpClient';

let cachedCredentials = null;
let pendingRequest = null;

function normalizeIceServers(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(server => {
    if (!server || typeof server !== 'object') return false;
    if (typeof server.urls === 'string') return Boolean(server.urls.trim());
    return Array.isArray(server.urls) && server.urls.some(url => typeof url === 'string' && url.trim());
  });
}

async function requestTurnCredentials() {
  const token = localStorage.getItem('chat_token');
  if (!token) return [];

  const response = await apiFetch(`${API_URL}/turn-credentials`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (response.status === 404 || response.status === 503) return [];
  if (!response.ok) throw new Error('TURN kimliği alınamadı.');

  const payload = await response.json();
  const iceServers = normalizeIceServers(payload?.iceServers);
  const expiresAt = Number(payload?.expiresAt || 0);
  if (!iceServers.length || !Number.isFinite(expiresAt)) return [];

  cachedCredentials = { iceServers, expiresAt };
  return iceServers;
}

export async function getPeerIceServers() {
  if (cachedCredentials && cachedCredentials.expiresAt - Date.now() > 60_000) {
    return cachedCredentials.iceServers;
  }

  if (!pendingRequest) {
    pendingRequest = requestTurnCredentials().finally(() => {
      pendingRequest = null;
    });
  }

  return pendingRequest;
}

export function withPeerIceServers(baseOptions, iceServers) {
  if (!Array.isArray(iceServers) || !iceServers.length) return baseOptions;
  return {
    ...baseOptions,
    config: {
      ...(baseOptions.config || {}),
      iceServers,
    },
  };
}
