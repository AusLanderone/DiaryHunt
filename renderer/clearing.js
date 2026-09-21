'use strict';

// Catching up on the variation margin, without anyone pressing anything.
//
// Every closed MOEX leg should carry the roubles the exchange actually credited.
// One can go missing for ordinary reasons — a backup was restored, the app was
// offline, the trade closed before MOEX published the day — so the diary looks
// for the gaps itself and fills them: on startup, after a trade is saved, and
// from the button in the settings. Whatever fails stays in the queue and is
// picked up next time round.
(function () {
  const Q = () => window.clearingQueue;

  // A leg the exchange could not answer for — a trade closed today, a ticker it
  // does not know — stays in the queue. Remembering the failures for the rest of
  // the session keeps the diary from asking again on every redraw; a restart
  // tries them all afresh, which is when a new day's history has appeared.
  const refused = new Set();
  const key = (item) => `${item.id}:${item.index}`;

  async function runClearing(trades, onProgress) {
    const todo = Q().pending(trades).filter((item) => !refused.has(key(item)));
    const failed = [];
    let done = 0;
    if (!todo.length) return { total: 0, done: 0, failed };

    // one trade at a time: the history cache makes a repeat pass almost free,
    // and a burst of requests is no faster than MOEX answers anyway
    const byTrade = new Map();
    for (const item of todo) {
      if (!byTrade.has(item.id)) byTrade.set(item.id, []);
      byTrade.get(item.id).push(item);
    }

    for (const [id, items] of byTrade) {
      const trade = trades.find((t) => t.id === id);
      if (!trade) continue;
      if (onProgress) onProgress({ total: todo.length, done, trade });
      const legs = trade.legs.map((l) => ({ ...l }));
      let changed = false;
      for (const item of items) {
        const leg = legs[item.index];
        const r = await window.api.market.legMargin({
          trade: { ticker: trade.ticker, openDate: trade.openDate, closeDate: trade.closeDate },
          leg, secid: leg.secid || undefined,
        });
        done++;
        if (!r.ok) { failed.push(`№${trade.num}: ${r.error}`); refused.add(key(item)); continue; }
        leg.secid = r.secid;
        leg.vmRub = r.rub;
        leg.vmMeta = { secid: r.secid, sessions: r.sessions,
          fingerprint: r.fingerprint, computedAt: r.computedAt };
        changed = true;
      }
      if (changed) await window.api.trades.update(trade.id, { legs });
    }
    if (onProgress) onProgress({ total: todo.length, done, trade: null });
    return { total: todo.length, done: done - failed.length, failed };
  }

  // pending work the diary has not been refused on yet
  const outstanding = (trades) => Q().pending(trades).filter((item) => !refused.has(key(item))).length;

  window.clearing = { runClearing, outstanding };
})();
