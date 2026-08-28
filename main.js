const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/store');
const { createBalanceStore } = require('./src/balanceStore');
const rates = require('./src/rates');
const { createConfig } = require('./src/config');
const { tradesToCsv } = require('./src/export');
const backup = require('./src/backup');
const cloudSync = require('./src/cloudSync');
const cloudLink = require('./src/cloudLink');

let store, balanceStore, config;
let win = null;
let pushTimer = null;

function initData() {
  const dataDir = app.getPath('userData');
  store = createStore({ dataDir });
  balanceStore = createBalanceStore({ dataDir });
  config = createConfig({ dataDir });
}

// ---------- cloud sync through a folder the cloud client keeps in step ----------

const syncState = () => ({ url: '', lastPushAt: '', lastPullAt: '', lastChangeAt: '', ...(config.getSettings().sync || {}) });
const saveSyncState = (patch) => config.setSettings({ sync: { ...syncState(), ...patch } });

const target = () => cloudLink.classify(syncState().url);

// One request, with a deadline — a hung cloud must not hang the app.
async function request(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, body === undefined ? { signal: ctrl.signal, redirect: 'follow' } : {
      method: 'POST',
      signal: ctrl.signal,
      redirect: 'follow',
      // text/plain keeps Apps Script from rejecting the request as cross-origin
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });
    if (!res.ok) throw new Error(cloudLink.explainHttp(res.status));
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readCloud() {
  const link = target();
  if (link.kind === 'unknown') return { error: link.error };
  try {
    const answer = cloudLink.parseResponse(await request(link.getUrl));
    if (!answer.ok) return { error: answer.error };
    if (!answer.data) return null;                     // nothing stored yet
    const parsed = cloudSync.parse(JSON.stringify(answer.data));
    return parsed.ok ? parsed : { error: parsed.error };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'Облако не ответило за 20 секунд' : err.message };
  }
}

function currentPayload() {
  const cfg = config.get();
  return backup.build({
    trades: store.list(),
    balances: balanceStore.list(),
    cashflows: balanceStore.listFlows(),
    config: cfg,
    settings: config.getSettings(),
  });
}

function tellRenderer(state) {
  if (win && !win.isDestroyed()) win.webContents.send('sync:state', state);
  return state;
}

function status(extra = {}) {
  const st = syncState();
  const link = cloudLink.classify(st.url);
  return {
    enabled: Boolean(st.url) && link.kind !== 'unknown',
    url: st.url,
    kind: link.kind,
    canWrite: Boolean(link.canWrite),
    note: link.note || link.error || '',
    lastPushAt: st.lastPushAt,
    lastPullAt: st.lastPullAt,
    ...extra,
  };
}

async function pushNow() {
  const link = target();
  if (!syncState().url) return status({ phase: 'off' });
  if (link.kind === 'unknown') return tellRenderer(status({ phase: 'error', error: link.error }));
  if (!link.canWrite) {
    return tellRenderer(status({ phase: 'error', error: link.note || 'По этой ссылке выгружать нельзя' }));
  }
  try {
    const payload = cloudSync.stamp(currentPayload(), {});
    await request(link.postUrl, JSON.stringify(payload));
    saveSyncState({ lastPushAt: payload.syncedAt });
    return tellRenderer(status({ phase: 'pushed', at: payload.syncedAt, counts: payload.counts }));
  } catch (err) {
    return tellRenderer(status({
      phase: 'error',
      error: err.name === 'AbortError' ? 'Облако не ответило за 20 секунд' : err.message,
    }));
  }
}

// A pull replaces the local databases outright — that is the agreed rule, so
// the previous state goes to backups/ first.
async function pullNow() {
  const cloud = await readCloud();
  if (!cloud) return tellRenderer(status({ phase: 'error', error: 'В облаке пока ничего нет' }));
  if (cloud.error) return tellRenderer(status({ phase: 'error', error: cloud.error }));
  const read = cloud.sections;
  if (read.trades) store.replaceAll(read.trades);
  if (read.balances) balanceStore.replaceAll(read.balances);
  if (read.cashflows) balanceStore.replaceAllFlows(read.cashflows);
  if (read.config) config.importAll(read.config);
  const at = new Date().toISOString();
  saveSyncState({ lastPullAt: at, lastPushAt: cloud.data.syncedAt, lastChangeAt: '' });
  return tellRenderer(status({
    phase: 'pulled', at, counts: read.counts, device: cloud.data.device,
  }));
}

// every change to trades, balances or cash movements schedules an upload
function markChanged() {
  saveSyncState({ lastChangeAt: new Date().toISOString() });
  if (!target().canWrite) return;
  tellRenderer(status({ phase: 'pushing' }));
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1500);
}

async function syncOnStartup() {
  if (!syncState().url) return tellRenderer(status({ phase: 'off' }));
  tellRenderer(status({ phase: 'pushing' }));           // "работаю" while the request runs
  const cloud = await readCloud();
  const decision = cloudSync.decide({
    dir: syncState().url,
    cloud: cloud && !cloud.error ? cloud.data : null,
    state: syncState(),
  });
  if (cloud && cloud.error) return tellRenderer(status({ phase: 'error', error: cloud.error }));
  if (decision.action === 'pull') return pullNow();
  if (decision.action === 'push') return pushNow();
  return tellRenderer(status({ phase: decision.action === 'off' ? 'off' : 'idle', reason: decision.reason }));
}

function registerIpc() {
  ipcMain.handle('trades:list', () => store.list());
  ipcMain.handle('trades:add', (_e, input) => { const r = store.add(input); markChanged(); return r; });
  ipcMain.handle('trades:update', (_e, id, patch) => { const r = store.update(id, patch); markChanged(); return r; });
  ipcMain.handle('trades:remove', (_e, id) => { store.remove(id); markChanged(); });
  ipcMain.handle('balances:list', () => balanceStore.list());
  ipcMain.handle('balances:add', (_e, input) => { const r = balanceStore.add(input); markChanged(); return r; });
  ipcMain.handle('balances:update', (_e, id, patch) => { const r = balanceStore.update(id, patch); markChanged(); return r; });
  ipcMain.handle('balances:remove', (_e, id) => { balanceStore.remove(id); markChanged(); });
  ipcMain.handle('flows:list', () => balanceStore.listFlows());
  ipcMain.handle('flows:add', (_e, input) => { const r = balanceStore.addFlow(input); markChanged(); return r; });
  ipcMain.handle('flows:update', (_e, id, patch) => { const r = balanceStore.updateFlow(id, patch); markChanged(); return r; });
  ipcMain.handle('flows:remove', (_e, id) => { balanceStore.removeFlow(id); markChanged(); });
  ipcMain.handle('sync:status', () => status({ phase: syncState().dir ? 'idle' : 'off' }));
  ipcMain.handle('sync:push', () => pushNow());
  ipcMain.handle('sync:pull', () => pullNow());
  ipcMain.handle('sync:setLink', async (_e, url) => {
    const link = cloudLink.classify(url);
    if (link.kind === 'unknown') return status({ phase: 'error', error: link.error });
    saveSyncState({ url: String(url).trim(), lastPushAt: '', lastPullAt: '' });
    return syncOnStartup();
  });
  ipcMain.handle('sync:disable', () => {
    saveSyncState({ url: '', lastPushAt: '', lastPullAt: '' });
    return tellRenderer(status({ phase: 'off' }));
  });
  ipcMain.handle('sync:scriptCode', () => cloudLink.SCRIPT_CODE);
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
        if (!res.ok) throw new Error(cloudLink.explainHttp(res.status));
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
    markChanged();
    return { imported: true, counts: read.counts, summary: backup.summary(read.counts) };
  });
}

function createWindow() {
  win = new BrowserWindow({
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
  // the first sync runs once the page can receive its result
  win.webContents.once('did-finish-load', () => { syncOnStartup(); });
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
