// test/store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-'));
}

const sampleTrade = () => ({
  openDate: '2026-08-13', closeDate: '2026-08-13', type: 'Фьючи',
  ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: -295, adjustment: 0,
  comment: '', legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
});

test('add assigns id and incrementing num, list returns it', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t1 = store.add(sampleTrade());
  const t2 = store.add(sampleTrade());
  assert.ok(t1.id && t2.id && t1.id !== t2.id);
  assert.strictEqual(t1.num, 1);
  assert.strictEqual(t2.num, 2);
  assert.strictEqual(store.list().length, 2);
});

test('persists across store instances', () => {
  const dir = tmpDir();
  const s1 = createStore({ dataDir: dir });
  const added = s1.add(sampleTrade());
  const s2 = createStore({ dataDir: dir });
  assert.strictEqual(s2.get(added.id).ticker, 'ED');
});

test('update merges patch and persists', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t = store.add(sampleTrade());
  const upd = store.update(t.id, { comment: 'hello' });
  assert.strictEqual(upd.comment, 'hello');
  assert.strictEqual(store.get(t.id).comment, 'hello');
});

test('remove deletes the trade', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t = store.add(sampleTrade());
  store.remove(t.id);
  assert.strictEqual(store.get(t.id), undefined);
});

test('a backup file is written on the second write', () => {
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });
  store.add(sampleTrade()); // first write, no prior file to back up
  store.add(sampleTrade()); // second write backs up the existing file
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.ok(backups.length >= 1, 'expected at least one backup');
});
