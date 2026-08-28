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

test('getSettings returns defaults, setSettings merges and persists', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  assert.deepStrictEqual(cfg.getSettings(), { font: 'system', theme: 'default', scale: 1 });
  cfg.setSettings({ theme: 'ocean', scale: 1.1 });
  const reloaded = createConfig({ dataDir: dir });
  const s = reloaded.getSettings();
  assert.strictEqual(s.theme, 'ocean');
  assert.strictEqual(s.scale, 1.1);
  assert.strictEqual(s.font, 'system'); // untouched default preserved
});

test('setSettings does not disturb dictionaries', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.addItem('tags', 'Пробой');
  cfg.setSettings({ theme: 'violet' });
  const reloaded = createConfig({ dataDir: dir });
  assert.ok(reloaded.get().tags.includes('Пробой'));
  assert.strictEqual(reloaded.getSettings().theme, 'violet');
});

test('importAll merges dictionaries and settings from a snapshot', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.importAll({
    exchanges: ['MOEX', 'FOREX', 'BYBIT'],
    tags: ['Схождение'],
    types: ['Фьючи'],
    settings: { theme: 'ocean', font: 'serif', scale: 1.1 },
  });
  const reloaded = createConfig({ dataDir: dir });
  assert.deepStrictEqual(reloaded.get().exchanges, ['MOEX', 'FOREX', 'BYBIT']);
  assert.deepStrictEqual(reloaded.get().tags, ['Схождение']);
  assert.strictEqual(reloaded.getSettings().theme, 'ocean');
  assert.strictEqual(reloaded.getSettings().scale, 1.1);
});

test('importAll ignores junk input', () => {
  const cfg = createConfig({ dataDir: tmpDir() });
  cfg.importAll(null);
  cfg.importAll('nope');
  assert.deepStrictEqual(cfg.get().exchanges, ['MOEX', 'FOREX']); // defaults intact
});

test('tickers are a dictionary like tags: empty by default, appended on use', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  assert.deepStrictEqual(cfg.get().tickers, []);
  cfg.addItem('tickers', 'ED');
  cfg.addItem('tickers', 'ED');
  cfg.addItem('tickers', 'SILV');
  const reloaded = createConfig({ dataDir: dir });
  assert.deepStrictEqual(reloaded.get().tickers, ['ED', 'SILV']);
});

test('importAll carries the ticker dictionary too', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.importAll({ tickers: ['GOLD', 'ED'], tags: ['Схождение'] });
  assert.deepStrictEqual(createConfig({ dataDir: dir }).get().tickers, ['GOLD', 'ED']);
});
