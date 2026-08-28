const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/store');
const { createBalanceStore } = require('./src/balanceStore');
const rates = require('./src/rates');
const { createConfig } = require('./src/config');
const { tradesToCsv } = require('./src/export');
const backup = require('./src/backup');

let store, balanceStore, config;

function initData() {
  const dataDir = app.getPath('userData');
  store = createStore({ dataDir });
  balanceStore = createBalanceStore({ dataDir });
  config = createConfig({ dataDir });
}

function registerIpc() {
  ipcMain.handle('trades:list', () => store.list());
  ipcMain.handle('trades:add', (_e, input) => store.add(input));
  ipcMain.handle('trades:update', (_e, id, patch) => store.update(id, patch));
  ipcMain.handle('trades:remove', (_e, id) => store.remove(id));
  ipcMain.handle('balances:list', () => balanceStore.list());
  ipcMain.handle('balances:add', (_e, input) => balanceStore.add(input));
  ipcMain.handle('balances:update', (_e, id, patch) => balanceStore.update(id, patch));
  ipcMain.handle('balances:remove', (_e, id) => balanceStore.remove(id));
  ipcMain.handle('flows:list', () => balanceStore.listFlows());
  ipcMain.handle('flows:add', (_e, input) => balanceStore.addFlow(input));
  ipcMain.handle('flows:update', (_e, id, patch) => balanceStore.updateFlow(id, patch));
  ipcMain.handle('flows:remove', (_e, id) => balanceStore.removeFlow(id));
  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:addItem', (_e, kind, value) => config.addItem(kind, value));
  ipcMain.handle('config:removeItem', (_e, kind, value) => config.removeItem(kind, value));
  ipcMain.handle('config:getSettings', () => config.getSettings());
  ipcMain.handle('config:setSettings', (_e, patch) => config.setSettings(patch));
  // Live USD/RUB for the trade form. Network lives in main (the renderer is
  // sandboxed); errors come back as { ok: false } so the form can show them.
  ipcMain.handle('rates:usdRub', async () => {
    const get = async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'DiaryHunt' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return { ok: true, ...(await rates.fetchUsdRub({ get })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('export:csv', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'diaryhunt-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, '﻿' + tradesToCsv(store.list()), 'utf8'); // BOM for Excel
    return { saved: true, path: filePath };
  });

  // Full DB backup: trades + dictionaries + settings, as JSON.
  ipcMain.handle('db:export', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `diaryhunt-backup-${day}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const cfg = config.get();
    const data = backup.build({
      trades: store.list(),
      balances: balanceStore.list(),
      cashflows: balanceStore.listFlows(),
      config: cfg,
      settings: config.getSettings(),
    });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { saved: true, path: filePath, counts: data.counts, summary: backup.summary(data.counts) };
  });

  // Restore from a backup file (replaces current trades; store backs up first).
  ipcMain.handle('db:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { imported: false };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      return { imported: false, error: 'Файл не читается как JSON.' };
    }
    const read = backup.read(parsed);
    if (!read.ok) return { imported: false, error: read.error };
    // a section the file doesn't carry is left as it is — backups made before
    // the balances tab existed must not wipe today's snapshots
    if (read.trades) store.replaceAll(read.trades);
    if (read.balances) balanceStore.replaceAll(read.balances);
    if (read.cashflows) balanceStore.replaceAllFlows(read.cashflows);
    if (read.config) config.importAll(read.config);
    return { imported: true, counts: read.counts, summary: backup.summary(read.counts) };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initData();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
