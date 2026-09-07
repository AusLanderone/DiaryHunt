// test/widgetOrder.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const wo = require('../src/widgetOrder');

test('the default order names every widget the stats tab draws, once each', () => {
  const d = wo.DEFAULT_ORDER;
  assert.ok(d.length >= 10, `only ${d.length} widgets`);
  assert.strictEqual(new Set(d).size, d.length, 'a widget is listed twice');
});

test('nothing saved means the order the app ships with', () => {
  assert.deepStrictEqual(wo.normalize(), wo.DEFAULT_ORDER);
  assert.deepStrictEqual(wo.normalize(null), wo.DEFAULT_ORDER);
  assert.deepStrictEqual(wo.normalize([]), wo.DEFAULT_ORDER);
});

test('a saved order is kept as it was arranged', () => {
  assert.deepStrictEqual(wo.normalize(['tag', 'equity'], ['equity', 'days', 'tag']),
    ['tag', 'equity', 'days']);
});

test('a widget the saved order never heard of lands at the end', () => {
  // a version that adds a widget must not hide it from anyone who has reordered
  assert.deepStrictEqual(wo.normalize(['days', 'equity'], ['equity', 'days', 'brandNew']),
    ['days', 'equity', 'brandNew']);
});

test('a widget that no longer exists is dropped, and repeats collapse', () => {
  assert.deepStrictEqual(wo.normalize(['gone', 'days', 'days', 'equity'], ['equity', 'days']),
    ['days', 'equity']);
});

test('dropping a widget on one further down puts it in that place', () => {
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
});

test('dropping it on one further up puts it before that one', () => {
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'c', 'b'), ['a', 'c', 'b']);
});

test('a move that means nothing changes nothing', () => {
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'x', 'b'), ['a', 'b', 'c']);
  assert.deepStrictEqual(wo.move(['a', 'b', 'c'], 'b', 'x'), ['a', 'b', 'c']);
});

test('move hands back a new list rather than rearranging the old one', () => {
  const before = ['a', 'b', 'c'];
  wo.move(before, 'a', 'c');
  assert.deepStrictEqual(before, ['a', 'b', 'c']);
});

test('the balances tab has an order of its own', () => {
  const d = wo.BALANCES_ORDER;
  assert.deepStrictEqual(d, ['curve', 'accounts', 'snapshots', 'flows']);
  assert.strictEqual(new Set(d).size, d.length);
});

test('normalize works for that order the same way', () => {
  assert.deepStrictEqual(wo.normalize(['flows'], wo.BALANCES_ORDER),
    ['flows', 'curve', 'accounts', 'snapshots']);
});
