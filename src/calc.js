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

// spread = Π(multiplying prices) / Π(dividing prices) - 1, over one price field
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
  if (!seenDen || den === 0) return null;
  return num / den - 1;
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

function spreadTotal(trade) {
  const ex = exitSpread(trade);
  if (ex === null) return null;
  return entrySpread(trade) - ex;
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

function legPriceMul(leg, usdRub) {
  return legPriceCcy(leg) === 'RUB' ? 1 : (Number(usdRub) || 0);
}

function legGrossRub(leg, usdRub) {
  const g = legGross(leg);
  return g === null ? null : g * legPriceMul(leg, usdRub);
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

function pnlNetPct(trade) {
  const rub = pnlRub(trade);
  const base = positionStartRub(trade);
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
// - MOEX leg in profit  -> taxed: payout = -rate * (MOEX gross $ * usdRub)
// - MOEX leg in loss    -> rebate on transferring the other legs' profit back to
//                          MOEX: payout = +rate * (other legs' profit $ * usdRub)
function estimatePayout(trade, rate) {
  const usd = Number(trade.usdRub) || 0;
  const moex = trade.legs.find((l) => l.exchange === 'MOEX');
  if (!moex) return null;
  const g = legGross(moex);
  if (g === null) return null;
  if (g > 0) return -rate * g * usd;
  const otherProfit = trade.legs
    .filter((l) => l !== moex)
    .reduce((s, l) => { const lg = legGross(l); return s + (lg && lg > 0 ? lg : 0); }, 0);
  return rate * otherProfit * usd;
}

function computeTrade(trade) {
  return {
    legs: trade.legs.map((leg, i) => {
      const start = legPositionStart(leg);
      const end = legPositionEnd(leg);
      const k = legPriceMul(leg, trade.usdRub);
      return {
        start, end, gross: legGross(leg),
        // same figures in roubles, so a mixed-currency trade can be summed
        startRub: start * k,
        endRub: end === null ? null : end * k,
        grossRub: legGrossRub(leg, trade.usdRub),
        swapRub: legSwapRub(leg, trade.usdRub),
        priceCcy: legPriceCcy(leg),
        role: legRole(leg, i),
      };
    }),
    entrySpread: entrySpread(trade),
    exitSpread: exitSpread(trade),
    spreadTotal: spreadTotal(trade),
    grossTotal: grossTotal(trade),
    feeTotalRub: feeTotalRub(trade),
    pnlNet: pnlNet(trade),
    pnlRub: pnlRub(trade),
    pnlNetPct: pnlNetPct(trade),
    netProfitRub: netProfitRub(trade),
    swapTotalRub: swapTotalRub(trade),
    positionStartRub: positionStartRub(trade),
    positionEndRub: positionEndRub(trade),
    spreadFormula: spreadFormula(trade),
    closed: isClosed(trade),
  };
}

const _api = {
  legPositionStart, legPositionEnd, legGross,
  entrySpread, exitSpread, spreadTotal, legRole, spreadFormula,
  grossTotal, feeTotalRub, legSwapRub, swapTotalRub, isRubLeg,
  legPriceCcy, legPriceMul, legGrossRub, positionStartRub, positionEndRub,
  pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade, estimatePayout,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.calc = _api;
