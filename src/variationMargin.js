'use strict';

// Variation margin, the way MOEX actually pays it.
//
// A dollar-quoted future on MOEX is not settled once at the end: every evening
// the exchange marks the position to that session's settlement price and credits
// the difference in ROUBLES, valuing a point by the day's official rate. Over a
// held position the rate moves AND the size can change, so the roubles credited
// are a sum over clearings and not the whole price move converted once. This
// module is that sum, and nothing else: prices and rates are handed to it, so it
// stays pure and testable.

const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

const EPS = 1e-9;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dirOf = (side) => (side === 'Шорт' ? -1 : 1);

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
// settlement, then the fill it was closed at. Kept for the single-fill shape
// and for reading; the sum below walks days, because the size can change.
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

// What the stored figure was computed from — calc owns the shape, because the
// renderer has to recognise a stale figure without this module.
const fingerprint = (leg, trade) => calc.vmFingerprint(leg, trade);

function compute({ leg, openDate, closeDate, settles, rates }) {
  const trade = { openDate, closeDate };
  const fills = calc.legFills(leg, trade);
  if (!fills.length || !calc.legIsClosed(leg, trade)) return null;

  const dir = dirOf(leg.side);
  const settleOn = new Map();
  for (const s of (settles || [])) {
    const price = num(s.settle);
    if (price !== null && price > 0) settleOn.set(String(s.date), price);
  }
  const first = fills[0].date;
  const last = fills[fills.length - 1].date;
  if (!first || !last) return null;

  // every day that either moves the position or marks it
  const days = [...new Set([
    ...fills.map((f) => String(f.date)),
    ...[...settleOn.keys()].filter((d) => d >= String(first) && d <= String(last)),
  ])].sort();

  let position = 0;
  let prevMark = null;
  let pending = [];        // fills made on a day the exchange did not clear
  let rub = 0;
  const rows = [];

  const net = (list) => list.reduce((s, f) => s + (f.kind === 'in' ? f.units : -f.units), 0);
  for (const day of days) {
    const today = fills.filter((f) => String(f.date) === day);
    // fills still waiting for a clearing count towards the size only once they
    // are marked — until then the exchange has not seen them either
    const after = position + net(pending) + net(today);

    // the day's mark: the clearing price, or — when the position goes flat —
    // the price it was closed at, because after that there is nothing to mark
    let mark = settleOn.has(day) ? settleOn.get(day) : null;
    if (Math.abs(after) < EPS) {
      const outs = today.filter((f) => f.kind === 'out');
      const q = outs.reduce((s, f) => s + f.units, 0);
      if (q > 0) mark = outs.reduce((s, f) => s + f.price * f.units, 0) / q;
    }
    if (mark === null) { pending = pending.concat(today); continue; }

    const rate = rateOn(rates, day);
    if (!rate) return null;   // a session without a rate has no figure, not a zero

    let points = prevMark === null ? 0 : (mark - prevMark) * position * dir;
    for (const f of pending.concat(today)) {
      points += (mark - f.price) * f.units * (f.kind === 'in' ? dir : -dir);
    }
    pending = [];
    const delta = points * rate;
    rub += delta;
    rows.push({ date: day, from: prevMark, to: mark, rate, delta, position: after });
    prevMark = mark;
    position = after;
  }

  if (pending.length || Math.abs(position) > EPS) return null;   // it did not close out
  return { rub, sessions: rows.length, rows, fingerprint: fingerprint(leg, trade) };
}

module.exports = { pickContract, rateOn, buildMarks, fingerprint, compute };
