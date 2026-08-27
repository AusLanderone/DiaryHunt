const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/store');
const { createConfig } = require('./src/config');
const { tradesToCsv } = require('./src/export');

let store, config;

function initData() {
  const dataDir = app.getPath('userData');
  store = createStore({ dataDir });
  config = createConfig({ dataDir });
}

function registerIpc() {
  ipcMain.handle('trades:list', () => store.list());
  ipcMain.handle('trades:add', (_e, input) => store.add(input));
  ipcMain.handle('trades:update', (_e, id, patch) => store.update(id, patch));
  ipcMain.handle('trades:remove', (_e, id) => store.remove(id));
  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:addItem', (_e, kind, value) => config.addItem(kind, value));
  ipcMain.handle('config:removeItem', (_e, kind, value) => config.removeItem(kind, value));
  ipcMain.handle('export:csv', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'diaryhunt-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, '﻿' + tradesToCsv(store.list()), 'utf8'); // BOM for Excel
    return { saved: true, path: filePath };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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
