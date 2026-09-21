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

// ---------- price step value (roubles per point of price) ----------
//
// The FORTS securities feed carries MINSTEP and STEPPRICE for every contract:
// the price step and what one step pays in roubles. Their ratio is the rouble
// value of one point — the multiplier a dollar-quoted MOEX leg is paid by.
const fortsFeed = JSON.stringify({
  securities: {
    columns: ['SECID', 'SHORTNAME', 'ASSETCODE', 'LASTTRADEDATE', 'MINSTEP', 'STEPPRICE'],
    data: [
      ['GDZ6', 'GOLD-12.26', 'GOLD', '2026-12-17', 0.1, 11.089],
      ['GDU6', 'GOLD-9.26', 'GOLD', '2026-09-17', 0.1, 10.5],      // already expired
      ['GDH7', 'GOLD-3.27', 'GOLD', '2027-03-18', 0.1, 11.2],      // further out
      ['SVZ6', 'SILV-12.26', 'SILV', '2026-12-17', 0.01, 0.842],
      ['BROKEN', 'X-12.26', 'XXX', '2026-12-17', 0, 0],
    ],
  },
});

test('parseStepPrice — the nearest live contract of the asset', () => {
  const r = rates.parseStepPrice(fortsFeed, 'GOLD', '2026-09-21');
  assert.strictEqual(r.secid, 'GDZ6');
  assert.strictEqual(r.shortName, 'GOLD-12.26');
  assert.ok(Math.abs(r.pointValue - 110.89) < 1e-6, `${r.pointValue}`);
  assert.strictEqual(r.lastTradeDate, '2026-12-17');
});

test('parseStepPrice — a contract can be asked for by its own code', () => {
  const r = rates.parseStepPrice(fortsFeed, 'gdh7', '2026-09-21');
  assert.strictEqual(r.secid, 'GDH7');
  assert.ok(Math.abs(r.pointValue - 112) < 1e-6);
});

test('parseStepPrice — a different step, a different point value', () => {
  const r = rates.parseStepPrice(fortsFeed, 'SILV', '2026-09-21');
  assert.ok(Math.abs(r.pointValue - 84.2) < 1e-6, `${r.pointValue}`);
});

test('parseStepPrice — nothing to report beats a wrong number', () => {
  assert.strictEqual(rates.parseStepPrice(fortsFeed, 'XXX', '2026-09-21'), null); // no step value
  assert.strictEqual(rates.parseStepPrice(fortsFeed, 'ED', '2026-09-21'), null);  // not listed
  assert.strictEqual(rates.parseStepPrice('not json', 'GOLD', '2026-09-21'), null);
  assert.strictEqual(rates.parseStepPrice(JSON.stringify({}), 'GOLD', '2026-09-21'), null);
});

test('parseStepPrice — when every contract has expired, the last one still answers', () => {
  const r = rates.parseStepPrice(fortsFeed, 'GOLD', '2028-01-01');
  assert.strictEqual(r.secid, 'GDH7');
  assert.strictEqual(r.expired, true);
});

test('fetchPointValue — asks the FORTS feed and hands back the point value', async () => {
  const seen = [];
  const get = async (url) => { seen.push(url); return fortsFeed; };
  const r = await rates.fetchPointValue({ get, code: 'GOLD', today: '2026-09-21' });
  assert.ok(Math.abs(r.pointValue - 110.89) < 1e-6);
  assert.match(seen[0], /forts\/securities\.json/);
});

test('fetchPointValue — an instrument MOEX does not list is an error, not a zero', async () => {
  const get = async () => fortsFeed;
  await assert.rejects(() => rates.fetchPointValue({ get, code: 'BTC', today: '2026-09-21' }),
    /BTC/);
});
