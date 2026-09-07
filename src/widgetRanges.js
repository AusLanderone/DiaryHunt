'use strict';

// The bands each stats widget draws. The app ships sensible defaults, but a
// diary's own scale decides what is a big trade or a wide spread, so every one
// of them can be set by hand from the widget's own gear.
//
// Values are stored canonically — a spread as a fraction, capital in roubles,
// holding time in days — and shown in the unit the field is labelled with.
// IIFE-scoped like the other shared modules: in the renderer this is a classic
// script sharing one global scope with calc.js.
(function () {

const DEFAULTS = {
  spread: [0.005, 0.01, 0.02],
  hold: [0, 3, 7],
  capital: [1e6, 3e6, 1e7],
  bins: 8,
};

const MAX_EDGES = 8;

const SPECS = {
  spread: {
    title: 'Профит по спреду входа',
    unit: '%',
    factor: 0.01,
    kind: 'edges',
    hint: 'Границы полос по величине спреда входа, в процентах. Например: 0,5 1 2',
  },
  hold: {
    title: 'Профит по времени удержания',
    unit: 'дней',
    factor: 1,
    kind: 'edges',
    hint: 'Границы полос по числу дней в сделке. Например: 0 3 7',
  },
  capital: {
    title: 'Профит по объёму позиции',
    unit: 'млн ₽',
    factor: 1e6,
    kind: 'edges',
    hint: 'Границы полос по объёму на одну ногу, в миллионах рублей. Например: 1 3 10',
  },
  bins: {
    title: 'Распределение профита',
    unit: 'столбцов',
    kind: 'count',
    min: 2,
    max: 40,
    hint: 'На сколько столбцов делить размах профита',
  },
};

const KEYS = Object.keys(DEFAULTS);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const defaults = () => ({ spread: [...DEFAULTS.spread], hold: [...DEFAULTS.hold],
  capital: [...DEFAULTS.capital], bins: DEFAULTS.bins });

// Sorted, deduped, no negatives, and never more than a chart can carry.
// Strict is for values read back from a config: one bad entry condemns the
// whole window to its default, because nobody typed it and nothing should be
// guessed. Typed text goes through lenient — there the junk is just noise
// around the numbers the reader meant.
function cleanEdges(list, strict) {
  if (!Array.isArray(list)) return null;
  const usable = (n) => Number.isFinite(n) && n >= 0;
  const numbers = list.map(Number);
  if (strict && !numbers.every(usable)) return null;
  const uniq = [...new Set(numbers.filter(usable))].sort((a, b) => a - b).slice(0, MAX_EDGES);
  return uniq.length ? uniq : null;
}

// Same two readings as cleanEdges: a saved count outside the allowed range is
// corrupt and falls back to the default, a typed one is simply pulled back in.
function cleanCount(value, strict) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (strict && (n < SPECS.bins.min || n > SPECS.bins.max)) return null;
  return clamp(n, SPECS.bins.min, SPECS.bins.max);
}

// What a saved config turns into: anything missing or unusable falls back to
// the app's own band, so a hand-edited config.json can never blank a widget.
function normalize(saved) {
  const out = defaults();
  if (!saved || typeof saved !== 'object') return out;
  for (const key of KEYS) {
    if (!(key in saved)) continue;
    const cleaned = SPECS[key].kind === 'count'
      ? cleanCount(saved[key], true)
      : cleanEdges(saved[key], true);
    if (cleaned !== null) out[key] = cleaned;
  }
  return out;
}

// What the user typed, in the unit of the field, as a canonical value. null
// means the text held nothing usable — the caller keeps what it had.
function parse(key, text) {
  const spec = SPECS[key];
  if (!spec) return null;
  // a comma between digits is a decimal point; anywhere else it separates.
  // The minus is kept so a negative edge can be rejected rather than silently
  // read as a positive one.
  const numbers = (String(text).replace(/(\d),(?=\d)/g, '$1.').match(/-?\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (!numbers.length) return null;
  if (spec.kind === 'count') return cleanCount(numbers[0]);
  const edges = cleanEdges(numbers.map((n) => n * spec.factor));
  return edges;
}

// The stored value as the field shows it: display units, decimal commas.
const showNumber = (n) => String(Number(n.toFixed(6))).replace('.', ',');

function format(key, value) {
  const spec = SPECS[key];
  if (!spec) return '';
  if (spec.kind === 'count') return String(value);
  return toDisplay(key, value).map(showNumber).join(' ');
}

// ---------- one row per band ----------

// The editor works a band at a time, so it needs the edges as plain numbers in
// the field's unit and a way back.
function toDisplay(key, value) {
  const spec = SPECS[key];
  if (!spec || spec.kind === 'count') return [];
  return (value || []).map((v) => Number((v / spec.factor).toFixed(6)));
}

// What the rows hold, as a stored value. An empty row is a band being deleted;
// a row with something unreadable in it stops the save instead, so a typo can
// never quietly drop a band.
function fromDisplay(key, values) {
  const spec = SPECS[key];
  if (!spec || spec.kind === 'count') return null;
  const numbers = [];
  for (const raw of values || []) {
    const text = String(raw).trim();
    if (!text) continue;
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    numbers.push(n * spec.factor);
  }
  return cleanEdges(numbers, true);
}

// Where the next band should start when one is added: past the last one, and
// at the app's own first edge when there are none left.
function suggestEdge(key, values) {
  const spec = SPECS[key];
  if (!spec || spec.kind === 'count') return 0;
  const last = (values || []).length ? Number(values[values.length - 1]) : null;
  if (last === null || !Number.isFinite(last)) return toDisplay(key, DEFAULTS[key])[0] || 1;
  return last > 0 ? Number((last * 2).toFixed(6)) : 1;
}

const _api = { DEFAULTS, SPECS, KEYS, MAX_EDGES, defaults, normalize, parse, format,
  toDisplay, fromDisplay, suggestEdge };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.widgetRanges = _api;
})();
