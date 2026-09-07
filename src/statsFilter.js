'use strict';

// The extra windows the stats tab can be narrowed by: dates, ticker, tag,
// exchange, weekday, trade size and the three spreads. Pure functions over the
// trade list — the renderer only draws the controls and shows what comes back.
// IIFE-scoped for the same reason as analytics.js: in the renderer this file is
// a classic script sharing one global scope with calc.js.
(function () {

const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const asUTC = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Monday-first, like the weekday widget in analytics.js. An open trade has no
// day yet, hence null.
function weekdayOf(trade) {
  if (!trade.closeDate) return null;
  return WEEKDAYS[(new Date(asUTC(trade.closeDate)).getUTCDay() + 6) % 7];
}

// A value window: { mode: 'include' | 'exclude', values: [...] }, empty = off.
// A number window: { min, max }, either end null = unbounded.
const EMPTY = {
  from: '', to: '',
  ticker: { mode: 'include', values: [] },
  tag: { mode: 'include', values: [] },
  exchange: { mode: 'include', values: [] },
  weekday: { mode: 'include', values: [] },
  size: { min: null, max: null },
  entrySpread: { min: null, max: null },
  exitSpread: { min: null, max: null },
  collected: { min: null, max: null },
};

const VALUE_DIMS = ['ticker', 'tag', 'exchange', 'weekday'];
const RANGE_DIMS = ['size', 'entrySpread', 'exitSpread', 'collected'];

const chosen = (spec) => (spec && spec.values ? spec.values : []);
const bound = (v) => (v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)));
const bounded = (range) => Boolean(range) && (bound(range.min) || bound(range.max));

// A trade that cannot answer — no weekday because it is still open, no exit
// spread because it has no exit — passes rather than disappears, the way open
// trades have always survived the period chips.
function matchesValue(spec, value) {
  const values = chosen(spec);
  if (!values.length || value === null) return true;
  return values.includes(value) === (spec.mode !== 'exclude');
}

// An exchange belongs to a leg, not to the trade: keeping «MOEX» keeps every
// trade with a MOEX leg, dropping it drops every one of them.
function matchesAny(spec, list) {
  const values = chosen(spec);
  if (!values.length) return true;
  return list.some((v) => values.includes(v)) === (spec.mode !== 'exclude');
}

function inRange(range, value) {
  if (!bounded(range)) return true;
  if (value === null || value === undefined || Number.isNaN(value)) return true;
  if (bound(range.min) && value < Number(range.min)) return false;
  if (bound(range.max) && value > Number(range.max)) return false;
  return true;
}

// Percent, and by size rather than by sign: which leg the diary happens to list
// first decides the sign of an entry or exit spread, so "between 0,5 and 1,5"
// means the distance. The collected spread is the exception — its sign is the
// trade's own result, so it stays signed and a loss reads below zero.
const magnitudePct = (v) => (v === null ? null : Math.abs(v) * 100);
const signedPct = (v) => (v === null ? null : v * 100);

function apply(trades, filter = {}) {
  const f = { ...EMPTY, ...filter };
  return trades.filter((t) => {
    if (f.from && t.closeDate && t.closeDate < f.from) return false;
    if (f.to && t.closeDate && t.closeDate > f.to) return false;
    if (!matchesValue(f.ticker, t.ticker || '')) return false;
    if (!matchesValue(f.tag, t.tag || '')) return false;
    if (!matchesValue(f.weekday, weekdayOf(t))) return false;
    if (!matchesAny(f.exchange, t.legs.map((l) => l.exchange || ''))) return false;
    if (!inRange(f.size, calc.positionStartAvgRub(t))) return false;
    if (!inRange(f.entrySpread, magnitudePct(calc.entrySpread(t)))) return false;
    if (!inRange(f.exitSpread, magnitudePct(calc.exitSpread(t)))) return false;
    if (!inRange(f.collected, signedPct(calc.spreadCollected(t)))) return false;
    return true;
  });
}

// How many windows are actually narrowing anything — the number the «Фильтры»
// button carries. The two date fields are one window between them.
function activeCount(filter = {}) {
  const f = { ...EMPTY, ...filter };
  let n = (f.from || f.to) ? 1 : 0;
  for (const dim of VALUE_DIMS) if (chosen(f[dim]).length) n += 1;
  for (const dim of RANGE_DIMS) if (bounded(f[dim])) n += 1;
  return n;
}

// What the pickers offer: [[value, trades carrying it]], values in the order a
// reader expects — alphabetical, except weekdays, which run Monday to Sunday.
function options(trades) {
  const count = (pick) => {
    const map = new Map();
    for (const t of trades) {
      for (const v of new Set(pick(t))) {
        if (v === null) continue;
        map.set(v, (map.get(v) || 0) + 1);
      }
    }
    return map;
  };
  const alpha = (map) => [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ru'));
  const exchanges = count((t) => t.legs.map((l) => l.exchange || ''));
  const weekdays = count((t) => [weekdayOf(t)]);
  return {
    ticker: alpha(count((t) => [t.ticker || ''])),
    tag: alpha(count((t) => [t.tag || ''])),
    exchange: alpha(exchanges),
    weekday: WEEKDAYS.filter((d) => weekdays.has(d)).map((d) => [d, weekdays.get(d)]),
  };
}

const _api = { EMPTY, apply, activeCount, options, weekdayOf, VALUE_DIMS, RANGE_DIMS, WEEKDAYS };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.statsFilter = _api;
})();
