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

// --- estimatePayout: MOEX-side tax/rebate approximation ---
const payProfit = {
  usdRub: 83.70,
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519 },   // gross +58.80
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361 },
  ],
};
const payLoss = {
  usdRub: 84.95,
  legs: [
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 65.76, units: 530, exitPrice: 66.57 },  // gross -429.30
    { exchange: 'FOREX', side: 'Лонг', entryPrice: 65.269, units: 500, exitPrice: 66.149 }, // gross +440.00
  ],
};

test('estimatePayout: MOEX-profit leg is taxed (negative)', () => {
  near(calc.estimatePayout(payProfit, 0.06), -0.06 * 58.8 * 83.70, 0.5); // ≈ -295.3
});

test('estimatePayout: MOEX-loss leg rebates other legs profit (positive)', () => {
  near(calc.estimatePayout(payLoss, 0.06), 0.06 * 440 * 84.95, 0.5); // ≈ +2242.7
});

test('estimatePayout: null when MOEX leg has no exit', () => {
  const open = { usdRub: 80, legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1, units: 1, exitPrice: null },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1, units: 1, exitPrice: 1 },
  ] };
  assert.strictEqual(calc.estimatePayout(open, 0.06), null);
});

test('estimatePayout: null when no MOEX leg present', () => {
  assert.strictEqual(calc.estimatePayout({ usdRub: 80, legs: [
    { exchange: 'BINANCE', side: 'Лонг', entryPrice: 1, units: 1, exitPrice: 2 },
    { exchange: 'BYBIT', side: 'Шорт', entryPrice: 1, units: 1, exitPrice: 1 },
  ] }, 0.06), null);
});

// Swap — the overnight financing charge, entered per leg in that leg's own
// currency: roubles on MOEX, dollars everywhere else (FOREX, crypto venues).
const legSwap = (t, a, b) => ({
  ...t,
  legs: [{ ...t.legs[0], swap: a }, { ...t.legs[1], swap: b }],
});

test('legSwapRub — a MOEX leg swap is already in roubles', () => {
  const moexLeg = { exchange: 'MOEX', swap: -300 };
  near(calc.legSwapRub(moexLeg, 84), -300);
});

test('legSwapRub — a non-MOEX leg swap is in dollars, converted at the trade rate', () => {
  near(calc.legSwapRub({ exchange: 'FOREX', swap: -5 }, 84), -420);
  near(calc.legSwapRub({ exchange: 'BYBIT', swap: 2.5 }, 80), 200);
});

test('legSwapRub — exchange match ignores case and padding', () => {
  near(calc.legSwapRub({ exchange: ' moex ', swap: -300 }, 84), -300);
});

test('swapTotalRub — mixes a rouble leg and a dollar leg', () => {
  // trade1 rate is 83.70: MOEX -300 ₽ plus FOREX -$4 = -300 - 334.80
  const t = { ...trade1 };
  t.legs = [{ ...t.legs[0], exchange: 'MOEX', swap: -300 },
    { ...t.legs[1], exchange: 'FOREX', swap: -4 }];
  near(calc.swapTotalRub(t), -300 - 4 * 83.70);
});

test('swapTotalRub — no swap anywhere is zero', () => {
  near(calc.swapTotalRub(trade1), 0);
  near(calc.swapTotalRub(legSwap(trade1, null, '')), 0);
});

test('netProfitRub — the legs\' swap lands in the net profit, each in its own currency', () => {
  const t = { ...trade1 };
  t.legs = [{ ...t.legs[0], exchange: 'MOEX', swap: -300 },
    { ...t.legs[1], exchange: 'FOREX', swap: -4 }];
  near(calc.netProfitRub(t), calc.netProfitRub(trade1) - 300 - 4 * 83.70);
});

test('netProfitRub — trades saved before swap existed still compute', () => {
  near(calc.netProfitRub(trade1), 1044.40, 0.05);
});

test('computeTrade — reports each leg swap in roubles plus the trade total', () => {
  const t = { ...trade1 };
  t.legs = [{ ...t.legs[0], exchange: 'MOEX', swap: -300 },
    { ...t.legs[1], exchange: 'FOREX', swap: -4 }];
  const c = calc.computeTrade(t);
  near(c.legs[0].swapRub, -300);
  near(c.legs[1].swapRub, -4 * 83.70);
  near(c.swapTotalRub, -300 - 4 * 83.70);
});

test('legSwapRub — the older swapRub field is still honoured as roubles', () => {
  near(calc.legSwapRub({ exchange: 'FOREX', swapRub: -420 }, 84), -420);
});

// ---- price currency per leg ----

test('legPriceCcy — defaults to dollars, honours an explicit value', () => {
  assert.strictEqual(calc.legPriceCcy({ exchange: 'MOEX' }), 'USD');
  assert.strictEqual(calc.legPriceCcy({ exchange: 'MOEX', priceCcy: 'RUB' }), 'RUB');
  assert.strictEqual(calc.legPriceCcy({ exchange: 'BYBIT', priceCcy: 'RUB' }), 'RUB');
});

test('legPriceMul — a rouble leg is not converted, a dollar leg is', () => {
  near(calc.legPriceMul({ priceCcy: 'RUB' }, 85), 1);
  near(calc.legPriceMul({ priceCcy: 'USD' }, 85), 85);
  near(calc.legPriceMul({}, 85), 85);
});

test('legGrossRub — leg PnL in roubles, per its own currency', () => {
  near(calc.legGrossRub({ side: 'Лонг', entryPrice: 85500, exitPrice: 85600, units: 1, priceCcy: 'RUB' }, 85), 100);
  near(calc.legGrossRub({ side: 'Шорт', entryPrice: 7.19, exitPrice: 7.18, units: 100, priceCcy: 'USD' }, 85), 85);
  assert.strictEqual(calc.legGrossRub({ side: 'Лонг', entryPrice: 1, exitPrice: null, units: 1 }, 85), null);
});

// A mixed trade: one rouble leg on MOEX, one dollar leg elsewhere.
const mixed = {
  usdRub: 85, payout: 0, adjustment: 0, closeDate: '2026-08-28',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85600, feeRub: 50, priceCcy: 'RUB' },
    { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.19, units: 100, exitPrice: 7.18, feeRub: 30, priceCcy: 'USD' },
  ],
};

test('pnlRub — each leg converts by its own currency, fees are already roubles', () => {
  near(calc.pnlRub(mixed), 100 + 85 - 80);
});

test('pnlNet — the dollar figure is the rouble one at the trade rate', () => {
  near(calc.pnlNet(mixed), (100 + 85 - 80) / 85);
});

test('positionStartRub / positionEndRub — legs summed in roubles', () => {
  near(calc.positionStartRub(mixed), 85500 + 7.19 * 100 * 85);
  near(calc.positionEndRub(mixed), 85600 + 7.18 * 100 * 85);
});

test('all-dollar trades keep their verified numbers', () => {
  near(calc.pnlRub(trade1), 1339.40, 0.05);
  near(calc.netProfitRub(trade1), 1044.40, 0.05);
  near(calc.netProfitRub(trade3), 3923.97, 0.5);
});
