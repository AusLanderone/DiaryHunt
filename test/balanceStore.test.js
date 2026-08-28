// test/balanceStore.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBalanceStore } = require('../src/balanceStore');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-bal-'));

const snap = (over = {}) => ({
  date: '2026-08-01', usdRub: 80, comment: '',
  accounts: [{ name: 'MOEX', amount: 800000, ccy: 'RUB' }],
  ...over,
});

test('list — an untouched data directory reads as empty', () => {
  assert.deepStrictEqual(createBalanceStore({ dataDir: tmpDir() }).list(), []);
});

test('add — gives the snapshot an id and persists it', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  const added = store.add(snap());
  assert.ok(added.id, 'id assigned');
  const reloaded = createBalanceStore({ dataDir: dir }).list();
  assert.strictEqual(reloaded.length, 1);
  assert.strictEqual(reloaded[0].accounts[0].amount, 800000);
});

test('list — snapshots come back oldest first whatever order they went in', () => {
  const store = createBalanceStore({ dataDir: tmpDir() });
  store.add(snap({ date: '2026-08-20' }));
  store.add(snap({ date: '2026-08-01' }));
  assert.deepStrictEqual(store.list().map((s) => s.date), ['2026-08-01', '2026-08-20']);
});

test('update — patches a snapshot and keeps its id', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  const added = store.add(snap());
  const updated = store.update(added.id, { usdRub: 90 });
  assert.strictEqual(updated.id, added.id);
  assert.strictEqual(updated.usdRub, 90);
  assert.strictEqual(createBalanceStore({ dataDir: dir }).list()[0].usdRub, 90);
});

test('update — an unknown id is an error, not a silent no-op', () => {
  const store = createBalanceStore({ dataDir: tmpDir() });
  assert.throws(() => store.update('nope', { usdRub: 90 }), /not found/i);
});

test('remove — drops the snapshot and persists that', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  const added = store.add(snap());
  store.remove(added.id);
  assert.deepStrictEqual(createBalanceStore({ dataDir: dir }).list(), []);
});

test('replaceAll — swaps the whole list, as a DB import does', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  store.add(snap());
  store.replaceAll([snap({ date: '2026-09-01', usdRub: 95 })]);
  const rows = createBalanceStore({ dataDir: dir }).list();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].date, '2026-09-01');
  assert.ok(rows[0].id, 'imported snapshots still get ids');
});

test('a corrupt file reads as empty instead of throwing', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'balances.json'), '{ not json', 'utf8');
  assert.deepStrictEqual(createBalanceStore({ dataDir: dir }).list(), []);
});
