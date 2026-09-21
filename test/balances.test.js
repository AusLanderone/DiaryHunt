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

// ---- deposits and withdrawals ----

const flow = (over = {}) => ({
  id: 'f1', date: '2026-08-05', account: 'MOEX', amount: 100000, ccy: 'RUB',
  kind: 'in', usdRub: 80, comment: '', ...over,
});

test('flowRub — a deposit is positive, a withdrawal negative', () => {
  near(B.flowRub(flow()), 100000);
  near(B.flowRub(flow({ kind: 'out' })), -100000);
});

test('flowRub — a dollar movement converts at its own rate', () => {
  near(B.flowRub(flow({ amount: 1000, ccy: 'USD', usdRub: 85 })), 85000);
  near(B.flowRub(flow({ amount: 1000, ccy: 'USD', usdRub: 85, kind: 'out' })), -85000);
});

test('flowsUpTo — nets everything dated on or before the given day', () => {
  const flows = [
    flow({ id: 'a', date: '2026-08-01', amount: 200000 }),
    flow({ id: 'b', date: '2026-08-10', amount: 50000, kind: 'out' }),
    flow({ id: 'c', date: '2026-08-20', amount: 30000 }),
  ];
  near(B.flowsUpTo(flows, '2026-08-01'), 200000);
  near(B.flowsUpTo(flows, '2026-08-15'), 150000);
  near(B.flowsUpTo(flows, '2026-08-31'), 180000);
  near(B.flowsUpTo(flows, '2026-07-01'), 0);
  near(B.flowsUpTo([], '2026-08-31'), 0);
});

test('flowTotals — deposits, withdrawals and the net, all in roubles', () => {
  const t = B.flowTotals([
    flow({ amount: 200000 }),
    flow({ amount: 50000, kind: 'out' }),
    flow({ amount: 1000, ccy: 'USD', usdRub: 85 }),
  ]);
  near(t.in, 200000 + 85000);
  near(t.out, -50000);
  near(t.net, 235000);
});

test('flowTotals — nothing moved is three zeroes, not NaN', () => {
  const t = B.flowTotals([]);
  near(t.in, 0); near(t.out, 0); near(t.net, 0);
});

test('journalLine — deposits lift the journal line so the curves stay comparable', () => {
  const snaps = [
    snap({ id: 'a', date: '2026-08-01', accounts: [{ name: 'MOEX', amount: 1000000, ccy: 'RUB' }] }),
    snap({ id: 'b', date: '2026-08-20', accounts: [{ name: 'MOEX', amount: 1400000, ccy: 'RUB' }] }),
  ];
  const trades = [trade('2026-08-05', 250000)];
  const flows = [flow({ date: '2026-08-10', amount: 150000 })];
  const line = B.journalLine(snaps, trades, flows);
  near(line[0], 1000000);
  near(line[1], 1000000 + 250000 + 150000);
});

test('journalLine — a withdrawal lowers it, and no flows behave as before', () => {
  const snaps = [
    snap({ id: 'a', date: '2026-08-01', accounts: [{ name: 'MOEX', amount: 1000000, ccy: 'RUB' }] }),
    snap({ id: 'b', date: '2026-08-20', accounts: [{ name: 'MOEX', amount: 800000, ccy: 'RUB' }] }),
  ];
  const trades = [trade('2026-08-05', 100000)];
  near(B.journalLine(snaps, trades, [flow({ date: '2026-08-12', amount: 300000, kind: 'out' })])[1],
    1000000 + 100000 - 300000);
  near(B.journalLine(snaps, trades)[1], 1100000);
});

// ---------- what the audit turned up ----------

test('the first snapshot is the starting line, not a starting line plus that day', () => {
  const snaps = [snap({ id: 'a', date: '2026-08-13', usdRub: 80,
    accounts: [{ name: 'MOEX', amount: 1000000, ccy: 'RUB' }] })];
  const closedThatDay = {
    num: 1, ticker: 'ED', openDate: '2026-08-13', closeDate: '2026-08-13',
    usdRub: 80, payout: 0, adjustment: 0,
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 110, feeRub: 0 },
      { exchange: 'FOREX', side: 'Шорт', entryPrice: 100, units: 10, exitPrice: 105, feeRub: 0 },
    ],
  };
  const [first] = B.journalLine(snaps, [closedThatDay], []);
  near(first, 1000000, 0.01);   // the mark already holds that trade's profit
});

test('only what happened after the first mark is added to it', () => {
  const snaps = [
    snap({ id: 'a', date: '2026-08-13', accounts: [{ name: 'MOEX', amount: 1000000, ccy: 'RUB' }] }),
    snap({ id: 'b', date: '2026-08-20', accounts: [{ name: 'MOEX', amount: 1300000, ccy: 'RUB' }] }),
  ];
  const mk = (num, closeDate) => ({
    num, ticker: 'ED', openDate: '2026-08-12', closeDate, usdRub: 80, payout: 0, adjustment: 0,
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 110, feeRub: 0 },
      { exchange: 'FOREX', side: 'Шорт', entryPrice: 100, units: 10, exitPrice: 100, feeRub: 0 },
    ],
  });
  const before = mk(1, '2026-08-13');     // on the mark: already inside it
  const after = mk(2, '2026-08-18');      // after it: counts
  const line = B.journalLine(snaps, [before, after], [
    { date: '2026-08-13', account: 'MOEX', amount: 50000, ccy: 'RUB', kind: 'in' },   // already inside
    { date: '2026-08-15', account: 'MOEX', amount: 20000, ccy: 'RUB', kind: 'in' },   // counts
  ]);
  near(line[0], 1000000, 0.01);
  // the trade moved 10 points on 10 units: 100 $ at 80 ₽, plus the 20 000 ₽ deposit
  near(line[1], 1000000 + 100 * 80 + 20000, 0.01);
});
