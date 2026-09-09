import { API_URL as API_ROOT } from '../config/runtimeConfig';
import { apiFetch } from './httpClient';

async function platformRequest(path, options = {}) {
  const token = localStorage.getItem('chat_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await apiFetch(`${API_ROOT}${path}`, { ...options, headers });
  } catch (_) {
    throw new Error('Could not connect to the server. Check your internet connection and try again.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || 'The request could not be completed.');
    error.status = response.status;
    error.code = payload.code;
    error.details = payload;
    throw error;
  }
  return payload;
}

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const getInvitePreview = code => platformRequest(`/invites/${encodeURIComponent(code)}`);
export const discoverServers = (query = '') => platformRequest(`/discovery${query ? `?query=${encodeURIComponent(query)}` : ''}`);

export const listInvites = serverId => platformRequest(`/servers/${serverId}/invites`);
export const createInvite = (serverId, data) => platformRequest(`/servers/${serverId}/invites`, json('POST', data));
export const revokeInvite = (serverId, inviteId) => platformRequest(`/servers/${serverId}/invites/${inviteId}`, { method: 'DELETE' });

export const listAuditLogs = (serverId, filters = {}) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
  return platformRequest(`/servers/${serverId}/audit-logs${query.size ? `?${query}` : ''}`);
};

export const getAutomod = serverId => platformRequest(`/servers/${serverId}/automod`);
export const saveAutomod = (serverId, data) => platformRequest(`/servers/${serverId}/automod`, json('PUT', data));

export const listReports = serverId => platformRequest(`/servers/${serverId}/reports`);
export const createReport = (serverId, data) => platformRequest(`/servers/${serverId}/reports`, json('POST', data));
export const resolveReport = (serverId, reportId, data) => platformRequest(`/servers/${serverId}/reports/${reportId}`, json('PATCH', data));
export const listBans = serverId => platformRequest(`/servers/${serverId}/bans`);
export const banMember = (serverId, userId, data) => platformRequest(`/servers/${serverId}/bans/${userId}`, json('PUT', data));
export const unbanMember = (serverId, userId) => platformRequest(`/servers/${serverId}/bans/${userId}`, { method: 'DELETE' });

export const getOnboarding = serverId => platformRequest(`/servers/${serverId}/onboarding`);
export const saveOnboarding = (serverId, data) => platformRequest(`/servers/${serverId}/onboarding`, json('PUT', data));
export const acknowledgeOnboarding = (serverId, data) => platformRequest(`/servers/${serverId}/onboarding/acknowledge`, json('POST', data));

export const listEvents = serverId => platformRequest(`/servers/${serverId}/events`);
export const createEvent = (serverId, data) => platformRequest(`/servers/${serverId}/events`, json('POST', data));
export const updateEvent = (serverId, eventId, data) => platformRequest(`/servers/${serverId}/events/${eventId}`, json('PATCH', data));
export const deleteEvent = (serverId, eventId) => platformRequest(`/servers/${serverId}/events/${eventId}`, { method: 'DELETE' });
export const rsvpEvent = (serverId, eventId, status) => platformRequest(`/servers/${serverId}/events/${eventId}/rsvp`, json('PUT', { status }));

export const getServerStats = serverId => platformRequest(`/servers/${serverId}/stats`);
export const exportServer = serverId => platformRequest(`/servers/${serverId}/export`);
export const listBackups = serverId => platformRequest(`/servers/${serverId}/backups`);
export const createBackup = (serverId, data) => platformRequest(`/servers/${serverId}/backups`, json('POST', data));
export const restoreBackup = (serverId, backupId) => platformRequest(`/servers/${serverId}/backups/${backupId}/restore`, json('POST'));
export const deleteBackup = (serverId, backupId) => platformRequest(`/servers/${serverId}/backups/${backupId}`, { method: 'DELETE' });
export const listServerTrash = serverId => platformRequest(`/servers/${serverId}/trash`);
export const restoreServerTrash = (serverId, trashId) => platformRequest(`/servers/${serverId}/trash/${trashId}/restore`, json('POST'));
export const purgeServerTrash = (serverId, trashId) => platformRequest(`/servers/${serverId}/trash/${trashId}`, { method: 'DELETE' });
export const listPublicTemplates = () => platformRequest('/templates');
export const listServerTemplates = serverId => platformRequest(`/servers/${serverId}/templates`);
export const createServerTemplate = (serverId, data) => platformRequest(`/servers/${serverId}/templates`, json('POST', data));
export const applyServerTemplate = (templateId, name) => platformRequest(`/templates/${templateId}/apply`, json('POST', { name }));

export const listWebhooks = serverId => platformRequest(`/servers/${serverId}/webhooks`);
export const createWebhook = (serverId, data) => platformRequest(`/servers/${serverId}/webhooks`, json('POST', data));
export const deleteWebhook = (serverId, webhookId) => platformRequest(`/servers/${serverId}/webhooks/${webhookId}`, { method: 'DELETE' });
export const listCommands = serverId => platformRequest(`/servers/${serverId}/commands`);
export const createCommand = (serverId, data) => platformRequest(`/servers/${serverId}/commands`, json('POST', data));
export const deleteCommand = (serverId, commandId) => platformRequest(`/servers/${serverId}/commands/${commandId}`, { method: 'DELETE' });

export const listServerAssets = (serverId, type) => platformRequest(`/servers/${serverId}/${type}`);
export const createServerAsset = (serverId, type, data) => platformRequest(`/servers/${serverId}/${type}`, json('POST', data));
export const deleteServerAsset = (serverId, type, assetId) => platformRequest(`/servers/${serverId}/${type}/${assetId}`, { method: 'DELETE' });

export const getNotificationPreferences = () => platformRequest('/users/me/notification-preferences');
export const saveNotificationPreferences = data => platformRequest('/users/me/notification-preferences', json('PUT', data));
export const saveServerNotificationPreferences = (serverId, data) => platformRequest(`/users/me/notification-preferences/servers/${serverId}`, json('PUT', data));
export const saveChannelNotificationPreferences = (channelId, data) => platformRequest(`/users/me/notification-preferences/channels/${channelId}`, json('PUT', data));
export const updateServerProfile = (serverId, data) => platformRequest(`/servers/${serverId}/members/me/profile`, json('PATCH', data));
export const listBlockedUsers = () => platformRequest('/users/me/blocks');
export const blockUser = userId => platformRequest(`/users/me/blocks/${userId}`, json('POST'));
export const unblockUser = userId => platformRequest(`/users/me/blocks/${userId}`, { method: 'DELETE' });

export const updateChannelMetadata = (channelId, data) => platformRequest(`/channels/${channelId}/metadata`, json('PATCH', data));
export const listChannelPermissions = channelId => platformRequest(`/channels/${channelId}/permissions`);
export const saveChannelPermission = (channelId, targetType, targetId, data) => platformRequest(`/channels/${channelId}/permissions/${targetType}/${targetId}`, json('PUT', data));
export const deleteChannelPermission = (channelId, targetType, targetId) => platformRequest(`/channels/${channelId}/permissions/${targetType}/${targetId}`, { method: 'DELETE' });
export const listAnnouncementFollowers = channelId => platformRequest(`/channels/${channelId}/followers`);
export const followAnnouncementChannel = (channelId, targetChannelId) => platformRequest(`/channels/${channelId}/followers`, json('POST', { targetChannelId }));
export const unfollowAnnouncementChannel = (channelId, followId) => platformRequest(`/channels/${channelId}/followers/${followId}`, { method: 'DELETE' });

export const listForumTags = channelId => platformRequest(`/channels/${channelId}/forum-tags`);
export const createForumTag = (channelId, data) => platformRequest(`/channels/${channelId}/forum-tags`, json('POST', data));
export const listForumPosts = channelId => platformRequest(`/channels/${channelId}/forum-posts`);
export const createForumPost = (channelId, data) => platformRequest(`/channels/${channelId}/forum-posts`, json('POST', data));
export const listForumReplies = (channelId, postId) => platformRequest(`/channels/${channelId}/forum-posts/${postId}/replies`);
export const createForumReply = (channelId, postId, data) => platformRequest(`/channels/${channelId}/forum-posts/${postId}/replies`, json('POST', data));

export const listThreads = channelId => platformRequest(`/channels/${channelId}/threads`);
export const createThread = (channelId, data) => platformRequest(`/channels/${channelId}/threads`, json('POST', data));
export const listThreadMessages = (channelId, threadId) => platformRequest(`/channels/${channelId}/threads/${threadId}/messages`);
export const createThreadMessage = (channelId, threadId, data) => platformRequest(`/channels/${channelId}/threads/${threadId}/messages`, json('POST', data));
export const getMessageEditHistory = (channelId, messageId) => platformRequest(`/channels/${channelId}/messages/${messageId}/edit-history`);

export const listPolls = channelId => platformRequest(`/channels/${channelId}/polls`);
export const createPoll = (channelId, data) => platformRequest(`/channels/${channelId}/polls`, json('POST', data));
export const votePoll = (channelId, pollId, optionIds) => platformRequest(`/channels/${channelId}/polls/${pollId}/votes`, json('PUT', { optionIds: Array.isArray(optionIds) ? optionIds : [optionIds] }));

export { platformRequest };
