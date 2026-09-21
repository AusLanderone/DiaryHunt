// test/clearingQueue.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { pending, needsClearing, pendingOpen } = require('../src/clearingQueue');

const moex = (extra = {}) => ({
  exchange: 'MOEX', side: 'Шорт', entryPrice: 4538, units: 21, exitPrice: 4326.4, feeRub: 550, ...extra,
});
const forex = { exchange: 'FOREX', side: 'Лонг', entryPrice: 4520.7, units: 20, exitPrice: 4319.89, feeRub: 60 };
const trade = (legs, extra = {}) => ({
  id: 't1', num: 13, ticker: 'GOLD', usdRub: 85.43,
  openDate: '2026-08-28', closeDate: '2026-09-17', legs, ...extra,
});
const fresh = (leg, t) => ({ ...leg, vmRub: 378316, vmMeta: { secid: 'GDU6', sessions: 15,
  fingerprint: require('../src/calc').vmFingerprint(leg, t) } });

test('a closed MOEX leg with no figure is what needs computing', () => {
  const t = trade([moex(), forex]);
  assert.deepStrictEqual(pending([t]), [{ id: 't1', num: 13, index: 0, ticker: 'GOLD' }]);
});

test('the other venue is never queued — it is not paid in roubles', () => {
  assert.strictEqual(needsClearing(forex, trade([moex(), forex])), false);
});

test('a leg already computed is left alone', () => {
  const base = moex();
  const t = trade([base, forex]);
  const done = trade([fresh(base, t), forex]);
  assert.deepStrictEqual(pending([done]), []);
});

test('a figure whose inputs moved is queued again', () => {
  const base = moex();
  const t = trade([base, forex]);
  const stale = trade([{ ...fresh(base, t), units: 20 }, forex]);
  assert.strictEqual(pending(stale.legs && [stale]).length, 1);
});

test('a broker figure means nothing to compute', () => {
  const t = trade([moex({ pnlFactRub: 15788.4 }), forex]);
  assert.deepStrictEqual(pending([t]), []);
});

test('open trades and unclosed legs stay out of the queue', () => {
  const open = trade([moex({ exitPrice: null }), forex], { closeDate: '' });
  assert.deepStrictEqual(pending([open]), []);
  const halfLeg = trade([moex({ fills: [
    { date: '2026-08-28', price: 4538, units: 21, kind: 'in' },
    { date: '2026-09-03', price: 4496.5, units: 1, kind: 'out' },
  ] }), forex]);
  assert.deepStrictEqual(pending([halfLeg]), []);
});

test('the queue runs oldest trade first', () => {
  const a = { ...trade([moex(), forex]), id: 'a', num: 20 };
  const b = { ...trade([moex(), forex]), id: 'b', num: 4 };
  assert.deepStrictEqual(pending([a, b]).map((x) => x.num), [4, 20]);
});

test('rubbish in the list does not throw', () => {
  assert.deepStrictEqual(pending(null), []);
  assert.deepStrictEqual(pending([null, {}, { legs: [] }]), []);
});

// ---------- open positions get refreshed, not computed once ----------
const openTrade = (legs, extra = {}) => ({
  id: 'o1', num: 27, ticker: 'GOLD', usdRub: 84.2,
  openDate: '2026-09-18', closeDate: '', legs, ...extra,
});
const openLeg = (extra = {}) => ({ exchange: 'MOEX', side: 'Шорт', entryPrice: 4411.3, units: 21, exitPrice: null, ...extra });

test('an open MOEX leg with no accrual yet is queued', () => {
  const t = openTrade([openLeg(), forex]);
  assert.deepStrictEqual(pendingOpen([t], '2026-09-21'),
    [{ id: 'o1', num: 27, index: 0, ticker: 'GOLD' }]);
});

test('an accrual from an earlier day is queued again — the sessions have moved on', () => {
  const leg = openLeg();
  const t = openTrade([leg, forex]);
  const fp = require('../src/calc').vmFingerprint(leg, t);
  const yesterday = openTrade([{ ...leg, vmOpenRub: 21420,
    vmOpenMeta: { through: '2026-09-18', computedAt: '2026-09-20T18:00:00.000Z', fingerprint: fp } }, forex]);
  assert.strictEqual(pendingOpen([yesterday], '2026-09-21').length, 1);
  const todayDone = openTrade([{ ...leg, vmOpenRub: 21420,
    vmOpenMeta: { through: '2026-09-18', computedAt: '2026-09-21T09:00:00.000Z', fingerprint: fp } }, forex]);
  assert.deepStrictEqual(pendingOpen([todayDone], '2026-09-21'), [], 'already done today');
});

test('closed trades are not in the open queue, and vice versa', () => {
  const closed = trade([moex(), forex]);
  assert.deepStrictEqual(pendingOpen([closed], '2026-09-21'), []);
  assert.deepStrictEqual(pending([openTrade([openLeg(), forex])]), []);
});
