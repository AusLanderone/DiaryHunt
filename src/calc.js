'use strict';

// ---------- a leg is a list of executions ----------
//
// A position is rarely one click, and the size can change while it is held: a
// leg carries `fills` — {date, price, units, kind: 'in' | 'out'}. A leg saved
// before this has one entry and one exit, which is the same list of two, so
// every trade in the diary keeps its numbers to the kopeck.
const EPS = 1e-9;
const isFilled = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

function legFills(leg, trade) {
  const t = trade || {};
  if (Array.isArray(leg.fills) && leg.fills.length) {
    return leg.fills
      .filter((f) => f && isFilled(f.price) && Number(f.units) > 0)
      .map((f) => ({
        date: f.date || null,
        price: Number(f.price),
        units: Number(f.units),
        kind: f.kind === 'out' ? 'out' : 'in',
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  const units = Number(leg.units);
  if (!units) return [];
  const out = [];
  if (isFilled(leg.entryPrice)) out.push({ date: t.openDate || null, price: Number(leg.entryPrice), units, kind: 'in' });
  if (isFilled(leg.exitPrice)) out.push({ date: t.closeDate || null, price: Number(leg.exitPrice), units, kind: 'out' });
  return out;
}

const sumUnits = (fills, kind) => fills.reduce((s, f) => (f.kind === kind ? s + f.units : s), 0);
const sumMoney = (fills, kind) => fills.reduce((s, f) => (f.kind === kind ? s + f.price * f.units : s), 0);

// The size of the position that was opened — what «Кол-во единиц» used to be.
function legUnits(leg, trade) {
  return sumUnits(legFills(leg, trade), 'in');
}

function legAvgEntry(leg, trade) {
  const fills = legFills(leg, trade);
  const q = sumUnits(fills, 'in');
  return q ? sumMoney(fills, 'in') / q : null;
}

function legAvgExit(leg, trade) {
  const fills = legFills(leg, trade);
  const q = sumUnits(fills, 'out');
  return q ? sumMoney(fills, 'out') / q : null;
}

// Closed means everything that was opened has been closed again — a leg half
// unwound is still open, and has no result yet.
function legIsClosed(leg, trade) {
  const fills = legFills(leg, trade);
  const opened = sumUnits(fills, 'in');
  return opened > 0 && Math.abs(opened - sumUnits(fills, 'out')) < EPS;
}

const hasExit = (leg) => legIsClosed(leg);

function legPositionStart(leg, trade) {
  return sumMoney(legFills(leg, trade), 'in');
}

function legPositionEnd(leg, trade) {
  if (!legIsClosed(leg, trade)) return null;
  return sumMoney(legFills(leg, trade), 'out');
}

// What the leg made, in the currency its price is quoted in: what came back
// minus what went in, signed by the side.
function legGross(leg, trade) {
  if (!legIsClosed(leg, trade)) return null;
  const fills = legFills(leg, trade);
  const start = sumMoney(fills, 'in');
  const end = sumMoney(fills, 'out');
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
    const price = field === 'entryPrice' ? legAvgEntry(leg, trade) : legAvgExit(leg, trade);
    if (price === null || Number.isNaN(price)) return null;
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

// What the legs made before costs, in ROUBLES. Adding the legs' own figures
// together would add dollars to roubles the moment a trade mixes currencies —
// which is why this converts each leg first, exactly as pnlRub does.
function grossTotalRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const g = legGrossRub(leg, trade.usdRub, trade);
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
// money — everything else is an estimate of it.
const filled = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

function legPnlFactRub(leg) {
  return filled(leg.pnlFactRub) ? Number(leg.pnlFactRub) : null;
}

// What a stored variation-margin figure was computed from. src/variationMargin.js
// builds the same shape when it computes one; calc.js runs in the renderer as a
// classic script and cannot require that module, so it carries its own copy —
// test/variationMargin.test.js holds the two together.
function vmFingerprint(leg, trade) {
  const t = trade || {};
  const fills = legFills(leg, t);
  return {
    entryPrice: legAvgEntry(leg, t), exitPrice: legAvgExit(leg, t),
    units: legUnits(leg, t), side: leg.side || null,
    openDate: t.openDate || null, closeDate: t.closeDate || null,
    fills: fills.map((f) => `${f.date}:${f.price}:${f.units}:${f.kind}`).join('|'),
  };
}

// A figure computed clearing by clearing describes the leg it was computed from.
// Move a price, a size or a date and it is a number about a different trade, so
// it is dropped rather than quietly believed.
function fingerprintMoved(fp, now) {
  // only the fields the stored fingerprint actually named: one written before
  // fills existed still guards the leg it was written for
  return Object.keys(fp).some((k) => {
    const a = now[k];
    const b = fp[k];
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-9;
    return a !== b;
  });
}

function legVmStale(leg, trade) {
  const fp = leg.vmMeta && leg.vmMeta.fingerprint;
  if (!fp) return false;
  return fingerprintMoved(fp, vmFingerprint(leg, trade));
}

// The roubles MOEX credited over the life of the position, summed session by
// session at each day's rate — what «↻ по клирингам» computes and stores.
function legVmRub(leg, trade) {
  if (!filled(leg.vmRub)) return null;
  return legVmStale(leg, trade) ? null : Number(leg.vmRub);
}

// The figure that stands in for the model, if any: the broker's first, the
// per-clearing sum second.
function legOverrideRub(leg, trade) {
  const fact = legPnlFactRub(leg);
  return fact === null ? legVmRub(leg, trade) : fact;
}

// Where a leg's money came from, for the line that says so in the UI.
function legMoneySource(leg, trade) {
  if (legPnlFactRub(leg) !== null) return 'fact';
  if (legVmRub(leg, trade) !== null) return 'clearing';
  return filled(leg.rateRub) && Number(leg.rateRub) > 0 ? 'rate' : 'trade';
}

// What the model says the leg earned, kept separate so the fact can be measured
// against it instead of quietly replacing it.
function legGrossCalcRub(leg, usdRub, trade) {
  const g = legGross(leg, trade);
  if (g === null) return null;
  const rate = legRateRub(leg, usdRub);
  // a dollar leg with no rate cannot be turned into roubles: saying nothing is
  // better than calling it zero and quietly losing the leg from every total
  return rate > 0 ? g * rate : null;
}

function legGrossRub(leg, usdRub, trade) {
  if (!legIsClosed(leg, trade)) return null;   // a figure on an unclosed leg is not money yet
  const over = legOverrideRub(leg, trade);
  return over === null ? legGrossCalcRub(leg, usdRub, trade) : over;
}

// How far the figure that won stands from the model, as a fraction: +0,317 = the
// exchange credited 31,7% more than the conversion by the trade's rate suggested.
function legDeviation(leg, usdRub, trade) {
  const over = legOverrideRub(leg, trade);
  const model = legGrossCalcRub(leg, usdRub, trade);
  if (over === null || model === null || model === 0) return null;
  return over / model - 1;
}

// The rouble rate a broker figure implies for this leg — the calibration behind
// the form's "подобрать из факта": roubles credited per point of price moved.
function impliedLegRate(leg, factRub, trade) {
  const g = legGross(leg, trade);
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
  return trade.legs.reduce((s, leg) => s + legPositionStart(leg, trade) * legPriceMul(leg, trade.usdRub), 0);
}

function positionEndRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const end = legPositionEnd(leg, trade);
    if (end === null) return null;
    sum += end * legPriceMul(leg, trade.usdRub);
  }
  return sum;
}

// Roubles are the primary unit: each leg's gross converts by its own price
// currency and fees are already roubles. The dollar figure derives from it, so
// an all-dollar trade lands on exactly the numbers it did before.
function pnlRub(trade) {
  const gross = grossTotalRub(trade);
  return gross === null ? null : gross - feeTotalRub(trade);
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
// answers "what did this trade earn on the money it needed". It is measured on
// the NET profit, the same number the journal prints beside it: measuring it on
// the gross made the two columns disagree about the sign whenever the payout
// was bigger than the trade's own result.
function pnlNetPct(trade) {
  const net = netProfitRub(trade);
  const base = positionStartAvgRub(trade);
  return net === null || base === 0 ? null : net / base;
}

// Net profit = PnL in roubles plus the manual adjustments: payout (the
// MOEX-side tax/rebate), the legs' swap and a free-form fix.
function netProfitRub(trade) {
  const rub = pnlRub(trade);
  if (rub === null) return null;
  return rub + Number(trade.payout || 0) + swapTotalRub(trade) + Number(trade.adjustment || 0);
}

function isClosed(trade) {
  return Boolean(trade.closeDate) && trade.legs.every((leg) => legIsClosed(leg, trade));
}

// Estimated payout ("Payout / перелив"): a MOEX-side tax/rebate approximation.
// The exact figure comes from the MOEX platform; this preview is close.
// rate is a fraction (e.g. 0.06). Returns ₽, or null if the MOEX leg is unclosed.
// Both branches read the legs' ROUBLE figures — the broker's fact when the leg
// carries one — because the tax is levied on the roubles the exchange credited,
// not on a dollar move converted at the trade's rate.
// The two parts are independent and a trade can carry both:
// - MOEX in profit  -> taxed on the closed trade: -rate * (MOEX legs ₽)
// - FOREX in profit -> moving that profit into roubles on MOEX pays +rate on
//                      top: +rate * (the other legs' net ₽)
// A side in loss adds nothing.
function estimatePayout(trade, rate) {
  const moexLegs = trade.legs.filter((l) => l.exchange === 'MOEX');
  if (!moexLegs.length) return null;
  // a triangle can stand on two MOEX legs: the tax is on what the venue made
  // altogether, not on whichever leg happens to be listed first
  let g = 0;
  for (const leg of moexLegs) {
    const one = legGrossRub(leg, trade.usdRub, trade);
    if (one === null) return null;
    g += one;
  }
  const tax = g > 0 ? -rate * g : 0;
  // what arrives on the other account is its net result, not its winning legs
  const other = trade.legs
    .filter((l) => l.exchange !== 'MOEX')
    .reduce((s, l) => s + (legGrossRub(l, trade.usdRub, trade) || 0), 0);
  return tax + (other > 0 ? rate * other : 0);
}

function computeTrade(trade) {
  return {
    legs: trade.legs.map((leg, i) => {
      const start = legPositionStart(leg, trade);
      const end = legPositionEnd(leg, trade);
      const k = legPriceMul(leg, trade.usdRub);
      const rateRub = legRateRub(leg, trade.usdRub);
      const grossRub = legGrossRub(leg, trade.usdRub, trade);
      return {
        start, end, gross: legGross(leg, trade),
        fills: legFills(leg, trade),
        units: legUnits(leg, trade),
        avgEntry: legAvgEntry(leg, trade),
        avgExit: legAvgExit(leg, trade),
        // same figures in roubles, so a mixed-currency trade can be summed
        startRub: start * k,
        endRub: end === null ? null : end * k,
        grossRub,
        // the money the leg actually made, read in the currency it quotes in:
        // the roubles back through the trade rate for a dollar leg
        grossMoney: grossRub === null ? null
          : (legPriceCcy(leg) === 'RUB' ? grossRub : (k ? grossRub / k : null)),
        rateRub,
        grossCalcRub: legGrossCalcRub(leg, trade.usdRub, trade),
        factRub: legPnlFactRub(leg),
        vmRub: legVmRub(leg, trade),
        vmStale: legVmStale(leg, trade),
        vmMeta: leg.vmMeta || null,
        source: legMoneySource(leg, trade),
        deviation: legDeviation(leg, trade.usdRub, trade),
        swapRub: legSwapRub(leg, trade.usdRub),
        priceCcy: legPriceCcy(leg),
        role: legRole(leg, i),
      };
    }),
    entrySpread: entrySpread(trade),
    exitSpread: exitSpread(trade),
    spreadTotal: spreadTotal(trade),
    spreadCollected: spreadCollected(trade),
    grossTotalRub: grossTotalRub(trade),
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
  legFills, legUnits, legAvgEntry, legAvgExit, legIsClosed,
  entrySpread, exitSpread, spreadTotal, spreadCollected, legRole, spreadFormula,
  grossTotalRub, feeTotalRub, legSwapRub, swapTotalRub, isRubLeg,
  legPriceCcy, legPriceMul, legGrossRub, positionStartRub, positionEndRub,
  legRateRub, legPnlFactRub, legGrossCalcRub, legDeviation, impliedLegRate,
  vmFingerprint, legVmStale, legVmRub, legOverrideRub, legMoneySource,
  positionStartAvgRub, positionEndAvgRub,
  pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade, estimatePayout,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.calc = _api;
