// test/widgetRanges.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const wr = require('../src/widgetRanges');

// The module stores canonical values — a spread as a fraction, capital in
// roubles, holding time in days — and shows them in the unit each field is
// labelled with (%, млн ₽, дней).

test('the defaults are the bands the app has always drawn', () => {
  const d = wr.defaults();
  assert.deepStrictEqual(d.spread, [0.005, 0.01, 0.02]);
  assert.deepStrictEqual(d.hold, [0, 3, 7]);
  assert.deepStrictEqual(d.capital, [1e6, 3e6, 1e7]);
  assert.strictEqual(d.bins, 8);
});

test('defaults hands back a copy, so a caller cannot edit them in place', () => {
  wr.defaults().spread.push(99);
  assert.deepStrictEqual(wr.defaults().spread, [0.005, 0.01, 0.02]);
});

// ---------- normalize: what comes back from a saved config ----------

test('normalize fills in every window the saved settings do not carry', () => {
  const n = wr.normalize({ spread: [0.01] });
  assert.deepStrictEqual(n.spread, [0.01]);
  assert.deepStrictEqual(n.hold, wr.defaults().hold);
  assert.strictEqual(n.bins, 8);
});

test('normalize accepts nothing at all', () => {
  assert.deepStrictEqual(wr.normalize(), wr.defaults());
  assert.deepStrictEqual(wr.normalize(null), wr.defaults());
  assert.deepStrictEqual(wr.normalize({}), wr.defaults());
});

test('normalize falls back to the default when a saved window is unusable', () => {
  assert.deepStrictEqual(wr.normalize({ spread: [] }).spread, wr.defaults().spread);
  assert.deepStrictEqual(wr.normalize({ spread: 'что-то' }).spread, wr.defaults().spread);
  assert.deepStrictEqual(wr.normalize({ hold: [-3] }).hold, wr.defaults().hold);
  assert.deepStrictEqual(wr.normalize({ capital: [1e6, 'x'] }).capital, wr.defaults().capital);
  assert.strictEqual(wr.normalize({ bins: 0 }).bins, 8);
  assert.strictEqual(wr.normalize({ bins: 1000 }).bins, 8);
});

test('normalize sorts and dedupes a window that is otherwise fine', () => {
  assert.deepStrictEqual(wr.normalize({ hold: [7, 0, 3, 3] }).hold, [0, 3, 7]);
});

// ---------- parse: what the user types ----------

test('a spread window is typed in percent and stored as a fraction', () => {
  assert.deepStrictEqual(wr.parse('spread', '0,5 1 2'), [0.005, 0.01, 0.02]);
});

test('a capital window is typed in millions and stored in roubles', () => {
  assert.deepStrictEqual(wr.parse('capital', '0,5 2'), [500000, 2000000]);
});

test('a holding window is typed and stored in days', () => {
  assert.deepStrictEqual(wr.parse('hold', '0 1 5'), [0, 1, 5]);
});

test('separators, order and repeats do not matter', () => {
  assert.deepStrictEqual(wr.parse('hold', '  7;3 , 0 3 '), [0, 3, 7]);
});

test('nothing usable in the text means no change to make', () => {
  assert.strictEqual(wr.parse('spread', ''), null);
  assert.strictEqual(wr.parse('spread', '   '), null);
  assert.strictEqual(wr.parse('spread', 'полпроцента'), null);
  assert.strictEqual(wr.parse('hold', '-5'), null);
});

test('a window can hold only so many edges', () => {
  const many = wr.parse('hold', '1 2 3 4 5 6 7 8 9 10 11 12');
  assert.strictEqual(many.length, wr.MAX_EDGES);
  assert.deepStrictEqual(many, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('the histogram takes a whole number of columns, kept in range', () => {
  assert.strictEqual(wr.parse('bins', '12'), 12);
  assert.strictEqual(wr.parse('bins', '12,7'), 12);
  assert.strictEqual(wr.parse('bins', '1'), 2);
  assert.strictEqual(wr.parse('bins', '999'), wr.SPECS.bins.max);
  assert.strictEqual(wr.parse('bins', 'много'), null);
});

// ---------- format: what the field shows ----------

test('format writes the stored value back in the unit of its field', () => {
  assert.strictEqual(wr.format('spread', [0.005, 0.01, 0.02]), '0,5 1 2');
  assert.strictEqual(wr.format('capital', [1e6, 3e6, 1e7]), '1 3 10');
  assert.strictEqual(wr.format('hold', [0, 3, 7]), '0 3 7');
  assert.strictEqual(wr.format('bins', 8), '8');
});

test('what the field shows parses back to what was stored', () => {
  for (const [key, value] of Object.entries(wr.defaults())) {
    assert.deepStrictEqual(wr.parse(key, wr.format(key, value)), value, key);
  }
});

test('every window it knows about has a title and a unit to show', () => {
  for (const key of Object.keys(wr.defaults())) {
    assert.ok(wr.SPECS[key].title, key);
    assert.ok(wr.SPECS[key].unit, key);
  }
});
