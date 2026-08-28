'use strict';

// What the journal tab shows: which trades, in what order, grouped how.
// Pure functions over the trade list — the renderer only draws the result.
// IIFE-scoped for the same reason as analytics.js: in the renderer this file
// is a classic script sharing one global scope with calc.js.
(function () {

const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- filtering ----------

const haystack = (t) => [t.ticker, t.tag, t.type, t.comment, String(t.num)]
  .filter(Boolean).join(' ').toLowerCase();

function periodStart(period, now) {
  const y = now.getFullYear(), m = now.getMonth();
  if (period === 'month') return `${y}-${pad2(m + 1)}-01`;
  if (period === 'quarter') return `${y}-${pad2(Math.floor(m / 3) * 3 + 1)}-01`;
  if (period === 'year') return `${y}-01-01`;
  return null;
}

// { query, status: all|open|closed, tag: all|<tag>, period: all|month|quarter|year }
function filterTrades(trades, filter = {}, now = new Date()) {
  const q = (filter.query || '').trim().toLowerCase();
  const start = periodStart(filter.period, now);
  return trades.filter((t) => {
    if (q && !haystack(t).includes(q)) return false;
    if (filter.status === 'open' && calc.isClosed(t)) return false;
    if (filter.status === 'closed' && !calc.isClosed(t)) return false;
    if (filter.tag && filter.tag !== 'all' && (t.tag || '') !== filter.tag) return false;
    if (start && (t.openDate || '') < start) return false;
    return true;
  });
}

// ---------- sorting ----------

const SORT_VALUE = {
  num: (t) => t.num,
  date: (t) => t.openDate || '',
  ticker: (t) => (t.ticker || '').toLowerCase(),
  spread: (t) => calc.entrySpread(t),
  profit: (t) => (calc.isClosed(t) ? calc.netProfitRub(t) : null),
};

// Open trades have no profit to compare, so they always sit at the bottom
// rather than flipping to the top when the direction changes.
function sortTrades(trades, key = 'num', dir = 'desc') {
  const value = SORT_VALUE[key] || SORT_VALUE.num;
  const sign = dir === 'asc' ? 1 : -1;
  return trades.slice().sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === null && vb === null) return a.num - b.num;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return a.num - b.num;
  });
}

// ---------- grouping ----------

// [{ key: '2026-08', label: 'август 2026', trades, count, openCount, profit }]
// Months run newest first; inside a month the given order is kept, so the
// active sort still decides what the reader sees at the top of each block.
function groupByMonth(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = String(t.openDate || '').slice(0, 7) || '—';
    if (!map.has(key)) {
      const [y, m] = key.split('-');
      map.set(key, {
        key,
        label: MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : 'без даты',
        trades: [], count: 0, openCount: 0, profit: 0,
      });
    }
    const g = map.get(key);
    g.trades.push(t);
    g.count += 1;
    if (calc.isClosed(t)) g.profit += calc.netProfitRub(t);
    else g.openCount += 1;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

// ---------- footer summary ----------

function summarize(trades) {
  const closed = trades.filter((t) => calc.isClosed(t));
  const profits = closed.map((t) => calc.netProfitRub(t));
  const wins = profits.filter((p) => p > 0).length;
  return {
    count: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    wins,
    winrate: closed.length ? (wins / closed.length) * 100 : null,
    total: profits.reduce((s, v) => s + v, 0),
  };
}

const _api = { filterTrades, sortTrades, groupByMonth, summarize, MONTHS };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.journalView = _api;
})();
