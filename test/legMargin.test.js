// test/legMargin.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeLegMargin } = require('../src/legMargin');

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// a cache that keeps nothing, so the fetching itself is what the tests see
const noCache = { remember: (key, cacheable, produce) => produce() };

const CONTRACTS = JSON.stringify({ history: {
  columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'],
  data: [['GDU6', 'GOLD', 4531], ['GDZ6', 'GOLD', 4570.2]],
} });
const SETTLES = JSON.stringify({ history: {
  columns: ['TRADEDATE', 'SECID', 'SETTLEPRICE'],
  data: [['2026-08-28', 'GDU6', 4531], ['2026-08-31', 'GDU6', 4500], ['2026-09-01', 'GDU6', 4400]],
} });
const CBR = `<ValCurs>
  <Record Date="28.08.2026"><Value>80,0000</Value></Record>
  <Record Date="31.08.2026"><Value>81,0000</Value></Record>
  <Record Date="01.09.2026"><Value>82,0000</Value></Record>
</ValCurs>`;

const fakeGet = (log = []) => async (url) => {
  log.push(url);
  if (url.includes('cbr.ru')) return CBR;
  if (url.includes('assetcode=')) return CONTRACTS;
  return SETTLES;
};

const leg = { side: 'Шорт', entryPrice: 4538, exitPrice: 4326.4, units: 21 };
const trade = { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '2026-09-01' };
const args = (extra) => ({ get: fakeGet(), cache: noCache, today: '2026-09-20', trade, leg, ...extra });

test('the margin is summed over the contract the trade was actually in', async () => {
  const log = [];
  const r = await computeLegMargin(args({ get: fakeGet(log) }));
  assert.strictEqual(r.secid, 'GDU6');          // 4531 is nearer the 4538 filled than 4570,2
  assert.strictEqual(r.sessions, 3);
  near(r.rub, 7 * 21 * 80 + 31 * 21 * 81 + 173.6 * 21 * 82);
  assert.ok(log.some((u) => /assetcode=GOLD/.test(u)), 'the series is looked up by asset code');
  assert.ok(log.some((u) => /GDU6\.json/.test(u)), 'and then that contract is read');
});

test('a contract given by hand is used as given', async () => {
  const log = [];
  const r = await computeLegMargin(args({ get: fakeGet(log), secid: 'GDZ6' }));
  assert.strictEqual(r.secid, 'GDZ6');
  assert.ok(!log.some((u) => /assetcode=/.test(u)), 'nothing to resolve');
});

test('the answer carries the fingerprint of what it was computed from', async () => {
  const r = await computeLegMargin(args({}));
  assert.deepStrictEqual(r.fingerprint, {
    entryPrice: 4538, exitPrice: 4326.4, units: 21, side: 'Шорт',
    openDate: '2026-08-28', closeDate: '2026-09-01',
    fills: '2026-08-28:4538:21:in|2026-09-01:4326.4:21:out',
  });
});

test('history that is over is cached; a trade closed today is not', async () => {
  const keys = [];
  const cache = { remember: (key, cacheable, produce) => { keys.push([key, cacheable]); return produce(); } };
  await computeLegMargin(args({ cache }));
  assert.ok(keys.every(([, c]) => c === true), JSON.stringify(keys));
  keys.length = 0;
  await computeLegMargin(args({ cache, today: '2026-09-01' }));
  assert.ok(keys.some(([, c]) => c === false), 'a range reaching today must stay fresh');
});

test('an unclosed leg has no margin to compute', async () => {
  await assert.rejects(
    () => computeLegMargin(args({ leg: { ...leg, exitPrice: null } })),
    /закрыт/i,
  );
});

test('an instrument MOEX does not know is an error, not a zero', async () => {
  const get = async (url) => (url.includes('cbr.ru') ? CBR
    : JSON.stringify({ history: { columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'], data: [] } }));
  await assert.rejects(
    () => computeLegMargin(args({ get, trade: { ...trade, ticker: 'XAU' } })),
    /XAU/,
  );
});

test('a gap in the rate series is reported, not papered over', async () => {
  const get = async (url) => {
    if (url.includes('cbr.ru')) return '<ValCurs/>';
    if (url.includes('assetcode=')) return CONTRACTS;
    return SETTLES;
  };
  await assert.rejects(() => computeLegMargin(args({ get })), /курс/i);
});

test('a leg of several fills is read over the span of those fills', async () => {
  const log = [];
  const filled = { side: 'Шорт', fills: [
    { date: '2026-08-28', price: 4538, units: 21, kind: 'in' },
    { date: '2026-08-31', price: 4505, units: 1, kind: 'out' },
    { date: '2026-09-01', price: 4400, units: 20, kind: 'out' },
  ] };
  const r = await computeLegMargin(args({ get: fakeGet(log), leg: filled }));
  assert.strictEqual(r.sessions, 3);
  assert.ok(log.some((u) => /from=2026-08-28&till=2026-09-01/.test(u)), log.join('\n'));
  assert.ok(log.some((u) => /date=2026-08-28/.test(u)), 'the contract is resolved on the first fill');
});

test('an unclosed leg of fills is refused like any other', async () => {
  const half = { side: 'Шорт', fills: [
    { date: '2026-08-28', price: 4538, units: 21, kind: 'in' },
    { date: '2026-08-31', price: 4505, units: 1, kind: 'out' },
  ] };
  await assert.rejects(() => computeLegMargin(args({ leg: half })), /закрыт/i);
});

// ---------- the exchange publishes the day only after the evening clearing ----------
//
// A trade closed today is computable: every mark but the last is a past
// session, and the last is the price it was closed at. Only the contract lookup
// stumbles, because the list of what traded "today" is not out yet — so it
// walks back to the last day the exchange did publish.
test('the contract is looked up on the last day the exchange published', async () => {
  const asked = [];
  const get = async (url) => {
    if (url.includes('cbr.ru')) return CBR;
    if (url.includes('assetcode=')) {
      const day = /date=([\d-]+)/.exec(url)[1];
      asked.push(day);
      // nothing for the weekend and nothing for today
      return day >= '2026-08-29'
        ? JSON.stringify({ history: { columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'], data: [] } })
        : CONTRACTS;
    }
    return SETTLES;
  };
  const r = await computeLegMargin(args({
    get, today: '2026-08-31',
    trade: { ticker: 'GOLD', openDate: '2026-08-31', closeDate: '2026-08-31' },
    leg: { side: 'Шорт', entryPrice: 4538, exitPrice: 4500, units: 21 },
  }));
  assert.strictEqual(r.secid, 'GDU6');
  assert.deepStrictEqual(asked, ['2026-08-31', '2026-08-30', '2026-08-29', '2026-08-28'],
    'it walks back a day at a time');
  assert.strictEqual(r.contractAsOf, '2026-08-28', 'and says which day it settled on');
});

test('walking back has a limit — a nonexistent asset still errors', async () => {
  const get = async (url) => (url.includes('cbr.ru') ? CBR
    : url.includes('assetcode=') ? JSON.stringify({ history: { columns: ['SECID', 'ASSETCODE', 'SETTLEPRICE'], data: [] } })
      : SETTLES);
  await assert.rejects(() => computeLegMargin(args({ get })), /GOLD/);
});

test('an open leg is valued up to the last published session', async () => {
  const log = [];
  const r = await computeLegMargin(args({
    get: fakeGet(log), open: true,
    trade: { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '' },
    leg: { side: 'Шорт', entryPrice: 4538, exitPrice: null, units: 21 },
  }));
  assert.strictEqual(r.through, '2026-09-01');
  assert.strictEqual(r.position, 21);
  near(r.rub, 7 * 21 * 80 + 31 * 21 * 81 + 100 * 21 * 82, 1);
  assert.ok(log.some((u) => /till=2026-09-20/.test(u)), 'the range runs to today: ' + log.join(' '));
  assert.ok(log.every((u) => !/start=100/.test(u)));
});

test('an open valuation is never cached — tomorrow it is a different number', async () => {
  const keys = [];
  const cache = { remember: (key, cacheable, produce) => { keys.push([key, cacheable]); return produce(); } };
  await computeLegMargin(args({
    cache, open: true,
    trade: { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '' },
    leg: { side: 'Шорт', entryPrice: 4538, exitPrice: null, units: 21 },
  }));
  assert.ok(keys.some(([k, c]) => /^settles/.test(k) && c === false), JSON.stringify(keys));
});

// ---------- today has no clearing yet, so the last quote stands in ----------
const MARKETDATA = JSON.stringify({ marketdata: {
  columns: ['SECID', 'LAST', 'BID', 'OFFER', 'SETTLEPRICE', 'UPDATETIME'],
  data: [['GDU6', 4380, 4379, 4381, 4400, '18:37:29']],
} });
const liveGet = (log = []) => async (url) => {
  log.push(url);
  if (url.includes('cbr.ru')) return CBR;
  if (url.includes('assetcode=')) return CONTRACTS;
  if (url.includes('iss.only=marketdata')) return MARKETDATA;
  return SETTLES;
};

test('an open leg is marked at the last quote when today has not cleared', async () => {
  const log = [];
  const r = await computeLegMargin({
    get: liveGet(log), cache: noCache, today: '2026-09-02', open: true,
    trade: { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '' },
    leg: { side: 'Шорт', entryPrice: 4538, exitPrice: null, units: 21 },
  });
  assert.strictEqual(r.through, '2026-09-02', 'the last mark is today');
  assert.deepStrictEqual(r.live, { price: 4380, time: '18:37:29' });
  assert.ok(log.some((u) => /iss\.only=marketdata/.test(u)));
  // ... 4400 on 01.09 -> 4380 now, on 21 lots short, at the rate in force
  near(r.rub, 7 * 21 * 80 + 31 * 21 * 81 + 100 * 21 * 82 + 20 * 21 * 82, 1);
});

test('no quote is not a failure — the accrual stops at the last clearing', async () => {
  const get = async (url) => {
    if (url.includes('cbr.ru')) return CBR;
    if (url.includes('assetcode=')) return CONTRACTS;
    if (url.includes('iss.only=marketdata')) throw new Error('MOEX молчит');
    return SETTLES;
  };
  const r = await computeLegMargin({
    get, cache: noCache, today: '2026-09-02', open: true,
    trade: { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '' },
    leg: { side: 'Шорт', entryPrice: 4538, exitPrice: null, units: 21 },
  });
  assert.strictEqual(r.through, '2026-09-01');
  assert.strictEqual(r.live, null);
});

test('a closed leg is never marked at a quote', async () => {
  const log = [];
  const r = await computeLegMargin(args({ get: liveGet(log) }));
  assert.strictEqual(r.live, null);
  assert.ok(!log.some((u) => /iss\.only=marketdata/.test(u)), 'and does not even ask');
});

test('an open leg is fingerprinted as it stands, without borrowing today as a close', async () => {
  const calc = require('../src/calc');
  const leg = { side: 'Шорт', entryPrice: 4538, exitPrice: null, units: 21 };
  const openTrade = { ticker: 'GOLD', openDate: '2026-08-28', closeDate: '' };
  const r = await computeLegMargin({ get: fakeGet(), cache: noCache, today: '2026-09-20', open: true,
    trade: openTrade, leg });
  assert.deepStrictEqual(r.fingerprint, calc.vmFingerprint(leg, openTrade));
  assert.strictEqual(r.fingerprint.closeDate, null, 'an open leg has no closing date');
  // and so the stored figure is accepted, not thrown away as stale
  const stored = { ...leg, vmOpenRub: r.rub, vmOpenMeta: { fingerprint: r.fingerprint } };
  assert.ok(Math.abs(calc.legInterimRub(stored, openTrade) - r.rub) < 1e-9);
});
