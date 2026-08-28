# Three-Leg Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trade hold any number of legs (three in practice), with a multiplicative spread and a per-leg price currency, without changing a single number in the trades already recorded.

**Architecture:** All domain maths stays in `src/calc.js` as pure functions over `trade.legs`. Two new per-leg fields — `role` (`mul`/`div`) and `priceCcy` (`USD`/`RUB`) — drive the spread and the rouble conversion; both have defaults that reproduce today's behaviour for existing data. The renderer builds legs from an array instead of two hardcoded calls.

**Tech Stack:** Electron 33, plain JS (no build step), `node:test` for unit tests, playwright-core `_electron` for e2e.

**Spec:** `docs/superpowers/specs/2026-08-28-three-leg-trades-design.md`

## Global Constraints

- Trades already in the diary must keep their numbers to the kopeck. Trade #1 nets `1044.40 ₽` with entry spread `0.1904%`; trade #3 nets `3923.97 ₽` with a negative entry spread. Every task re-runs `npm test` and must keep these green.
- A leg with no `role` reads as `div` when it is `legs[0]` and `mul` otherwise.
- A leg with no `priceCcy` reads as `USD`, whatever its exchange.
- `MOEX` matching is case- and whitespace-insensitive (`calc.isRubLeg` already does this).
- Minimum two legs per trade, no upper bound.
- Fees are always in roubles. Swap stays in the leg's exchange currency (₽ on MOEX, $ elsewhere) — do not touch that logic.
- Renderer files are classic scripts sharing one global scope: any new top-level `const` in `src/*.js` must live inside the file's IIFE.

---

### Task 1: Per-leg price currency in the maths

**Files:**
- Modify: `src/calc.js`
- Test: `test/calc.test.js`

**Interfaces:**
- Produces: `calc.legPriceCcy(leg) -> 'USD'|'RUB'`, `calc.legPriceMul(leg, usdRub) -> number` (1 for a rouble leg, `usdRub` for a dollar leg), `calc.legGrossRub(leg, usdRub) -> number|null`.

- [ ] **Step 1: Write the failing tests**

```js
test('legPriceCcy — defaults to dollars, honours an explicit value', () => {
  assert.strictEqual(calc.legPriceCcy({ exchange: 'MOEX' }), 'USD');
  assert.strictEqual(calc.legPriceCcy({ exchange: 'MOEX', priceCcy: 'RUB' }), 'RUB');
  assert.strictEqual(calc.legPriceCcy({ exchange: 'BYBIT', priceCcy: 'RUB' }), 'RUB');
});

test('legPriceMul — a rouble leg is not converted, a dollar leg is', () => {
  near(calc.legPriceMul({ priceCcy: 'RUB' }, 85), 1);
  near(calc.legPriceMul({ priceCcy: 'USD' }, 85), 85);
  near(calc.legPriceMul({}, 85), 85);
});

test('legGrossRub — leg PnL in roubles, per its own currency', () => {
  // rouble leg: long 85500 -> 85600, 1 unit = +100 ₽
  near(calc.legGrossRub({ side: 'Лонг', entryPrice: 85500, exitPrice: 85600, units: 1, priceCcy: 'RUB' }, 85), 100);
  // dollar leg: short 7.19 -> 7.18, 100 units = +$1 = +85 ₽
  near(calc.legGrossRub({ side: 'Шорт', entryPrice: 7.19, exitPrice: 7.18, units: 100, priceCcy: 'USD' }, 85), 85);
  assert.strictEqual(calc.legGrossRub({ side: 'Лонг', entryPrice: 1, exitPrice: null, units: 1 }, 85), null);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/calc.test.js`
Expected: FAIL — `calc.legPriceCcy is not a function`.

- [ ] **Step 3: Implement**

In `src/calc.js`, next to `isRubLeg`:

```js
// Price currency is stored on the leg. Legs saved before this field existed are
// dollar-priced — including MOEX ones (ED, SILV quote in dollars), so it must
// not be inferred from the exchange here. The form picks the default at entry.
function legPriceCcy(leg) {
  return leg.priceCcy === 'RUB' ? 'RUB' : 'USD';
}

function legPriceMul(leg, usdRub) {
  return legPriceCcy(leg) === 'RUB' ? 1 : (Number(usdRub) || 0);
}

function legGrossRub(leg, usdRub) {
  const g = legGross(leg);
  return g === null ? null : g * legPriceMul(leg, usdRub);
}
```

Export all three from `_api`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS, all suites, including the trade #1 / #3 regressions.

- [ ] **Step 5: Commit**

```bash
git add src/calc.js test/calc.test.js
git commit -m "feat(calc): per-leg price currency, defaulting to dollars"
```

---

### Task 2: Money totals honour the price currency

**Files:**
- Modify: `src/calc.js` (`pnlRub`, `pnlNet`, `pnlNetPct`, `legPositionStart`/`End` consumers, `computeTrade`)
- Test: `test/calc.test.js`

**Interfaces:**
- Consumes: `legGrossRub`, `legPriceMul` from Task 1.
- Produces: `calc.positionStartRub(trade)`, `calc.positionEndRub(trade)`; `pnlRub` becomes the primary figure and `pnlNet` is derived as `pnlRub / usdRub`.

- [ ] **Step 1: Write the failing tests**

```js
// A mixed trade: one rouble leg on MOEX, one dollar leg elsewhere.
const mixed = {
  usdRub: 85, payout: 0, adjustment: 0, closeDate: '2026-08-28',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85600, feeRub: 50, priceCcy: 'RUB' },
    { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.19, units: 100, exitPrice: 7.18, feeRub: 30, priceCcy: 'USD' },
  ],
};

test('pnlRub — each leg converts by its own currency, fees are already roubles', () => {
  // +100 ₽ and +$1 (= 85 ₽), minus 80 ₽ of fees
  near(calc.pnlRub(mixed), 100 + 85 - 80);
});

test('pnlNet — the dollar figure is the rouble one at the trade rate', () => {
  near(calc.pnlNet(mixed), (100 + 85 - 80) / 85);
});

test('positionStartRub / positionEndRub — legs summed in roubles', () => {
  near(calc.positionStartRub(mixed), 85500 + 7.19 * 100 * 85);
  near(calc.positionEndRub(mixed), 85600 + 7.18 * 100 * 85);
});

test('all-dollar trades keep their verified numbers', () => {
  near(calc.pnlRub(trade1), 1339.40, 0.05);      // 1044.40 net minus the -295 payout
  near(calc.netProfitRub(trade1), 1044.40, 0.05);
  near(calc.netProfitRub(trade3), 3923.97, 0.5);
  near(calc.pnlNetPct(trade1), 0.000165, 1e-5);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/calc.test.js`
Expected: FAIL — `calc.positionStartRub is not a function`, and `pnlRub(mixed)` off by the unconverted rouble leg.

- [ ] **Step 3: Implement**

Replace the money section of `src/calc.js`:

```js
function positionStartRub(trade) {
  return trade.legs.reduce((s, leg) => s + legPositionStart(leg) * legPriceMul(leg, trade.usdRub), 0);
}

function positionEndRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const end = legPositionEnd(leg);
    if (end === null) return null;
    sum += end * legPriceMul(leg, trade.usdRub);
  }
  return sum;
}

// Roubles are the primary unit now: each leg's gross converts by its own price
// currency, fees are already roubles. The dollar figure is derived from it.
function pnlRub(trade) {
  let sum = 0;
  for (const leg of trade.legs) {
    const g = legGrossRub(leg, trade.usdRub);
    if (g === null) return null;
    sum += g;
  }
  return sum - feeTotalRub(trade);
}

function pnlNet(trade) {
  const rub = pnlRub(trade);
  const rate = Number(trade.usdRub) || 0;
  return rub === null || rate === 0 ? null : rub / rate;
}

function pnlNetPct(trade) {
  const rub = pnlRub(trade);
  const base = positionStartRub(trade);
  return rub === null || base === 0 ? null : rub / base;
}
```

Keep `netProfitRub` as is (it already adds payout, swap total and adjustment to `pnlRub`). Add `positionStartRub` and `positionEndRub` to `_api`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS. If trade #1 or #3 moved, the conversion is wrong — do not adjust the expected values, fix the code.

- [ ] **Step 5: Commit**

```bash
git add src/calc.js test/calc.test.js
git commit -m "feat(calc): totals convert each leg by its own price currency"
```

---

### Task 3: Multiplicative spread

**Files:**
- Modify: `src/calc.js` (`entrySpread`, `exitSpread`)
- Test: `test/calc.test.js`

**Interfaces:**
- Produces: `calc.legRole(leg, index) -> 'mul'|'div'`, `calc.spreadFormula(trade) -> string` (e.g. `"SI1! ÷ CR1! ÷ USDCNH"`), and `entrySpread`/`exitSpread` working for any leg count.

- [ ] **Step 1: Write the failing tests**

```js
// The user's triangle: synthetic USD/CNH from MOEX against the market cross.
const triangle = {
  usdRub: 85, payout: 0, adjustment: 0, closeDate: '2026-08-28',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85400, feeRub: 0, role: 'mul', priceCcy: 'RUB' },
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 11900, units: 1, exitPrice: 11880, feeRub: 0, role: 'div', priceCcy: 'RUB' },
    { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.180, units: 1, exitPrice: 7.175, feeRub: 0, role: 'div', priceCcy: 'USD' },
  ],
};

test('legRole — first leg divides, the rest multiply, explicit wins', () => {
  assert.strictEqual(calc.legRole({}, 0), 'div');
  assert.strictEqual(calc.legRole({}, 1), 'mul');
  assert.strictEqual(calc.legRole({ role: 'mul' }, 0), 'mul');
  assert.strictEqual(calc.legRole({ role: 'div' }, 1), 'div');
});

test('entrySpread — two legs keep the verified numbers', () => {
  near(calc.entrySpread(trade1), 0.001903, 1e-5);
  near(calc.exitSpread(trade1), 0.001484, 1e-5);
  near(calc.spreadTotal(trade1), 0.000419, 1e-5);
  assert.ok(calc.entrySpread(trade3) < 0, 'trade #3 entry spread stays negative');
});

test('entrySpread — the triangle divides the synthetic by the market cross', () => {
  // 85500 / (11900 * 7.180) - 1
  near(calc.entrySpread(triangle), 85500 / (11900 * 7.18) - 1, 1e-9);
  near(calc.exitSpread(triangle), 85400 / (11880 * 7.175) - 1, 1e-9);
});

test('entrySpread — degenerate shapes yield null instead of Infinity', () => {
  const oneLeg = { ...triangle, legs: [triangle.legs[0]] };
  assert.strictEqual(calc.entrySpread(oneLeg), null);
  const noDiv = { ...triangle, legs: triangle.legs.map((l) => ({ ...l, role: 'mul' })) };
  assert.strictEqual(calc.entrySpread(noDiv), null);
  const zeroDiv = { ...triangle, legs: [triangle.legs[0], { ...triangle.legs[1], entryPrice: 0 }] };
  assert.strictEqual(calc.entrySpread(zeroDiv), null);
});

test('spreadFormula — reads back as the trade was entered', () => {
  assert.strictEqual(calc.spreadFormula(triangle), 'MOEX ÷ MOEX ÷ VANTAGE');
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/calc.test.js`
Expected: FAIL — `calc.legRole is not a function`; the triangle spread is computed from the first two legs only.

- [ ] **Step 3: Implement**

Replace `entrySpread` / `exitSpread` in `src/calc.js`:

```js
// A leg either multiplies or divides the spread expression. The defaults make a
// two-leg trade read leg2 / leg1 - 1, which is exactly the (b - a) / a the
// sheet-verified formula used, so old trades keep their numbers.
function legRole(leg, index) {
  if (leg.role === 'mul' || leg.role === 'div') return leg.role;
  return index === 0 ? 'div' : 'mul';
}

// spread = Π(mul prices) / Π(div prices) - 1, over the given price field
function spreadOver(trade, field) {
  if (!trade.legs || trade.legs.length < 2) return null;
  let num = 1, den = 1, seenDen = false;
  for (const [i, leg] of trade.legs.entries()) {
    const price = Number(leg[field]);
    if (leg[field] === null || leg[field] === undefined || leg[field] === '' || Number.isNaN(price)) return null;
    if (legRole(leg, i) === 'div') { den *= price; seenDen = true; } else { num *= price; }
  }
  if (!seenDen || den === 0) return null;
  return num / den - 1;
}

const entrySpread = (trade) => spreadOver(trade, 'entryPrice');
const exitSpread = (trade) => spreadOver(trade, 'exitPrice');

// "MOEX ÷ MOEX ÷ VANTAGE" — what the spread is actually dividing by what
function spreadFormula(trade) {
  return trade.legs
    .map((leg, i) => (i === 0 ? leg.exchange : `${legRole(leg, i) === 'div' ? '÷' : '×'} ${leg.exchange}`))
    .join(' ');
}
```

Note `spreadTotal` already calls `entrySpread`/`exitSpread` and needs no change. Add `legRole` and `spreadFormula` to `_api`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS, including the trade #1 and #3 spread regressions.

- [ ] **Step 5: Commit**

```bash
git add src/calc.js test/calc.test.js
git commit -m "feat(calc): multiplicative spread over any number of legs"
```

---

### Task 4: Form builds legs from an array

**Files:**
- Modify: `renderer/form.js`
- Modify: `renderer/styles.css` (leg toolbar, role/currency selects)
- Test: covered by e2e in Task 8; no unit test (DOM-only code)

**Interfaces:**
- Consumes: `calc.legRole`, `calc.legPriceCcy`, `calc.isRubLeg`, `calc.spreadFormula`.
- Produces: a trade payload whose `legs[]` entries carry `role` and `priceCcy`.

- [ ] **Step 1: Replace the two hardcoded legs with a list**

In `openForm`, swap:

```js
const leg1 = legInputs('Нога 1', t.legs[0] || {}, cfg.exchanges[0] || '');
const leg2 = legInputs('Нога 2', t.legs[1] || {}, cfg.exchanges[1] || cfg.exchanges[0] || '');
```

for:

```js
// legs live in an array: at least two, no upper bound
const legsWrap = el('div', { class: 'legs' });
let legFields = [];

function defaultExchange(i) {
  return cfg.exchanges[i] || cfg.exchanges[0] || '';
}

function renderLegs(source) {
  legsWrap.innerHTML = '';
  legFields = source.map((leg, i) => legInputs(`Нога ${i + 1}`, leg, defaultExchange(i), i));
  legFields.forEach((f, i) => {
    if (i >= 2) {
      const del = el('button', { type: 'button', class: 'btn icon leg-remove' }, [txt('✕')]);
      del.title = 'Убрать ногу';
      del.onclick = () => { renderLegs(legFields.map((x) => x.read()).filter((_, j) => j !== i)); recompute(); };
      f.box.querySelector('.leg-head').appendChild(del);
    }
    legsWrap.appendChild(f.box);
  });
  const add = el('button', { type: 'button', class: 'btn ghost add-leg' }, [txt('+ Добавить ногу')]);
  add.onclick = () => {
    renderLegs([...legFields.map((x) => x.read()), { exchange: defaultExchange(legFields.length), role: 'mul' }]);
    recompute();
  };
  legsWrap.appendChild(add);
  legFields.forEach((f) => f.inputs.forEach((inp) => inp.addEventListener('input', recompute)));
}
```

Every later reference to `leg1.read()` / `leg2.read()` becomes `legFields.map((f) => f.read())`, and `[...leg1.inputs, ...leg2.inputs]` is handled inside `renderLegs`. `draft()` becomes:

```js
function draft() {
  return { usdRub: Number(usdRub.value) || 0, payout: Number(payout.value) || 0,
    adjustment: Number(t.adjustment) || 0, closeDate: closeDate.value,
    legs: legFields.map((f) => f.read()) };
}
```

- [ ] **Step 2: Add the role and currency controls to a leg**

In `legInputs(title, leg, defaultEx, index)`:

```js
const role = el('select', { class: 'leg-role' });
[['mul', '× числитель'], ['div', '÷ знаменатель']].forEach(([v, l]) => role.append(new Option(l, v)));
role.value = window.calc.legRole(leg, index);

const ccy = el('select', { class: 'leg-ccy' });
[['USD', '$'], ['RUB', '₽']].forEach(([v, l]) => ccy.append(new Option(l, v)));
// default follows the exchange for a new leg; a saved leg keeps what it has
ccy.value = leg.priceCcy || (window.calc.isRubLeg({ exchange: ex.value }) ? 'RUB' : 'USD');
ex.addEventListener('input', () => {
  if (!leg.priceCcy) ccy.value = window.calc.isRubLeg({ exchange: ex.value }) ? 'RUB' : 'USD';
});
```

Add them to the leg grid after «Сделка», include both in the returned `inputs`, and extend `read()`:

```js
role: role.value,
priceCcy: ccy.value,
```

- [ ] **Step 3: Show the formula above the legs**

In `recompute()`, after computing `c`:

```js
formulaLine.textContent = window.calc.spreadFormula(draft());
```

where `formulaLine` is `el('div', { class: 'formula-line' })` placed directly above `legsWrap`.

- [ ] **Step 4: Loosen the validation**

Replace the save guard:

```js
if (!tickerValue || legFields.length < 2 || legFields.some((f) => !f.read().units)) {
  alert('Укажите тикер и количество единиц по каждой ноге (минимум две ноги).');
  return;
}
```

- [ ] **Step 5: Style the new controls**

Append to `renderer/styles.css`:

```css
.formula-line {
  margin: 4px 0 10px;
  font-family: var(--mono); font-size: 12.5px; color: var(--muted);
}
.add-leg { width: 100%; margin-top: 10px; }
.leg-head { display: flex; align-items: center; gap: 8px; }
.leg-remove { margin-left: auto; }
```

- [ ] **Step 6: Verify by hand and commit**

Run: `npm start`, add a trade with three legs, confirm the formula line updates and the live net profit reacts.

```bash
git add renderer/form.js renderer/styles.css
git commit -m "feat(form): any number of legs, with role and price currency"
```

---

### Task 5: Journal shows role and price currency

**Files:**
- Modify: `renderer/journal.js` (`tradeDetail`)
- Modify: `renderer/styles.css` (`.detail-leg` grid)

**Interfaces:**
- Consumes: `calc.legRole`, `calc.legPriceCcy`, `calc.spreadFormula`.

- [ ] **Step 1: Add the column**

In the detail header list, insert `'Роль'` after `'Сделка'`, and give it the class `role`:

```js
['Биржа', 'Сделка', 'Роль', 'Цена вход → выход', 'Кол-во', 'Позиция начало → конец', 'Комиссия', 'Своп', 'PnL ноги']
  .forEach((label, i) => head.append(el('span',
    ['ex', 'side', 'role', 'prices', 'units', 'pos', 'fee', 'swap', 'pnl'][i], label)));
```

In the leg line, after the side:

```js
line.append(el('span', 'role', window.calc.legRole(leg, i) === 'div' ? '÷' : '×'));
```

and price formatting follows the leg's currency:

```js
const ccy = window.calc.legPriceCcy(leg);
const p = (v) => (ccy === 'RUB' ? rub0(v) : price(v));
line.append(el('span', 'prices', `${p(leg.entryPrice)} → ${p(leg.exitPrice)}`));
```

- [ ] **Step 2: Show the formula in the detail**

Above `detail-legs`:

```js
box.append(el('div', 'detail-formula', window.calc.spreadFormula(trade)));
```

- [ ] **Step 3: Update the CSS grid**

```css
.detail-leg { grid-template-columns: 92px 56px 34px 170px 70px 190px 100px 100px 1fr; }
.detail-leg .role { color: var(--accent); font-weight: 700; text-align: center; }
.detail-formula { margin-bottom: 8px; font-family: var(--mono); font-size: 12px; color: var(--muted); }
```

- [ ] **Step 4: Verify and commit**

Run: `npm run e2e` — the existing "every column in the expanded trade is labelled" check must be extended with `'Роль'` in Task 8.

```bash
git add renderer/journal.js renderer/styles.css
git commit -m "feat(journal): show leg role and price currency in the expanded trade"
```

---

### Task 6: Statistics stop assuming two legs

**Files:**
- Modify: `renderer/stats.js:509-510`

- [ ] **Step 1: Replace the "second leg" breakdown**

```js
const moexLeg = (t) => t.legs.find((l) => window.calc.isRubLeg(l)) || t.legs[0];
const otherLegs = (t) => t.legs.filter((l) => l !== moexLeg(t));
const byDirOther = an.groupBy(closed, (t) => otherLegs(t)
  .map((l) => `${l.exchange} ${l.side}`).join(' · ') || '—').sort(byProfit);
```

and rename the panel to `'Профит по направлению (не-MOEX ноги)'`.

- [ ] **Step 2: Verify and commit**

Run: `npm run e2e` — the stats section must stay green.

```bash
git add renderer/stats.js
git commit -m "feat(stats): direction breakdown covers every non-MOEX leg"
```

---

### Task 7: CSV carries role and price currency

**Files:**
- Modify: `src/export.js`
- Test: `test/export.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('csv — a leg row carries its role and price currency', () => {
  const csv = tradesToCsv([{
    num: 7, openDate: '2026-08-28', closeDate: '2026-08-28', ticker: 'TRI', tag: '', type: '',
    usdRub: 85, payout: 0, adjustment: 0, comment: '',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85600, feeRub: 0, role: 'mul', priceCcy: 'RUB' },
      { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.18, units: 1, exitPrice: 7.17, feeRub: 0, role: 'div', priceCcy: 'USD' },
    ],
  }]);
  const [header, first, second] = csv.split('\n');
  assert.ok(header.includes('Роль'), header);
  assert.ok(header.includes('Валюта цены'), header);
  assert.ok(first.includes('mul') && first.includes('RUB'), first);
  assert.ok(second.includes('div') && second.includes('USD'), second);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/export.test.js`
Expected: FAIL — header has no `Роль`.

- [ ] **Step 3: Implement**

In `HEADER`, after `'Сделка'` insert `'Роль'`, and after `'Цена выход'` insert `'Валюта цены'`. In the row builder, matching positions:

```js
calc.legRole(leg, i),
...
calc.legPriceCcy(leg),
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/export.js test/export.test.js
git commit -m "feat(export): csv carries leg role and price currency"
```

---

### Task 8: End-to-end — enter a triangle

**Files:**
- Modify: `e2e/drive.mjs`

- [ ] **Step 1: Extend the expanded-trade label check**

Add `'Роль'` to the list in the "every column in the expanded trade is labelled" check.

- [ ] **Step 2: Add a triangle section**

Append before the `} catch (err) {`:

```js
  console.log('\n[8] a three-leg trade');
  await page.evaluate(() => window.api.trades.add({
    openDate: '2026-08-28', closeDate: '2026-08-28', type: 'Фьючи', ticker: 'TRI', tag: 'Тройник',
    usdRub: 85, payout: 0, adjustment: 0, comment: 'triangle',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 85500, units: 1, exitPrice: 85600, feeRub: 0, role: 'mul', priceCcy: 'RUB' },
      { exchange: 'MOEX', side: 'Шорт', entryPrice: 11900, units: 1, exitPrice: 11880, feeRub: 0, role: 'div', priceCcy: 'RUB' },
      { exchange: 'VANTAGE', side: 'Шорт', entryPrice: 7.18, units: 1, exitPrice: 7.175, feeRub: 0, role: 'div', priceCcy: 'USD' },
    ],
  }));
  await page.reload();
  await page.waitForSelector('.trade-row', { timeout: 10000 });
  const tri = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.trade-row')]
      .find((r) => /TRI/.test(r.innerText));
    row.click();
    const detail = row.parentElement.querySelector('.trade-detail');
    return { row: row.innerText.replace(/\\n/g, ' | '), detail: detail.innerText.replace(/\\n/g, ' | '),
      legChips: row.querySelectorAll('.leg-chip').length };
  });
  check('a three-leg trade shows three leg chips', tri.legChips === 3, tri.row);
  check('its spread is the multiplicative one (+0,07%)', /0,07%/.test(tri.row), tri.row);
  check('the detail spells out the formula', /MOEX ÷ MOEX ÷ VANTAGE/.test(tri.detail), tri.detail);
  check('each leg shows its role', (tri.detail.match(/÷/g) || []).length >= 2, tri.detail);
```

- [ ] **Step 3: Run e2e**

Run: `npm run e2e`
Expected: every check green, including the pre-existing trade #1 / #3 assertions.

- [ ] **Step 4: Commit**

```bash
git add e2e/drive.mjs
git commit -m "test(e2e): drive a three-leg trade end to end"
```

---

### Task 9: Update the memory of the project

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-diaryhunt-design.md`

- [ ] **Step 1: Correct the stale MVP constraint**

The MVP spec says «MVP строго 2 ноги; 3-я нога — отдельной итерацией позже». Add a line under it:

```markdown
> **Обновление 2026-08-28:** ограничение снято, см.
> `2026-08-28-three-leg-trades-design.md` — ног может быть сколько угодно,
> спред стал мультипликативным.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-27-diaryhunt-design.md
git commit -m "docs: point the MVP spec at the multi-leg design"
```
