const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haloCapture', {
  enumerateWindows: () => ipcRenderer.invoke('enumerate-windows'),
  simulateInput: (data) => ipcRenderer.invoke('simulate-input', data),
  getWindowBounds: (sourceId) => ipcRenderer.invoke('get-window-bounds', sourceId),
});
