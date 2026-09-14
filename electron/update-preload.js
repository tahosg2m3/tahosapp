const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tahosappUpdate', Object.freeze({
  hide: () => ipcRenderer.send('update-window:hide'),
  onState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state && typeof state === 'object' ? state : {});
    ipcRenderer.on('desktop-update:state', listener);
    return () => ipcRenderer.removeListener('desktop-update:state', listener);
  },
}));
