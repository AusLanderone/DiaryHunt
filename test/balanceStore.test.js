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

// ---- cash movements live in the same file as the snapshots ----

const flow = (over = {}) => ({
  date: '2026-08-05', account: 'MOEX', amount: 100000, ccy: 'RUB',
  kind: 'in', usdRub: 80, comment: '', ...over,
});

test('listFlows — empty until something is added', () => {
  assert.deepStrictEqual(createBalanceStore({ dataDir: tmpDir() }).listFlows(), []);
});

test('addFlow — assigns an id and persists beside the snapshots', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  store.add(snap());
  const added = store.addFlow(flow());
  assert.ok(added.id);
  const reloaded = createBalanceStore({ dataDir: dir });
  assert.strictEqual(reloaded.listFlows().length, 1);
  assert.strictEqual(reloaded.list().length, 1, 'snapshots survive a flow write');
});

test('listFlows — oldest first', () => {
  const store = createBalanceStore({ dataDir: tmpDir() });
  store.addFlow(flow({ date: '2026-08-20' }));
  store.addFlow(flow({ date: '2026-08-01' }));
  assert.deepStrictEqual(store.listFlows().map((f) => f.date), ['2026-08-01', '2026-08-20']);
});

test('updateFlow / removeFlow — patch and drop by id', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  const added = store.addFlow(flow());
  assert.strictEqual(store.updateFlow(added.id, { amount: 250000 }).amount, 250000);
  assert.throws(() => store.updateFlow('nope', { amount: 1 }), /not found/i);
  store.removeFlow(added.id);
  assert.deepStrictEqual(createBalanceStore({ dataDir: dir }).listFlows(), []);
});

test('replaceAllFlows — bulk swap for a DB import', () => {
  const dir = tmpDir();
  const store = createBalanceStore({ dataDir: dir });
  store.addFlow(flow());
  store.replaceAllFlows([flow({ date: '2026-09-01', amount: 5 })]);
  const rows = createBalanceStore({ dataDir: dir }).listFlows();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].date, '2026-09-01');
  assert.ok(rows[0].id, 'imported movements still get ids');
});
