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

// The arrangement the diary is actually kept in — read off a working install
// and written down here, so a new one opens on the same page rather than on a
// theoretical default. Change it by dragging; «Раскладка по умолчанию» comes
// back to exactly this.
const DEFAULTS = {
  equity: { cols: 3, rows: 3 },
  days: { cols: 1, rows: 3 },
  hist: { cols: 1, rows: 1 },
  fees: { cols: 1, rows: 1 },
  calendar: { cols: 2, rows: 1 },
  spread: { cols: 1, rows: 1 },
  hold: { cols: 1, rows: 1 },
  capital: { cols: 1, rows: 1 },
  weekday: { cols: 1, rows: 1 },
  ticker: { cols: 1, rows: 1 },
  tag: { cols: 1, rows: 1 },
  months: { cols: 2, rows: 1 },
};

// The balances tab, likewise taken from the working install: the curve across
// the top, the marks and the movements wide enough for their tables.
const BALANCES_DEFAULTS = {
  curve: { cols: 4, rows: 3 },
  accounts: { cols: 1, rows: 2 },
  snapshots: { cols: 3, rows: 2 },
  flows: { cols: 2, rows: 2 },
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
