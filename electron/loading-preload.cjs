'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  retry:    () => ipcRenderer.send('balance-retry'),
  continuar: () => ipcRenderer.send('balance-continuar'),
})
