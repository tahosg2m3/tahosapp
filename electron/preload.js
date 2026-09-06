const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  platform: process.platform,
  api: Object.freeze({
    request: request => ipcRenderer.invoke('api:request', request),
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
