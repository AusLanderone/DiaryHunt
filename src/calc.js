'use strict';

const hasExit = (leg) => leg.exitPrice !== null && leg.exitPrice !== undefined && leg.exitPrice !== '';

function legPositionStart(leg) {
  return Number(leg.entryPrice) * Number(leg.units);
}

function legPositionEnd(leg) {
  if (!hasExit(leg)) return null;
  return Number(leg.exitPrice) * Number(leg.units);
}

function legGross(leg) {
  const end = legPositionEnd(leg);
  if (end === null) return null;
  const start = legPositionStart(leg);
  return leg.side === 'Шорт' ? start - end : end - start; // Лонг/Спот: end - start
}

// A leg either multiplies or divides the spread expression. The defaults make a
// two-leg trade read leg2 / leg1 - 1 — exactly the (b - a) / a of the
// sheet-verified formula — so trades entered before this keep their numbers.
function legRole(leg, index) {
  return (leg.role === 'mul' || leg.role === 'div') ? leg.role : (index === 0 ? 'div' : 'mul');
}

// spread = (Π multiplying prices − Π dividing prices) / their mid point.
//
// The source sheet measures against the mid price of the two legs, not against
// the first one: on SILV that is the difference between −0,7467% and the
// sheet's −0,7495%. Taking the mid keeps the measure symmetric — swapping the
// legs only flips the sign — and on a triangle it still lands on the ratio the
// TradingView formula gives (+0,0679% against +0,0679%).
function spreadOver(trade, field) {
  if (!trade.legs || trade.legs.length < 2) return null;
  let num = 1, den = 1, seenDen = false;
  for (let i = 0; i < trade.legs.length; i++) {
    const leg = trade.legs[i];
    const raw = leg[field];
    if (raw === null || raw === undefined || raw === '') return null;
    const price = Number(raw);
    if (Number.isNaN(price)) return null;
    if (legRole(leg, i) === 'div') { den *= price; seenDen = true; } else { num *= price; }
  }
  const mid = (num + den) / 2;
  if (!seenDen || den === 0 || mid === 0) return null;   // an empty side is not a spread
  return (num - den) / mid;
}

const entrySpread = (trade) => spreadOver(trade, 'entryPrice');
const exitSpread = (trade) => spreadOver(trade, 'exitPrice');

// "MOEX ÷ MOEX ÷ VANTAGE" — what the spread divides by what
function spreadFormula(trade) {
  return trade.legs
    .map((leg, i) => (i === 0
      ? String(leg.exchange || '?')
      : `${legRole(leg, i) === 'div' ? '÷' : '×'} ${leg.exchange || '?'}`))
    .join(' ');
}

// How much of the spread the trade actually collected: what it entered on minus
// what was left at the exit. Both ends have to be there — a trade with a price
// missing on either side has no closed spread, not a spread of its other half.
function spreadTotal(trade) {
  const en = entrySpread(trade);
  const ex = exitSpread(trade);
  if (en === null || ex === null) return null;
  return en - ex;
}

// The spread the trade actually collected, as the trade itself reads: the size
// is the entry-to-exit difference, the sign is the trade's result. A trade
// closed in profit collected a plus even when the spread widened against the
// leg order (that direction lives in spreadTotal), a losing one a minus.
function spreadCollected(trade) {
  const diff = spreadTotal(trade);
  const profit = netProfitRub(trade);
  if (diff === null || profit === null) return null;
  return profit < 0 ? -Math.abs(diff) : Math.abs(diff);
}

function grossTotal(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const g = legGross(leg);
    if (g === null) return null;
    sum += g;
  }
  return sum;
}

function feeTotalRub(trade) {
  return trade.legs.reduce((s, leg) => s + Number(leg.feeRub || 0), 0);
}

// Overnight financing, entered per leg in that leg's own currency: roubles on
// MOEX, dollars on every other venue. `swapRub` is the older rouble-only field
// and is still read as roubles whatever the exchange.
const isRubLeg = (leg) => String(leg.exchange || '').trim().toUpperCase() === 'MOEX';

// Price currency lives on the leg. Legs saved before this field existed are
// dollar-priced — MOEX ones included (ED and SILV quote in dollars), so it must
// not be inferred from the exchange here; the form picks the default at entry.
function legPriceCcy(leg) {
  return leg.priceCcy === 'RUB' ? 'RUB' : 'USD';
}

// The multiplier that values a POSITION in roubles: the trade's rate, one leg
// like another. Volume has to stay comparable between the legs — they are the
// same ounces on two venues — so it deliberately ignores the leg's own rate.
function legPriceMul(leg, usdRub) {
  return legPriceCcy(leg) === 'RUB' ? 1 : (Number(usdRub) || 0);
}

// The multiplier that values MONEY in roubles: how many roubles one point of
// price pays. A dollar leg pays the dollar move at the trade's rate — but a
// MOEX future quoted in dollars (GOLD, SILV, ED) does not: it credits variation
// margin in roubles by the contract's price step value, which is not the
// USD/RUB of the day. `rateRub` on the leg is that value; left empty, the old
// rule stands, so every trade entered before this keeps its numbers.
function legRateRub(leg, usdRub) {
  const own = Number(leg.rateRub);
  if (leg.rateRub !== null && leg.rateRub !== undefined && leg.rateRub !== '' && own > 0) return own;
  return legPriceCcy(leg) === 'RUB' ? 1 : (Number(usdRub) || 0);
}

// The broker's own figure for the leg, in roubles. When it is there it IS the
// money — the model is only an estimate of it.
const hasFact = (leg) => leg.pnlFactRub !== null && leg.pnlFactRub !== undefined
  && leg.pnlFactRub !== '' && !Number.isNaN(Number(leg.pnlFactRub));

function legPnlFactRub(leg) {
  return hasFact(leg) ? Number(leg.pnlFactRub) : null;
}

// What the model says the leg earned, kept separate so the fact can be measured
// against it instead of quietly replacing it.
function legGrossCalcRub(leg, usdRub) {
  const g = legGross(leg);
  return g === null ? null : g * legRateRub(leg, usdRub);
}

function legGrossRub(leg, usdRub) {
  if (!hasExit(leg)) return null;   // a fact on an unclosed leg is not money yet
  const fact = legPnlFactRub(leg);
  return fact === null ? legGrossCalcRub(leg, usdRub) : fact;
}

// How far the fact stands from the model, as a fraction: +0,317 = the exchange
// credited 31,7% more than the conversion by the trade's rate suggested.
function legFactDeviation(leg, usdRub) {
  const fact = legPnlFactRub(leg);
  const model = legGrossCalcRub(leg, usdRub);
  if (fact === null || model === null || model === 0) return null;
  return fact / model - 1;
}

// The rouble rate a broker figure implies for this leg — the calibration behind
// the form's "подобрать из факта": roubles credited per point of price moved.
function impliedLegRate(leg, factRub) {
  const g = legGross(leg);
  const fact = Number(factRub);
  if (g === null || g === 0) return null;
  if (factRub === null || factRub === undefined || factRub === '' || Number.isNaN(fact)) return null;
  return fact / g;
}

function legSwapRub(leg, usdRub) {
  if (leg.swapRub !== undefined && leg.swapRub !== null && leg.swapRub !== '') {
    return Number(leg.swapRub) || 0;
  }
  const raw = Number(leg.swap || 0);
  return isRubLeg(leg) ? raw : raw * (Number(usdRub) || 0);
}

function swapTotalRub(trade) {
  return trade.legs.reduce((s, leg) => s + legSwapRub(leg, trade.usdRub), 0);
}

// Capital tied up, both legs converted to roubles by their own price currency.
function positionStartRub(trade) {
  return trade.legs.reduce((s, leg) => s + legPositionStart(leg) * legPriceMul(leg, trade.usdRub), 0);
}

function positionEndRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const end = legPositionEnd(leg);
    if (end === null) return null;
    sum += end * legPriceMul(leg, trade.usdRub);
  }
  return sum;
}

// Roubles are the primary unit: each leg's gross converts by its own price
// currency and fees are already roubles. The dollar figure derives from it, so
// an all-dollar trade lands on exactly the numbers it did before.
function pnlRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const g = legGrossRub(leg, trade.usdRub);
    if (g === null) return null;
    sum += g;
  }
  return sum - feeTotalRub(trade);
}

function pnlNet(trade) {
  const rub = pnlRub(trade);
  const rate = Number(trade.usdRub) || 0;
  return rub === null || rate === 0 ? null : rub / rate;
}

// The size of ONE side of the trade: its legs are two (or three) sides of the
// same position, so their sum counts the same money twice. Returns ₽.
function positionStartAvgRub(trade) {
  const legs = trade.legs.length;
  return legs ? positionStartRub(trade) / legs : 0;
}

// The same measure at the exit; null while any leg is still open.
function positionEndAvgRub(trade) {
  const legs = trade.legs.length;
  const end = positionEndRub(trade);
  return !legs || end === null ? null : end / legs;
}

// Return on the capital a single side of the trade ties up — the figure that
// answers "what did this trade earn on the money it needed".
function pnlNetPct(trade) {
  const rub = pnlRub(trade);
  const base = positionStartAvgRub(trade);
  return rub === null || base === 0 ? null : rub / base;
}

// Net profit = PnL in roubles plus the manual adjustments: payout (the
// MOEX-side tax/rebate), the legs' swap and a free-form fix.
function netProfitRub(trade) {
  const rub = pnlRub(trade);
  if (rub === null) return null;
  return rub + Number(trade.payout || 0) + swapTotalRub(trade) + Number(trade.adjustment || 0);
}

function isClosed(trade) {
  return Boolean(trade.closeDate) && trade.legs.every(hasExit);
}

// Estimated payout ("Payout / перелив"): a MOEX-side tax/rebate approximation.
// The exact figure comes from the MOEX platform; this preview is close.
// rate is a fraction (e.g. 0.06). Returns ₽, or null if the MOEX leg is unclosed.
// Both branches read the legs' ROUBLE figures — the broker's fact when the leg
// carries one — because the tax is levied on the roubles the exchange credited,
// not on a dollar move converted at the trade's rate.
// - MOEX leg in profit  -> taxed: payout = -rate * (MOEX leg ₽)
// - MOEX leg in loss    -> rebate on transferring the other legs' profit back to
//                          MOEX: payout = +rate * (other legs' profit ₽)
function estimatePayout(trade, rate) {
  const moex = trade.legs.find((l) => l.exchange === 'MOEX');
  if (!moex) return null;
  const g = legGrossRub(moex, trade.usdRub);
  if (g === null) return null;
  if (g > 0) return -rate * g;
  const otherProfit = trade.legs
    .filter((l) => l !== moex)
    .reduce((s, l) => { const lg = legGrossRub(l, trade.usdRub); return s + (lg && lg > 0 ? lg : 0); }, 0);
  return rate * otherProfit;
}

function computeTrade(trade) {
  return {
    legs: trade.legs.map((leg, i) => {
      const start = legPositionStart(leg);
      const end = legPositionEnd(leg);
      const k = legPriceMul(leg, trade.usdRub);
      const rateRub = legRateRub(leg, trade.usdRub);
      const grossRub = legGrossRub(leg, trade.usdRub);
      return {
        start, end, gross: legGross(leg),
        // same figures in roubles, so a mixed-currency trade can be summed
        startRub: start * k,
        endRub: end === null ? null : end * k,
        grossRub,
        // the money the leg actually made, read in the currency it quotes in:
        // the roubles back through the trade rate for a dollar leg
        grossMoney: grossRub === null ? null
          : (legPriceCcy(leg) === 'RUB' ? grossRub : (k ? grossRub / k : null)),
        rateRub,
        grossCalcRub: legGrossCalcRub(leg, trade.usdRub),
        factRub: legPnlFactRub(leg),
        factDeviation: legFactDeviation(leg, trade.usdRub),
        swapRub: legSwapRub(leg, trade.usdRub),
        priceCcy: legPriceCcy(leg),
        role: legRole(leg, i),
      };
    }),
    entrySpread: entrySpread(trade),
    exitSpread: exitSpread(trade),
    spreadTotal: spreadTotal(trade),
    spreadCollected: spreadCollected(trade),
    grossTotal: grossTotal(trade),
    feeTotalRub: feeTotalRub(trade),
    pnlNet: pnlNet(trade),
    pnlRub: pnlRub(trade),
    pnlNetPct: pnlNetPct(trade),
    netProfitRub: netProfitRub(trade),
    swapTotalRub: swapTotalRub(trade),
    positionStartRub: positionStartRub(trade),
    positionStartAvgRub: positionStartAvgRub(trade),
    positionEndAvgRub: positionEndAvgRub(trade),
    positionEndRub: positionEndRub(trade),
    spreadFormula: spreadFormula(trade),
    closed: isClosed(trade),
  };
}

const _api = {
  legPositionStart, legPositionEnd, legGross,
  entrySpread, exitSpread, spreadTotal, spreadCollected, legRole, spreadFormula,
  grossTotal, feeTotalRub, legSwapRub, swapTotalRub, isRubLeg,
  legPriceCcy, legPriceMul, legGrossRub, positionStartRub, positionEndRub,
  legRateRub, legPnlFactRub, legGrossCalcRub, legFactDeviation, impliedLegRate,
  positionStartAvgRub, positionEndAvgRub,
  pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade, estimatePayout,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.calc = _api;
