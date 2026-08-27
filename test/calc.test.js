// test/calc.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const calc = require('../src/calc');

// Trade #1 from the source sheet (Лонг leg first)
const trade1 = {
  usdRub: 83.70, payout: -295, adjustment: 0, closeDate: '2026-08-13',
  legs: [
    { side: 'Лонг', entryPrice: 1.15050, units: 42000, exitPrice: 1.15190, feeRub: 270 },
    { side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
};

// Trade #3: legs reversed (Шорт leg first) — guards spread-by-leg-order + short-first gross
const trade3 = {
  usdRub: 84.95, payout: 3061, adjustment: 0, closeDate: '2026-08-17',
  legs: [
    { side: 'Шорт', entryPrice: 65.76, units: 530, exitPrice: 66.57, feeRub: 46 },
    { side: 'Лонг', entryPrice: 65.269, units: 500, exitPrice: 66.149, feeRub: 0 },
  ],
};

// Trade #11: open (no exits)
const tradeOpen = {
  usdRub: 84.50, payout: 0, adjustment: 0, closeDate: '',
  legs: [
    { side: 'Шорт', entryPrice: 68.95, units: 530, exitPrice: null, feeRub: 0 },
    { side: 'Лонг', entryPrice: 68.713, units: 500, exitPrice: null, feeRub: 0 },
  ],
};

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('leg position start/end/gross — long and short', () => {
  near(calc.legPositionStart(trade1.legs[0]), 48321.0);
  near(calc.legPositionEnd(trade1.legs[0]), 48379.8);
  near(calc.legGross(trade1.legs[0]), 58.8);      // long: end - start
  near(calc.legGross(trade1.legs[1]), -36.8);     // short: start - end
});

test('entry/exit/total spread by leg order (trade 1)', () => {
  near(calc.entrySpread(trade1), 0.001903, 1e-5);
  near(calc.exitSpread(trade1), 0.001484, 1e-5);
  near(calc.spreadTotal(trade1), 0.000419, 1e-5);
});

test('spread sign is leg-order based, not side based (trade 3)', () => {
  assert.ok(calc.entrySpread(trade3) < 0, 'entry spread must be negative for trade 3');
  near(calc.entrySpread(trade3), -0.007466, 1e-4);
});

test('trade totals match sheet (trade 1)', () => {
  near(calc.grossTotal(trade1), 22.0);
  near(calc.feeTotalRub(trade1), 502);
  near(calc.pnlNet(trade1), 16.0, 0.02);
  near(calc.pnlRub(trade1), 1339.4, 0.5);
  near(calc.pnlNetPct(trade1), 0.00016947, 1e-6);
  near(calc.netProfitRub(trade1), 1044.4, 0.5);
});

test('trade totals match sheet (trade 3, short leg first)', () => {
  near(calc.grossTotal(trade3), 10.7);
  near(calc.pnlNet(trade3), 10.16, 0.02);
  near(calc.netProfitRub(trade3), 3923.97, 0.5);
});

test('open trade returns nulls for exit-dependent values', () => {
  assert.strictEqual(calc.exitSpread(tradeOpen), null);
  assert.strictEqual(calc.grossTotal(tradeOpen), null);
  assert.strictEqual(calc.pnlNet(tradeOpen), null);
  assert.strictEqual(calc.isClosed(tradeOpen), false);
  near(calc.legPositionStart(tradeOpen.legs[0]), 36543.5); // start still computable
});

test('computeTrade aggregates everything', () => {
  const c = calc.computeTrade(trade1);
  near(c.netProfitRub, 1044.4, 0.5);
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.legs.length, 2);
});
