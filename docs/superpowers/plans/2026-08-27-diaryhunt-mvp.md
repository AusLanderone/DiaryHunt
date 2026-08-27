# DiaryHunt MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Electron desktop diary for manual-entry arbitrage trades that reproduces the user's Google-Sheet logic (2-leg trades, verified formulas) with journal, entry form, stats and CSV export.

**Architecture:** Pure-logic core (`calc`, `store`, `config`, `export`) written as dependency-free CommonJS Node modules, unit-tested with the built-in `node:test` runner. Electron main process wires those modules to the OS `userData` directory over IPC; a vanilla-JS renderer (journal / form / stats) consumes them through a `contextBridge` API. No frameworks, no database — a single JSON file with automatic backups.

**Tech Stack:** Electron, vanilla JS (CommonJS in main/core, ES in renderer), Node built-ins (`fs`, `crypto`, `node:test`, `node:assert`), electron-builder (portable Windows exe).

## Global Constraints

- Node runtime: v20.12 (uses stable `node:test`, `crypto.randomUUID`) — do not add a test framework dependency.
- Core modules (`src/calc.js`, `src/store.js`, `src/config.js`, `src/export.js`) MUST be pure CommonJS with **no Electron imports** and no DOM — so they run under `node --test`.
- `store.js` / `config.js` MUST receive their data directory as a parameter (dependency injection) — never call Electron `app.getPath` inside them.
- MVP is **exactly 2 legs** per trade. No 3rd leg, no import, no cloud.
- Money/number rules: prices display `$` with 5 decimals, profit displays `₽`, spreads display `%`. Keep full precision in `calc`; format only in the renderer.
- Spread is computed by **leg order** (leg1 = base): `(leg2 - leg1) / leg1`. Leg gross is computed by **side** (Лонг: end−start, Шорт/Спот: see calc).
- Every write to disk creates a timestamped backup first.
- Commit after every task with a `feat:`/`test:`/`chore:` message.

---

### Task 1: Project scaffold + Electron blank window

**Files:**
- Create: `package.json`
- Create: `main.js`
- Create: `renderer/index.html`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm start` launches Electron and shows a window loading `renderer/index.html`. Later tasks add IPC to `main.js`.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "diaryhunt",
  "version": "0.1.0",
  "description": "Manual-entry arbitrage trade diary",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

- [ ] **Step 3: Create `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>DiaryHunt</title>
</head>
<body>
  <h1>DiaryHunt</h1>
</body>
</html>
```

- [ ] **Step 4: Create `main.js`**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

Note: `preload.js` does not exist yet; Electron tolerates a missing preload path at this stage. It is created in Task 6.

- [ ] **Step 5: Install deps and smoke-test**

Run: `npm install`
Then run: `npm start`
Expected: a 1280×800 window opens showing the heading "DiaryHunt". Close it.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json package-lock.json main.js renderer/index.html
git commit -m "chore: scaffold Electron app with blank window"
```

---

### Task 2: `calc.js` — verified trade formulas (TDD)

**Files:**
- Create: `src/calc.js`
- Test: `test/calc.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all pure functions, a `trade`/`leg` are plain objects per the spec):
  - `legPositionStart(leg) -> number` = `entryPrice * units`
  - `legPositionEnd(leg) -> number | null` = `exitPrice * units`, `null` if `exitPrice` missing
  - `legGross(leg) -> number | null` — Лонг/Спот: `end - start`; Шорт: `start - end`; `null` if no exit
  - `entrySpread(trade) -> number` = `(leg2.entryPrice - leg1.entryPrice) / leg1.entryPrice`
  - `exitSpread(trade) -> number | null` = `(leg2.exitPrice - leg1.exitPrice) / leg1.exitPrice`, `null` if any exit missing
  - `spreadTotal(trade) -> number | null` = `entrySpread - exitSpread`
  - `grossTotal(trade) -> number | null` = sum of `legGross`, `null` if any leg unclosed
  - `feeTotalRub(trade) -> number` = sum of `leg.feeRub`
  - `pnlNet(trade) -> number | null` = `grossTotal - feeTotalRub / usdRub`
  - `pnlRub(trade) -> number | null` = `pnlNet * usdRub`
  - `pnlNetPct(trade) -> number | null` = `pnlNet / (leg1.start + leg2.start)`
  - `netProfitRub(trade) -> number | null` = `pnlRub + (payout||0) + (adjustment||0)`
  - `isClosed(trade) -> boolean` = both legs have `exitPrice` and `trade.closeDate` truthy
  - `computeTrade(trade) -> object` aggregating all of the above (keys: `legs:[{start,end,gross}]`, `entrySpread, exitSpread, spreadTotal, grossTotal, feeTotalRub, pnlNet, pnlRub, pnlNetPct, netProfitRub, closed`)

- [ ] **Step 1: Write the failing test with real spreadsheet fixtures**

```js
// test/calc.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const calc = require('../src/calc');

// Trade #1 from the source sheet (Лонг leg first)
const trade1 = {
  usdRub: 83.70, payout: -295, adjustment: 0, closeDate: '2026-08-13',
  legs: [
    { side: 'Лонг', entryPrice: 1.15050, units: 42000, exitPrice: 1.15190, feeRub: 270 },
    { side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
};

// Trade #3: legs reversed (Шорт leg first) — guards spread-by-leg-order + short-first gross
const trade3 = {
  usdRub: 84.95, payout: 3061, adjustment: 0, closeDate: '2026-08-17',
  legs: [
    { side: 'Шорт', entryPrice: 65.76, units: 530, exitPrice: 66.57, feeRub: 46 },
    { side: 'Лонг', entryPrice: 65.269, units: 500, exitPrice: 66.149, feeRub: 0 },
  ],
};

// Trade #11: open (no exits)
const tradeOpen = {
  usdRub: 84.50, payout: 0, adjustment: 0, closeDate: '',
  legs: [
    { side: 'Шорт', entryPrice: 68.95, units: 530, exitPrice: null, feeRub: 0 },
    { side: 'Лонг', entryPrice: 68.713, units: 500, exitPrice: null, feeRub: 0 },
  ],
};

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('leg position start/end/gross — long and short', () => {
  near(calc.legPositionStart(trade1.legs[0]), 48321.0);
  near(calc.legPositionEnd(trade1.legs[0]), 48379.8);
  near(calc.legGross(trade1.legs[0]), 58.8);      // long: end - start
  near(calc.legGross(trade1.legs[1]), -36.8);     // short: start - end
});

test('entry/exit/total spread by leg order (trade 1)', () => {
  near(calc.entrySpread(trade1), 0.001903, 1e-5);
  near(calc.exitSpread(trade1), 0.001484, 1e-5);
  near(calc.spreadTotal(trade1), 0.000419, 1e-5);
});

test('spread sign is leg-order based, not side based (trade 3)', () => {
  assert.ok(calc.entrySpread(trade3) < 0, 'entry spread must be negative for trade 3');
  near(calc.entrySpread(trade3), -0.007466, 1e-4);
});

test('trade totals match sheet (trade 1)', () => {
  near(calc.grossTotal(trade1), 22.0);
  near(calc.feeTotalRub(trade1), 502);
  near(calc.pnlNet(trade1), 16.0, 0.02);
  near(calc.pnlRub(trade1), 1339.4, 0.5);
  near(calc.pnlNetPct(trade1), 0.00016947, 1e-6);
  near(calc.netProfitRub(trade1), 1044.4, 0.5);
});

test('trade totals match sheet (trade 3, short leg first)', () => {
  near(calc.grossTotal(trade3), 10.7);
  near(calc.pnlNet(trade3), 10.16, 0.02);
  near(calc.netProfitRub(trade3), 3923.97, 0.5);
});

test('open trade returns nulls for exit-dependent values', () => {
  assert.strictEqual(calc.exitSpread(tradeOpen), null);
  assert.strictEqual(calc.grossTotal(tradeOpen), null);
  assert.strictEqual(calc.pnlNet(tradeOpen), null);
  assert.strictEqual(calc.isClosed(tradeOpen), false);
  near(calc.legPositionStart(tradeOpen.legs[0]), 36543.5); // start still computable
});

test('computeTrade aggregates everything', () => {
  const c = calc.computeTrade(trade1);
  near(c.netProfitRub, 1044.4, 0.5);
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.legs.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/calc'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/calc.js
'use strict';

const hasExit = (leg) => leg.exitPrice !== null && leg.exitPrice !== undefined && leg.exitPrice !== '';

function legPositionStart(leg) {
  return Number(leg.entryPrice) * Number(leg.units);
}

function legPositionEnd(leg) {
  if (!hasExit(leg)) return null;
  return Number(leg.exitPrice) * Number(leg.units);
}

function legGross(leg) {
  const end = legPositionEnd(leg);
  if (end === null) return null;
  const start = legPositionStart(leg);
  return leg.side === 'Шорт' ? start - end : end - start; // Лонг/Спот: end - start
}

function entrySpread(trade) {
  const [a, b] = trade.legs;
  return (Number(b.entryPrice) - Number(a.entryPrice)) / Number(a.entryPrice);
}

function exitSpread(trade) {
  const [a, b] = trade.legs;
  if (!hasExit(a) || !hasExit(b)) return null;
  return (Number(b.exitPrice) - Number(a.exitPrice)) / Number(a.exitPrice);
}

function spreadTotal(trade) {
  const ex = exitSpread(trade);
  if (ex === null) return null;
  return entrySpread(trade) - ex;
}

function grossTotal(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const g = legGross(leg);
    if (g === null) return null;
    sum += g;
  }
  return sum;
}

function feeTotalRub(trade) {
  return trade.legs.reduce((s, leg) => s + Number(leg.feeRub || 0), 0);
}

function pnlNet(trade) {
  const gross = grossTotal(trade);
  if (gross === null) return null;
  return gross - feeTotalRub(trade) / Number(trade.usdRub);
}

function pnlRub(trade) {
  const net = pnlNet(trade);
  return net === null ? null : net * Number(trade.usdRub);
}

function pnlNetPct(trade) {
  const net = pnlNet(trade);
  if (net === null) return null;
  const base = trade.legs.reduce((s, leg) => s + legPositionStart(leg), 0);
  return base === 0 ? null : net / base;
}

function netProfitRub(trade) {
  const rub = pnlRub(trade);
  if (rub === null) return null;
  return rub + Number(trade.payout || 0) + Number(trade.adjustment || 0);
}

function isClosed(trade) {
  return Boolean(trade.closeDate) && trade.legs.every(hasExit);
}

function computeTrade(trade) {
  return {
    legs: trade.legs.map((leg) => ({
      start: legPositionStart(leg),
      end: legPositionEnd(leg),
      gross: legGross(leg),
    })),
    entrySpread: entrySpread(trade),
    exitSpread: exitSpread(trade),
    spreadTotal: spreadTotal(trade),
    grossTotal: grossTotal(trade),
    feeTotalRub: feeTotalRub(trade),
    pnlNet: pnlNet(trade),
    pnlRub: pnlRub(trade),
    pnlNetPct: pnlNetPct(trade),
    netProfitRub: netProfitRub(trade),
    closed: isClosed(trade),
  };
}

module.exports = {
  legPositionStart, legPositionEnd, legGross,
  entrySpread, exitSpread, spreadTotal,
  grossTotal, feeTotalRub, pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `calc` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/calc.js test/calc.test.js
git commit -m "feat: add verified trade calculation module"
```

---

### Task 3: `store.js` — JSON persistence with backups (TDD)

**Files:**
- Create: `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: `crypto.randomUUID`, `fs`.
- Produces: `createStore({ dataDir }) -> store` where `store` has:
  - `list() -> trade[]` (sorted by `num` ascending)
  - `get(id) -> trade | undefined`
  - `add(tradeInput) -> trade` — assigns `id` (uuid) and `num` (max existing + 1), persists, returns stored trade
  - `update(id, patch) -> trade` — shallow-merges `patch`, persists, returns updated trade (throws if id missing)
  - `remove(id) -> void`
  - Data file: `<dataDir>/trades.json` shaped `{ "trades": [] }`
  - Backups: before any write, copies current `trades.json` (if it exists) to `<dataDir>/backups/trades-<ISO-ish timestamp>.json`

- [ ] **Step 1: Write the failing test**

```js
// test/store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-'));
}

const sampleTrade = () => ({
  openDate: '2026-08-13', closeDate: '2026-08-13', type: 'Фьючи',
  ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: -295, adjustment: 0,
  comment: '', legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
});

test('add assigns id and incrementing num, list returns it', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t1 = store.add(sampleTrade());
  const t2 = store.add(sampleTrade());
  assert.ok(t1.id && t2.id && t1.id !== t2.id);
  assert.strictEqual(t1.num, 1);
  assert.strictEqual(t2.num, 2);
  assert.strictEqual(store.list().length, 2);
});

test('persists across store instances', () => {
  const dir = tmpDir();
  const s1 = createStore({ dataDir: dir });
  const added = s1.add(sampleTrade());
  const s2 = createStore({ dataDir: dir });
  assert.strictEqual(s2.get(added.id).ticker, 'ED');
});

test('update merges patch and persists', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t = store.add(sampleTrade());
  const upd = store.update(t.id, { comment: 'hello' });
  assert.strictEqual(upd.comment, 'hello');
  assert.strictEqual(store.get(t.id).comment, 'hello');
});

test('remove deletes the trade', () => {
  const store = createStore({ dataDir: tmpDir() });
  const t = store.add(sampleTrade());
  store.remove(t.id);
  assert.strictEqual(store.get(t.id), undefined);
});

test('a backup file is written on the second write', () => {
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });
  store.add(sampleTrade()); // first write, no prior file to back up
  store.add(sampleTrade()); // second write backs up the existing file
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.ok(backups.length >= 1, 'expected at least one backup');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/store'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/store.js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore({ dataDir }) {
  const file = path.join(dataDir, 'trades.json');
  const backupDir = path.join(dataDir, 'backups');

  function ensureDirs() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
  }

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')).trades || [];
    } catch {
      return [];
    }
  }

  function backup() {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, `trades-${stamp}.json`));
  }

  function write(trades) {
    ensureDirs();
    backup();
    fs.writeFileSync(file, JSON.stringify({ trades }, null, 2), 'utf8');
  }

  function list() {
    return read().slice().sort((a, b) => a.num - b.num);
  }

  function get(id) {
    return read().find((t) => t.id === id);
  }

  function add(input) {
    const trades = read();
    const num = trades.reduce((m, t) => Math.max(m, t.num || 0), 0) + 1;
    const trade = { ...input, id: crypto.randomUUID(), num };
    trades.push(trade);
    write(trades);
    return trade;
  }

  function update(id, patch) {
    const trades = read();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Trade not found: ${id}`);
    trades[idx] = { ...trades[idx], ...patch, id };
    write(trades);
    return trades[idx];
  }

  function remove(id) {
    write(read().filter((t) => t.id !== id));
  }

  return { list, get, add, update, remove };
}

module.exports = { createStore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `calc` and `store` suites green.

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: add JSON trade store with backups"
```

---

### Task 4: `config.js` — dictionaries for dropdowns (TDD)

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `fs`.
- Produces: `createConfig({ dataDir }) -> config` where `config` has:
  - `get() -> { exchanges: string[], tags: string[], types: string[] }` — returns stored dicts, seeding defaults on first call
  - `addItem(kind, value) -> void` — `kind` in `'exchanges'|'tags'|'types'`; ignores duplicates
  - `removeItem(kind, value) -> void`
  - Defaults: `exchanges: ['MOEX','FOREX']`, `tags: ['Схождение','Раскор']`, `types: ['Фьючи','Крипто','RWA']`
  - Data file: `<dataDir>/config.json`

- [ ] **Step 1: Write the failing test**

```js
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
  assert.ok(d.tags.includes('Схождение'));
});

test('addItem appends and dedupes, persists', () => {
  const dir = tmpDir();
  const cfg = createConfig({ dataDir: dir });
  cfg.addItem('exchanges', 'BINANCE');
  cfg.addItem('exchanges', 'BINANCE'); // duplicate ignored
  const reloaded = createConfig({ dataDir: dir });
  assert.deepStrictEqual(reloaded.get().exchanges, ['MOEX', 'FOREX', 'BINANCE']);
});

test('removeItem drops a value', () => {
  const cfg = createConfig({ dataDir: tmpDir() });
  cfg.removeItem('tags', 'Раскор');
  assert.deepStrictEqual(cfg.get().tags, ['Схождение']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/config.js
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  exchanges: ['MOEX', 'FOREX'],
  tags: ['Схождение', 'Раскор'],
  types: ['Фьючи', 'Крипто', 'RWA'],
};

function createConfig({ dataDir }) {
  const file = path.join(dataDir, 'config.json');

  function read() {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function get() {
    const data = read();
    if (!fs.existsSync(file)) write(data); // seed defaults
    return data;
  }

  function addItem(kind, value) {
    const data = read();
    if (!data[kind].includes(value)) {
      data[kind] = [...data[kind], value];
      write(data);
    }
  }

  function removeItem(kind, value) {
    const data = read();
    data[kind] = data[kind].filter((v) => v !== value);
    write(data);
  }

  return { get, addItem, removeItem };
}

module.exports = { createConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: add dictionary config module"
```

---

### Task 5: `export.js` — CSV export matching the sheet (TDD)

**Files:**
- Create: `src/export.js`
- Test: `test/export.test.js`

**Interfaces:**
- Consumes: `src/calc.js`.
- Produces: `tradesToCsv(trades) -> string`
  - Two rows per trade (one per leg). Trade-level fields appear only on the first (leg1) row; second row leaves them blank.
  - Header (comma-separated, in order): `№,Дата открытия,Дата закрытия,Тип,Тикер,Тег,Биржа,Сделка,Цена вход,Кол единиц,Цена выход,Комса,Позиция начало,Вход спред,Выход спред,Спред итог,Позиция конец,PnL gross,PnL net,PnL руб,% PnL net,USDRUB,Пейаут,Чистый профит,Комментарий`
  - Computed columns come from `calc`. Spread/net/profit columns (trade-level) go on the leg1 row only; `Позиция начало/конец` and `PnL gross` are per-leg.
  - Values containing `,`, `"`, or newline are quoted with `"` and inner quotes doubled.
  - `null` computed values render as empty string.

- [ ] **Step 1: Write the failing test**

```js
// test/export.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { tradesToCsv } = require('../src/export');

const trade1 = {
  num: 1, openDate: '2026-08-13', closeDate: '2026-08-13', type: 'Фьючи',
  ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: -295, adjustment: 0,
  comment: 'hi, there', legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
};

test('csv has header plus two rows per trade', () => {
  const csv = tradesToCsv([trade1]);
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines.length, 3); // header + 2 legs
  assert.ok(lines[0].startsWith('№,Дата открытия'));
});

test('leg1 row carries trade-level fields, leg2 row blanks them', () => {
  const rows = tradesToCsv([trade1]).trim().split('\n');
  const leg1 = rows[1].split(',');
  assert.strictEqual(leg1[0], '1');          // №
  assert.strictEqual(leg1[4], 'ED');         // Тикер
  const leg2 = rows[2];
  assert.ok(leg2.startsWith(',,,,,,FOREX')); // leading trade-level cells blank, then Биржа
});

test('fields with commas are quoted', () => {
  const csv = tradesToCsv([trade1]);
  assert.ok(csv.includes('"hi, there"'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/export'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/export.js
'use strict';

const calc = require('./calc');

const HEADER = [
  '№', 'Дата открытия', 'Дата закрытия', 'Тип', 'Тикер', 'Тег',
  'Биржа', 'Сделка', 'Цена вход', 'Кол единиц', 'Цена выход', 'Комса',
  'Позиция начало', 'Вход спред', 'Выход спред', 'Спред итог', 'Позиция конец',
  'PnL gross', 'PnL net', 'PnL руб', '% PnL net', 'USDRUB', 'Пейаут',
  'Чистый профит', 'Комментарий',
];

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tradesToCsv(trades) {
  const lines = [HEADER.map(cell).join(',')];
  for (const trade of trades) {
    const c = calc.computeTrade(trade);
    trade.legs.forEach((leg, i) => {
      const first = i === 0;
      const lc = c.legs[i];
      lines.push([
        first ? trade.num : '',
        first ? trade.openDate : '',
        first ? trade.closeDate : '',
        first ? trade.type : '',
        first ? trade.ticker : '',
        first ? trade.tag : '',
        leg.exchange,
        leg.side,
        leg.entryPrice,
        leg.units,
        leg.exitPrice,
        leg.feeRub,
        lc.start,
        first ? c.entrySpread : '',
        first ? c.exitSpread : '',
        first ? c.spreadTotal : '',
        lc.end,
        lc.gross,
        first ? c.pnlNet : '',
        first ? c.pnlRub : '',
        first ? c.pnlNetPct : '',
        first ? trade.usdRub : '',
        first ? trade.payout : '',
        first ? c.netProfitRub : '',
        first ? trade.comment : '',
      ].map(cell).join(','));
    });
  }
  return lines.join('\n');
}

module.exports = { tradesToCsv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export.js test/export.test.js
git commit -m "feat: add CSV export module"
```

---

### Task 6: Electron IPC wiring (main + preload)

**Files:**
- Modify: `main.js`
- Create: `preload.js`

**Interfaces:**
- Consumes: `src/store.js`, `src/config.js`, `src/export.js` (+ `app.getPath('userData')` for `dataDir`).
- Produces: renderer-side global `window.api`:
  - `api.trades.list() -> Promise<trade[]>`
  - `api.trades.add(input) -> Promise<trade>`
  - `api.trades.update(id, patch) -> Promise<trade>`
  - `api.trades.remove(id) -> Promise<void>`
  - `api.config.get() -> Promise<{exchanges,tags,types}>`
  - `api.config.addItem(kind, value) -> Promise<void>`
  - `api.config.removeItem(kind, value) -> Promise<void>`
  - `api.exportCsv() -> Promise<{ saved: boolean, path?: string }>` (opens save dialog, writes CSV)
  - IPC channel names mirror the paths: `trades:list`, `trades:add`, `trades:update`, `trades:remove`, `config:get`, `config:addItem`, `config:removeItem`, `export:csv`.

- [ ] **Step 1: Add IPC handlers to `main.js`**

Replace the top of `main.js` (require block + `createWindow`) so it wires the modules and registers handlers:

```js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/store');
const { createConfig } = require('./src/config');
const { tradesToCsv } = require('./src/export');

let store, config;

function initData() {
  const dataDir = app.getPath('userData');
  store = createStore({ dataDir });
  config = createConfig({ dataDir });
}

function registerIpc() {
  ipcMain.handle('trades:list', () => store.list());
  ipcMain.handle('trades:add', (_e, input) => store.add(input));
  ipcMain.handle('trades:update', (_e, id, patch) => store.update(id, patch));
  ipcMain.handle('trades:remove', (_e, id) => store.remove(id));
  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:addItem', (_e, kind, value) => config.addItem(kind, value));
  ipcMain.handle('config:removeItem', (_e, kind, value) => config.removeItem(kind, value));
  ipcMain.handle('export:csv', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'diaryhunt-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, '﻿' + tradesToCsv(store.list()), 'utf8'); // BOM for Excel
    return { saved: true, path: filePath };
  });
}
```

Then update `app.whenReady()` to call the initializers:

```js
app.whenReady().then(() => {
  initData();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 2: Create `preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  trades: {
    list: () => ipcRenderer.invoke('trades:list'),
    add: (input) => ipcRenderer.invoke('trades:add', input),
    update: (id, patch) => ipcRenderer.invoke('trades:update', id, patch),
    remove: (id) => ipcRenderer.invoke('trades:remove', id),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    addItem: (kind, value) => ipcRenderer.invoke('config:addItem', kind, value),
    removeItem: (kind, value) => ipcRenderer.invoke('config:removeItem', kind, value),
  },
  exportCsv: () => ipcRenderer.invoke('export:csv'),
});
```

- [ ] **Step 3: Manual smoke test via DevTools**

Run: `npm start`. In the window, open DevTools (Ctrl+Shift+I) → Console, run:

```js
await window.api.config.get();
await window.api.trades.add({ openDate: '2026-08-13', closeDate: '', type: 'Фьючи', ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: 0, adjustment: 0, comment: '', legs: [{ exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: null, feeRub: 0 }, { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: null, feeRub: 0 }] });
await window.api.trades.list();
```

Expected: config returns defaults; add returns a trade with `id` and `num: 1`; list returns an array containing it.

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat: wire store/config/export over IPC"
```

---

### Task 7: Renderer — journal table + tab shell

**Files:**
- Modify: `renderer/index.html`
- Create: `renderer/styles.css`
- Create: `renderer/format.js`
- Create: `renderer/journal.js`
- Create: `renderer/app.js`

**Interfaces:**
- Consumes: `window.api`, `src/calc.js` logic re-imported in the renderer as `renderer/calc-view.js`? No — the renderer cannot `require`. Instead `format.js` holds display helpers, and computed values are recomputed in the renderer by importing calc via a `<script>`. To avoid duplication, load `src/calc.js` in the page with a UMD-style guard.
- Produces:
  - `format.js`: `fmtUsd(n)`, `fmtRub(n)`, `fmtPct(n)`, `fmtNum(n)` — return `''` for null/undefined.
  - `journal.js`: `renderJournal(container, trades, { onEdit, onDelete })` — draws the two-row-per-trade table with a totals row.
  - `app.js`: bootstraps tabs (Журнал / Статистика) and loads trades.

- [ ] **Step 1: Make `src/calc.js` loadable in the browser**

Append a UMD tail to `src/calc.js` so it also attaches to `window` when there is no `module`:

Add at the very bottom of `src/calc.js`, replacing the existing `module.exports = {...}` line with:

```js
const _api = {
  legPositionStart, legPositionEnd, legGross,
  entrySpread, exitSpread, spreadTotal,
  grossTotal, feeTotalRub, pnlNet, pnlRub, pnlNetPct, netProfitRub,
  isClosed, computeTrade,
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.calc = _api;
```

Run: `npm test` — Expected: PASS (calc tests still green; the `window` guard is inert under Node).

- [ ] **Step 2: Create `renderer/format.js`**

```js
const isNil = (n) => n === null || n === undefined || Number.isNaN(n);
function fmtUsd(n) { return isNil(n) ? '' : '$' + Number(n).toFixed(5); }
function fmtRub(n) { return isNil(n) ? '' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'; }
function fmtPct(n) { return isNil(n) ? '' : (Number(n) * 100).toFixed(4) + '%'; }
function fmtNum(n) { return isNil(n) ? '' : String(n); }
window.format = { fmtUsd, fmtRub, fmtPct, fmtNum };
```

- [ ] **Step 3: Create `renderer/styles.css`**

```css
* { box-sizing: border-box; font-family: system-ui, sans-serif; }
body { margin: 0; background: #1e1e1e; color: #e0e0e0; }
header { display: flex; gap: 8px; padding: 10px; background: #252526; align-items: center; }
button { background: #0e639c; color: #fff; border: 0; padding: 8px 14px; border-radius: 4px; cursor: pointer; }
button.secondary { background: #3a3d41; }
.tab { background: transparent; }
.tab.active { background: #0e639c; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #333; padding: 4px 6px; text-align: right; white-space: nowrap; }
th { background: #2d2d30; position: sticky; top: 0; }
td.text, th.text { text-align: left; }
tr.leg1 td { border-bottom: 0; }
tr.leg2 td { border-top: 0; color: #b0b0b0; }
tr.open td { background: #3a2f1a; }   /* open trade highlight */
td.calc { background: #2a2a1e; }       /* auto-computed columns */
.totals td { font-weight: bold; background: #1b3a1b; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; justify-content: center; align-items: flex-start; padding-top: 40px; }
.modal { background: #252526; padding: 20px; border-radius: 6px; width: 720px; max-height: 88vh; overflow: auto; }
.modal .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.modal label { display: flex; flex-direction: column; font-size: 12px; gap: 3px; }
.modal input, .modal select, .modal textarea { background: #1e1e1e; color: #e0e0e0; border: 1px solid #444; padding: 6px; border-radius: 3px; }
.leg-box { border: 1px solid #444; border-radius: 4px; padding: 10px; margin-top: 10px; }
.live { margin-top: 10px; padding: 8px; background: #1b2a1b; border-radius: 4px; font-size: 13px; }
#view { padding: 10px; overflow: auto; height: calc(100vh - 56px); }
```

- [ ] **Step 4: Create `renderer/journal.js`**

```js
function td(value, cls) {
  const el = document.createElement('td');
  if (cls) el.className = cls;
  el.textContent = value;
  return el;
}

function renderJournal(container, trades, { onEdit, onDelete }) {
  const F = window.format;
  container.innerHTML = '';
  const table = document.createElement('table');

  const headCols = ['№', 'Откр', 'Закр', 'Тип', 'Тикер', 'Тег', 'Биржа', 'Сделка',
    'Цена вход', 'Кол-во', 'Цена выход', 'Комса ₽', 'Поз. начало', 'Вход спред',
    'Спред итог', 'Поз. конец', 'PnL ноги', 'PnL net', 'Чистый ₽', ''];
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  headCols.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i >= 1 && i <= 5) th.className = 'text';
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let totalProfit = 0;

  trades.forEach((trade) => {
    const c = window.calc.computeTrade(trade);
    if (c.netProfitRub !== null) totalProfit += c.netProfitRub;
    const openCls = c.closed ? '' : ' open';

    trade.legs.forEach((leg, i) => {
      const first = i === 0;
      const lc = c.legs[i];
      const tr = document.createElement('tr');
      tr.className = (first ? 'leg1' : 'leg2') + openCls;
      tr.appendChild(td(first ? trade.num : '', 'text'));
      tr.appendChild(td(first ? trade.openDate : '', 'text'));
      tr.appendChild(td(first ? trade.closeDate : '', 'text'));
      tr.appendChild(td(first ? trade.type : '', 'text'));
      tr.appendChild(td(first ? trade.ticker : '', 'text'));
      tr.appendChild(td(first ? trade.tag : '', 'text'));
      tr.appendChild(td(leg.exchange, 'text'));
      tr.appendChild(td(leg.side, 'text'));
      tr.appendChild(td(F.fmtUsd(leg.entryPrice)));
      tr.appendChild(td(F.fmtNum(leg.units)));
      tr.appendChild(td(F.fmtUsd(leg.exitPrice)));
      tr.appendChild(td(F.fmtRub(leg.feeRub)));
      tr.appendChild(td(F.fmtUsd(lc.start), 'calc'));
      tr.appendChild(td(first ? F.fmtPct(c.entrySpread) : '', 'calc'));
      tr.appendChild(td(first ? F.fmtPct(c.spreadTotal) : '', 'calc'));
      tr.appendChild(td(F.fmtUsd(lc.end), 'calc'));
      tr.appendChild(td(F.fmtUsd(lc.gross), 'calc'));
      tr.appendChild(td(first ? F.fmtUsd(c.pnlNet) : '', 'calc'));
      tr.appendChild(td(first ? F.fmtRub(c.netProfitRub) : '', 'calc'));
      if (first) {
        const act = document.createElement('td');
        act.rowSpan = 2;
        const edit = document.createElement('button');
        edit.textContent = '✎'; edit.className = 'secondary';
        edit.onclick = () => onEdit(trade);
        const del = document.createElement('button');
        del.textContent = '🗑'; del.className = 'secondary';
        del.onclick = () => onDelete(trade);
        act.append(edit, del);
        tr.appendChild(act);
      }
      tbody.appendChild(tr);
    });
  });

  const totalTr = document.createElement('tr');
  totalTr.className = 'totals';
  totalTr.appendChild(td('ИТОГО', 'text'));
  for (let i = 1; i < 18; i++) totalTr.appendChild(td(''));
  totalTr.appendChild(td(F.fmtRub(totalProfit)));
  totalTr.appendChild(td(''));
  tbody.appendChild(totalTr);

  table.appendChild(tbody);
  container.appendChild(table);
}

window.journal = { renderJournal };
```

- [ ] **Step 5: Rewrite `renderer/index.html` to load the scripts and tab shell**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>DiaryHunt</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <button class="tab active" id="tab-journal">Журнал</button>
    <button class="tab" id="tab-stats">Статистика</button>
    <span style="flex:1"></span>
    <button id="btn-add">+ Сделка</button>
    <button class="secondary" id="btn-export">Экспорт CSV</button>
  </header>
  <div id="view"></div>

  <script src="../src/calc.js"></script>
  <script src="format.js"></script>
  <script src="journal.js"></script>
  <script src="form.js"></script>
  <script src="stats.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `renderer/app.js` (journal tab only for now)**

```js
const view = document.getElementById('view');
let trades = [];

async function refresh() {
  trades = await window.api.trades.list();
  showJournal();
}

function showJournal() {
  setActive('tab-journal');
  window.journal.renderJournal(view, trades, {
    onEdit: (t) => window.form.openForm(t, refresh),
    onDelete: async (t) => {
      if (confirm(`Удалить сделку №${t.num}?`)) { await window.api.trades.remove(t.id); refresh(); }
    },
  });
}

function showStats() {
  setActive('tab-stats');
  window.stats.renderStats(view, trades);
}

function setActive(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('tab-journal').onclick = showJournal;
document.getElementById('tab-stats').onclick = showStats;
document.getElementById('btn-add').onclick = () => window.form.openForm(null, refresh);
document.getElementById('btn-export').onclick = async () => {
  const r = await window.api.exportCsv();
  if (r.saved) alert('Сохранено: ' + r.path);
};

refresh();
```

Note: `form.js` and `stats.js` are created in Tasks 8–9; until then, comment out their `<script>` tags or the Add/Stats buttons will error. The implementer should do Tasks 7→8→9 in order.

- [ ] **Step 7: Manual verification**

Run: `npm start`. Add a trade via DevTools (as in Task 6 Step 3), then reload. Expected: the journal shows the trade as two rows, auto-columns tinted, open trade highlighted, ИТОГО row present.

- [ ] **Step 8: Commit**

```bash
git add renderer/ src/calc.js
git commit -m "feat: add journal table view and tab shell"
```

---

### Task 8: Renderer — trade form with live recalculation

**Files:**
- Create: `renderer/form.js`

**Interfaces:**
- Consumes: `window.api`, `window.calc`, `window.format`.
- Produces: `window.form.openForm(trade | null, onSaved)` — opens a modal to create (null) or edit a trade; on save calls `api.trades.add`/`update` then `onSaved()`. Recomputes spread/PnL live on every input.

- [ ] **Step 1: Create `renderer/form.js`**

```js
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
  children.forEach((c) => e.append(c));
  return e;
}

function field(label, input) {
  const l = el('label', {}, [document.createTextNode(label), input]);
  return l;
}

function legInputs(prefix, leg, cfg) {
  const ex = el('select');
  cfg.exchanges.forEach((x) => ex.append(new Option(x, x)));
  ex.value = leg.exchange || cfg.exchanges[0];
  const side = el('select');
  ['Лонг', 'Шорт', 'Спот'].forEach((s) => side.append(new Option(s, s)));
  side.value = leg.side || 'Лонг';
  const entry = el('input', { type: 'number', step: 'any', value: leg.entryPrice ?? '' });
  const units = el('input', { type: 'number', step: 'any', value: leg.units ?? '' });
  const exit = el('input', { type: 'number', step: 'any', value: leg.exitPrice ?? '' });
  const fee = el('input', { type: 'number', step: 'any', value: leg.feeRub ?? '' });
  const box = el('div', { class: 'leg-box' }, [
    el('div', { class: 'grid' }, [
      field('Биржа', ex), field('Сделка', side),
      field('Цена вход', entry), field('Кол-во единиц', units),
      field('Цена выход', exit), field('Комса ₽', fee),
    ]),
  ]);
  return { box, read: () => ({
    exchange: ex.value, side: side.value,
    entryPrice: entry.value === '' ? null : Number(entry.value),
    units: Number(units.value),
    exitPrice: exit.value === '' ? null : Number(exit.value),
    feeRub: fee.value === '' ? 0 : Number(fee.value),
  }), inputs: [ex, side, entry, units, exit, fee] };
}

async function openForm(trade, onSaved) {
  const cfg = await window.api.config.get();
  const t = trade || { openDate: '', closeDate: '', type: cfg.types[0], ticker: '',
    tag: cfg.tags[0], usdRub: '', payout: 0, adjustment: 0, comment: '',
    legs: [{}, {}] };

  const openDate = el('input', { type: 'date', value: t.openDate || '' });
  const closeDate = el('input', { type: 'date', value: t.closeDate || '' });
  const type = el('select'); cfg.types.forEach((x) => type.append(new Option(x, x))); type.value = t.type;
  const ticker = el('input', { type: 'text', value: t.ticker || '' });
  const tag = el('select'); cfg.tags.forEach((x) => tag.append(new Option(x, x))); tag.value = t.tag;
  const usdRub = el('input', { type: 'number', step: 'any', value: t.usdRub ?? '' });
  const payout = el('input', { type: 'number', step: 'any', value: t.payout ?? 0 });
  const comment = el('textarea', {}, [document.createTextNode(t.comment || '')]);

  const leg1 = legInputs('l1', t.legs[0] || {}, cfg);
  const leg2 = legInputs('l2', t.legs[1] || {}, cfg);
  const live = el('div', { class: 'live' });

  function draft() {
    return { usdRub: Number(usdRub.value) || 0, payout: Number(payout.value) || 0,
      adjustment: Number(t.adjustment) || 0, closeDate: closeDate.value,
      legs: [leg1.read(), leg2.read()] };
  }
  function recompute() {
    const c = window.calc.computeTrade(draft());
    const F = window.format;
    live.textContent =
      `Вход спред: ${F.fmtPct(c.entrySpread)} | Спред итог: ${F.fmtPct(c.spreadTotal)} | ` +
      `PnL net: ${F.fmtUsd(c.pnlNet)} | Чистый профит: ${F.fmtRub(c.netProfitRub)}`;
  }
  [usdRub, payout, closeDate, ...leg1.inputs, ...leg2.inputs].forEach((i) =>
    i.addEventListener('input', recompute));

  const save = el('button', {}, [document.createTextNode('Сохранить')]);
  const cancel = el('button', { class: 'secondary' }, [document.createTextNode('Отмена')]);

  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, [document.createTextNode(trade ? `Сделка №${trade.num}` : 'Новая сделка')]),
      el('div', { class: 'grid' }, [
        field('Дата открытия', openDate), field('Дата закрытия', closeDate),
        field('Тип', type), field('Тикер', ticker),
        field('Тег', tag), field('USDRUB', usdRub),
        field('Пейаут/перелив ₽', payout), field('Комментарий', comment),
      ]),
      el('div', {}, [leg1.box, leg2.box]),
      live,
      el('div', { style: 'margin-top:12px; display:flex; gap:8px;' }, [save, cancel]),
    ]),
  ]);

  cancel.onclick = () => backdrop.remove();
  save.onclick = async () => {
    const payload = {
      openDate: openDate.value, closeDate: closeDate.value, type: type.value,
      ticker: ticker.value, tag: tag.value, usdRub: Number(usdRub.value) || 0,
      payout: Number(payout.value) || 0, adjustment: Number(t.adjustment) || 0,
      comment: comment.value, legs: [leg1.read(), leg2.read()],
    };
    if (!ticker.value || !leg1.read().units || !leg2.read().units) {
      alert('Заполни тикер и количество по обеим ногам'); return;
    }
    if (trade) await window.api.trades.update(trade.id, payload);
    else await window.api.trades.add(payload);
    backdrop.remove();
    onSaved();
  };

  document.body.appendChild(backdrop);
  recompute();
}

window.form = { openForm };
```

- [ ] **Step 2: Manual verification**

Run: `npm start`. Click "+ Сделка". Enter trade #1 numbers from the sheet. Expected: the live line shows `Вход спред: 0.1903%`, `Чистый профит: 1 044.40 ₽` as you type the second leg's exit. Save → appears in journal. Edit it → values prefilled.

- [ ] **Step 3: Commit**

```bash
git add renderer/form.js
git commit -m "feat: add trade entry form with live recalculation"
```

---

### Task 9: Renderer — statistics + equity curve

**Files:**
- Create: `renderer/stats.js`

**Interfaces:**
- Consumes: `window.calc`, `window.format`.
- Produces: `window.stats.renderStats(container, trades)` — renders summary metrics and a zero-dependency `<canvas>` equity curve of cumulative `netProfitRub` over closed trades ordered by `num`.

- [ ] **Step 1: Create `renderer/stats.js`**

```js
function metric(label, value) {
  const box = document.createElement('div');
  box.style.cssText = 'display:inline-block; margin:8px 16px 8px 0; padding:10px 16px; background:#252526; border-radius:6px;';
  box.innerHTML = `<div style="font-size:12px;color:#aaa">${label}</div><div style="font-size:20px">${value}</div>`;
  return box;
}

function drawEquity(canvas, points) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 30;
  ctx.clearRect(0, 0, W, H);
  if (points.length === 0) return;
  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v) => H - pad - ((v - min) * (H - 2 * pad)) / Math.max(1e-9, max - min);
  ctx.strokeStyle = '#444'; ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke();
  ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

function renderStats(container, trades) {
  const F = window.format;
  container.innerHTML = '';
  const closed = trades.filter((t) => window.calc.isClosed(t))
    .sort((a, b) => a.num - b.num);
  const profits = closed.map((t) => window.calc.netProfitRub(t));
  const total = profits.reduce((s, v) => s + v, 0);
  const wins = profits.filter((v) => v > 0).length;
  const winrate = closed.length ? (wins / closed.length) * 100 : 0;
  const avg = closed.length ? total / closed.length : 0;

  const metrics = document.createElement('div');
  metrics.append(
    metric('Всего сделок (закрыто)', closed.length),
    metric('Суммарный профит', F.fmtRub(total)),
    metric('Винрейт', winrate.toFixed(1) + '%'),
    metric('Средний профит', F.fmtRub(avg)),
  );
  container.appendChild(metrics);

  const title = document.createElement('h3');
  title.textContent = 'Кривая капитала (₽, накопительно)';
  container.appendChild(title);

  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 320;
  canvas.style.cssText = 'background:#1b1b1b; border:1px solid #333; border-radius:6px;';
  container.appendChild(canvas);

  let cum = 0;
  drawEquity(canvas, profits.map((v) => (cum += v)));
}

window.stats = { renderStats };
```

- [ ] **Step 2: Manual verification**

Run: `npm start`. Add 2–3 closed trades, open the "Статистика" tab. Expected: four metric boxes with correct totals and a green cumulative line above/below the zero axis.

- [ ] **Step 3: Commit**

```bash
git add renderer/stats.js
git commit -m "feat: add statistics view with equity curve"
```

---

### Task 10: Packaging — portable Windows exe

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: electron-builder.
- Produces: `npm run dist` builds a portable `.exe` into `dist/`.

- [ ] **Step 1: Add build config and script to `package.json`**

Add a `dist` script and a `build` block (merge into the existing JSON):

```json
{
  "scripts": {
    "start": "electron .",
    "test": "node --test",
    "dist": "electron-builder"
  },
  "build": {
    "appId": "com.diaryhunt.app",
    "productName": "DiaryHunt",
    "files": ["main.js", "preload.js", "src/**/*", "renderer/**/*"],
    "win": {
      "target": "portable",
      "signAndEditExecutable": false
    }
  }
}
```

Note: `signAndEditExecutable: false` avoids the Windows signing/edit step that has failed on this machine before (per InvestHunt build experience).

- [ ] **Step 2: Build**

Run: `npm run dist`
Expected: `dist/DiaryHunt <version>.exe` is produced without a signing error.

- [ ] **Step 3: Smoke-test the portable exe**

Run the produced `.exe`. Expected: app launches, add a trade, close and reopen — data persists (stored under `%APPDATA%/DiaryHunt`).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add portable Windows build config"
```

---

## Self-Review

**1. Spec coverage:**
- Domain model + stored JSON shape → Tasks 2, 3. ✓
- All verified formulas (positions, spreads, PnL, net profit, %) → Task 2 with sheet fixtures. ✓
- Spread by leg order (the corrected formula) → Task 2 `entrySpread`/`exitSpread` + trade3 sign test. ✓
- Dictionaries (exchanges/tags/types) → Task 4. ✓
- Journal screen (2 rows/trade, colored open/closed, auto-columns, totals) → Task 7. ✓
- Form with live recompute + validation → Task 8. ✓
- Statistics + equity curve → Task 9. ✓
- CSV export compatible with the sheet → Tasks 5, 6 (dialog). ✓
- Auto-backups before writes → Task 3. ✓
- Number formatting rules → Task 7 `format.js`. ✓
- Portable exe (`signAndEditExecutable:false`) → Task 10. ✓
- MVP bounded to 2 legs → enforced throughout. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code. The only forward-reference note (form.js/stats.js scripts in Task 7) is intentional and explained, with an ordering instruction.

**3. Type consistency:** `computeTrade` shape (`legs[].start/end/gross`, `entrySpread`, `spreadTotal`, `pnlNet`, `netProfitRub`, `closed`) is defined in Task 2 and consumed identically in Tasks 5, 7, 8, 9. `window.api` surface defined in Task 6 matches every renderer call. Store methods (`list/get/add/update/remove`) consistent across Tasks 3, 6. `format` helpers (`fmtUsd/fmtRub/fmtPct/fmtNum`) defined in Task 7, used in 7/8/9. No signature drift found.

