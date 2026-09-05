'use strict';

// IIFE-scoped: in the renderer this file is a classic script sharing one global
// scope with calc.js, so top-level `const` here would collide with its bindings.
(function () {

// Derived statistics on top of src/calc.js: risk metrics, entry-spread bands,
// holding time, calendar/period slicing. Pure functions — no DOM, no I/O — so
// the numbers behind every stats widget are covered by node:test.
const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

const closedOnly = (trades) => trades.filter((t) => calc.isClosed(t));
const profitOf = (t) => calc.netProfitRub(t);

// group trades -> [{ key, label, profit, count, wins }] in insertion order
function groupBy(trades, keyFn, labelFn) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, { key: k, label: labelFn ? labelFn(k, t) : k, profit: 0, count: 0, wins: 0 });
    const g = map.get(k);
    const np = profitOf(t);
    g.profit += np; g.count += 1; if (np > 0) g.wins += 1;
  }
  return [...map.values()];
}

// ---------- risk / quality metrics ----------

function profitFactor(profits) {
  if (!profits.length) return null;
  let wins = 0, losses = 0;
  for (const p of profits) (p > 0 ? (wins += p) : (losses -= p));
  if (losses === 0) return wins > 0 ? Infinity : null;
  return wins / losses;
}

function expectancy(profits) {
  if (!profits.length) return null;
  return profits.reduce((s, v) => s + v, 0) / profits.length;
}

function avgWin(profits) {
  const w = profits.filter((p) => p > 0);
  return w.length ? w.reduce((s, v) => s + v, 0) / w.length : null;
}

function avgLoss(profits) {
  const l = profits.filter((p) => p < 0);
  return l.length ? l.reduce((s, v) => s + v, 0) / l.length : null;
}

// ---------- entry spread ----------

const pct1 = (v) => String(Math.round(v * 1000) / 10).replace('.', ',');
const SPREAD_EDGES = [0.005, 0.01, 0.02];

// closed trades bucketed by |entry spread| -> [{ label, profit, count, wins }]
function spreadBuckets(trades, edges = SPREAD_EDGES) {
  const buckets = edges.map((e, i) => ({
    label: i === 0 ? `< ${pct1(e)}%` : `${pct1(edges[i - 1])}–${pct1(e)}%`,
    profit: 0, count: 0, wins: 0,
  }));
  buckets.push({ label: `> ${pct1(edges[edges.length - 1])}%`, profit: 0, count: 0, wins: 0 });
  for (const t of closedOnly(trades)) {
    const s = Math.abs(calc.entrySpread(t));
    let i = edges.findIndex((e) => s < e);
    if (i === -1) i = edges.length;
    const b = buckets[i];
    const np = profitOf(t);
    b.profit += np; b.count += 1; if (np > 0) b.wins += 1;
  }
  return buckets;
}

// ---------- holding time ----------

const DAY = 86400000;
const asUTC = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); };

function holdingDays(trade) {
  if (!trade.openDate || !trade.closeDate) return null;
  return Math.round((asUTC(trade.closeDate) - asUTC(trade.openDate)) / DAY);
}

const HOLD_BANDS = [
  { label: 'В тот же день', max: 0 },
  { label: '1–3 дня', max: 3 },
  { label: '4–7 дней', max: 7 },
  { label: 'Больше недели', max: Infinity },
];

function holdingBuckets(trades) {
  const buckets = HOLD_BANDS.map((b) => ({ label: b.label, profit: 0, count: 0, wins: 0 }));
  for (const t of closedOnly(trades)) {
    const d = holdingDays(t);
    if (d === null) continue;
    const b = buckets[HOLD_BANDS.findIndex((band) => d <= band.max)];
    const np = profitOf(t);
    b.profit += np; b.count += 1; if (np > 0) b.wins += 1;
  }
  return buckets;
}

// ---------- calendar slices ----------

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pad2 = (n) => String(n).padStart(2, '0');

function byMonth(trades) {
  return groupBy(
    closedOnly(trades),
    (t) => String(t.closeDate).slice(0, 7),
    (k) => `${MONTHS[Number(k.slice(5, 7)) - 1] || k} ${k.slice(0, 4)}`,
  ).sort((a, b) => (a.key < b.key ? -1 : 1));
}

// Monday-first weekday buckets; all seven always present
function byWeekday(trades) {
  const rows = WEEKDAYS.map((label) => ({ key: label, label, profit: 0, count: 0, wins: 0 }));
  for (const t of closedOnly(trades)) {
    const js = new Date(asUTC(t.closeDate)).getUTCDay();   // 0=Sun
    const r = rows[(js + 6) % 7];
    const np = profitOf(t);
    r.profit += np; r.count += 1; if (np > 0) r.wins += 1;
  }
  return rows;
}

// { '2026-08-12': { profit, count, wins } } — the heatmap's data source
function calendarMap(trades) {
  const map = {};
  for (const t of closedOnly(trades)) {
    const d = t.closeDate;
    if (!map[d]) map[d] = { profit: 0, count: 0, wins: 0 };
    const np = profitOf(t);
    map[d].profit += np; map[d].count += 1; if (np > 0) map[d].wins += 1;
  }
  return map;
}

// ---------- distribution / capital ----------

function profitHistogram(profits, bins = 8) {
  if (!profits.length) return [];
  const min = Math.min(...profits), max = Math.max(...profits);
  if (max === min) return [{ from: min, to: max, count: profits.length }];
  const step = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: min + step * i, to: min + step * (i + 1), count: 0 }));
  for (const p of profits) {
    const i = Math.min(bins - 1, Math.floor((p - min) / step));
    out[i].count += 1;
  }
  return out;
}

// Size of a trade in ₽: the AVERAGE entry value of its legs, not their sum.
// The legs of an arbitrage trade are two sides of one position, so their sum
// double-counts it; the average reads as "a position of this size on each
// side". Each leg converts by its own price currency — multiplying the whole
// sum by the rate inflated rouble-quoted legs (SI, CR) by the rate itself and
// threw them into the top capital band.
function capitalDeployed(trade) {
  return calc.positionStartAvgRub(trade);
}

const CAPITAL_EDGES = [1e6, 3e6, 1e7];
const compactRub = (v) => (v >= 1e6 ? `${v / 1e6} млн` : `${Math.round(v / 1e3)}к`);

// closed trades bucketed by deployed capital (₽) -> [{ label, profit, count, wins }]
function capitalBuckets(trades, edges = CAPITAL_EDGES) {
  const buckets = edges.map((e, i) => ({
    label: i === 0 ? `< ${compactRub(e)}` : `${compactRub(edges[i - 1])}–${compactRub(e)}`,
    profit: 0, count: 0, wins: 0,
  }));
  buckets.push({ label: `> ${compactRub(edges[edges.length - 1])}`, profit: 0, count: 0, wins: 0 });
  for (const t of closedOnly(trades)) {
    const cap = capitalDeployed(t);
    let i = edges.findIndex((e) => cap < e);
    if (i === -1) i = edges.length;
    const b = buckets[i];
    const np = profitOf(t);
    b.profit += np; b.count += 1; if (np > 0) b.wins += 1;
  }
  return buckets;
}

// ---------- where the profit actually comes from ----------

// Every article that stands between the raw price move and what the diary
// counts as profit, summed over the closed trades and expressed in ₽:
// gross − fees + payout + swap + fix = net. `fees` is kept positive, as the
// cost it is; the waterfall draws it downwards.
function profitStructure(trades) {
  const s = { gross: 0, fees: 0, payout: 0, swap: 0, adjustment: 0, net: 0 };
  for (const t of closedOnly(trades)) {
    for (const leg of t.legs) s.gross += calc.legGrossRub(leg, t.usdRub);
    s.fees += calc.feeTotalRub(t);
    s.payout += Number(t.payout || 0);
    s.swap += calc.swapTotalRub(t);
    s.adjustment += Number(t.adjustment || 0);
  }
  s.net = s.gross - s.fees + s.payout + s.swap + s.adjustment;
  return s;
}

// mean net return on deployed capital across closed trades (fraction, e.g. 0.005 = 0,5%)
function avgReturnPct(trades) {
  const pcts = closedOnly(trades).map((t) => calc.pnlNetPct(t)).filter((v) => v !== null);
  return pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null;
}

// ---------- period filter ----------

// 'all' | 'month' | 'quarter' | 'year'; open trades survive every window
function filterByPeriod(trades, period, now = new Date()) {
  if (period === 'all' || !period) return trades.slice();
  const y = now.getFullYear(), m = now.getMonth();
  const start = period === 'month' ? `${y}-${pad2(m + 1)}-01`
    : period === 'quarter' ? `${y}-${pad2(Math.floor(m / 3) * 3 + 1)}-01`
      : `${y}-01-01`;
  return trades.filter((t) => !t.closeDate || t.closeDate >= start);
}

const _api = {
  groupBy,
  profitFactor, expectancy, avgWin, avgLoss,
  spreadBuckets,
  holdingDays, holdingBuckets,
  byMonth, byWeekday, calendarMap,
  profitHistogram, capitalDeployed, capitalBuckets, avgReturnPct, profitStructure,
  filterByPeriod,
  MONTHS, WEEKDAYS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.analytics = _api;
})();
