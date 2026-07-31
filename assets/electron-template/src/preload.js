'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getBootstrap: () => ipcRenderer.invoke('pet:get-bootstrap'),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
  setInteractive: (interactive) => {
    if (typeof interactive !== 'boolean') throw new TypeError('interactive must be a boolean');
    ipcRenderer.send('pet:set-interactive', interactive);
  },
  openContextMenu: () => ipcRenderer.send('pet:context-menu'),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  endDrag: () => ipcRenderer.send('pet:drag-end')
});
