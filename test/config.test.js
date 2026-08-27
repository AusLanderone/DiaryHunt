// test/config.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfig } = require('../src/config');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-cfg-'));

test('get seeds defaults on first use', () => {
  const cfg = createConfig({ dataDir: tmpDir() });
  const d = cfg.get();
  assert.deepStrictEqual(d.exchanges, ['MOEX', 'FOREX']);
  assert.deepStrictEqual(d.types, ['Фьючи', 'Крипто', 'RWA']);
  assert.deepStrictEqual(d.tags, ['Схождение', 'Раскор']);
});

test('addItem appends and dedupes, persists', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.addItem('exchanges', 'BINANCE');
  cfg.addItem('exchanges', 'BINANCE'); // duplicate ignored
  const reloaded = createConfig({ dataDir: dir });
  assert.deepStrictEqual(reloaded.get().exchanges, ['MOEX', 'FOREX', 'BINANCE']);
});

test('removeItem drops a value and persists across instances', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.get(); // seed defaults to disk
  cfg.removeItem('tags', 'Раскор');
  assert.deepStrictEqual(cfg.get().tags, ['Схождение']);
  const reloaded = createConfig({ dataDir: dir });
  assert.deepStrictEqual(reloaded.get().tags, ['Схождение']);
});
