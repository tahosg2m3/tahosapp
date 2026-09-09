const storage = require('../storage/inMemory');

function resolveServerId(req) {
  return req.params.serverId || req.params.id || req.body?.serverId || null;
}

function requireServerMember(req, res, next) {
  const serverId = resolveServerId(req);
  const server = storage.getServerById(serverId);

  if (!server || server.isDM) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  if (!storage.isServerMember(serverId, req.user.id)) {
    return res.status(403).json({ error: 'You do not have access to this server.' });
  }

  req.server = server;
  return next();
}

function requireServerOwner(req, res, next) {
  const serverId = resolveServerId(req);
  const server = storage.getServerById(serverId);

  if (!server || server.isDM) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  if (server.creatorId !== req.user.id) {
    return res.status(403).json({ error: 'Only the server owner can perform this action.' });
  }

  req.server = server;
  return next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const serverId = resolveServerId(req);
    const server = storage.getServerById(serverId);

    if (!server || server.isDM) {
      return res.status(404).json({ error: 'Server not found.' });
    }

    if (!storage.isServerMember(serverId, req.user.id)) {
      return res.status(403).json({ error: 'You do not have access to this server.' });
    }

    if (!storage.hasPermission(serverId, req.user.id, permission)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }

    req.server = server;
    return next();
  };
}

module.exports = {
  resolveServerId,
  requireServerMember,
  requireServerOwner,
  requirePermission,
};
