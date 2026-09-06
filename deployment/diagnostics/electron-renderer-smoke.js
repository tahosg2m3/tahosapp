const WebSocket = require('ws');

const port = Number(process.argv[2] || 9335);
const includeDevices = !process.argv.slice(3).includes('--skip-devices');

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
  const target = targets.find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl);
  if (!target) throw new Error('Electron renderer target not found.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  socket.on('message', raw => {
    const message = JSON.parse(String(raw));
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    if (message.error) resolver.reject(new Error(message.error.message));
    else resolver.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const expression = `
    (async () => {
      const runtime = globalThis.tahosappRuntime || {};
      const result = {
        pageUrl: location.href,
        apiOrigin: runtime.apiOrigin || '',
        mode: runtime.mode || '',
      };
      try {
        const response = await fetch((runtime.apiOrigin || 'https://api.tahosapp.com.tr') + '/health');
        result.fetchStatus = response.status;
        result.fetchBody = await response.text();
      } catch (error) {
        result.fetchError = error && (error.stack || error.message || String(error));
      }
      try {
        const bridgeResponse = await globalThis.electron?.api?.request({
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'desktop-connectivity-check@invalid.example',
            password: 'not-a-real-password',
          }),
        });
        result.apiBridge = bridgeResponse?.transportError
          ? { transportError: true, code: bridgeResponse.code }
          : { status: bridgeResponse?.status, contentType: bridgeResponse?.headers?.['content-type'] };
      } catch (error) {
        result.apiBridgeError = error && (error.stack || error.message || String(error));
      }
      try {
        if (globalThis.electron?.desktopUpdater) {
          result.desktopUpdate = await globalThis.electron.desktopUpdater.getState();
        }
      } catch (error) {
        result.desktopUpdateError = error && (error.stack || error.message || String(error));
      }
      if (${JSON.stringify(includeDevices)}) try {
        const before = await navigator.mediaDevices.enumerateDevices();
        result.devicesBeforePermission = before.map(device => ({ kind: device.kind, label: device.label, id: device.deviceId }));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        try {
          const after = await navigator.mediaDevices.enumerateDevices();
          result.devicesAfterPermission = after.map(device => ({ kind: device.kind, label: device.label, id: device.deviceId }));
        } finally {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (error) {
        result.deviceError = error && (error.name + ': ' + error.message);
      }
      return result;
    })()
  `;
  const evaluation = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  socket.close();
  process.stdout.write(JSON.stringify(evaluation.result?.value || evaluation, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
