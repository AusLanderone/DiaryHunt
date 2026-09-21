// test/marketCache.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketCache } = require('../src/marketCache');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dh-cache-'));

test('a remembered answer is not asked for twice', async () => {
  const dir = tmpDir();
  const cache = createMarketCache({ dataDir: dir });
  let calls = 0;
  const produce = async () => { calls++; return [{ date: '2026-08-28', settle: 4531 }]; };
  const a = await cache.remember('settles|GDU6|2026-08-01|2026-08-29', true, produce);
  const b = await cache.remember('settles|GDU6|2026-08-01|2026-08-29', true, produce);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(calls, 1);
});

test('what is still moving is not remembered', async () => {
  const cache = createMarketCache({ dataDir: tmpDir() });
  let calls = 0;
  const produce = async () => { calls++; return calls; };
  await cache.remember('settles|GDU6|today', false, produce);
  await cache.remember('settles|GDU6|today', false, produce);
  assert.strictEqual(calls, 2, 'a range that reaches today is asked for every time');
});

test('the cache survives a restart', async () => {
  const dir = tmpDir();
  await createMarketCache({ dataDir: dir }).remember('rates|2026-08', true, async () => ({ r: 84.2 }));
  let calls = 0;
  const again = await createMarketCache({ dataDir: dir })
    .remember('rates|2026-08', true, async () => { calls++; return null; });
  assert.deepStrictEqual(again, { r: 84.2 });
  assert.strictEqual(calls, 0);
});

test('a broken cache file is an empty cache, not a crash', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'market-cache.json'), '{ not json');
  const out = await createMarketCache({ dataDir: dir }).remember('k', true, async () => 'fresh');
  assert.strictEqual(out, 'fresh');
});

test('nothing is remembered for a producer that failed', async () => {
  const cache = createMarketCache({ dataDir: tmpDir() });
  await assert.rejects(() => cache.remember('k', true, async () => { throw new Error('ISS молчит'); }));
  const out = await cache.remember('k', true, async () => 'second try');
  assert.strictEqual(out, 'second try');
});

test('the cache can be emptied', async () => {
  const dir = tmpDir();
  const cache = createMarketCache({ dataDir: dir });
  await cache.remember('k', true, async () => 'one');
  cache.clear();
  assert.strictEqual(await cache.remember('k', true, async () => 'two'), 'two');
});
