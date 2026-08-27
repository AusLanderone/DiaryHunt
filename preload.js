const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  trades: {
    list: () => ipcRenderer.invoke('trades:list'),
    add: (input) => ipcRenderer.invoke('trades:add', input),
    update: (id, patch) => ipcRenderer.invoke('trades:update', id, patch),
    remove: (id) => ipcRenderer.invoke('trades:remove', id),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    addItem: (kind, value) => ipcRenderer.invoke('config:addItem', kind, value),
    removeItem: (kind, value) => ipcRenderer.invoke('config:removeItem', kind, value),
    getSettings: () => ipcRenderer.invoke('config:getSettings'),
    setSettings: (patch) => ipcRenderer.invoke('config:setSettings', patch),
  },
  exportCsv: () => ipcRenderer.invoke('export:csv'),
  db: {
    export: () => ipcRenderer.invoke('db:export'),
    import: () => ipcRenderer.invoke('db:import'),
  },
});
