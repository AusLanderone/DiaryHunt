// test/analytics.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const analytics = require('../src/analytics');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// Minimal closed trade builder: one long leg + one short leg, sheet-shaped.
// entry spread = (leg2.entry - leg1.entry) / leg1.entry
function trade(over = {}) {
  return {
    num: 1, ticker: 'ED', tag: '', usdRub: 80, payout: 0, adjustment: 0,
    openDate: '2026-08-10', closeDate: '2026-08-12',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0 },
      { exchange: 'BYBIT', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
    ],
    ...over,
  };
}

// profit-only stub: analytics helpers that take raw ₽ arrays don't need trades
const P = (...profits) => profits;

test('profitFactor — gross wins over absolute gross losses', () => {
  near(analytics.profitFactor(P(300, 100, -200)), 2.0);
});

test('profitFactor — no losing trades yields Infinity, no trades yields null', () => {
  assert.strictEqual(analytics.profitFactor(P(100, 50)), Infinity);
  assert.strictEqual(analytics.profitFactor(P()), null);
});

test('expectancy — average profit per trade', () => {
  near(analytics.expectancy(P(300, 100, -200)), 66.67);
  assert.strictEqual(analytics.expectancy(P()), null);
});

test('avgWin / avgLoss — averages of each side, loss returned as a negative', () => {
  near(analytics.avgWin(P(300, 100, -200)), 200);
  near(analytics.avgLoss(P(300, 100, -200)), -200);
  assert.strictEqual(analytics.avgWin(P(-50)), null);
});

test('spreadBuckets — trades land in the entry-spread band they belong to', () => {
  const small = trade({ num: 1 });                                   // entry spread 1%
  const big = trade({ num: 2 });
  big.legs[1].entryPrice = 103;                                      // entry spread 3%
  const buckets = analytics.spreadBuckets([small, big]);
  const labels = buckets.map((b) => b.label);
  assert.ok(labels.length >= 3, 'expected several bands');
  const withSmall = buckets.find((b) => b.count && b.label.includes('1'));
  assert.ok(withSmall, 'the 1% trade should fall in a band mentioning 1');
  assert.strictEqual(buckets.reduce((s, b) => s + b.count, 0), 2);
});

test('holdingDays — whole days between open and close', () => {
  assert.strictEqual(analytics.holdingDays(trade()), 2);
  assert.strictEqual(analytics.holdingDays(trade({ openDate: '2026-08-12' })), 0);
  assert.strictEqual(analytics.holdingDays(trade({ openDate: '' })), null);
});

test('holdingBuckets — same-day trades separate from multi-day ones', () => {
  const sameDay = trade({ num: 1, openDate: '2026-08-12' });
  const week = trade({ num: 2, openDate: '2026-08-01' });            // 11 days
  const buckets = analytics.holdingBuckets([sameDay, week]);
  assert.strictEqual(buckets.reduce((s, b) => s + b.count, 0), 2);
  assert.ok(buckets.length >= 3);
  assert.notStrictEqual(
    buckets.findIndex((b) => b.count === 1),
    buckets.findLastIndex((b) => b.count === 1),
    'the two trades belong to different buckets',
  );
});

test('byMonth — groups closed trades by their close month, chronologically', () => {
  const july = trade({ num: 1, closeDate: '2026-07-30' });
  const aug = trade({ num: 2, closeDate: '2026-08-12' });
  const rows = analytics.byMonth([aug, july]);
  assert.deepStrictEqual(rows.map((r) => r.key), ['2026-07', '2026-08']);
  assert.strictEqual(rows[0].count, 1);
});

test('byWeekday — buckets all seven days, Monday first', () => {
  const wed = trade({ closeDate: '2026-08-12' });                    // Wednesday
  const rows = analytics.byWeekday([wed]);
  assert.strictEqual(rows.length, 7);
  assert.strictEqual(rows[0].label, 'Пн');
  assert.strictEqual(rows[2].count, 1);
});

test('profitHistogram — spreads profits over the requested number of bins', () => {
  const bins = analytics.profitHistogram(P(-100, 0, 100), 4);
  assert.strictEqual(bins.length, 4);
  assert.strictEqual(bins.reduce((s, b) => s + b.count, 0), 3);
  near(bins[0].from, -100);
  near(bins[bins.length - 1].to, 100);
});

test('profitHistogram — identical profits still produce a single populated bin', () => {
  const bins = analytics.profitHistogram(P(50, 50), 4);
  assert.strictEqual(bins.reduce((s, b) => s + b.count, 0), 2);
});

test('capitalDeployed — both legs entry value converted to roubles', () => {
  // (100*10 + 101*10) $ * 80 = 160 800 ₽
  near(analytics.capitalDeployed(trade()), 160800);
});

test('calendarMap — profit and trade count keyed by close date', () => {
  const a = trade({ num: 1, closeDate: '2026-08-12' });
  const b = trade({ num: 2, closeDate: '2026-08-12', payout: 100 });
  const map = analytics.calendarMap([a, b]);
  assert.strictEqual(map['2026-08-12'].count, 2);
  near(map['2026-08-12'].profit, 1700);
});

test('filterByPeriod — month keeps only trades closed in the current month', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const thisMonth = trade({ num: 1, closeDate: '2026-08-02' });
  const lastMonth = trade({ num: 2, closeDate: '2026-07-31' });
  const kept = analytics.filterByPeriod([thisMonth, lastMonth], 'month', now);
  assert.deepStrictEqual(kept.map((t) => t.num), [1]);
});

test('filterByPeriod — quarter and year windows, all keeps everything', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const q3 = trade({ num: 1, closeDate: '2026-07-05' });             // Q3
  const q2 = trade({ num: 2, closeDate: '2026-05-05' });             // Q2, same year
  const older = trade({ num: 3, closeDate: '2025-12-31' });
  const list = [q3, q2, older];
  assert.deepStrictEqual(analytics.filterByPeriod(list, 'quarter', now).map((t) => t.num), [1]);
  assert.deepStrictEqual(analytics.filterByPeriod(list, 'year', now).map((t) => t.num), [1, 2]);
  assert.strictEqual(analytics.filterByPeriod(list, 'all', now).length, 3);
});

test('filterByPeriod — open trades are kept in every window', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const open = trade({ num: 9, closeDate: '' });
  assert.strictEqual(analytics.filterByPeriod([open], 'month', now).length, 1);
});

test('capitalBuckets — closed trades bucketed by deployed capital in roubles', () => {
  const small = trade({ num: 1 });                                   // 160 800 ₽
  const large = trade({ num: 2, usdRub: 8000 });                     // 16 080 000 ₽
  const buckets = analytics.capitalBuckets([small, large]);
  assert.strictEqual(buckets.reduce((s, b) => s + b.count, 0), 2);
  assert.strictEqual(buckets[0].count, 1, 'the 160к trade lands in the lowest band');
  assert.strictEqual(buckets[buckets.length - 1].count, 1, 'the 16млн trade lands in the top band');
});

test('avgReturnPct — average net return on deployed capital', () => {
  // gross 10$ on 2010$ deployed, no fees -> ~0,498%
  near(analytics.avgReturnPct([trade()]), 0.004975, 1e-5);
  assert.strictEqual(analytics.avgReturnPct([]), null);
});

// ---------- where the profit actually comes from ----------

const calc = require('../src/calc');

test('profitStructure — gross, fees, payout, swap and the fix add up to the net profit', () => {
  const t = trade({
    payout: -100, adjustment: 25,
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 50 },
      { exchange: 'BYBIT', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0, swap: -4 },
    ],
  });
  const s = analytics.profitStructure([t]);
  near(s.gross, 800);            // 1$ × 10 units × 80 ₽
  near(s.fees, 50);
  near(s.payout, -100);
  near(s.swap, -320);            // -4$ on a dollar venue, at the trade's rate
  near(s.adjustment, 25);
  near(s.net, 355);
  near(s.net, calc.netProfitRub(t));
});

test('profitStructure — a rouble-quoted leg is not converted by the rate again', () => {
  const t = trade({
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0, priceCcy: 'RUB' },
      { exchange: 'MOEX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0, priceCcy: 'RUB' },
    ],
  });
  const s = analytics.profitStructure([t]);
  near(s.gross, 10);             // 10 ₽, not 10 × 80
  near(s.net, calc.netProfitRub(t));
});

test('profitStructure — open trades are left out', () => {
  const s = analytics.profitStructure([trade({ closeDate: '' })]);
  near(s.gross, 0);
  near(s.net, 0);
});

test('capitalDeployed — a rouble-quoted leg counts at face value', () => {
  const t = trade({
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0, priceCcy: 'RUB' },
      { exchange: 'MOEX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0, priceCcy: 'RUB' },
    ],
  });
  near(analytics.capitalDeployed(t), 2010);   // 2 010 ₽, not 2 010 × 80
});
