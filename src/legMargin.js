'use strict';

const rates = require('./rates');
const vm = require('./variationMargin');
const calc = require('./calc');

// Puts the pieces together for one MOEX leg: find the contract, read its
// settlement prices and the official rate day by day, then hand both to the
// pure sum in variationMargin.js. Network access arrives as `get` and the disk
// cache as `cache`, so the whole flow is testable without either.

const shift = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function computeLegMargin({ get, cache, today, trade, leg, secid }) {
  if (!calc.legIsClosed(leg, trade)) {
    throw new Error('Нога не закрыта: вариационную маржу считать не из чего');
  }
  // the span is the leg's own: with several fills it can be narrower than the
  // trade, and the contract is the one traded on the day of the first fill
  const fills = calc.legFills(leg, trade);
  const openDate = fills[0].date || trade.openDate;
  const closeDate = fills[fills.length - 1].date || trade.closeDate;
  if (!openDate || !closeDate) {
    throw new Error('У ноги нет дат исполнения: вариационную маржу считать не из чего');
  }
  const assetCode = String(trade.ticker || '').trim().toUpperCase();
  // a range that reaches today is still moving — today's clearing has not happened
  const settled = (till) => String(till) < String(today || new Date().toISOString().slice(0, 10));

  let contract = secid ? { secid: String(secid).toUpperCase(), settle: null } : null;
  if (!contract) {
    const rows = await cache.remember(`contracts|${assetCode}|${openDate}`, settled(openDate),
      () => rates.fetchContracts({ get, assetCode, date: openDate }));
    contract = vm.pickContract(rows || [], fills[0].price);
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

  const out = vm.compute({ leg, openDate, closeDate, settles: settles || [], rates: series || [] });
  if (!out) {
    throw new Error(`Не хватает данных: курс ЦБ или расчётные цены ${contract.secid} за ${openDate}—${closeDate}`);
  }
  return { ...out, secid: contract.secid, assetCode, computedAt: new Date().toISOString() };
}

module.exports = { computeLegMargin };
