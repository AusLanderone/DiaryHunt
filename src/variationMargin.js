'use strict';

// Variation margin, the way MOEX actually pays it.
//
// A dollar-quoted future on MOEX is not settled once at the end: every evening
// the exchange marks the position to that session's settlement price and credits
// the difference in ROUBLES, valuing a point by the day's official rate. Over a
// held position the rate moves, so the roubles credited are a SUM over clearings
// and not the whole price move converted once. This module is that sum, and
// nothing else: prices and rates are handed to it, so it stays pure and testable.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sign = (side) => (side === 'Шорт' ? -1 : 1);

// Which contract of a series a trade was in. The asset code (GOLD, SILV, ED)
// names the series; the expiries differ by carry, so the one whose settlement
// price on the open day sits closest to the price actually filled is the one.
function pickContract(rows, entryPrice) {
  const price = num(entryPrice);
  if (price === null || !Array.isArray(rows) || !rows.length) return null;
  const usable = rows.filter((r) => Number(r.settle) > 0);
  if (!usable.length) return null;
  return usable.reduce((best, r) => (Math.abs(r.settle - price) < Math.abs(best.settle - price) ? r : best));
}

// The rate in force on a day: the last one published on or before it. Weekends
// and holidays carry the previous business day's rate, which is what the
// exchange does too.
function rateOn(series, day) {
  if (!Array.isArray(series)) return null;
  let best = null;
  for (const r of series) {
    if (String(r.date) <= String(day) && (!best || String(r.date) > String(best.date))) best = r;
  }
  return best ? Number(best.rate) : null;
}

// Every price the position was marked at: the fill, then each evening's
// settlement, then the fill it was closed at. The close day's settlement is
// never a mark — the position was gone by then.
function buildMarks({ openDate, closeDate, entryPrice, exitPrice, settles }) {
  const marks = [{ date: openDate, price: num(entryPrice) }];
  for (const s of (settles || [])) {
    const price = num(s.settle);
    if (price === null) continue;
    if (String(s.date) >= String(openDate) && String(s.date) < String(closeDate)) {
      marks.push({ date: s.date, price });
    }
  }
  marks.push({ date: closeDate, price: num(exitPrice) });
  return marks;
}

// What the stored figure was computed from. A price, a size or a date changes
// and the figure describes a different trade — the app compares fingerprints
// rather than trusting a number whose inputs have moved.
function fingerprint(leg, trade) {
  return {
    entryPrice: num(leg.entryPrice), exitPrice: num(leg.exitPrice),
    units: num(leg.units), side: leg.side || null,
    openDate: trade.openDate || null, closeDate: trade.closeDate || null,
  };
}

function compute({ leg, openDate, closeDate, settles, rates }) {
  const entry = num(leg.entryPrice);
  const exit = num(leg.exitPrice);
  const units = num(leg.units);
  if (entry === null || exit === null || !units || !openDate || !closeDate) return null;

  const marks = buildMarks({ openDate, closeDate, entryPrice: entry, exitPrice: exit, settles });
  const dir = sign(leg.side);
  const rows = [];
  let rub = 0;
  for (let i = 1; i < marks.length; i++) {
    const rate = rateOn(rates, marks[i].date);
    if (!rate) return null;   // a session without a rate has no figure, not a zero
    const delta = (marks[i].price - marks[i - 1].price) * units * dir * rate;
    rub += delta;
    rows.push({ date: marks[i].date, from: marks[i - 1].price, to: marks[i].price, rate, delta });
  }
  return { rub, sessions: rows.length, rows, fingerprint: fingerprint(leg, { openDate, closeDate }) };
}

module.exports = { pickContract, rateOn, buildMarks, fingerprint, compute };
