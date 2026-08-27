'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore({ dataDir }) {
  const file = path.join(dataDir, 'trades.json');
  const backupDir = path.join(dataDir, 'backups');

  function ensureDirs() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
  }

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).trades || [];
    } catch {
      return [];
    }
  }

  function backup() {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, `trades-${stamp}.json`));
  }

  function write(trades) {
    ensureDirs();
    backup();
    fs.writeFileSync(file, JSON.stringify({ trades }, null, 2), 'utf8');
  }

  function list() {
    return read().slice().sort((a, b) => a.num - b.num);
  }

  function get(id) {
    return read().find((t) => t.id === id);
  }

  function add(input) {
    const trades = read();
    const num = trades.reduce((m, t) => Math.max(m, t.num || 0), 0) + 1;
    const trade = { ...input, id: crypto.randomUUID(), num };
    trades.push(trade);
    write(trades);
    return trade;
  }

  function update(id, patch) {
    const trades = read();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Trade not found: ${id}`);
    trades[idx] = { ...trades[idx], ...patch, id };
    write(trades);
    return trades[idx];
  }

  function remove(id) {
    write(read().filter((t) => t.id !== id));
  }

  return { list, get, add, update, remove };
}

module.exports = { createStore };
