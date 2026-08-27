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
