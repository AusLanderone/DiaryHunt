// test/cloudSync.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const sync = require('../src/cloudSync');

const T = {
  old: '2026-08-28T10:00:00.000Z',
  mid: '2026-08-28T12:00:00.000Z',
  new: '2026-08-28T14:00:00.000Z',
};

test('decide — no folder means synchronisation is simply off', () => {
  assert.strictEqual(sync.decide({ dir: '', cloud: null, state: {} }).action, 'off');
  assert.strictEqual(sync.decide({ dir: null, cloud: null, state: {} }).action, 'off');
});

test('decide — an empty folder gets the local database', () => {
  const d = sync.decide({ dir: 'G:/drive', cloud: null, state: { lastPushAt: T.old } });
  assert.strictEqual(d.action, 'push');
  assert.match(d.reason, /пусто|впервые/i);
});

test('decide — a newer cloud file wins and is pulled whole', () => {
  const d = sync.decide({
    dir: 'G:/drive',
    cloud: { syncedAt: T.new, device: 'LAPTOP' },
    state: { lastPushAt: T.mid, lastChangeAt: T.old },
  });
  assert.strictEqual(d.action, 'pull');
  assert.match(d.reason, /облак/i);
});

test('decide — local changes since the last push are sent up', () => {
  const d = sync.decide({
    dir: 'G:/drive',
    cloud: { syncedAt: T.old },
    state: { lastPushAt: T.mid, lastChangeAt: T.new },
  });
  assert.strictEqual(d.action, 'push');
});

test('decide — nothing moved on either side', () => {
  const d = sync.decide({
    dir: 'G:/drive',
    cloud: { syncedAt: T.mid },
    state: { lastPushAt: T.mid, lastChangeAt: T.old },
  });
  assert.strictEqual(d.action, 'idle');
});

test('decide — a cloud file written by this device is not pulled back', () => {
  // the same instant on both sides means it is our own upload
  const d = sync.decide({
    dir: 'G:/drive',
    cloud: { syncedAt: T.mid },
    state: { lastPushAt: T.mid, lastChangeAt: T.mid },
  });
  assert.strictEqual(d.action, 'idle');
});

test('stamp — marks the payload with a time and this device', () => {
  const s = sync.stamp({ trades: [] }, { device: 'PC-1', now: new Date(T.mid) });
  assert.strictEqual(s.syncedAt, T.mid);
  assert.strictEqual(s.device, 'PC-1');
  assert.deepStrictEqual(s.trades, []);
});

test('parse — reads a stamped backup back', () => {
  const s = sync.stamp({ app: 'DiaryHunt', trades: [{ num: 1 }] }, { device: 'PC-1' });
  const p = sync.parse(JSON.stringify(s));
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.data.device, 'PC-1');
  assert.strictEqual(p.data.trades.length, 1);
});

test('parse — refuses rubbish with a reason instead of throwing', () => {
  for (const bad of ['', '{ not json', '[]', '{"hello":1}']) {
    const p = sync.parse(bad);
    assert.strictEqual(p.ok, false, JSON.stringify(bad));
    assert.ok(p.error && p.error.length > 5, p.error);
  }
});

test('fileName — one fixed file, so the folder never fills up with copies', () => {
  assert.strictEqual(sync.FILE_NAME, 'diaryhunt-db.json');
});
