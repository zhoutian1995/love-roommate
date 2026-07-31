'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getBootstrap: (id) => ipcRenderer.invoke('pet:get-bootstrap', id),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
  setInteractive: (interactive) => ipcRenderer.send('pet:set-interactive', Boolean(interactive)),
  openContextMenu: () => ipcRenderer.send('pet:context-menu'),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  endDrag: () => ipcRenderer.send('pet:drag-end')
});
