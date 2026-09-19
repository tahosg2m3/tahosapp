const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');

const temporaryDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tahosapp-auth-test-'));
process.env.APP_DATA_DIR = temporaryDataDirectory;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-that-is-longer-than-thirty-two-bytes';
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.DISCORD_OAUTH_CLIENT_ID;
delete process.env.DISCORD_OAUTH_CLIENT_SECRET;

const storage = require('../src/storage/inMemory');
const authRoutes = require('../src/routes/auth');
const communityHubRoutes = require('../src/routes/communityHub');
const { createSession, ensureHubState, getSession } = require('../src/services/communityHubService');
const { signAuthToken } = require('../src/middleware/auth');
const { hashPassword, verifyPassword } = require('../src/services/passwordService');

function request(server, { method = 'GET', requestPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
    }, async response => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() });
    });
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('social provider state and authenticated password change work end to end', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/hub', communityHubRoutes);
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    storage.close();
    assert.equal(path.dirname(temporaryDataDirectory), os.tmpdir());
    fs.rmSync(temporaryDataDirectory, { recursive: true, force: true });
  });

  const disabledProviders = await request(server, { requestPath: '/api/auth/social/providers' });
  assert.equal(disabledProviders.status, 200);
  assert.deepEqual(JSON.parse(disabledProviders.body).providers.map(item => item.enabled), [false, false]);

  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-secret';
  process.env.SOCIAL_AUTH_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SOCIAL_AUTH_WEB_URL = 'http://127.0.0.1:5173/app/';

  const start = await request(server, { requestPath: '/api/auth/social/google/start?client=web' });
  assert.equal(start.status, 303);
  const providerUrl = new URL(start.headers.location);
  assert.equal(providerUrl.origin, 'https://accounts.google.com');
  assert.equal(providerUrl.searchParams.get('client_id'), 'test-google-client');
  const state = providerUrl.searchParams.get('state');
  assert.match(state, /^[A-Za-z0-9_-]{40,100}$/);
  const stateCookie = start.headers['set-cookie'][0].split(';')[0];
  assert.equal(decodeURIComponent(stateCookie.split('=')[1]), state);

  const callback = await request(server, {
    requestPath: `/api/auth/social/google/callback?state=${encodeURIComponent(state)}&error=access_denied`,
    headers: { Cookie: stateCookie },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, 'http://127.0.0.1:5173/app/#social_error=cancelled');

  const oldPassword = 'old-password-123';
  const newPassword = 'new-password-456';
  const user = storage.createUserWithAuth({
    username: 'auth-test-user',
    email: 'auth-test@example.com',
    password: await hashPassword(oldPassword),
  });
  const session = createSession(user.id, { ip: '127.0.0.1', headers: { 'user-agent': 'node-test' } }, 'password');
  const token = signAuthToken(user, { sid: session.id });

  const passkeys = await request(server, {
    requestPath: '/api/hub/passkeys',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(passkeys.status, 200);
  assert.deepEqual(JSON.parse(passkeys.body), []);

  for (const id of ['__proto__', 'constructor']) {
    const revoke = await request(server, {
      method: 'DELETE',
      requestPath: `/api/hub/sessions/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(revoke.status, 404);
    assert.equal(getSession(id), null);
  }
  assert.equal(Object.prototype.revokedAt, undefined);
  const anotherSession = createSession(user.id, { ip: '127.0.0.1', headers: {} });
  const revokeOwnSession = await request(server, {
    method: 'DELETE',
    requestPath: `/api/hub/sessions/${anotherSession.id}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(revokeOwnSession.status, 200);
  assert.ok(ensureHubState().sessions[anotherSession.id].revokedAt);

  const wrongPassword = await request(server, {
    method: 'POST',
    requestPath: '/api/auth/change-password',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword }),
  });
  assert.equal(wrongPassword.status, 401);

  const changed = await request(server, {
    method: 'POST',
    requestPath: '/api/auth/change-password',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await verifyPassword(newPassword, storage.getUserById(user.id).password)).valid, true);

  const oldSession = await request(server, {
    requestPath: '/api/auth/verify',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(oldSession.status, 401);

  let limited;
  for (let attempt = 0; attempt < 1201; attempt += 1) {
    limited = await request(server, { requestPath: '/api/hub/overview' });
    if (limited.status === 429) break;
  }
  assert.equal(limited.status, 429);
  assert.equal(JSON.parse(limited.body).code, 'RATE_LIMITED');
});
