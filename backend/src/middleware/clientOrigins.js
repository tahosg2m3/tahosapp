// Keep the API, Socket.IO and PeerJS origin policies in sync. Native clients
// still authenticate with bearer tokens; an allowed Origin is not a credential.
const BUNDLED_CLIENT_ORIGINS = [
  'tahosapp://app',
  // Older desktop releases need access while their update is being delivered.
  'discord-clone://app',
  // Capacitor serves the bundled Android frontend from this exact origin.
  'https://localhost',
];

function getClientOrigins(env = process.env) {
  return new Set([
    ...String(env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    ...BUNDLED_CLIENT_ORIGINS,
  ]);
}

function createCorsOrigin(origins, { service = 'Client', code = 'CORS_ORIGIN_DENIED' } = {}) {
  return (origin, callback) => {
    // Health checks and native/non-browser clients may omit Origin. Browser
    // origins must match exactly: do not admit null, wildcard or localhost ports.
    if (!origin || origins.has(origin)) {
      callback(null, true);
      return;
    }

    const error = new Error(`${service} origin is not allowed.`);
    error.status = 403;
    error.code = code;
    callback(error);
  };
}

module.exports = { getClientOrigins, createCorsOrigin };
