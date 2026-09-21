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
