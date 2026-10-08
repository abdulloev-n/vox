const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['rec:start', 'rec:stop', 'rec:cancel', 'widget:state', 'history:updated', 'settings:changed', 'nav'];

contextBridge.exposeInMainWorld('vox', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  on: (channel, cb) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
