'use strict';

// How much room each stats widget takes: a span in grid columns and in grid
// rows. Everything is measured in the same cells, which is what keeps the tab
// looking like one field rather than a pile of boxes — cards line up on the
// same raster whatever sizes they are dragged to.
// IIFE-scoped like the other shared modules.
(function () {

const MAX_COLS = 4;
const MAX_ROWS = 8;
const MIN_COL_WIDTH = 340;   // narrower than this and a card stops being readable

// The sizes are chosen to TILE the raster in the default order: each band of
// cards fills the width exactly and its members span the same rows, so no card
// is left short of its neighbour and no corner of the page is dead space.
// Bands at three columns: [equity] [days hist fees] [calendar spread hold]
// [capital weekday ticker] [tag months]. At two columns or one they pair up
// just as evenly.
const DEFAULTS = {
  equity: { cols: 3, rows: 3 },
  days: { cols: 1, rows: 3 },
  hist: { cols: 1, rows: 3 },
  fees: { cols: 1, rows: 3 },
  calendar: { cols: 1, rows: 3 },
  spread: { cols: 1, rows: 3 },
  hold: { cols: 1, rows: 3 },
  capital: { cols: 1, rows: 2 },
  weekday: { cols: 1, rows: 2 },
  ticker: { cols: 1, rows: 2 },
  tag: { cols: 1, rows: 2 },
  months: { cols: 2, rows: 2 },
};

// The balances tab: the curve across the top, then the three panels in a row.
const BALANCES_DEFAULTS = {
  curve: { cols: 3, rows: 3 },
  accounts: { cols: 1, rows: 2 },
  snapshots: { cols: 1, rows: 2 },
  flows: { cols: 1, rows: 2 },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const defaults = (defs = DEFAULTS) => Object.fromEntries(
  Object.entries(defs).map(([k, v]) => [k, { ...v }]),
);

const usable = (size) => Boolean(size) && typeof size === 'object'
  && Number.isInteger(size.cols) && Number.isInteger(size.rows)
  && size.cols >= 1 && size.cols <= MAX_COLS
  && size.rows >= 1 && size.rows <= MAX_ROWS;

// A saved size is taken as it is or not at all: half a size (no rows, say) is
// a corrupt one, and guessing the other half would put a card somewhere nobody
// asked for.
function normalize(saved, defs = DEFAULTS) {
  const out = defaults(defs);
  if (!saved || typeof saved !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (usable(saved[key])) out[key] = { cols: saved[key].cols, rows: saved[key].rows };
  }
  return out;
}

// How many columns the grid itself has at this width — the same raster every
// card is measured against.
function columnsFor(width) {
  return clamp(Math.floor(width / MIN_COL_WIDTH), 1, MAX_COLS);
}

// A card can ask for three columns and be drawn in a two-column grid.
function spanFor(size, cols) {
  return { cols: clamp(size.cols, 1, Math.max(1, cols)), rows: size.rows };
}

// Dragging the corner: the size follows the pointer by whole cells, so a card
// always lands on the raster rather than between two of them.
function resize(start, dx, dy, metrics) {
  const { cellW, cellH, maxCols = MAX_COLS } = metrics;
  return {
    cols: clamp(Math.round((start.cols * cellW + dx) / cellW), 1, Math.min(MAX_COLS, maxCols)),
    rows: clamp(Math.round((start.rows * cellH + dy) / cellH), 1, MAX_ROWS),
  };
}

const _api = { DEFAULTS, BALANCES_DEFAULTS, MAX_COLS, MAX_ROWS, MIN_COL_WIDTH,
  defaults, normalize, columnsFor, spanFor, resize };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.widgetSize = _api;
})();
