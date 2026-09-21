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
  near(calc.pnlNetPct(trade1), 0.00033894, 1e-6);   // measured against one leg, not both
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

test('positionStartAvgRub / positionEndAvgRub — one side of the position', () => {
  // the legs are two sides of one position, so its size is their average
  near(calc.positionStartAvgRub(mixed), (85500 + 7.19 * 100 * 85) / 2);
  near(calc.positionEndAvgRub(mixed), (85600 + 7.18 * 100 * 85) / 2);
});

test('positionEndAvgRub — an open trade has no closing size', () => {
  const open = { ...mixed, closeDate: '', legs: [mixed.legs[0], { ...mixed.legs[1], exitPrice: '' }] };
  assert.strictEqual(calc.positionEndAvgRub(open), null);
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


// ---- multiplicative spread over any number of legs ----

// The user's triangle: synthetic USD/CNH from MOEX against the market cross.
const triangle = {
  usdRub: 85, payout: 0, adjustment: 0, closeDate: '2026-08-28',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85400, feeRub: 0, role: 'mul', priceCcy: 'RUB' },
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 11900, units: 1, exitPrice: 11880, feeRub: 0, role: 'div', priceCcy: 'RUB' },
    { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.180, units: 1, exitPrice: 7.175, feeRub: 0, role: 'div', priceCcy: 'USD' },
  ],
};

test('legRole — first leg divides, the rest multiply, explicit wins', () => {
  assert.strictEqual(calc.legRole({}, 0), 'div');
  assert.strictEqual(calc.legRole({}, 1), 'mul');
  assert.strictEqual(calc.legRole({ role: 'mul' }, 0), 'mul');
  assert.strictEqual(calc.legRole({ role: 'div' }, 1), 'div');
});

test('entrySpread — two legs keep the verified numbers', () => {
  near(calc.entrySpread(trade1), 0.001903, 1e-5);
  near(calc.exitSpread(trade1), 0.001484, 1e-5);
  near(calc.spreadTotal(trade1), 0.000419, 1e-5);
  assert.ok(calc.entrySpread(trade3) < 0, 'trade #3 entry spread stays negative');
});

test('entrySpread — the triangle weighs the synthetic against the market cross', () => {
  const relative = (a, b) => (a - b) / ((a + b) / 2);
  near(calc.entrySpread(triangle), relative(85500, 11900 * 7.18), 1e-9);
  near(calc.exitSpread(triangle), relative(85400, 11880 * 7.175), 1e-9);
});

test('entrySpread — degenerate shapes yield null instead of Infinity', () => {
  assert.strictEqual(calc.entrySpread({ ...triangle, legs: [triangle.legs[0]] }), null);
  assert.strictEqual(calc.entrySpread({ ...triangle, legs: triangle.legs.map((l) => ({ ...l, role: 'mul' })) }), null);
  assert.strictEqual(calc.entrySpread({ ...triangle, legs: [triangle.legs[0], { ...triangle.legs[1], entryPrice: 0 }] }), null);
});

test('exitSpread — an unfinished leg leaves the exit spread unknown', () => {
  assert.strictEqual(calc.exitSpread({ ...triangle,
    legs: [triangle.legs[0], triangle.legs[1], { ...triangle.legs[2], exitPrice: null }] }), null);
});

test('spreadFormula — reads back as the trade was entered', () => {
  assert.strictEqual(calc.spreadFormula(triangle), 'MOEX ÷ MOEX ÷ VANTAGE');
});

test('computeTrade — leg figures come with their rouble equivalents', () => {
  const c = calc.computeTrade(triangle);
  near(c.legs[0].start, 85500);          // as quoted, in the leg's currency
  near(c.legs[0].startRub, 85500);       // rouble leg: unchanged
  near(c.legs[2].start, 7.18);
  near(c.legs[2].startRub, 7.18 * 85);   // dollar leg: converted
  near(c.legs[0].grossRub, -100);   // long 85500 -> 85400
  near(c.positionStartRub, 85500 + 11900 + 7.18 * 85);
  near(c.positionEndRub, 85400 + 11880 + 7.175 * 85);
  near(c.positionStartAvgRub, (85500 + 11900 + 7.18 * 85) / 3);
  near(c.positionEndAvgRub, (85400 + 11880 + 7.175 * 85) / 3);
});

// ---- spread is measured against the mid price, as the source sheet does ----

// Sheet trade #1 with the full-precision prices from the sheet itself
const sheet1 = {
  usdRub: 83.7, payout: -295, adjustment: 0, closeDate: '2026-08-13',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.1526925, units: 40000, exitPrice: 1.153608, feeRub: 232 },
  ],
};
// Sheet trade #3 — the one where measuring from the first leg was visibly off
const sheet3 = {
  usdRub: 84.95, payout: 3061, adjustment: 0, closeDate: '2026-08-17',
  legs: [
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 65.76, units: 530, exitPrice: 66.57, feeRub: 46 },
    { exchange: 'FOREX', side: 'Лонг', entryPrice: 65.269, units: 500, exitPrice: 66.149, feeRub: 0 },
  ],
};

test('entrySpread — matches the sheet: difference over the mid price', () => {
  near(calc.entrySpread(sheet1) * 100, 0.1904, 0.0002);
  near(calc.entrySpread(sheet3) * 100, -0.7495, 0.0002);
  near(calc.exitSpread(sheet3) * 100, -0.6344, 0.0002);
  near(calc.spreadTotal(sheet3) * 100, -0.1150, 0.0003);
});

test('entrySpread — the triangle still reads +0,07%', () => {
  const tri = {
    usdRub: 85, payout: 0, adjustment: 0, closeDate: '2026-08-28',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85400, feeRub: 0, role: 'mul' },
      { exchange: 'MOEX', side: 'Шорт', entryPrice: 11900, units: 1, exitPrice: 11880, feeRub: 0, role: 'div' },
      { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.18, units: 1, exitPrice: 7.175, feeRub: 0, role: 'div' },
    ],
  };
  const den = 11900 * 7.18;
  near(calc.entrySpread(tri), (85500 - den) / ((85500 + den) / 2), 1e-9);
  near(calc.entrySpread(tri) * 100, 0.0679, 0.001);
});

test('entrySpread — a symmetric measure: swapping the legs only flips the sign', () => {
  const flipped = { ...sheet3, legs: [
    { ...sheet3.legs[1], role: 'div' },
    { ...sheet3.legs[0], role: 'mul' },
  ] };
  near(calc.entrySpread(flipped), -calc.entrySpread(sheet3), 1e-12);
});

// The journal now prints the closed spread on every closed row, so a half-filled
// trade must not read as "the whole spread was collected".
test('spread total needs both ends — a missing entry price is not a closed spread', () => {
  const noEntry = { ...trade1, legs: trade1.legs.map((l, i) => (i ? l : { ...l, entryPrice: '' })) };
  assert.strictEqual(calc.spreadTotal(noEntry), null);
  const noExit = { ...trade1, legs: trade1.legs.map((l, i) => (i ? l : { ...l, exitPrice: '' })) };
  assert.strictEqual(calc.spreadTotal(noExit), null);
});

// The collected spread reads as the trade reads: a trade closed in profit
// collected a plus, one closed in a loss a minus — whichever way the spread
// itself moved. The size is still the entry-to-exit difference.
test('spread collected — the sign follows the net profit, not the leg order', () => {
  near(calc.spreadCollected(trade1), 0.000419, 1e-5);       // profit, positive difference
  assert.ok(calc.netProfitRub(trade3) > 0, 'trade 3 closes in profit');
  near(calc.spreadCollected(trade3), 0.00113, 1e-4);        // profit, though entry - exit < 0
  const losing = { ...trade1, payout: -20000 };
  assert.ok(calc.netProfitRub(losing) < 0, 'the fixture must close in a loss');
  near(calc.spreadCollected(losing), -0.000419, 1e-5);
});

test('spread collected — nothing to show while a trade is open or half filled', () => {
  assert.strictEqual(calc.spreadCollected(tradeOpen), null);
  const noEntry = { ...trade1, legs: trade1.legs.map((l, i) => (i ? l : { ...l, entryPrice: '' })) };
  assert.strictEqual(calc.spreadCollected(noEntry), null);
});

// ---------- the rouble side of a leg ----------
//
// Trade #23 (GOLD, 21.09). The MOEX leg moved 6,78 points on 21 lots — $142,38
// — but MOEX credits variation margin in ROUBLES, by the contract's own price
// step value, not by the trade's USD/RUB: the broker's figure was 15 788,40 ₽,
// i.e. 110,89 ₽ per point against the 84,20 the trade was converted at. So the
// leg carries its own rouble rate, and may carry the broker's figure outright.
const trade23 = {
  usdRub: 84.2, payout: -719.3, adjustment: 0, closeDate: '2026-09-21', payoutRate: 0.06,
  legs: [
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 4427.2, units: 21, exitPrice: 4420.42, feeRub: 180, priceCcy: 'USD', role: 'mul' },
    { exchange: 'FOREX', side: 'Лонг', entryPrice: 4351.95, units: 20, exitPrice: 4345.02, feeRub: 105, priceCcy: 'USD', role: 'div' },
  ],
};
const moexLeg = (patch) => ({ ...trade23, legs: [{ ...trade23.legs[0], ...patch }, trade23.legs[1]] });

test('leg rouble rate — the trade rate unless the leg states its own', () => {
  near(calc.legRateRub(trade23.legs[0], 84.2), 84.2);          // dollar leg, nothing stated
  near(calc.legRateRub({ priceCcy: 'RUB' }, 84.2), 1);         // rouble-priced: a point is a rouble
  near(calc.legRateRub({ rateRub: 110.89 }, 84.2), 110.89);    // the leg wins over the trade
  near(calc.legRateRub({ priceCcy: 'RUB', rateRub: 10 }, 84.2), 10); // ... on a rouble leg too
  near(calc.legRateRub({ rateRub: '' }, 84.2), 84.2);          // blank is not a rate
  near(calc.legRateRub({ rateRub: 0 }, 84.2), 84.2);
});

test('leg gross in roubles — by the price step value, not the trade rate', () => {
  near(calc.legGrossRub(moexLeg({ rateRub: 110.89 }).legs[0], 84.2), 15788.5, 0.5);
  near(calc.legGrossRub(trade23.legs[0], 84.2), 11988.4, 0.5);  // unchanged without the field
});

test('leg gross in roubles — the broker figure replaces the calculation', () => {
  const t = moexLeg({ pnlFactRub: 15788.4 });
  near(calc.legGrossRub(t.legs[0], 84.2), 15788.4);
  near(calc.legGrossCalcRub(t.legs[0], 84.2), 11988.4, 0.5);    // what the model says, kept for the delta
  near(calc.legFactDeviation(t.legs[0], 84.2), 0.3170, 1e-3);   // +31,7% against the model
  assert.strictEqual(calc.legFactDeviation(trade23.legs[0], 84.2), null); // no fact, no deviation
});

test('a fact on an unclosed leg is not money yet', () => {
  const open = moexLeg({ exitPrice: null, pnlFactRub: 15788.4 });
  assert.strictEqual(calc.legGrossRub(open.legs[0], 84.2), null);
  assert.strictEqual(calc.pnlRub(open), null);
});

test('trade totals follow the leg rate — roubles first, dollars derived', () => {
  const t = moexLeg({ rateRub: 110.89 });
  near(calc.pnlRub(t), 3833.4, 1);            // 15 788,5 − 11 670,1 − 285
  near(calc.pnlNet(t), 45.53, 0.02);          // the dollar figure is pnlRub / rate
  near(calc.legGrossRub(t.legs[0], t.usdRub) / t.usdRub, 187.5, 0.1); // the leg reads $187,5
  near(calc.pnlRub(trade23), 33.3, 0.5);      // the old trade, untouched
});

test('the rouble rate moves money, not volume — position stays on the trade rate', () => {
  const t = moexLeg({ rateRub: 110.89 });
  near(calc.positionStartRub(t), calc.positionStartRub(trade23), 0.01);
  near(calc.positionEndRub(t), calc.positionEndRub(trade23), 0.01);
  near(calc.positionStartAvgRub(t), calc.positionStartAvgRub(trade23), 0.01);
});

test('payout estimate is taken from the roubles the exchange credited', () => {
  near(calc.estimatePayout(trade23, 0.06), -719.3, 0.5);                       // as before
  near(calc.estimatePayout(moexLeg({ rateRub: 110.89 }), 0.06), -947.3, 0.5);  // 6% of 15 788,5
  near(calc.estimatePayout(moexLeg({ pnlFactRub: 15788.4 }), 0.06), -947.3, 0.5);
});

test('payout estimate on a losing MOEX leg rebates the other legs, in roubles', () => {
  // MOEX loses, FOREX earns: the rebate is 6% of what has to be moved back
  const t = {
    ...trade23,
    legs: [
      { ...trade23.legs[0], exitPrice: 4437.2, rateRub: 110.89 },  // short, price up -> loss
      { ...trade23.legs[1], exitPrice: 4361.95 },                  // long, price up -> +$200
    ],
  };
  near(calc.estimatePayout(t, 0.06), 0.06 * 200 * 84.2, 1);
});

test('computeTrade carries the rouble side of every leg', () => {
  const c23 = calc.computeTrade(moexLeg({ rateRub: 110.89, pnlFactRub: 15788.4 }));
  near(c23.legs[0].rateRub, 110.89);
  near(c23.legs[0].grossRub, 15788.4);
  near(c23.legs[0].grossCalcRub, 15788.5, 0.5);
  near(c23.legs[0].factRub, 15788.4);
  near(c23.legs[0].factDeviation, 0.0, 1e-3);   // the rate now agrees with the fact
  assert.strictEqual(calc.computeTrade(trade23).legs[0].factRub, null);
});

test('the rate implied by a broker figure — what the calibration button computes', () => {
  near(calc.impliedLegRate(trade23.legs[0], 15788.4), 110.89, 0.01);
  assert.strictEqual(calc.impliedLegRate(trade23.legs[0], null), null);
  assert.strictEqual(calc.impliedLegRate({ ...trade23.legs[0], exitPrice: null }, 15788.4), null);
  assert.strictEqual(calc.impliedLegRate({ ...trade23.legs[0], exitPrice: 4427.2 }, 15788.4), null); // no move, no rate
});

// The journal prints a leg's money in the currency it quotes in, so the rouble
// figure has to read back through the trade rate — otherwise a calibrated MOEX
// leg would still show the dollar price move.
test('computeTrade — a leg reports the money it made, not the price move', () => {
  const c23 = calc.computeTrade(moexLeg({ pnlFactRub: 15788.4 }));
  near(c23.legs[0].grossMoney, 187.51, 0.01);            // dollar leg: roubles / trade rate
  near(c23.legs[1].grossMoney, -138.6, 0.01);            // untouched leg reads as before
  near(calc.computeTrade(trade23).legs[0].grossMoney, 142.38, 0.01);
  const rubLeg = calc.computeTrade({ usdRub: 84.2, legs: [
    { priceCcy: 'RUB', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 110, feeRub: 0 },
    trade23.legs[1],
  ] });
  near(rubLeg.legs[0].grossMoney, 100);                  // rouble leg reads roubles
});
