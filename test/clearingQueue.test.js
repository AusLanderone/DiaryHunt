// test/clearingQueue.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { pending, needsClearing } = require('../src/clearingQueue');

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
