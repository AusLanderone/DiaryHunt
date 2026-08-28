'use strict';

const calc = require('./calc');

const HEADER = [
  '№', 'Дата открытия', 'Дата закрытия', 'Тип', 'Тикер', 'Тег',
  'Биржа', 'Сделка', 'Цена вход', 'Кол единиц', 'Цена выход', 'Комса', 'Своп', 'Своп валюта', 'Своп руб',
  'Позиция начало', 'Вход спред', 'Выход спред', 'Спред итог', 'Позиция конец',
  'PnL gross', 'PnL net', 'PnL руб', '% PnL net', 'USDRUB', 'Payout',
  'Чистый профит', 'Комментарий',
];

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tradesToCsv(trades) {
  const lines = [HEADER.map(cell).join(',')];
  for (const trade of trades) {
    const c = calc.computeTrade(trade);
    trade.legs.forEach((leg, i) => {
      const first = i === 0;
      const lc = c.legs[i];
      lines.push([
        first ? trade.num : '',
        first ? trade.openDate : '',
        first ? trade.closeDate : '',
        first ? trade.type : '',
        first ? trade.ticker : '',
        first ? trade.tag : '',
        leg.exchange,
        leg.side,
        leg.entryPrice,
        leg.units,
        leg.exitPrice,
        leg.feeRub,
        leg.swap ?? leg.swapRub ?? 0,
        calc.isRubLeg(leg) ? 'RUB' : 'USD',
        lc.swapRub,
        lc.start,
        first ? c.entrySpread : '',
        first ? c.exitSpread : '',
        first ? c.spreadTotal : '',
        lc.end,
        lc.gross,
        first ? c.pnlNet : '',
        first ? c.pnlRub : '',
        first ? c.pnlNetPct : '',
        first ? trade.usdRub : '',
        first ? trade.payout : '',
        first ? c.netProfitRub : '',
        first ? trade.comment : '',
      ].map(cell).join(','));
    });
  }
  return lines.join('\n');
}

module.exports = { tradesToCsv };
