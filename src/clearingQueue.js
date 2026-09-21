'use strict';

// What still needs its variation margin worked out.
//
// The diary computes a MOEX leg's roubles from the exchange's own clearing
// history, but a trade can arrive without that figure: imported from a backup,
// entered while offline, or closed on a day MOEX had not yet published. This
// picks out exactly those legs, so the app can quietly catch up on its own
// instead of asking anyone to type a number.
//
// IIFE-scoped like analytics.js and balances.js: in the renderer this file is a
// classic script sharing one global scope with calc.js, and `_api` is taken.
(function () {

const calc = (typeof module !== 'undefined' && module.exports)
  ? require('./calc')
  : (typeof window !== 'undefined' ? window.calc : null);

function needsClearing(leg, trade) {
  if (!calc.isRubLeg(leg)) return false;            // only the venue that pays in roubles
  if (!calc.legIsClosed(leg, trade)) return false;  // an open leg has nothing final yet
  if (calc.legPnlFactRub(leg) !== null) return false; // a broker figure already wins
  return calc.legVmRub(leg, trade) === null;        // missing, or stale and dropped
}

// An open position is a moving target: the exchange adds a session every
// evening, so its accrual is refreshed once a day rather than computed once.
function needsOpenClearing(leg, trade, today) {
  if (!calc.isRubLeg(leg)) return false;
  if (calc.legIsClosed(leg, trade)) return false;         // a closed leg has the real figure
  if (!calc.legFills(leg, trade).length) return false;    // nothing entered yet
  if (calc.legInterimRub(leg, trade) === null) return true;
  const at = String((leg.vmOpenMeta && leg.vmOpenMeta.computedAt) || '').slice(0, 10);
  return at !== String(today || new Date().toISOString().slice(0, 10));
}

function pendingOpen(trades, today) {
  const out = [];
  for (const trade of (trades || [])) {
    if (!trade || !Array.isArray(trade.legs) || trade.closeDate) continue;
    trade.legs.forEach((leg, index) => {
      if (needsOpenClearing(leg, trade, today)) out.push({ id: trade.id, num: trade.num, index, ticker: trade.ticker });
    });
  }
  return out.sort((a, b) => (a.num || 0) - (b.num || 0));
}

// Legs to compute, oldest trade first — the cache warms in the order the
// history is read, and a long journal shows progress from the top.
function pending(trades) {
  const out = [];
  for (const trade of (trades || [])) {
    if (!trade || !Array.isArray(trade.legs) || !trade.closeDate) continue;
    trade.legs.forEach((leg, index) => {
      if (needsClearing(leg, trade)) out.push({ id: trade.id, num: trade.num, index, ticker: trade.ticker });
    });
  }
  return out.sort((a, b) => (a.num || 0) - (b.num || 0));
}

const _api = { pending, needsClearing, pendingOpen, needsOpenClearing };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.clearingQueue = _api;
})();
