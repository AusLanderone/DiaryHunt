// test/dicts.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const dicts = require('../src/dicts');

const trade = (over = {}) => ({
  num: 1, type: 'Фьючи', ticker: 'ED', tag: 'Схождение',
  legs: [{ exchange: 'MOEX' }, { exchange: 'BYBIT' }],
  ...over,
});

const cfg = (over = {}) => ({
  types: ['Фьючи', 'Крипто'], tickers: ['ED'], tags: ['Схождение', 'Раскор'],
  exchanges: ['MOEX', 'FOREX'],
  hidden: { types: [], tickers: [], tags: [], exchanges: [] },
  ...over,
});

test('KINDS names every dictionary the diary keeps', () => {
  assert.deepStrictEqual(dicts.KINDS.map((k) => k.key), ['types', 'tickers', 'tags', 'exchanges']);
});

test('options merge the dictionary with what the trades already hold', () => {
  const trades = [trade({ ticker: 'SILV', tag: 'Импорт' })];
  assert.deepStrictEqual(dicts.options('tickers', cfg(), trades), ['ED', 'SILV']);
  assert.deepStrictEqual(dicts.options('tags', cfg(), trades), ['Импорт', 'Раскор', 'Схождение']);
});

test('options read every leg of a trade for the exchange list', () => {
  const trades = [trade({ legs: [{ exchange: 'MOEX' }, { exchange: 'MOEX' }, { exchange: 'VANTAGE' }] })];
  assert.deepStrictEqual(dicts.options('exchanges', cfg(), trades), ['FOREX', 'MOEX', 'VANTAGE']);
});

test('options drop a hidden value even when a trade still carries it', () => {
  const c = cfg({ hidden: { types: [], tickers: [], tags: ['Схождение'], exchanges: [] } });
  assert.deepStrictEqual(dicts.options('tags', c, [trade()]), ['Раскор']);
});

test('rows count how many trades use each value', () => {
  const trades = [trade({ tag: 'Схождение' }), trade({ num: 2, tag: 'Схождение' }), trade({ num: 3, tag: 'Импорт' })];
  const rows = dicts.rows('tags', cfg(), trades);
  assert.deepStrictEqual(rows.map((r) => [r.value, r.count]),
    [['Импорт', 1], ['Раскор', 0], ['Схождение', 2]]);
});

test('rows say which values the dictionary itself holds', () => {
  const rows = dicts.rows('tags', cfg(), [trade({ tag: 'Импорт' })]);
  assert.deepStrictEqual(rows.find((r) => r.value === 'Импорт').inDict, false);
  assert.deepStrictEqual(rows.find((r) => r.value === 'Раскор').inDict, true);
});

test('hiddenOf lists what was removed, in order', () => {
  const c = cfg({ hidden: { types: [], tickers: [], tags: ['Раскор', 'Импорт'], exchanges: [] } });
  assert.deepStrictEqual(dicts.hiddenOf('tags', c), ['Раскор', 'Импорт']);
  assert.deepStrictEqual(dicts.hiddenOf('tags', cfg({ hidden: undefined })), []);
});

test('blank values never become dictionary entries', () => {
  const trades = [trade({ tag: '' }), trade({ num: 2, tag: null })];
  assert.deepStrictEqual(dicts.options('tags', cfg(), trades), ['Раскор', 'Схождение']);
});
