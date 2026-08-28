'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Balance snapshots, stored beside trades.json and backed up the same way.
// Snapshots have no running number — they are identified by date, so the list
// always comes back oldest first.
function createBalanceStore({ dataDir }) {
  const file = path.join(dataDir, 'balances.json');
  const backupDir = path.join(dataDir, 'backups');

  function ensureDirs() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // the file holds both: snapshots of what is on the accounts, and the money
  // moved in or out of them
  function readFile() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  const read = () => readFile().balances || [];
  const readFlows = () => readFile().cashflows || [];

  function backup() {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, `balances-${stamp}.json`));
  }

  function writeFile(next) {
    ensureDirs();
    backup();
    fs.writeFileSync(file, JSON.stringify({ ...readFile(), ...next }, null, 2), 'utf8');
  }

  const write = (balances) => writeFile({ balances });
  const writeFlows = (cashflows) => writeFile({ cashflows });

  function list() {
    return read().slice().sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
  }

  function add(input) {
    const rows = read();
    const snapshot = { ...input, id: crypto.randomUUID() };
    rows.push(snapshot);
    write(rows);
    return snapshot;
  }

  function update(id, patch) {
    const rows = read();
    const idx = rows.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Balance snapshot not found: ${id}`);
    rows[idx] = { ...rows[idx], ...patch, id };
    write(rows);
    return rows[idx];
  }

  function remove(id) {
    write(read().filter((s) => s.id !== id));
  }

  // Bulk replace (DB import). Snapshots arriving without an id get one.
  function replaceAll(balances) {
    const rows = Array.isArray(balances) ? balances : [];
    write(rows.map((s) => (s.id ? s : { ...s, id: crypto.randomUUID() })));
  }

  // ---------- cash movements ----------

  const byDate = (a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0);

  function listFlows() {
    return readFlows().slice().sort(byDate);
  }

  function addFlow(input) {
    const rows = readFlows();
    const flow = { ...input, id: crypto.randomUUID() };
    rows.push(flow);
    writeFlows(rows);
    return flow;
  }

  function updateFlow(id, patch) {
    const rows = readFlows();
    const idx = rows.findIndex((f) => f.id === id);
    if (idx === -1) throw new Error(`Cash movement not found: ${id}`);
    rows[idx] = { ...rows[idx], ...patch, id };
    writeFlows(rows);
    return rows[idx];
  }

  function removeFlow(id) {
    writeFlows(readFlows().filter((f) => f.id !== id));
  }

  function replaceAllFlows(cashflows) {
    const rows = Array.isArray(cashflows) ? cashflows : [];
    writeFlows(rows.map((f) => (f.id ? f : { ...f, id: crypto.randomUUID() })));
  }

  return {
    list, add, update, remove, replaceAll,
    listFlows, addFlow, updateFlow, removeFlow, replaceAllFlows,
  };
}

module.exports = { createBalanceStore };
