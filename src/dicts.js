'use strict';

// The four dictionaries behind the editable dropdowns: what a value list holds,
// what the trades add to it, and what the user has hidden. Pure functions — the
// form fills its datalists from here, the settings screen draws rows from here.
// IIFE-scoped like calc.js/analytics.js: in the renderer this is a classic
// script sharing one global scope.
(function () {

// key -> where the value lives on a trade, and what to call the list on screen
const KINDS = [
  { key: 'types', label: 'Типы', pick: (t) => [t.type] },
  { key: 'tickers', label: 'Тикеры', pick: (t) => [t.ticker] },
  { key: 'tags', label: 'Теги', pick: (t) => [t.tag] },
  { key: 'exchanges', label: 'Биржи', pick: (t) => (t.legs || []).map((l) => l.exchange) },
];

const kindOf = (key) => KINDS.find((k) => k.key === key);

const hiddenOf = (key, cfg) => ((cfg && cfg.hidden && cfg.hidden[key]) || []).slice();

// every value the trades carry for this dictionary, blanks dropped
function inTrades(key, trades) {
  const pick = kindOf(key).pick;
  return (trades || []).flatMap(pick).filter(Boolean);
}

// what a dropdown offers: the dictionary plus what the diary already holds,
// minus whatever was hidden. Sorted, so the same list reads the same everywhere.
function options(key, cfg, trades) {
  const hidden = new Set(hiddenOf(key, cfg));
  const all = [...((cfg && cfg[key]) || []), ...inTrades(key, trades)];
  return [...new Set(all.filter((v) => v && !hidden.has(v)))].sort((a, b) => a.localeCompare(b, 'ru'));
}

// one row per offered value: is it in the dictionary itself, and how many
// trades use it — the settings screen needs both to explain what a removal does
function rows(key, cfg, trades) {
  const dict = new Set(((cfg && cfg[key]) || []).filter(Boolean));
  const counts = new Map();
  for (const v of inTrades(key, trades)) counts.set(v, (counts.get(v) || 0) + 1);
  return options(key, cfg, trades).map((value) => ({
    value, count: counts.get(value) || 0, inDict: dict.has(value),
  }));
}

const _api = { KINDS, options, rows, hiddenOf, inTrades };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.dicts = _api;
})();
