// test/rates.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const rates = require('../src/rates');

// Shape of https://iss.moex.com/iss/.../USDRUBF.json (columns + row arrays)
const moexJson = (over = {}) => JSON.stringify({
  marketdata: {
    columns: ['SECID', 'LAST', 'SETTLEPRICE', 'UPDATETIME'],
    data: [['USDRUBF', over.last === undefined ? 85.52 : over.last,
      over.settle === undefined ? 85.5 : over.settle,
      over.time === undefined ? '13:51:01' : over.time]],
  },
});

// Shape of https://www.cbr.ru/scripts/XML_daily.asp (windows-1251, comma decimals)
const cbrXml = (value = '85,9541', date = '28.08.2026') =>
  `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="${date}" name="Foreign Currency Market">` +
  `<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal>` +
  `<Name>Доллар США</Name><Value>${value}</Value><VunitRate>${value}</VunitRate></Valute>` +
  `<Valute ID="R01239"><CharCode>EUR</CharCode><Value>99,1234</Value></Valute></ValCurs>`;

test('parseMoex — takes the last traded price of the perpetual future', () => {
  const r = rates.parseMoex(moexJson());
  assert.strictEqual(r.rate, 85.52);
  assert.match(r.source, /MOEX/);
  assert.strictEqual(r.time, '13:51:01');
});

test('parseMoex — falls back to the settle price outside trading hours', () => {
  const r = rates.parseMoex(moexJson({ last: null }));
  assert.strictEqual(r.rate, 85.5);
});

test('parseMoex — returns null when neither price is quoted', () => {
  assert.strictEqual(rates.parseMoex(moexJson({ last: null, settle: null })), null);
  assert.strictEqual(rates.parseMoex('{"marketdata":{"columns":[],"data":[]}}'), null);
  assert.strictEqual(rates.parseMoex('not json'), null);
});

test('parseCbr — reads the USD row and converts the comma decimal', () => {
  const r = rates.parseCbr(cbrXml());
  assert.strictEqual(r.rate, 85.9541);
  assert.match(r.source, /ЦБ/);
  assert.strictEqual(r.date, '28.08.2026');
});

test('parseCbr — returns null when the USD row is missing', () => {
  assert.strictEqual(rates.parseCbr('<ValCurs></ValCurs>'), null);
  assert.strictEqual(rates.parseCbr(''), null);
});

test('fetchUsdRub — uses MOEX and never asks the CBR when the market answers', async () => {
  const asked = [];
  const r = await rates.fetchUsdRub({ get: async (url) => { asked.push(url); return moexJson(); } });
  assert.strictEqual(r.rate, 85.52);
  assert.strictEqual(asked.length, 1);
  assert.match(asked[0], /moex/i);
});

test('fetchUsdRub — falls back to the CBR when MOEX fails', async () => {
  const r = await rates.fetchUsdRub({
    get: async (url) => {
      if (/moex/i.test(url)) throw new Error('network down');
      return cbrXml();
    },
  });
  assert.strictEqual(r.rate, 85.9541);
  assert.match(r.source, /ЦБ/);
});

test('fetchUsdRub — falls back to the CBR when MOEX answers without a price', async () => {
  const r = await rates.fetchUsdRub({
    get: async (url) => (/moex/i.test(url) ? moexJson({ last: null, settle: null }) : cbrXml()),
  });
  assert.strictEqual(r.rate, 85.9541);
});

test('fetchUsdRub — rejects with a readable message when both sources fail', async () => {
  await assert.rejects(
    rates.fetchUsdRub({ get: async () => { throw new Error('offline'); } }),
    (err) => /курс/i.test(err.message),
  );
});
