// test/widgetSize.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const ws = require('../src/widgetSize');
const wo = require('../src/widgetOrder');

test('every widget the stats tab draws has a size of its own', () => {
  for (const id of wo.DEFAULT_ORDER) {
    assert.ok(ws.DEFAULTS[id], `no size for ${id}`);
    assert.ok(ws.DEFAULTS[id].cols >= 1 && ws.DEFAULTS[id].rows >= 1, id);
  }
});

test('nothing saved means the sizes the app ships with', () => {
  assert.deepStrictEqual(ws.normalize(), ws.defaults());
  assert.deepStrictEqual(ws.normalize(null), ws.defaults());
});

test('a saved size is kept', () => {
  assert.deepStrictEqual(ws.normalize({ fees: { cols: 2, rows: 4 } }).fees, { cols: 2, rows: 4 });
});

test('a size that makes no sense falls back to the default', () => {
  const d = ws.defaults();
  assert.deepStrictEqual(ws.normalize({ fees: { cols: 0, rows: 2 } }).fees, d.fees);
  assert.deepStrictEqual(ws.normalize({ fees: { cols: 99, rows: 2 } }).fees, d.fees);
  assert.deepStrictEqual(ws.normalize({ fees: 'большой' }).fees, d.fees);
  assert.deepStrictEqual(ws.normalize({ fees: { cols: 2 } }).fees, d.fees);
});

test('a widget the saved sizes never heard of still gets one', () => {
  assert.deepStrictEqual(ws.normalize({}).equity, ws.defaults().equity);
});

// ---------- fitting the grid it is drawn in ----------

test('a card never spans more columns than the grid has', () => {
  assert.deepStrictEqual(ws.spanFor({ cols: 3, rows: 2 }, 2), { cols: 2, rows: 2 });
  assert.deepStrictEqual(ws.spanFor({ cols: 1, rows: 2 }, 3), { cols: 1, rows: 2 });
});

test('the grid takes as many columns as the width allows, between one and four', () => {
  assert.strictEqual(ws.columnsFor(1280), 3);
  assert.strictEqual(ws.columnsFor(700), 2);
  assert.strictEqual(ws.columnsFor(300), 1);
  assert.ok(ws.columnsFor(4000) <= ws.MAX_COLS);
});

// ---------- dragging the corner ----------

const metrics = { cellW: 100, cellH: 50, maxCols: 4 };

test('a drag that goes nowhere leaves the size alone', () => {
  assert.deepStrictEqual(ws.resize({ cols: 2, rows: 2 }, 0, 0, metrics), { cols: 2, rows: 2 });
});

test('dragging past half a cell takes the next one', () => {
  assert.deepStrictEqual(ws.resize({ cols: 1, rows: 1 }, 60, 30, metrics), { cols: 2, rows: 2 });
  assert.deepStrictEqual(ws.resize({ cols: 1, rows: 1 }, 40, 20, metrics), { cols: 1, rows: 1 });
});

test('dragging back shrinks it, and never below one cell', () => {
  assert.deepStrictEqual(ws.resize({ cols: 3, rows: 3 }, -100, -50, metrics), { cols: 2, rows: 2 });
  assert.deepStrictEqual(ws.resize({ cols: 2, rows: 2 }, -9000, -9000, metrics), { cols: 1, rows: 1 });
});

test('a card cannot be dragged wider than the grid', () => {
  assert.deepStrictEqual(ws.resize({ cols: 2, rows: 2 }, 9000, 0, metrics).cols, 4);
  assert.deepStrictEqual(ws.resize({ cols: 2, rows: 2 }, 9000, 0, { ...metrics, maxCols: 2 }).cols, 2);
});

test('and not taller than a screen holds', () => {
  assert.strictEqual(ws.resize({ cols: 1, rows: 1 }, 0, 9000, metrics).rows, ws.MAX_ROWS);
});

// ---------- the balances tab is laid out the same way ----------

test('every balances widget has a size of its own', () => {
  for (const id of wo.BALANCES_ORDER) {
    assert.ok(ws.BALANCES_DEFAULTS[id], `no size for ${id}`);
  }
});

// The defaults are the arrangement the diary is actually kept in, not a
// theoretical tiling — what has to hold is that every one of them is a size the
// grid can draw, and that normalize hands them back untouched.
test('every default size is one the grid can actually draw', () => {
  for (const defs of [ws.DEFAULTS, ws.BALANCES_DEFAULTS]) {
    for (const [id, size] of Object.entries(defs)) {
      assert.ok(size.cols >= 1 && size.cols <= ws.MAX_COLS, `${id}: ${size.cols} cols`);
      assert.ok(size.rows >= 1 && size.rows <= ws.MAX_ROWS, `${id}: ${size.rows} rows`);
    }
    assert.deepStrictEqual(ws.normalize(defs, defs), ws.defaults(defs));
  }
});

test('normalize takes the defaults it is given', () => {
  const out = ws.normalize({ curve: { cols: 1, rows: 2 } }, ws.BALANCES_DEFAULTS);
  assert.deepStrictEqual(out.curve, { cols: 1, rows: 2 });
  assert.deepStrictEqual(out.accounts, ws.BALANCES_DEFAULTS.accounts);
  assert.ok(!('equity' in out), 'stats widgets have no business here');
});
