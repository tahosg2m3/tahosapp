const { contextBridge, ipcRenderer } = require('electron');

let pendingSocialAuthPayload = null;
const socialAuthCallbacks = new Set();
ipcRenderer.on('social-auth:callback', (_event, payload) => {
  pendingSocialAuthPayload = payload && typeof payload === 'object' ? payload : null;
  socialAuthCallbacks.forEach(callback => callback(pendingSocialAuthPayload));
  if (socialAuthCallbacks.size) pendingSocialAuthPayload = null;
});

contextBridge.exposeInMainWorld('electron', {
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  platform: process.platform,
  api: Object.freeze({
    request: request => ipcRenderer.invoke('api:request', request),
  }),
  socialAuth: Object.freeze({
    start: provider => ipcRenderer.invoke('social-auth:start', provider),
    onCallback: callback => {
      if (typeof callback !== 'function') return () => {};
      socialAuthCallbacks.add(callback);
      if (pendingSocialAuthPayload) {
        const payload = pendingSocialAuthPayload;
        pendingSocialAuthPayload = null;
        queueMicrotask(() => callback(payload));
      }
      return () => socialAuthCallbacks.delete(callback);
    },
  }),
  automaticPresence: Object.freeze({
    start: () => ipcRenderer.invoke('automatic-presence:start'),
    stop: () => ipcRenderer.invoke('automatic-presence:stop'),
    onUpdate: callback => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, activities) => callback(Array.isArray(activities) ? activities : []);
      ipcRenderer.on('automatic-presence:update', listener);
      return () => ipcRenderer.removeListener('automatic-presence:update', listener);
    },
  }),
  desktopUpdater: Object.freeze({
    getState: () => ipcRenderer.invoke('desktop-update:get-state'),
    check: () => ipcRenderer.invoke('desktop-update:check'),
    install: () => ipcRenderer.invoke('desktop-update:install'),
    setAutomaticChecks: enabled => ipcRenderer.invoke('desktop-update:set-automatic', Boolean(enabled)),
    onState: callback => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, state) => callback(state && typeof state === 'object' ? state : {});
      ipcRenderer.on('desktop-update:state', listener);
      return () => ipcRenderer.removeListener('desktop-update:state', listener);
    },
  }),
});
