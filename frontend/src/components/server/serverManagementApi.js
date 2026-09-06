import { API_URL } from '../../config/runtimeConfig';
import { apiFetch } from '../../services/httpClient';

async function request(path, options = {}) {
  const token = localStorage.getItem('chat_token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await apiFetch(`${API_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || payload.message || 'İşlem gerçekleştirilemedi.');
  }

  return payload;
}

export const getServerRoles = (serverId) => request(`/servers/${serverId}/roles`);

export const createServerRole = (serverId, data) => request(`/servers/${serverId}/roles`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateServerRole = (serverId, roleId, data) => request(`/servers/${serverId}/roles/${roleId}`, {
  method: 'PATCH',
  body: JSON.stringify(data),
});

export const deleteServerRole = (serverId, roleId, actorId) => request(`/servers/${serverId}/roles/${roleId}`, {
  method: 'DELETE',
  body: JSON.stringify({ actorId }),
});

export const reorderServerRoles = (serverId, roleIds) => request(`/servers/${serverId}/roles/reorder`, {
  method: 'PUT',
  body: JSON.stringify({ roleIds }),
});

export const getServerMembers = (serverId) => request(`/servers/${serverId}/members`);

export const assignMemberRoles = (serverId, memberId, roleIds, actorId) => request(
  `/servers/${serverId}/members/${memberId}/roles`,
  {
    method: 'PATCH',
    body: JSON.stringify({ roleIds, actorId }),
  },
);

export const moderateMember = (serverId, memberId, action, actorId, reason = '', options = {}) => request(
  `/servers/${serverId}/members/${memberId}/moderate`,
  {
    method: 'POST',
    body: JSON.stringify({ action, actorId, reason, ...options }),
  },
);

export const updateServerDetails = (serverId, data) => request(`/servers/${serverId}`, {
  method: 'PATCH',
  body: JSON.stringify(data),
});

export const removeServer = (serverId, actorId) => request(`/servers/${serverId}`, {
  method: 'DELETE',
  body: JSON.stringify({ actorId }),
});

export const transferServerOwnership = (serverId, userId) => request(`/servers/${serverId}/transfer-ownership`, {
  method: 'POST',
  body: JSON.stringify({ userId }),
});

export const createManagedChannel = (serverId, name, type, userId) => request('/channels', {
  method: 'POST',
  body: JSON.stringify({ serverId, name, type, userId }),
});

export const removeManagedChannel = (channelId, userId) => request(`/channels/${channelId}`, {
  method: 'DELETE',
  body: JSON.stringify({ userId }),
});

export function unwrapRoles(payload) {
  return Array.isArray(payload) ? payload : (payload?.roles || []);
}

export function unwrapMembers(payload) {
  return Array.isArray(payload) ? payload : (payload?.members || []);
}

export function getMemberRoleIds(member) {
  if (!member) return [];
  if (Array.isArray(member.roleIds)) return member.roleIds;
  if (Array.isArray(member.roles)) return member.roles.map((role) => (typeof role === 'string' ? role : role.id)).filter(Boolean);
  if (Array.isArray(member.serverRoleIds)) return member.serverRoleIds;
  return [];
}

export function getEffectivePermissions({ roles = [], member, isOwner = false }) {
  const allPermissions = [
    'ADMINISTRATOR',
    'MANAGE_SERVER',
    'MANAGE_ROLES',
    'MANAGE_CHANNELS',
    'KICK_MEMBERS',
    'MODERATE_MEMBERS',
    'MANAGE_MESSAGES',
    'CONNECT',
    'SPEAK',
    'STREAM',
    'MUTE_MEMBERS',
    'DEAFEN_MEMBERS',
    'MOVE_MEMBERS',
  ];

  if (isOwner) {
    return Object.fromEntries(allPermissions.map((permission) => [permission, true]));
  }

  const roleIds = new Set(getMemberRoleIds(member));
  const permissions = {};

  roles.filter((role) => roleIds.has(role.id)).forEach((role) => {
    const values = Array.isArray(role.permissions)
      ? role.permissions
      : Object.entries(role.permissions || {}).filter(([, allowed]) => allowed).map(([permission]) => permission);
    values.forEach((permission) => { permissions[permission] = true; });
  });

  if (permissions.ADMINISTRATOR) {
    allPermissions.forEach((permission) => { permissions[permission] = true; });
  }

  return permissions;
}

export function permissionsToMap(permissions = []) {
  if (Array.isArray(permissions)) {
    const map = Object.fromEntries(permissions.map((permission) => [permission, true]));
    if (map.ADMINISTRATOR) {
      ['MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'KICK_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'STREAM', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'].forEach((permission) => {
        map[permission] = true;
      });
    }
    return map;
  }
  return permissions || {};
}
