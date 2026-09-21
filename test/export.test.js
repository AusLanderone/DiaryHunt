const { test } = require('node:test');
const assert = require('node:assert');
const { tradesToCsv } = require('../src/export');

const trade1 = {
  num: 1, openDate: '2026-08-13', closeDate: '2026-08-13', type: 'Фьючи',
  ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: -295, adjustment: 0,
  comment: 'hi, there', legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
};

test('csv has header plus two rows per trade', () => {
  const csv = tradesToCsv([trade1]);
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines.length, 3); // header + 2 legs
  assert.ok(lines[0].startsWith('№,Дата открытия'));
});

test('leg1 row carries trade-level fields, leg2 row blanks them', () => {
  const rows = tradesToCsv([trade1]).trim().split('\n');
  const leg1 = rows[1].split(',');
  assert.strictEqual(leg1[0], '1');          // №
  assert.strictEqual(leg1[4], 'ED');         // Тикер
  const leg2 = rows[2];
  assert.ok(leg2.startsWith(',,,,,,FOREX')); // leading trade-level cells blank, then Биржа
});

test('fields with commas are quoted', () => {
  const csv = tradesToCsv([trade1]);
  assert.ok(csv.includes('"hi, there"'));
});

test('csv — a leg row carries its role and price currency', () => {
  const csv = tradesToCsv([{
    num: 7, openDate: '2026-08-28', closeDate: '2026-08-28', ticker: 'TRI', tag: '', type: '',
    usdRub: 85, payout: 0, adjustment: 0, comment: '',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85600, feeRub: 0, role: 'mul', priceCcy: 'RUB' },
      { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.18, units: 1, exitPrice: 7.17, feeRub: 0, role: 'div', priceCcy: 'USD' },
    ],
  }]);
  const [header, first, second] = csv.split('\n');
  assert.ok(header.includes('Роль'), header);
  assert.ok(header.includes('Валюта цены'), header);
  assert.ok(first.includes('mul') && first.includes('RUB'), first);
  assert.ok(second.includes('div') && second.includes('USD'), second);
});

test('csv — the collected spread rides along with the entry/exit spreads', () => {
  const rows = tradesToCsv([trade1]).trim().split('\n');
  const head = rows[0].split(',');
  const i = head.indexOf('Спред собран');
  assert.ok(i > head.indexOf('Спред итог'), 'the column is there, after the directional total');
  const cells = rows[1].split(',');
  assert.ok(Number(cells[i]) > 0, `collected spread ${cells[i]} must be positive on a winning trade`);
  assert.strictEqual(rows[2].split(',')[i], '');   // trade-level, so only the first leg row carries it
});

test('csv carries the rouble side of a leg', () => {
  const csv = tradesToCsv([{
    num: 23, openDate: '2026-09-21', closeDate: '2026-09-21', ticker: 'GOLD', usdRub: 84.2,
    legs: [
      { exchange: 'MOEX', side: 'Шорт', entryPrice: 4427.2, units: 21, exitPrice: 4420.42,
        feeRub: 180, rateRub: 110.89, pnlFactRub: 15788.4 },
      { exchange: 'FOREX', side: 'Лонг', entryPrice: 4351.95, units: 20, exitPrice: 4345.02, feeRub: 105 },
    ],
  }]);
  const [head, moex, forex] = csv.trim().split('\n');
  const col = (line, name) => line.split(',')[head.split(',').indexOf(name)];
  assert.strictEqual(col(moex, '₽ за пункт'), '110.89');
  assert.strictEqual(col(moex, 'Факт PnL ₽'), '15788.4');
  assert.strictEqual(col(moex, 'PnL ноги ₽'), '15788.4');
  assert.strictEqual(col(forex, '₽ за пункт'), '84.2', 'a leg without its own rate reports the trade rate');
  assert.strictEqual(col(forex, 'Факт PnL ₽'), '', 'and no fact');
});
