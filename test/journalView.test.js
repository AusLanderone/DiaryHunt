// test/journalView.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const jv = require('../src/journalView');

// closed unless closeDate/exit prices are cleared by the caller
function trade(over = {}) {
  const t = {
    num: 1, ticker: 'ED', tag: 'Схождение', type: 'Фьючи', comment: '',
    openDate: '2026-08-10', closeDate: '2026-08-12', usdRub: 80, payout: 0, adjustment: 0,
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0 },
      { exchange: 'BYBIT', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
    ],
    ...over,
  };
  if (over.open) {
    t.closeDate = '';
    t.legs = t.legs.map((l) => ({ ...l, exitPrice: null }));
  }
  return t;
}

const nums = (list) => list.map((t) => t.num);
const ALL = { query: '', status: 'all', tag: 'all', period: 'all' };

test('filterTrades — an empty filter keeps every trade', () => {
  const list = [trade({ num: 1 }), trade({ num: 2, open: true })];
  assert.deepStrictEqual(nums(jv.filterTrades(list, ALL)), [1, 2]);
});

test('filterTrades — status splits open from closed trades', () => {
  const list = [trade({ num: 1 }), trade({ num: 2, open: true })];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, status: 'open' })), [2]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, status: 'closed' })), [1]);
});

test('filterTrades — query matches ticker, tag, type, comment and number, case-insensitively', () => {
  const list = [
    trade({ num: 1, ticker: 'ED' }),
    trade({ num: 2, ticker: 'SILV', tag: 'Раскор' }),
    trade({ num: 3, ticker: 'GOLD', comment: 'пробная поставка' }),
    trade({ num: 4, ticker: 'GOLD', type: 'Крипто' }),
  ];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: 'silv' })), [2]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: 'раскор' })), [2]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: 'ПОСТАВКА' })), [3]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: 'крипто' })), [4]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: '3' })), [3]);
});

test('filterTrades — tag filter keeps only that tag', () => {
  const list = [trade({ num: 1, tag: 'Схождение' }), trade({ num: 2, tag: 'Раскор' })];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, tag: 'Раскор' })), [2]);
});

test('filterTrades — period windows count from the open date', () => {
  const now = new Date('2026-08-28T12:00:00Z');
  const list = [
    trade({ num: 1, openDate: '2026-08-02', closeDate: '2026-08-03' }),
    trade({ num: 2, openDate: '2026-06-02', closeDate: '2026-06-03' }),
    trade({ num: 3, openDate: '2025-11-02', closeDate: '2025-11-03' }),
  ];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, period: 'month' }, now)), [1]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, period: 'quarter' }, now)), [1]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, period: 'year' }, now)), [1, 2]);
});

test('filterTrades — filters combine', () => {
  const list = [
    trade({ num: 1, ticker: 'ED', open: true }),
    trade({ num: 2, ticker: 'ED' }),
    trade({ num: 3, ticker: 'SILV', open: true }),
  ];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, query: 'ed', status: 'open' })), [1]);
});

test('sortTrades — by number, both directions, without touching the input', () => {
  const list = [trade({ num: 2 }), trade({ num: 1 }), trade({ num: 3 })];
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'num', 'asc')), [1, 2, 3]);
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'num', 'desc')), [3, 2, 1]);
  assert.deepStrictEqual(nums(list), [2, 1, 3], 'input order preserved');
});

test('sortTrades — by open date', () => {
  const list = [
    trade({ num: 1, openDate: '2026-08-20' }),
    trade({ num: 2, openDate: '2026-07-01' }),
  ];
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'date', 'asc')), [2, 1]);
});

test('sortTrades — by ticker alphabetically', () => {
  const list = [trade({ num: 1, ticker: 'SILV' }), trade({ num: 2, ticker: 'ED' })];
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'ticker', 'asc')), [2, 1]);
});

test('sortTrades — by net profit', () => {
  const big = trade({ num: 1, payout: 5000 });
  const small = trade({ num: 2, payout: 0 });
  assert.deepStrictEqual(nums(jv.sortTrades([small, big], 'profit', 'desc')), [1, 2]);
});

test('sortTrades — open trades sink to the bottom whichever way profit is sorted', () => {
  const list = [trade({ num: 1, open: true }), trade({ num: 2 })];
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'profit', 'desc')), [2, 1]);
  assert.deepStrictEqual(nums(jv.sortTrades(list, 'profit', 'asc')), [2, 1]);
});

test('sortTrades — by entry spread', () => {
  const wide = trade({ num: 1 });
  wide.legs[1].entryPrice = 105;            // 5%
  const narrow = trade({ num: 2 });         // 1%
  assert.deepStrictEqual(nums(jv.sortTrades([narrow, wide], 'spread', 'desc')), [1, 2]);
});

test('sortTrades — by the spread actually closed, open trades at the bottom', () => {
  // entry 1%, exit 0% -> collected 1%
  const collected = trade({ num: 1 });
  // entry 1%, exit 0,99% -> almost nothing collected
  const stuck = trade({ num: 2 });
  stuck.legs[1].exitPrice = 101;
  stuck.legs[0].exitPrice = 100;
  const open = trade({ num: 3, open: true });
  assert.deepStrictEqual(nums(jv.sortTrades([stuck, collected, open], 'spreadFact', 'desc')), [1, 2, 3]);
  assert.deepStrictEqual(nums(jv.sortTrades([stuck, collected, open], 'spreadFact', 'asc')), [2, 1, 3]);
});

test('groupByMonth — newest month first, with its own count and total', () => {
  const groups = jv.groupByMonth([
    trade({ num: 1, openDate: '2026-07-05', closeDate: '2026-07-06', payout: 100 }),
    trade({ num: 2, openDate: '2026-08-05', closeDate: '2026-08-06', payout: 200 }),
    trade({ num: 3, openDate: '2026-08-20', closeDate: '2026-08-21', payout: 300 }),
  ]);
  assert.deepStrictEqual(groups.map((g) => g.key), ['2026-08', '2026-07']);
  assert.strictEqual(groups[0].count, 2);
  assert.match(groups[0].label, /август 2026/i);
  assert.strictEqual(groups[0].profit, 800 + 200 + 800 + 300);
});

test('groupByMonth — keeps the order it was given inside a month', () => {
  const groups = jv.groupByMonth([
    trade({ num: 5, openDate: '2026-08-20' }),
    trade({ num: 3, openDate: '2026-08-02' }),
  ]);
  assert.deepStrictEqual(nums(groups[0].trades), [5, 3]);
});

test('groupByMonth — an open trade contributes its count but not the total', () => {
  const groups = jv.groupByMonth([
    trade({ num: 1, openDate: '2026-08-05', closeDate: '2026-08-06', payout: 100 }),
    trade({ num: 2, openDate: '2026-08-07', open: true }),
  ]);
  assert.strictEqual(groups[0].count, 2);
  assert.strictEqual(groups[0].profit, 900);
  assert.strictEqual(groups[0].openCount, 1);
});

test('summarize — count, wins, winrate and total over the visible trades', () => {
  const s = jv.summarize([
    trade({ num: 1, payout: 100 }),          // +900
    trade({ num: 2, payout: -2000 }),        // -1200
    trade({ num: 3, open: true }),
  ]);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.closed, 2);
  assert.strictEqual(s.wins, 1);
  assert.strictEqual(s.winrate, 50);
  assert.strictEqual(s.total, -300);
});

test('summarize — an all-open list reports no winrate instead of dividing by zero', () => {
  const s = jv.summarize([trade({ num: 1, open: true })]);
  assert.strictEqual(s.closed, 0);
  assert.strictEqual(s.winrate, null);
  assert.strictEqual(s.total, 0);
});

test('nextSort — first click on a column sorts it descending', () => {
  assert.deepStrictEqual(jv.nextSort({ key: null, dir: 'desc' }, 'profit'), { key: 'profit', dir: 'desc' });
});

test('nextSort — ticker starts ascending, alphabetical order reads better', () => {
  assert.deepStrictEqual(jv.nextSort({ key: null, dir: 'desc' }, 'ticker'), { key: 'ticker', dir: 'asc' });
});

test('nextSort — second click flips the direction', () => {
  assert.deepStrictEqual(jv.nextSort({ key: 'profit', dir: 'desc' }, 'profit'), { key: 'profit', dir: 'asc' });
  assert.deepStrictEqual(jv.nextSort({ key: 'ticker', dir: 'asc' }, 'ticker'), { key: 'ticker', dir: 'desc' });
});

test('nextSort — third click clears the sort back to the default order', () => {
  const after2 = jv.nextSort({ key: 'profit', dir: 'desc' }, 'profit');
  assert.deepStrictEqual(jv.nextSort(after2, 'profit'), { key: null, dir: 'desc' });
  // whichever column was sorted, clearing restores newest-first, not its reverse
  const t2 = jv.nextSort({ key: 'ticker', dir: 'asc' }, 'ticker');
  assert.deepStrictEqual(jv.nextSort(t2, 'ticker'), { key: null, dir: 'desc' });
});

test('nextSort — clicking another column starts that column fresh', () => {
  assert.deepStrictEqual(jv.nextSort({ key: 'profit', dir: 'asc' }, 'date'), { key: 'date', dir: 'desc' });
});

test('sortTrades — a cleared sort falls back to newest trade first', () => {
  const list = [trade({ num: 2 }), trade({ num: 5 }), trade({ num: 1 })];
  assert.deepStrictEqual(nums(jv.sortTrades(list, null, 'desc')), [5, 2, 1]);
});

test('filterTrades — type filter works like the tag filter', () => {
  const list = [
    trade({ num: 1, type: 'Фьючи' }),
    trade({ num: 2, type: 'Крипто' }),
    trade({ num: 3, type: 'Фьючи' }),
  ];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, type: 'Крипто' })), [2]);
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, type: 'all' })), [1, 2, 3]);
});

test('filterTrades — type and tag narrow together', () => {
  const list = [
    trade({ num: 1, type: 'Фьючи', tag: 'Схождение' }),
    trade({ num: 2, type: 'Фьючи', tag: 'Раскор' }),
    trade({ num: 3, type: 'Крипто', tag: 'Раскор' }),
  ];
  assert.deepStrictEqual(nums(jv.filterTrades(list, { ...ALL, type: 'Фьючи', tag: 'Раскор' })), [2]);
});

// ---------- sorting by figures that aren't columns ----------

test('sortTrades — by position size, biggest first', () => {
  // numbered against the size, so a fallback to «by number» could not pass
  const small = trade({ num: 3, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 10, units: 10, exitPrice: 11, feeRub: 0 },
    { exchange: 'BYBIT', side: 'Шорт', entryPrice: 10, units: 10, exitPrice: 10, feeRub: 0 },
  ] });
  const big = trade({ num: 1 });   // 100 × 10 and 101 × 10 at 80 ₽
  assert.deepStrictEqual(nums(jv.sortTrades([small, big], 'size', 'desc')), [1, 3]);
  assert.deepStrictEqual(nums(jv.sortTrades([small, big], 'size', 'asc')), [3, 1]);
});

test('sortTrades — by time in the trade, open ones at the bottom', () => {
  const quick = trade({ num: 1, openDate: '2026-08-10', closeDate: '2026-08-11' });
  const slow = trade({ num: 2, openDate: '2026-08-01', closeDate: '2026-08-12' });
  const open = trade({ num: 3, open: true });
  assert.deepStrictEqual(nums(jv.sortTrades([quick, slow, open], 'hold', 'desc')), [2, 1, 3]);
  assert.deepStrictEqual(nums(jv.sortTrades([quick, slow, open], 'hold', 'asc')), [1, 2, 3]);
});

test('sortTrades — by return on the position, open ones at the bottom', () => {
  const rich = trade({ num: 1 });
  const poor = trade({ num: 2, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1000, units: 10, exitPrice: 1001, feeRub: 0 },
    { exchange: 'BYBIT', side: 'Шорт', entryPrice: 1001, units: 10, exitPrice: 1001, feeRub: 0 },
  ] });
  const open = trade({ num: 3, open: true });
  assert.deepStrictEqual(nums(jv.sortTrades([poor, rich, open], 'ret', 'desc')), [1, 2, 3]);
});

test('SORT_FIELDS name every sortable figure for the picker', () => {
  assert.deepStrictEqual(jv.SORT_FIELDS.map((f) => f.key),
    ['num', 'date', 'ticker', 'spread', 'spreadFact', 'profit', 'size', 'hold', 'ret']);
  assert.ok(jv.SORT_FIELDS.every((f) => f.label));
});

// ---------- keeping or dropping trades by tag / ticker / type ----------

const many = () => [
  trade({ num: 1, ticker: 'ED', tag: 'Схождение', type: 'Фьючи' }),
  trade({ num: 2, ticker: 'SILV', tag: 'Раскор', type: 'Фьючи' }),
  trade({ num: 3, ticker: 'BTC', tag: 'Схождение', type: 'Крипто' }),
  trade({ num: 4, ticker: 'BTC', tag: '', type: 'Крипто' }),
];

test('filterTrades — include keeps only the chosen values', () => {
  const f = { ...ALL, tag: { mode: 'include', values: ['Схождение'] } };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), f)), [1, 3]);
});

test('filterTrades — include accepts several values at once', () => {
  const f = { ...ALL, ticker: { mode: 'include', values: ['ED', 'SILV'] } };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), f)), [1, 2]);
});

test('filterTrades — exclude drops the chosen values and keeps the rest', () => {
  const f = { ...ALL, tag: { mode: 'exclude', values: ['Схождение'] } };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), f)), [2, 4]);
});

test('filterTrades — an empty selection means the filter is off', () => {
  const off = { ...ALL, tag: { mode: 'exclude', values: [] }, ticker: { mode: 'include', values: [] } };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), off)), [1, 2, 3, 4]);
});

test('filterTrades — the dimensions narrow each other', () => {
  const f = {
    ...ALL,
    ticker: { mode: 'include', values: ['BTC'] },
    tag: { mode: 'exclude', values: ['Схождение'] },
  };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), f)), [4]);
});

test('filterTrades — a trade with no tag can be picked out by an empty value', () => {
  const f = { ...ALL, tag: { mode: 'include', values: [''] } };
  assert.deepStrictEqual(nums(jv.filterTrades(many(), f)), [4]);
});

test('filterTrades — the old single-value form still filters', () => {
  assert.deepStrictEqual(nums(jv.filterTrades(many(), { ...ALL, type: 'Крипто' })), [3, 4]);
  assert.deepStrictEqual(nums(jv.filterTrades(many(), { ...ALL, type: 'all' })), [1, 2, 3, 4]);
});
