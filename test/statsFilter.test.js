// test/statsFilter.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const sf = require('../src/statsFilter');

// Default trade: ED / Схождение, MOEX + BYBIT, closed Wed 12.08.2026.
// Entry spread (100 - 101) / 100,5 = -0,995%; exit (101 - 101) = 0%;
// collected +0,995% (the trade closed +800 ₽, so the sign is a plus).
// Position per leg (100 × 10 + 101 × 10) × 80 / 2 = 80 400 ₽.
function trade(over = {}) {
  const t = {
    num: 1, ticker: 'ED', tag: 'Схождение', type: 'Фьючи',
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
const only = (dim, spec) => ({ ...sf.EMPTY, [dim]: spec });

// ---------- nothing on ----------

test('an empty filter keeps every trade', () => {
  const list = [trade({ num: 1 }), trade({ num: 2, open: true })];
  assert.deepStrictEqual(nums(sf.apply(list, sf.EMPTY)), [1, 2]);
  assert.deepStrictEqual(nums(sf.apply(list, {})), [1, 2]);
});

test('a dimension with nothing chosen does not filter', () => {
  const list = [trade({ num: 1 }), trade({ num: 2, ticker: 'SILV' })];
  assert.deepStrictEqual(nums(sf.apply(list, only('ticker', { mode: 'include', values: [] }))), [1, 2]);
  assert.deepStrictEqual(nums(sf.apply(list, only('size', { min: null, max: null }))), [1, 2]);
});

// ---------- dates ----------

test('a date range keeps the trades closed inside it', () => {
  const list = [
    trade({ num: 1, closeDate: '2026-08-12' }),
    trade({ num: 2, closeDate: '2026-09-02' }),
    trade({ num: 3, closeDate: '2026-07-30' }),
  ];
  const f = { ...sf.EMPTY, from: '2026-08-01', to: '2026-08-31' };
  assert.deepStrictEqual(nums(sf.apply(list, f)), [1]);
});

test('one open end of the date range leaves the other side unbounded', () => {
  const list = [trade({ num: 1, closeDate: '2026-08-12' }), trade({ num: 2, closeDate: '2026-09-02' })];
  assert.deepStrictEqual(nums(sf.apply(list, { ...sf.EMPTY, from: '2026-09-01' })), [2]);
  assert.deepStrictEqual(nums(sf.apply(list, { ...sf.EMPTY, to: '2026-08-31' })), [1]);
});

test('an open trade survives a filter it cannot answer', () => {
  // no close date, so no day, no weekday, no exit spread — those windows let it
  // through the way the period chips always have; it carries no profit anyway
  const list = [trade({ num: 1, open: true })];
  const f = {
    ...sf.EMPTY, from: '2026-01-01', to: '2026-01-31',
    weekday: { mode: 'include', values: ['Пн'] },
    exitSpread: { min: 5, max: 6 },
    collected: { min: 5, max: 6 },
  };
  assert.deepStrictEqual(nums(sf.apply(list, f)), [1]);
});

test('but an open trade still answers for its ticker and its size', () => {
  const list = [trade({ num: 1, open: true })];
  assert.deepStrictEqual(nums(sf.apply(list, only('ticker', { mode: 'include', values: ['SILV'] }))), []);
  assert.deepStrictEqual(nums(sf.apply(list, only('size', { min: 1e6, max: null }))), []);
});

// ---------- values: ticker, tag, exchange, weekday ----------

test('ticker keeps the chosen ones or drops them', () => {
  const list = [trade({ num: 1, ticker: 'ED' }), trade({ num: 2, ticker: 'SILV' })];
  assert.deepStrictEqual(nums(sf.apply(list, only('ticker', { mode: 'include', values: ['ED'] }))), [1]);
  assert.deepStrictEqual(nums(sf.apply(list, only('ticker', { mode: 'exclude', values: ['ED'] }))), [2]);
});

test('tag filters the same way', () => {
  const list = [trade({ num: 1, tag: 'Схождение' }), trade({ num: 2, tag: 'Раскор' })];
  assert.deepStrictEqual(nums(sf.apply(list, only('tag', { mode: 'include', values: ['Раскор'] }))), [2]);
});

test('an exchange matches when any leg trades on it', () => {
  const bybit = trade({ num: 1 });
  const forex = trade({ num: 2, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
  ] });
  const list = [bybit, forex];
  assert.deepStrictEqual(nums(sf.apply(list, only('exchange', { mode: 'include', values: ['BYBIT'] }))), [1]);
  // MOEX is on both, so keeping it keeps both and dropping it drops both
  assert.deepStrictEqual(nums(sf.apply(list, only('exchange', { mode: 'include', values: ['MOEX'] }))), [1, 2]);
  assert.deepStrictEqual(nums(sf.apply(list, only('exchange', { mode: 'exclude', values: ['MOEX'] }))), []);
  assert.deepStrictEqual(nums(sf.apply(list, only('exchange', { mode: 'exclude', values: ['BYBIT'] }))), [2]);
});

test('weekday reads the day the trade closed, Monday first', () => {
  const wed = trade({ num: 1, closeDate: '2026-08-12' });
  const sat = trade({ num: 2, closeDate: '2026-08-15' });
  const list = [wed, sat];
  assert.deepStrictEqual(nums(sf.apply(list, only('weekday', { mode: 'include', values: ['Ср'] }))), [1]);
  assert.deepStrictEqual(nums(sf.apply(list, only('weekday', { mode: 'exclude', values: ['Ср'] }))), [2]);
});

// ---------- ranges: size and the three spreads ----------

test('size is the money one leg ties up, in roubles', () => {
  const small = trade({ num: 1, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 10, units: 10, exitPrice: 11, feeRub: 0 },
    { exchange: 'BYBIT', side: 'Шорт', entryPrice: 10, units: 10, exitPrice: 10, feeRub: 0 },
  ] });                                   // 8 000 ₽ a leg
  const big = trade({ num: 2 });          // 80 400 ₽ a leg
  const list = [small, big];
  assert.deepStrictEqual(nums(sf.apply(list, only('size', { min: 50000, max: null }))), [2]);
  assert.deepStrictEqual(nums(sf.apply(list, only('size', { min: null, max: 50000 }))), [1]);
  assert.deepStrictEqual(nums(sf.apply(list, only('size', { min: 8000, max: 80400 }))), [1, 2]);
});

test('the entry spread window is read in percent, by size not by sign', () => {
  // -0,995% by leg order; which leg came first is not what the reader means by
  // "a spread of one percent", so the window measures the distance
  const list = [trade({ num: 1 })];
  assert.deepStrictEqual(nums(sf.apply(list, only('entrySpread', { min: 0.5, max: 1.5 }))), [1]);
  assert.deepStrictEqual(nums(sf.apply(list, only('entrySpread', { min: 1.5, max: null }))), []);
});

test('the exit spread window works the same way', () => {
  const flat = trade({ num: 1 });         // exit spread 0%
  const wide = trade({ num: 2, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 104, feeRub: 0 },
    { exchange: 'BYBIT', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
  ] });                                   // exit (104 - 101) / 102,5 = 2,927%
  const list = [flat, wide];
  assert.deepStrictEqual(nums(sf.apply(list, only('exitSpread', { min: 1, max: null }))), [2]);
  assert.deepStrictEqual(nums(sf.apply(list, only('exitSpread', { min: null, max: 0.5 }))), [1]);
});

test('the collected spread keeps its sign, so a loss reads below zero', () => {
  const winner = trade({ num: 1 });                      // +0,995%
  const loser = trade({ num: 2, adjustment: -5000 });    // same move, closed at a loss
  const list = [winner, loser];
  assert.deepStrictEqual(nums(sf.apply(list, only('collected', { min: 0, max: null }))), [1]);
  assert.deepStrictEqual(nums(sf.apply(list, only('collected', { min: null, max: 0 }))), [2]);
});

// ---------- what the UI needs to draw itself ----------

test('activeCount counts the dimensions actually in use', () => {
  assert.strictEqual(sf.activeCount(sf.EMPTY), 0);
  assert.strictEqual(sf.activeCount({ ...sf.EMPTY, from: '2026-08-01' }), 1);
  assert.strictEqual(sf.activeCount({ ...sf.EMPTY, from: '2026-08-01', to: '2026-08-31' }), 1);
  assert.strictEqual(sf.activeCount({
    ...sf.EMPTY,
    ticker: { mode: 'include', values: ['ED'] },
    size: { min: 1000, max: null },
  }), 2);
  assert.strictEqual(sf.activeCount({ ...sf.EMPTY, ticker: { mode: 'include', values: [] } }), 0);
});

test('options lists the values in the diary with their trade counts', () => {
  const list = [
    trade({ num: 1, ticker: 'ED', tag: 'Схождение', closeDate: '2026-08-12' }),
    trade({ num: 2, ticker: 'ED', tag: 'Раскор', closeDate: '2026-08-15' }),
  ];
  const o = sf.options(list);
  assert.deepStrictEqual(o.ticker, [['ED', 2]]);
  assert.deepStrictEqual(o.tag, [['Раскор', 1], ['Схождение', 1]]);
  assert.deepStrictEqual(o.exchange, [['BYBIT', 2], ['MOEX', 2]]);
  assert.deepStrictEqual(o.weekday, [['Ср', 1], ['Сб', 1]]);
});

test('options counts an exchange once per trade, not once per leg', () => {
  const both = trade({ num: 1, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0 },
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
  ] });
  assert.deepStrictEqual(sf.options([both]).exchange, [['MOEX', 1]]);
});
