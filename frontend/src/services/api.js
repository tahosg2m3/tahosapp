import { API_URL as RUNTIME_API_URL } from '../config/runtimeConfig';
import { apiFetch } from './httpClient';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('chat_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await apiFetch(`${RUNTIME_API_URL}${endpoint}`, { ...options, headers });
  } catch (error) {
    throw new Error('Could not connect to the server. Check your internet connection and make sure you are using the latest app version.', { cause: error });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Server request failed (${response.status}).`);
    error.code = payload.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export const fetchGifs = (query = '', limit = 24) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set('query', query.trim());
  return request(`/gifs?${params}`);
};

// Auth
export const loginUser = (data) =>
  request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const verifyTwoFactorCode = (data) =>
  request('/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const resendTwoFactorCode = (data) =>
  request('/auth/resend-2fa', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const registerUser = (data) =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const verifyToken = () => request('/auth/verify');

export const requestPasswordReset = (email) => request('/auth/request-password-reset', {
  method: 'POST',
  body: JSON.stringify({ email }),
});

export const resendPasswordReset = (resetTicket) => request('/auth/resend-password-reset', {
  method: 'POST',
  body: JSON.stringify({ resetTicket }),
});

export const resetPassword = (data) => request('/auth/reset-password', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const requestEmailChange = (data) => request('/auth/request-email-change', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const resendEmailChange = (emailChangeTicket) => request('/auth/resend-email-change', {
  method: 'POST',
  body: JSON.stringify({ emailChangeTicket }),
});

export const confirmEmailChange = (data) => request('/auth/confirm-email-change', {
  method: 'POST',
  body: JSON.stringify(data),
});

// Servers
export const fetchServers = (userId) => request(`/servers?userId=${userId}`);
export const fetchServerById = (id) => request(`/servers/${id}`);
export const createServer = (name, creatorId) => request('/servers', { method: 'POST', body: JSON.stringify({ name, creatorId }) });
export const deleteServer = (id) => request(`/servers/${id}`, { method: 'DELETE' });
export const joinServer = (inviteCode, userId) => request('/servers/join', { method: 'POST', body: JSON.stringify({ inviteCode, userId }) });

// YENİLER:
export const leaveServer = (serverId, userId) => request(`/servers/${serverId}/leave`, { method: 'POST', body: JSON.stringify({ userId }) });
export const fetchServerMembers = (serverId) => request(`/servers/${serverId}/members`);

// Channels & Messages
export const fetchChannels = (serverId) => request(`/channels?serverId=${serverId}`);
export const fetchChannelMessages = (channelId, before = null) => {
  const query = before ? `?before=${before}&limit=50` : '?limit=50';
  return request(`/channels/${channelId}/messages${query}`);
};
export const createChannel = (serverId, name, type) => request('/channels', { method: 'POST', body: JSON.stringify({ serverId, name, type }) });
export const deleteChannel = (id) => request(`/channels/${id}`, { method: 'DELETE' });

// Users & Friends
export const fetchUsers = () => request('/users');
export const fetchUserProfile = (userId, serverId = '') => {
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
  return request(`/users/${encodeURIComponent(userId)}/profile${query}`);
};
export const savePrivateUserNote = (userId, note) => request(`/users/${encodeURIComponent(userId)}/note`, {
  method: 'PUT',
  body: JSON.stringify({ note }),
});
export const getRichPresenceSettings = () => request('/users/me/rich-presence');
export const createRichPresenceToken = () => request('/users/me/rich-presence/token', { method: 'POST' });
export const revokeRichPresenceToken = () => request('/users/me/rich-presence/token', { method: 'DELETE' });
export const updateRichPresenceSettings = enabled => request('/users/me/rich-presence/settings', {
  method: 'PATCH',
  body: JSON.stringify({ enabled }),
});
export const setRichPresenceActivity = activity => request('/rich-presence', {
  method: 'PUT',
  body: JSON.stringify(activity),
});
export const clearRichPresenceActivity = sessionId => request(`/rich-presence/${encodeURIComponent(sessionId)}`, {
  method: 'DELETE',
});
export const clearAllRichPresenceActivities = () => request('/rich-presence', { method: 'DELETE' });
export const getSpotifyStatus = () => request('/spotify/status');
export const createSpotifyAuthorization = () => request('/spotify/connect', { method: 'POST' });
export const disconnectSpotify = () => request('/spotify/connection', { method: 'DELETE' });
export const getSpotifyCurrentlyPlaying = () => request('/spotify/currently-playing');
export const createSpotifyInviteFromUrl = url => request('/spotify/invite', {
  method: 'POST',
  body: JSON.stringify({ url }),
});
export const playSpotifyInvite = invite => request('/spotify/play', {
  method: 'PUT',
  body: JSON.stringify({ invite }),
});
export const fetchFriends = (userId) => request(`/friends/${userId}`);
export const fetchPendingRequests = (userId) => request(`/friends/${userId}/pending`);
export const sendFriendRequest = (fromUserId, targetUsername) => request('/friends/request', { method: 'POST', body: JSON.stringify({ fromUserId, targetUsername }) });
export const acceptFriendRequest = (requestId) => request('/friends/accept', { method: 'POST', body: JSON.stringify({ requestId }) });
export const rejectFriendRequest = (requestId) => request('/friends/reject', { method: 'POST', body: JSON.stringify({ requestId }) });
export const removeFriend = (userId, friendId) => request(`/friends/${userId}/${friendId}`, { method: 'DELETE' });

// DM
export const fetchDMConversations = (userId) => request(`/dm/${userId}`);
export const fetchDMMessages = (conversationId) => request(`/dm/messages/${conversationId}`);
export const createDMConversation = (userId1, userId2) => request('/dm/create', { method: 'POST', body: JSON.stringify({ userId1, userId2 }) });
export const createGroupDM = ({ name, icon = null, memberIds }) => request('/dm/groups', {
  method: 'POST',
  body: JSON.stringify({ name, icon, memberIds }),
});
export const fetchGroupDM = (conversationId) => request(`/dm/groups/${conversationId}`);
export const updateGroupDM = (conversationId, updates) => request(`/dm/groups/${conversationId}`, {
  method: 'PATCH',
  body: JSON.stringify(updates),
});
export const addGroupDMMember = (conversationId, userId) => request(`/dm/groups/${conversationId}/members`, {
  method: 'POST',
  body: JSON.stringify({ userId }),
});
export const removeGroupDMMember = (conversationId, userId) => request(`/dm/groups/${conversationId}/members/${userId}`, {
  method: 'DELETE',
});
export const leaveGroupDM = (conversationId) => request(`/dm/groups/${conversationId}/leave`, { method: 'POST' });
