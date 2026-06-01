const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("omni", {
  listModels: (settings) => ipcRenderer.invoke("omni:list-models", settings),
  chat: (request) => ipcRenderer.invoke("omni:chat", request),
  bootstrapStatus: () => ipcRenderer.invoke("bootstrap:status"),
  installNode: () => ipcRenderer.invoke("bootstrap:install-node"),
  installOmniRoute: () => ipcRenderer.invoke("bootstrap:install-omniroute"),
  startOmniRoute: () => ipcRenderer.invoke("bootstrap:start-omniroute"),
  claudeCheck: () => ipcRenderer.invoke("claude:check"),
  claudeLaunch: (payload) => ipcRenderer.invoke("claude:launch", payload),
  openLogsFolder: () => ipcRenderer.invoke("logs:open"),
  logsPath: () => ipcRenderer.invoke("logs:path"),

  // Main-process initiated toast — used for background events (OmniRoute auto-
  // downgrade, etc.) where the renderer wouldn't otherwise know to surface them.
  // Returns an unsubscribe function.
  onAppToast: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("app:toast", handler);
    return () => ipcRenderer.removeListener("app:toast", handler);
  }
});

// Custom window-control bridge — paired with the frameless BrowserWindow and the
// .window-controls cluster in the renderer.
contextBridge.exposeInMainWorld("winctl", {
  // Renderer uses this to hide the custom min/max/close cluster on macOS (where
  // we keep the native traffic lights) and to pad the top bar accordingly.
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (cb) => {
    const handler = (_e, value) => cb(value);
    ipcRenderer.on("window:maximized", handler);
    return () => ipcRenderer.removeListener("window:maximized", handler);
  }
});
