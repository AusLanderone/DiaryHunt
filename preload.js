const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
  balances: {
    list: () => ipcRenderer.invoke('balances:list'),
    add: (input) => ipcRenderer.invoke('balances:add', input),
    update: (id, patch) => ipcRenderer.invoke('balances:update', id, patch),
    remove: (id) => ipcRenderer.invoke('balances:remove', id),
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    push: () => ipcRenderer.invoke('sync:push'),
    pull: () => ipcRenderer.invoke('sync:pull'),
    setLink: (url) => ipcRenderer.invoke('sync:setLink', url),
    scriptCode: () => ipcRenderer.invoke('sync:scriptCode'),
    disable: () => ipcRenderer.invoke('sync:disable'),
    // main pushes its state here after every upload, pull or failure
    onState: (cb) => ipcRenderer.on('sync:state', (_e, state) => cb(state)),
  },
  flows: {
    list: () => ipcRenderer.invoke('flows:list'),
    add: (input) => ipcRenderer.invoke('flows:add', input),
    update: (id, patch) => ipcRenderer.invoke('flows:update', id, patch),
    remove: (id) => ipcRenderer.invoke('flows:remove', id),
  },
  rates: {
    usdRub: () => ipcRenderer.invoke('rates:usdRub'),
  },
  exportCsv: () => ipcRenderer.invoke('export:csv'),
  setZoom: (factor) => webFrame.setZoomFactor(factor), // proper page zoom (fills viewport)
  db: {
    export: () => ipcRenderer.invoke('db:export'),
    import: () => ipcRenderer.invoke('db:import'),
  },
});
