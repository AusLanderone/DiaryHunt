'use strict';

// The order the stats widgets stand in. The app ships one, the reader drags
// the cards into another, and it is kept with the rest of the settings.
// IIFE-scoped like the other shared modules: in the renderer this is a classic
// script sharing one global scope with calc.js.
(function () {

const DEFAULT_ORDER = [
  'equity', 'days', 'hist', 'fees', 'calendar',
  'spread', 'hold', 'capital', 'weekday', 'ticker', 'tag', 'months',
];

// What a saved order turns into: the arrangement that was made, minus widgets
// that no longer exist, plus any the saved order never heard of. A new widget
// lands at the end rather than in the middle of someone's layout — visible,
// and not in the way.
function normalize(saved, known = DEFAULT_ORDER) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(saved) ? saved : []) {
    if (known.includes(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  for (const id of known) {
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// Dropping one card on another gives it that card's place: pulled out of the
// list, then put back where the target stood. Dragged down, it lands after the
// target; dragged up, before it — which is what the hand expects either way.
function move(order, dragged, target) {
  const list = [...order];
  const from = list.indexOf(dragged);
  const to = list.indexOf(target);
  if (from === -1 || to === -1 || dragged === target) return list;
  list.splice(from, 1);
  list.splice(to, 0, dragged);
  return list;
}

const _api = { DEFAULT_ORDER, normalize, move };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.widgetOrder = _api;
})();
