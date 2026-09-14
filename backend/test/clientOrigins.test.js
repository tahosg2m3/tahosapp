const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { getClientOrigins, createCorsOrigin } = require('../src/middleware/clientOrigins');

const productionOrigins = getClientOrigins({ CLIENT_URL: ' https://tahosapp.com.tr, https://www.tahosapp.com.tr ' });

function evaluate(origin, options) {
  let result;
  createCorsOrigin(productionOrigins, options)(origin, (error, allowed) => { result = { error, allowed }; });
  return result;
}

test('production allowlist retains web, desktop, legacy desktop and exact Android origins', () => {
  for (const origin of ['https://tahosapp.com.tr', 'https://www.tahosapp.com.tr', 'tahosapp://app', 'discord-clone://app', 'https://localhost']) {
    assert.deepEqual(evaluate(origin), { error: null, allowed: true }, origin);
  }
  assert.deepEqual(evaluate(undefined), { error: null, allowed: true });
  assert.ok(getClientOrigins({}).has('http://localhost:5173'));
  assert.ok(!productionOrigins.has('http://localhost:5173'));
});

test('similar origins, opaque origins and other localhost schemes or ports are denied', () => {
  for (const origin of ['null', '*', 'http://localhost', 'https://localhost:5173', 'https://localhost.evil.example', 'https://tahosapp.com.tr.evil.example', 'capacitor://localhost', 'https://localhost/', 'https://example.com']) {
    const { error, allowed } = evaluate(origin);
    assert.equal(error?.status, 403, origin);
    assert.equal(error?.code, 'CORS_ORIGIN_DENIED', origin);
    assert.equal(allowed, undefined, origin);
  }
  const { error } = evaluate('https://example.com', { service: 'PeerJS', code: 'PEER_CORS_ORIGIN_DENIED' });
  assert.equal(error.code, 'PEER_CORS_ORIGIN_DENIED');
  assert.equal(error.message, 'PeerJS origin is not allowed.');
});

async function request(server, { path = '/api/check', method = 'GET', origin, headers = {} } = {}) {
  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port, path, method,
      headers: { ...(origin ? { Origin: origin } : {}), ...headers },
    }, resolve);
    req.once('error', reject);
    req.end();
  });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() };
}

test('Android preflight supports bearer auth and mutations while hostile origins remain blocked', async t => {
  const app = express();
  app.use(cors({ origin: createCorsOrigin(productionOrigins), credentials: true }));
  app.get('/api/check', (req, res) => res.json({ ok: true }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ code: error.code }));
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const preflight = await request(server, {
    method: 'OPTIONS', origin: 'https://localhost',
    headers: { 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://localhost');
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH/);
  assert.match(preflight.headers['access-control-allow-headers'], /authorization/);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');

  const denied = await request(server, { origin: 'https://localhost.evil.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert.equal((await request(server)).status, 200);
});

test('Socket.IO polling accepts the Android origin without weakening the origin filter', async t => {
  const server = http.createServer();
  const io = new Server(server, {
    cors: { origin: createCorsOrigin(productionOrigins), methods: ['GET', 'POST'], credentials: true },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => io.close(resolve)));
  const path = '/socket.io/?EIO=4&transport=polling';

  const allowed = await request(server, { path, origin: 'https://localhost' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://localhost');
  assert.match(allowed.body, /^0\{/);
  const denied = await request(server, { path, origin: 'https://example.com' });
  assert.equal(denied.status, 400);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});
