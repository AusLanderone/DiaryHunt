// test/balances.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../src/balances');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

const snap = (over = {}) => ({
  id: 's1', date: '2026-08-01', usdRub: 80, comment: '',
  accounts: [
    { name: 'MOEX', amount: 800000, ccy: 'RUB' },
    { name: 'FOREX', amount: 5000, ccy: 'USD' },
  ],
  ...over,
});

test('snapshotTotals — roubles sum both currencies, dollars divide by the rate', () => {
  const t = B.snapshotTotals(snap());
  near(t.rub, 800000 + 5000 * 80);          // 1 200 000 ₽
  near(t.usd, (800000 + 5000 * 80) / 80);   // 15 000 $
});

test('snapshotTotals — a missing rate leaves dollars unknown but keeps roubles', () => {
  const t = B.snapshotTotals(snap({ usdRub: 0 }));
  near(t.rub, 800000);                       // the dollar account cannot convert
  assert.strictEqual(t.usd, null);
});

test('snapshotTotals — a snapshot with no accounts totals zero', () => {
  const t = B.snapshotTotals(snap({ accounts: [] }));
  near(t.rub, 0);
  near(t.usd, 0);
});

test('series — snapshots sorted by date, each carrying its totals', () => {
  const rows = B.series([
    snap({ id: 'b', date: '2026-08-10' }),
    snap({ id: 'a', date: '2026-08-01' }),
  ]);
  assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b']);
  near(rows[0].rub, 1200000);
  assert.ok('usd' in rows[0]);
});

test('series — an empty list stays empty', () => {
  assert.deepStrictEqual(B.series([]), []);
});

test('deltas — each snapshot reports the change from the previous one', () => {
  const rows = B.deltas([
    snap({ id: 'a', date: '2026-08-01' }),                                     // 1 200 000 ₽
    snap({ id: 'b', date: '2026-08-10', accounts: [{ name: 'MOEX', amount: 1500000, ccy: 'RUB' }] }),
  ]);
  assert.strictEqual(rows[0].deltaRub, null, 'the first snapshot has nothing to compare to');
  near(rows[1].deltaRub, 300000);
  near(rows[1].deltaPct, 25);
});

test('deltas — a zero starting capital reports no percentage instead of Infinity', () => {
  const rows = B.deltas([
    snap({ id: 'a', accounts: [] }),
    snap({ id: 'b', date: '2026-08-10' }),
  ]);
  near(rows[1].deltaRub, 1200000);
  assert.strictEqual(rows[1].deltaPct, null);
});

test('byAccount — each account with its rouble value and share of the total', () => {
  const rows = B.byAccount(snap());
  assert.deepStrictEqual(rows.map((r) => r.name), ['MOEX', 'FOREX']);
  near(rows[0].rub, 800000);
  near(rows[0].share, 800000 / 1200000 * 100);
  near(rows[1].rub, 400000);
  near(rows[1].share, 400000 / 1200000 * 100);
});

test('byAccount — no accounts means no rows, not a division by zero', () => {
  assert.deepStrictEqual(B.byAccount(snap({ accounts: [] })), []);
});

// closed trade worth +1000 ₽ net: 10 units, 100 -> 200, rate 1
const trade = (closeDate, profit) => ({
  num: 1, openDate: closeDate, closeDate, usdRub: 1, payout: profit, adjustment: 0,
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 1, exitPrice: 100, feeRub: 0 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 100, units: 1, exitPrice: 100, feeRub: 0 },
  ],
});

test('journalLine — starts at the first snapshot and adds profit closed by each date', () => {
  const snaps = [
    snap({ id: 'a', date: '2026-08-01', accounts: [{ name: 'MOEX', amount: 1000000, ccy: 'RUB' }] }),
    snap({ id: 'b', date: '2026-08-20', accounts: [{ name: 'MOEX', amount: 1400000, ccy: 'RUB' }] }),
  ];
  const line = B.journalLine(snaps, [trade('2026-08-05', 250000), trade('2026-08-25', 999)]);
  near(line[0], 1000000);                    // nothing closed yet on the first date
  near(line[1], 1250000);                    // the 25.08 trade is after the last snapshot
});

test('journalLine — without snapshots there is nothing to anchor to', () => {
  assert.deepStrictEqual(B.journalLine([], [trade('2026-08-05', 1000)]), []);
});
