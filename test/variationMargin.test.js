// test/variationMargin.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('../src/variationMargin');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// GOLD, 21 lots short, 4538 on 28.08 -> 4326,4 on 17.09 (the user's trade #13),
// shortened to three sessions so the arithmetic can be read by hand.
const settles = [
  { date: '2026-08-28', settle: 4531 },
  { date: '2026-08-31', settle: 4500 },
  { date: '2026-09-01', settle: 4400 },   // the close day: its settle is not a mark
];
const rates = [
  { date: '2026-08-28', rate: 80 },
  { date: '2026-08-31', rate: 81 },
  { date: '2026-09-01', rate: 82 },
];
const leg = { side: 'Шорт', entryPrice: 4538, exitPrice: 4326.4, units: 21 };
const trade = { openDate: '2026-08-28', closeDate: '2026-09-01' };

test('the contract is the one whose settle sits closest to the price entered', () => {
  const rows = [
    { secid: 'GDZ6', settle: 4570.2 },
    { secid: 'GDU6', settle: 4531 },
    { secid: 'GDH7', settle: 4624.9 },
  ];
  assert.strictEqual(vm.pickContract(rows, 4538).secid, 'GDU6');
  assert.strictEqual(vm.pickContract(rows, 4560).secid, 'GDZ6');
  assert.strictEqual(vm.pickContract([], 4538), null);
  assert.strictEqual(vm.pickContract(rows, null), null);
});

test('the rate of a day is the last one published on or before it', () => {
  near(vm.rateOn(rates, '2026-08-28'), 80);
  near(vm.rateOn(rates, '2026-08-30'), 81 - 1);   // Sunday keeps Friday's rate
  near(vm.rateOn(rates, '2026-09-05'), 82);       // and the last one carries forward
  assert.strictEqual(vm.rateOn(rates, '2026-08-01'), null); // nothing published yet
  assert.strictEqual(vm.rateOn([], '2026-08-28'), null);
});

test('marks run entry → every settle before the close → exit', () => {
  const marks = vm.buildMarks({ ...trade, entryPrice: 4538, exitPrice: 4326.4, settles });
  assert.deepStrictEqual(marks.map((m) => [m.date, m.price]), [
    ['2026-08-28', 4538],     // the entry itself
    ['2026-08-28', 4531],     // that evening's clearing
    ['2026-08-31', 4500],
    ['2026-09-01', 4326.4],   // the exit replaces the close day's settle
  ]);
});

test('variation margin is summed clearing by clearing, each at its own rate', () => {
  const r = vm.compute({ leg, ...trade, settles, rates });
  // short: (4538-4531)*21*80 + (4531-4500)*21*81 + (4500-4326,4)*21*82
  near(r.rub, 7 * 21 * 80 + 31 * 21 * 81 + 173.6 * 21 * 82, 0.5);
  assert.strictEqual(r.sessions, 3);
  assert.strictEqual(r.rows.length, 3);
  near(r.rows[0].rate, 80);
  near(r.rows[2].delta, 173.6 * 21 * 82, 0.5);
});

test('a long leg earns where the short one loses', () => {
  const long = vm.compute({ leg: { ...leg, side: 'Лонг' }, ...trade, settles, rates });
  const short = vm.compute({ leg, ...trade, settles, rates });
  near(long.rub, -short.rub, 0.5);
});

test('a same-day trade is one session at that day rate', () => {
  const r = vm.compute({
    leg: { side: 'Шорт', entryPrice: 4427.2, exitPrice: 4420.42, units: 21 },
    openDate: '2026-09-01', closeDate: '2026-09-01', settles: [], rates,
  });
  assert.strictEqual(r.sessions, 1);
  near(r.rub, 6.78 * 21 * 82, 0.5);
});

test('nothing to compute beats a number pulled out of thin air', () => {
  const open = vm.compute({ leg: { ...leg, exitPrice: null }, ...trade, settles, rates });
  assert.strictEqual(open, null, 'an unclosed leg has no variation margin yet');
  const noRates = vm.compute({ leg, ...trade, settles, rates: [] });
  assert.strictEqual(noRates, null, 'no rate for a session means no figure');
  const early = vm.compute({ leg, ...trade, settles, rates: rates.slice(2) });
  assert.strictEqual(early, null, 'a rate that starts mid-trade is not enough either');
});

// A stored figure describes the leg it was computed from. Change a price and it
// is a number about a different trade — the app has to notice.
test('the fingerprint of the inputs travels with the result', () => {
  const r = vm.compute({ leg, ...trade, settles, rates });
  assert.deepStrictEqual(r.fingerprint, vm.fingerprint(leg, trade));
  assert.notDeepStrictEqual(vm.fingerprint({ ...leg, units: 20 }, trade), r.fingerprint);
  assert.notDeepStrictEqual(vm.fingerprint(leg, { ...trade, closeDate: '2026-09-02' }), r.fingerprint);
  assert.deepStrictEqual(vm.fingerprint({ ...leg, feeRub: 999 }, trade), r.fingerprint,
    'a fee does not change the variation margin');
});

// calc.js runs in the renderer as a classic script and cannot require this
// module, so it carries its own copy of the fingerprint. The two must agree, or
// every stored figure would read as stale.
test('calc and the margin module fingerprint a leg the same way', () => {
  const calc = require('../src/calc');
  assert.deepStrictEqual(calc.vmFingerprint(leg, trade), vm.fingerprint(leg, trade));
  const open = { side: 'Лонг', entryPrice: 1.15, units: 1000, exitPrice: null };
  assert.deepStrictEqual(calc.vmFingerprint(open, { openDate: '2026-09-01', closeDate: '' }),
    vm.fingerprint(open, { openDate: '2026-09-01', closeDate: '' }));
});

// ---------- a position whose size changes while it is held ----------
//
// This is the case the old shape could not express: 21 lots opened, one taken
// off mid-way, twenty closed at the end. Each session must be valued at the
// size the position actually had that day.
const shrinking = {
  side: 'Шорт',
  fills: [
    { date: '2026-08-28', price: 4538, units: 21, kind: 'in' },
    { date: '2026-08-31', price: 4505, units: 1, kind: 'out' },
    { date: '2026-09-01', price: 4400, units: 20, kind: 'out' },
  ],
};

test('each session is valued at the size the position had that day', () => {
  const r = vm.compute({ leg: shrinking, ...trade, settles, rates });
  assert.strictEqual(r.sessions, 3);
  // 28.08: 21 lots marked from 4538 to 4531 at 80
  near(r.rows[0].delta, (4531 - 4538) * 21 * -1 * 80, 0.5);
  assert.strictEqual(r.rows[0].position, 21);
  // 31.08: 21 lots from 4531 to 4500, plus the lot closed at 4505, at 81
  near(r.rows[1].delta, ((4500 - 4531) * 21 * -1 + (4500 - 4505) * 1) * 81, 0.5);
  assert.strictEqual(r.rows[1].position, 20);
  // 01.09: the remaining 20 from 4500 to the closing price, at 82
  near(r.rows[2].delta, (4400 - 4500) * 20 * -1 * 82, 0.5);
  assert.strictEqual(r.rows[2].position, 0);
  near(r.rub, 147 * 80 + 646 * 81 + 2000 * 82, 1);
  // and the sessions add up to the price result of the leg: 33 on one lot, 138 on twenty
  near(r.rows.reduce((s, x) => s + x.delta / x.rate, 0), 33 + 2760, 1e-6);
});

test('the same leg written as one entry and one exit is the old sum', () => {
  const plain = { side: 'Шорт', entryPrice: 4538, exitPrice: 4326.4, units: 21 };
  const a = vm.compute({ leg: plain, ...trade, settles, rates });
  const b = vm.compute({ leg: { side: 'Шорт', fills: [
    { date: '2026-08-28', price: 4538, units: 21, kind: 'in' },
    { date: '2026-09-01', price: 4326.4, units: 21, kind: 'out' },
  ] }, ...trade, settles, rates });
  near(b.rub, a.rub, 1e-6);
  assert.strictEqual(b.sessions, a.sessions);
});

test('a fill on a day the exchange did not clear waits for the next clearing', () => {
  const weekend = { side: 'Шорт', fills: [
    { date: '2026-08-29', price: 4538, units: 10, kind: 'in' },   // Saturday: no settle
    { date: '2026-09-01', price: 4400, units: 10, kind: 'out' },
  ] };
  const r = vm.compute({ leg: weekend, openDate: '2026-08-29', closeDate: '2026-09-01', settles, rates });
  assert.strictEqual(r.sessions, 2);      // 31.08 and the close
  near(r.rows[0].delta, (4500 - 4538) * 10 * -1 * 81, 0.5);
  near(r.rub, (4538 - 4400) * 10 * 82 - 38 * 10 * 81 + 38 * 10 * 81, 1e6);  // sane order of magnitude
});

test('a leg that is not fully closed has no margin', () => {
  const half = { side: 'Шорт', fills: shrinking.fills.slice(0, 2) };
  assert.strictEqual(vm.compute({ leg: half, ...trade, settles, rates }), null);
});
