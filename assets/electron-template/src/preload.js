'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getBootstrap: () => ipcRenderer.invoke('pet:get-bootstrap'),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
  onPaused: (callback) => {
    const handler = (_event, paused) => callback(paused);
    ipcRenderer.on('pet:paused', handler);
    return () => ipcRenderer.removeListener('pet:paused', handler);
  },
  onPresentRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('pet:present-request', handler);
    return () => ipcRenderer.removeListener('pet:present-request', handler);
  },
  signalPresented: () => ipcRenderer.send('pet:presented'),
  setInteractive: (interactive) => {
    if (typeof interactive !== 'boolean') throw new TypeError('interactive must be a boolean');
    ipcRenderer.send('pet:set-interactive', interactive);
  },
  openContextMenu: () => ipcRenderer.send('pet:context-menu'),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  endDrag: () => ipcRenderer.send('pet:drag-end')
});
