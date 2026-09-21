'use strict';

const rates = require('./rates');
const vm = require('./variationMargin');
const calc = require('./calc');

// Puts the pieces together for one MOEX leg: find the contract, read its
// settlement prices and the official rate day by day, then hand both to the
// pure sum in variationMargin.js. Network access arrives as `get` and the disk
// cache as `cache`, so the whole flow is testable without either.

// how far back the contract lookup may walk: a long holiday stretch plus a bit
const LOOKBACK_DAYS = 10;

const shift = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function computeLegMargin({ get, cache, today, trade, leg, secid, open }) {
  const day = today || new Date().toISOString().slice(0, 10);
  if (!open && !calc.legIsClosed(leg, trade)) {
    throw new Error('Нога не закрыта: вариационную маржу считать не из чего');
  }
  // the span is the leg's own: with several fills it can be narrower than the
  // trade, and the contract is the one traded on the day of the first fill.
  // An open leg runs to today — whatever the exchange has published by now.
  const fills = calc.legFills(leg, trade);
  const openDate = fills[0].date || trade.openDate;
  const closeDate = open ? day : (fills[fills.length - 1].date || trade.closeDate);
  if (!openDate || !closeDate) {
    throw new Error('У ноги нет дат исполнения: вариационную маржу считать не из чего');
  }
  const assetCode = String(trade.ticker || '').trim().toUpperCase();
  // a range that reaches today is still moving — today's clearing has not happened
  const settled = (till) => String(till) < String(day);

  let contract = secid ? { secid: String(secid).toUpperCase(), settle: null } : null;
  let contractAsOf = null;
  if (!contract) {
    // The list of what traded on a day appears only after that day's evening
    // clearing, and never for a weekend — so the lookup walks back until the
    // exchange has something to say. The series is the same either way: a
    // contract does not change identity between Friday and Monday.
    for (let back = 0; back <= LOOKBACK_DAYS && !contract; back++) {
      const day = shift(openDate, -back);
      const rows = await cache.remember(`contracts|${assetCode}|${day}`, settled(day),
        () => rates.fetchContracts({ get, assetCode, date: day }));
      contract = vm.pickContract(rows || [], fills[0].price);
      if (contract) contractAsOf = day;
    }
    if (!contract) {
      throw new Error(`MOEX не знает контракт «${assetCode}» на ${openDate} — впишите код контракта вручную`);
    }
  }

  const settles = await cache.remember(`settles|${contract.secid}|${openDate}|${closeDate}`, settled(closeDate),
    () => rates.fetchSettles({ get, secid: contract.secid, from: openDate, till: closeDate }));

  // the rate in force on the open day may have been published days earlier
  const from = shift(openDate, -10);
  const series = await cache.remember(`cbr|${from}|${closeDate}`, settled(closeDate),
    () => rates.fetchCbrSeries({ get, from, till: closeDate }));

  // An open position is worth marking today as well, but today's clearing has
  // not happened — so the last price the exchange has shown stands in for it.
  // It runs about fifteen minutes behind, hence the stamp that travels with it.
  const marks = (settles || []).slice();
  let live = null;
  if (open && !marks.some((m) => String(m.date) === day)) {
    try {
      const last = await rates.fetchLast({ get, secid: contract.secid });
      if (last && last.price > 0) {
        live = { price: last.price, time: last.time, systime: last.systime };
        marks.push({ date: day, settle: last.price });
      }
    } catch {
      /* no live price is not an error: the accrual simply stops at the last clearing */
    }
  }

  const out = vm.compute({ leg, openDate, closeDate, settles: marks, rates: series || [], open });
  if (!out) {
    throw new Error(`Не хватает данных: курс ЦБ или расчётные цены ${contract.secid} за ${openDate}—${closeDate}`);
  }
  // when the last mark is the live price, say so — it is a quote, not a clearing
  const liveIncluded = Boolean(live && out.through === day);
  return { ...out, secid: contract.secid, assetCode, contractAsOf,
    // the fingerprint describes the LEG AS IT STANDS, not the window it was read
    // over: an open leg has no closing date, and borrowing today's would make
    // the figure look stale the moment it was stored
    fingerprint: calc.vmFingerprint(leg, trade),
    live: liveIncluded ? { price: live.price, time: live.time } : null,
    computedAt: new Date().toISOString() };
}

module.exports = { computeLegMargin };
