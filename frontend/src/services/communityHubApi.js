import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { API_URL } from '../config/runtimeConfig';
import { apiFetch } from './httpClient';

async function request(path, options = {}) {
  const token = localStorage.getItem('chat_token');
  const response = await apiFetch(`${API_URL}/hub${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'İşlem tamamlanamadı.');
  return payload;
}

const json = (method, body) => ({ method, body: JSON.stringify(body || {}) });

export const getHubOverview = ({ serverId = '', channelId = '' } = {}) => {
  const query = new URLSearchParams();
  if (serverId) query.set('serverId', serverId);
  if (channelId) query.set('channelId', channelId);
  return request(`/overview${query.size ? `?${query}` : ''}`);
};

export const saveMessage = data => request('/bookmarks', json('POST', data));
export const deleteSavedMessage = id => request(`/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const createReminder = data => request('/reminders', json('POST', data));
export const cancelReminder = id => request(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const scheduleMessage = data => request('/scheduled-messages', json('POST', data));
export const cancelScheduledMessage = id => request(`/scheduled-messages/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createLfg = data => request('/lfg', json('POST', data));
export const joinLfg = id => request(`/lfg/${encodeURIComponent(id)}/join`, json('POST'));
export const closeLfg = id => request(`/lfg/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createTicket = data => request('/tickets', json('POST', data));
export const replyTicket = (id, message) => request(`/tickets/${encodeURIComponent(id)}/messages`, json('POST', { message }));
export const updateTicket = (id, data) => request(`/tickets/${encodeURIComponent(id)}`, json('PATCH', data));

export const createWikiPage = data => request('/wiki', json('POST', data));
export const updateWikiPage = (id, data) => request(`/wiki/${encodeURIComponent(id)}`, json('PATCH', data));
export const deleteWikiPage = id => request(`/wiki/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const addWhiteboardStroke = (channelId, data) => request(`/whiteboards/${encodeURIComponent(channelId)}/strokes`, json('POST', data));
export const clearWhiteboard = channelId => request(`/whiteboards/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
export const getCatchUp = (channelId, since) => request(`/catch-up/${encodeURIComponent(channelId)}?since=${encodeURIComponent(since)}`);

export const revokeSession = id => request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const deletePasskey = id => request(`/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });

export async function registerPasskey(name = '') {
  const start = await request('/passkeys/register/options', json('POST'));
  const response = await startRegistration({ optionsJSON: start.options });
  return request('/passkeys/register/verify', json('POST', { ticket: start.ticket, response, name }));
}

export async function loginWithPasskey(email) {
  const start = await request('/passkeys/login/options', json('POST', { email }));
  const response = await startAuthentication({ optionsJSON: start.options });
  return request('/passkeys/login/verify', json('POST', { ticket: start.ticket, response }));
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}

export async function enableWebPush(publicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Bu tarayıcı arka plan bildirimlerini desteklemiyor.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bildirim izni verilmedi.');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await request('/push/subscriptions', json('POST', { subscription: subscription.toJSON() }));
  return subscription;
}

export async function disableWebPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await request('/push/subscriptions', json('DELETE', { endpoint: subscription.endpoint }));
  await subscription.unsubscribe();
}
