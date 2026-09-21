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

// ---------- history: settlement prices and the daily official rate ----------
const histPage = (rows, total) => JSON.stringify({
  history: { columns: ['TRADEDATE', 'SECID', 'SETTLEPRICE'], data: rows },
  'history.cursor': { columns: ['INDEX', 'TOTAL', 'PAGESIZE'], data: [[0, total, 100]] },
});

test('parseSettles — the settlement price of each day, in order', () => {
  const rows = parse => parse;
  const text = histPage([
    ['2026-08-28', 'GDU6', 4531],
    ['2026-08-31', 'GDU6', 4500],
    ['2026-09-01', 'GDU6', null],   // a day with no clearing price is not a zero
  ], 3);
  assert.deepStrictEqual(rates.parseSettles(text), [
    { date: '2026-08-28', settle: 4531 },
    { date: '2026-08-31', settle: 4500 },
  ]);
  assert.deepStrictEqual(rates.parseSettles('not json'), []);
});

test('parseContracts — every contract of a series traded that day', () => {
  const text = JSON.stringify({
    history: {
      columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'],
      data: [['GDU6', 'GOLD', 4531], ['GDZ6', 'GOLD', 4570.2], ['GDU6GDZ6', '', 0]],
    },
  });
  assert.deepStrictEqual(rates.parseContracts(text), [
    { secid: 'GDU6', assetCode: 'GOLD', settle: 4531 },
    { secid: 'GDZ6', assetCode: 'GOLD', settle: 4570.2 },
  ]);
});

test('parseCbrSeries — the official rate day by day', () => {
  const xml = `<?xml version="1.0"?><ValCurs ID="R01235">
    <Record Date="28.08.2026" Id="R01235"><Nominal>1</Nominal><Value>80,1234</Value></Record>
    <Record Date="31.08.2026" Id="R01235"><Nominal>1</Nominal><Value>81,5000</Value></Record>
  </ValCurs>`;
  assert.deepStrictEqual(rates.parseCbrSeries(xml), [
    { date: '2026-08-28', rate: 80.1234 },
    { date: '2026-08-31', rate: 81.5 },
  ]);
  assert.deepStrictEqual(rates.parseCbrSeries('<ValCurs/>'), []);
});

test('fetchSettles — pages through the feed until the series ends', async () => {
  const seen = [];
  const page1 = histPage(Array.from({ length: 100 }, (_, i) => [`2026-05-${String(i % 28 + 1).padStart(2, '0')}`, 'GDU6', 4000 + i]), 150);
  const page2 = histPage([['2026-09-01', 'GDU6', 4100]], 150);
  const get = async (url) => { seen.push(url); return seen.length === 1 ? page1 : page2; };
  const out = await rates.fetchSettles({ get, secid: 'GDU6', from: '2026-05-01', till: '2026-09-01' });
  assert.strictEqual(out.length, 101);
  assert.strictEqual(seen.length, 2);
  assert.match(seen[1], /start=100/);
});

test('fetchContracts — asks for one asset code on one day', async () => {
  const seen = [];
  const get = async (url) => {
    seen.push(url);
    return JSON.stringify({ history: { columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'], data: [['GDU6', 'GOLD', 4531]] } });
  };
  const out = await rates.fetchContracts({ get, assetCode: 'GOLD', date: '2026-08-28' });
  assert.deepStrictEqual(out, [{ secid: 'GDU6', assetCode: 'GOLD', settle: 4531 }]);
  assert.match(seen[0], /assetcode=GOLD/);
  assert.match(seen[0], /date=2026-08-28/);
});

// ---------- the last price the exchange has shown ----------
const mdFeed = JSON.stringify({
  marketdata: {
    columns: ['SECID', 'LAST', 'BID', 'OFFER', 'SETTLEPRICE', 'UPDATETIME', 'SYSTIME'],
    data: [['GDZ6', 4429.1, 4429, 4429.1, 4428.2, '18:37:29', '2026-09-21 18:52:31']],
  },
});

test('parseLast — the traded price, with the time it was traded at', () => {
  const r = rates.parseLast(mdFeed);
  assert.strictEqual(r.price, 4429.1);
  assert.strictEqual(r.time, '18:37:29');
  assert.strictEqual(r.systime, '2026-09-21 18:52:31');
});

test('parseLast — falls back to the middle of the book, then to the clearing price', () => {
  const noLast = JSON.stringify({ marketdata: {
    columns: ['SECID', 'LAST', 'BID', 'OFFER', 'SETTLEPRICE', 'UPDATETIME'],
    data: [['GDZ6', 0, 4400, 4402, 4428.2, '18:37:29']] } });
  assert.strictEqual(rates.parseLast(noLast).price, 4401);
  const only = JSON.stringify({ marketdata: {
    columns: ['SECID', 'LAST', 'BID', 'OFFER', 'SETTLEPRICE', 'UPDATETIME'],
    data: [['GDZ6', 0, 0, 0, 4428.2, '18:37:29']] } });
  assert.strictEqual(rates.parseLast(only).price, 4428.2);
  assert.strictEqual(rates.parseLast('{}'), null);
  assert.strictEqual(rates.parseLast('not json'), null);
});

test('fetchLast — asks for one contract', async () => {
  const seen = [];
  const get = async (url) => { seen.push(url); return mdFeed; };
  const r = await rates.fetchLast({ get, secid: 'GDZ6' });
  assert.strictEqual(r.price, 4429.1);
  assert.match(seen[0], /securities\/GDZ6\.json/);
});
