import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'deployment/app-config.json'), 'utf8'));
for (const field of ['apiOrigin', 'socketUrl']) {
  if (new URL(config[field]).protocol !== 'https:') throw new Error(`Android requires HTTPS ${field}.`);
}
if (config.mode !== 'remote' || !config.peerSecure) throw new Error('Android requires the secure remote deployment configuration.');

const env = {
  ...process.env,
  VITE_BASE_PATH: '/',
  VITE_API_ORIGIN: config.apiOrigin,
  VITE_API_URL: `${config.apiOrigin.replace(/\/$/, '')}/api`,
  VITE_SOCKET_URL: config.socketUrl,
  VITE_PEER_HOST: config.peerHost,
  VITE_PEER_PORT: String(config.peerPort),
  VITE_PEER_PATH: config.peerPath,
  VITE_PEER_SECURE: 'true',
  VITE_NATIVE_ANDROID: 'true',
};

for (const script of ['scripts/check-i18n.mjs', 'scripts/check-version-policy.mjs']) {
  const result = spawnSync(process.execPath, [resolve(root, script)], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.execPath, [resolve(root, 'frontend/node_modules/vite/bin/vite.js'), 'build', '--outDir', 'dist-android'], {
  cwd: resolve(root, 'frontend'), env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status || 0;
