// test/backup.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const backup = require('../src/backup');

const sample = {
  trades: [{ id: 't1', num: 1, ticker: 'ED', legs: [] }],
  balances: [{ id: 'b1', date: '2026-08-01', accounts: [] }],
  cashflows: [{ id: 'f1', date: '2026-08-05', account: 'MOEX', amount: 1000 }],
  config: { exchanges: ['MOEX'], tags: ['Схождение'], types: ['Фьючи'], tickers: ['ED'] },
  settings: { theme: 'default', font: 'system', scale: 1 },
};

test('build — carries both databases and the dictionaries', () => {
  const b = backup.build(sample);
  assert.strictEqual(b.app, 'DiaryHunt');
  assert.deepStrictEqual(b.trades, sample.trades);
  assert.deepStrictEqual(b.balances, sample.balances);
  assert.deepStrictEqual(b.cashflows, sample.cashflows);
  assert.deepStrictEqual(b.config.tickers, ['ED']);
  assert.deepStrictEqual(b.config.settings, sample.settings);
  assert.ok(b.exportedAt, 'stamped with a time');
});

test('build — counts what is inside, for the message shown to the user', () => {
  assert.deepStrictEqual(backup.build(sample).counts, { trades: 1, balances: 1, cashflows: 1 });
  assert.deepStrictEqual(
    backup.build({ trades: [], balances: [], cashflows: [], config: {}, settings: {} }).counts,
    { trades: 0, balances: 0, cashflows: 0 },
  );
});

test('read — accepts a full backup and reports every section', () => {
  const parsed = backup.build(sample);
  const r = backup.read(parsed);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.trades, sample.trades);
  assert.deepStrictEqual(r.balances, sample.balances);
  assert.deepStrictEqual(r.cashflows, sample.cashflows);
  assert.deepStrictEqual(r.counts, { trades: 1, balances: 1, cashflows: 1 });
});

test('read — a backup made before the balances section still restores the trades', () => {
  const r = backup.read({ app: 'DiaryHunt', trades: sample.trades, config: sample.config });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.trades, sample.trades);
  assert.strictEqual(r.balances, null, 'missing sections stay untouched, not emptied');
  assert.strictEqual(r.cashflows, null);
  assert.deepStrictEqual(r.counts, { trades: 1, balances: 0, cashflows: 0 });
});

test('read — a balances-only export is a valid backup too', () => {
  const r = backup.read({ app: 'DiaryHunt', balances: sample.balances, cashflows: sample.cashflows });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.trades, null);
  assert.deepStrictEqual(r.balances, sample.balances);
  assert.deepStrictEqual(r.counts, { trades: 0, balances: 1, cashflows: 1 });
});

test('read — an empty list is a real instruction to clear that database', () => {
  const r = backup.read({ app: 'DiaryHunt', trades: [], balances: sample.balances });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.trades, [], 'an explicit empty array is not "missing"');
});

test('read — rubbish is refused with a readable reason', () => {
  for (const bad of [null, undefined, 42, 'строка', {}, { app: 'DiaryHunt' }, { trades: 'no' }]) {
    const r = backup.read(bad);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /файл|сделок|балансов/i, `внятная причина отказа: ${r.error}`);
  }
});

test('summary — spells out what was restored', () => {
  assert.match(backup.summary({ trades: 14, balances: 3, cashflows: 2 }), /14/);
  assert.match(backup.summary({ trades: 14, balances: 3, cashflows: 2 }), /3/);
  assert.match(backup.summary({ trades: 0, balances: 0, cashflows: 0 }), /ничего|пуст/i);
});
