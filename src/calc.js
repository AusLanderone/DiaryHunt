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

function entrySpread(trade) {
  const [a, b] = trade.legs;
  return (Number(b.entryPrice) - Number(a.entryPrice)) / Number(a.entryPrice);
}

function exitSpread(trade) {
  const [a, b] = trade.legs;
  if (!hasExit(a) || !hasExit(b)) return null;
  return (Number(b.exitPrice) - Number(a.exitPrice)) / Number(a.exitPrice);
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

function pnlNet(trade) {
  const gross = grossTotal(trade);
  if (gross === null) return null;
  return gross - feeTotalRub(trade) / Number(trade.usdRub);
}

function pnlRub(trade) {
  const net = pnlNet(trade);
  return net === null ? null : net * Number(trade.usdRub);
}

function pnlNetPct(trade) {
  const net = pnlNet(trade);
  if (net === null) return null;
  const base = trade.legs.reduce((s, leg) => s + legPositionStart(leg), 0);
  return base === 0 ? null : net / base;
}

function netProfitRub(trade) {
  const rub = pnlRub(trade);
  if (rub === null) return null;
  return rub + Number(trade.payout || 0) + Number(trade.adjustment || 0);
}

function isClosed(trade) {
  return Boolean(trade.closeDate) && trade.legs.every(hasExit);
}

function computeTrade(trade) {
  return {
    legs: trade.legs.map((leg) => ({
      start: legPositionStart(leg),
      end: legPositionEnd(leg),
      gross: legGross(leg),
    })),
    entrySpread: entrySpread(trade),
    exitSpread: exitSpread(trade),
    spreadTotal: spreadTotal(trade),
    grossTotal: grossTotal(trade),
    feeTotalRub: feeTotalRub(trade),
    pnlNet: pnlNet(trade),
    pnlRub: pnlRub(trade),
    pnlNetPct: pnlNetPct(trade),
    netProfitRub: netProfitRub(trade),
    closed: isClosed(trade),
  };
}

module.exports = {
  legPositionStart, legPositionEnd, legGross,
  entrySpread, exitSpread, spreadTotal,
  grossTotal, feeTotalRub, pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade,
};
