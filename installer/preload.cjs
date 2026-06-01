const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // "win32" | "darwin" | "linux" — drives platform-specific steps + chrome.
  platform: process.platform,
  runStep:  (step) => ipcRenderer.invoke('run-step', step),
  minimize: ()     => ipcRenderer.send('window-minimize'),
  close:    ()     => ipcRenderer.send('window-close'),

  // Subscribe to live progress events emitted by the main process during long-running
  // steps (stage label + optional detail line). Returns an unsubscribe function.
  onProgress: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on('install:progress', handler)
    return () => ipcRenderer.removeListener('install:progress', handler)
  }
})
