'use strict';

// Manual balance snapshots: what actually sits on each account on a given date.
// Pure functions — the renderer only draws what these return.
// IIFE-scoped for the same reason as analytics.js: in the renderer this file is
// a classic script sharing one global scope with calc.js.
(function () {

const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

const num = (v) => Number(v) || 0;

// { rub, usd } — roubles convert dollar accounts at the snapshot's own rate.
// Without a rate the dollar accounts cannot be valued, so usd is unknown and
// only the rouble accounts are counted.
function snapshotTotals(snap) {
  const rate = num(snap.usdRub);
  const accounts = snap.accounts || [];
  const rub = accounts.reduce((s, a) => s + num(a.amount) * (a.ccy === 'RUB' ? 1 : rate), 0);
  return { rub, usd: rate === 0 ? (accounts.length ? null : 0) : rub / rate };
}

// snapshots oldest first, each with its totals folded in
function series(snaps) {
  return snaps
    .slice()
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0))
    .map((s) => ({ ...s, ...snapshotTotals(s) }));
}

// same rows plus the change from the previous snapshot
function deltas(snaps) {
  const rows = series(snaps);
  return rows.map((row, i) => {
    if (i === 0) return { ...row, deltaRub: null, deltaUsd: null, deltaPct: null };
    const prev = rows[i - 1];
    return {
      ...row,
      deltaRub: row.rub - prev.rub,
      deltaUsd: row.usd === null || prev.usd === null ? null : row.usd - prev.usd,
      deltaPct: prev.rub === 0 ? null : ((row.rub - prev.rub) / prev.rub) * 100,
    };
  });
}

// one row per account: as entered, in roubles, and its share of the snapshot
function byAccount(snap) {
  const rate = num(snap.usdRub);
  const total = snapshotTotals(snap).rub;
  return (snap.accounts || []).map((a) => {
    const rub = num(a.amount) * (a.ccy === 'RUB' ? 1 : rate);
    return {
      name: a.name || '—',
      amount: num(a.amount),
      ccy: a.ccy === 'RUB' ? 'RUB' : 'USD',
      rub,
      share: total === 0 ? 0 : (rub / total) * 100,
    };
  });
}

// ---------- deposits and withdrawals ----------

// signed roubles: a deposit adds, a withdrawal subtracts, dollars convert at
// the rate recorded with the movement itself
function flowRub(flow) {
  const raw = num(flow.amount) * (flow.ccy === 'RUB' ? 1 : num(flow.usdRub));
  return flow.kind === 'out' ? -raw : raw;
}

// net movement up to and including a date
function flowsUpTo(flows, date) {
  return (flows || [])
    .filter((f) => String(f.date) <= String(date))
    .reduce((s, f) => s + flowRub(f), 0);
}

function flowTotals(flows) {
  return (flows || []).reduce((acc, f) => {
    const v = flowRub(f);
    if (v >= 0) acc.in += v; else acc.out += v;
    acc.net += v;
    return acc;
  }, { in: 0, out: 0, net: 0 });
}

// The journal's view of the same timeline: start from the capital of the first
// snapshot, add the profit of every trade closed by each snapshot's date, and
// the money moved in or out by then. What is left between this line and the
// real one is unrecorded costs — not transfers.
function journalLine(snaps, trades, flows) {
  const rows = series(snaps);
  if (!rows.length) return [];
  const base = rows[0].rub;
  const closed = (trades || []).filter((t) => calc.isClosed(t));
  return rows.map((row) => base
    + closed
      .filter((t) => String(t.closeDate) <= String(row.date))
      .reduce((s, t) => s + calc.netProfitRub(t), 0)
    + flowsUpTo(flows, row.date));
}

const _api = { snapshotTotals, series, deltas, byAccount, journalLine, flowRub, flowsUpTo, flowTotals };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.balances = _api;
})();
