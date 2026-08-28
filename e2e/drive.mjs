// End-to-end smoke test: launches the real DiaryHunt Electron app with an
// isolated user-data dir, drives journal / stats / form, and asserts the
// sheet-verified numbers appear. Exits non-zero on any failure.
//
// Run: npm run e2e
// Screenshots (for debugging) land in <tmp>/diaryhunt-e2e-shots.
//
// It uses real IPC + the real JSON store, but points userData at a throwaway
// temp dir via --user-data-dir, so your real data under %APPDATA%/DiaryHunt
// is never touched.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const electronBin = require('electron');
const APP_DIR = path.resolve(import.meta.dirname, '..');
const SHOT = path.join(os.tmpdir(), 'diaryhunt-e2e-shots');
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-e2e-'));
fs.mkdirSync(SHOT, { recursive: true });

// --- tiny assert harness ---
let failures = 0;
const norm = (s) => String(s).replace(/\s/g, ''); // ru-RU uses U+00A0 group sep
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, eps = 0.01) => typeof a === 'number' && Math.abs(a - b) <= eps;

// Sheet-verified fixtures (net profit matches the user's Google sheet to the ruble).
const trade1 = {
  openDate: '2026-08-13', closeDate: '2026-08-13', type: 'Фьючи',
  ticker: 'ED', tag: 'Схождение', usdRub: 83.7, payout: -295, adjustment: 0, comment: 'e2e #1',
  legs: [
    { exchange: 'MOEX', side: 'Лонг', entryPrice: 1.1505, units: 42000, exitPrice: 1.1519, feeRub: 270 },
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.15269, units: 40000, exitPrice: 1.15361, feeRub: 232 },
  ],
};
// Trade #3: legs reversed (Шорт first) — guards leg-order spread + short-first gross.
const trade3 = {
  openDate: '2026-08-17', closeDate: '2026-08-17', type: 'Фьючи',
  ticker: 'SILV', tag: 'Схождение', usdRub: 84.95, payout: 3061, adjustment: 0, comment: 'e2e #3',
  legs: [
    { exchange: 'MOEX', side: 'Шорт', entryPrice: 65.76, units: 530, exitPrice: 66.57, feeRub: 46 },
    { exchange: 'FOREX', side: 'Лонг', entryPrice: 65.269, units: 500, exitPrice: 66.149, feeRub: 0 },
  ],
};

let app;
try {
  app = await electron.launch({
    executablePath: electronBin,
    args: [`--user-data-dir=${USERDATA}`, '.'],
    cwd: APP_DIR,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  // surface renderer crashes instead of silently rendering half a view
  page.on('pageerror', (err) => { failures++; console.log(`  ✗ renderer error: ${err.message}`); });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  ! console: ${m.text()}`); });
  await page.waitForSelector('#btn-add', { timeout: 15000 });
  console.log('app launched:', await page.title());

  console.log('\n[1] renderer calc/format (in-page)');
  const c1 = await page.evaluate((t) => {
    const c = window.calc.computeTrade(t);
    return { net: c.netProfitRub, entry: window.format.fmtPct(c.entrySpread),
      netProfit: window.format.fmtRub(c.netProfitRub), closed: c.closed };
  }, trade1);
  check('trade #1 netProfit ≈ 1044.40 ₽', near(c1.net, 1044.4), `got ${c1.net}`);
  check('trade #1 entry spread = 0.1904%', c1.entry === '0.1904%', `got ${c1.entry}`);
  check('trade #1 netProfit format contains 044,40 ₽', norm(c1.netProfit).includes('044,40₽'), c1.netProfit);
  check('trade #1 is closed', c1.closed === true);

  const c3 = await page.evaluate((t) => {
    const c = window.calc.computeTrade(t);
    return { net: c.netProfitRub, entryRaw: c.entrySpread };
  }, trade3);
  check('trade #3 netProfit ≈ 3923.97 ₽ (short-leg-first)', near(c3.net, 3923.97, 0.5), `got ${c3.net}`);
  check('trade #3 entry spread is negative (leg-order, not side)', c3.entryRaw < 0, `got ${c3.entryRaw}`);

  console.log('\n[2] journal via real IPC + store');
  await page.screenshot({ path: path.join(SHOT, '01-empty.png') });
  await page.evaluate((t) => window.api.trades.add(t), trade1);
  await page.evaluate((t) => window.api.trades.add(t), trade3);
  await page.reload();
  await page.waitForSelector('table', { timeout: 10000 });
  await page.screenshot({ path: path.join(SHOT, '02-journal.png') });
  // total ≈ 1044.40 + 3923.97 = 4968.37 ₽ (may render 4968.36 — app sums raw
  // floats then rounds, vs summing already-rounded cents; ±1 kopeck is expected).
  const totalTxt = await page.evaluate(() => document.querySelector('.journal-total .val')?.innerText || '');
  const totalMatch = totalTxt.replace(/\s/g, '').match(/(\d+),(\d{2})/);
  const totalNum = totalMatch ? parseFloat(`${totalMatch[1]}.${totalMatch[2]}`) : NaN;
  check('journal ИТОГО ≈ 4968.37 ₽ (±0.05)', near(totalNum, 4968.37, 0.05), `parsed ${totalNum} from "${totalTxt}"`);

  console.log('\n[3] stats');
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT, '03-stats.png'), fullPage: true });
  const stats = await page.evaluate(() => document.querySelector('#view').innerText);
  check('stats: 2 closed trades', /закрытых сделок[^\d]*2/i.test(stats.replace(/\n/g, ' ')), '');
  check('stats: winrate 100.0%', norm(stats).includes('100.0%'));

  console.log('\n[3b] stats widgets');
  const widgets = await page.evaluate(() => ({
    canvases: document.querySelectorAll('#view canvas').length,
    painted: [...document.querySelectorAll('#view canvas')].every((c) => c.width > 0 && c.height > 0),
    chips: [...document.querySelectorAll('.period-bar .chip')].map((b) => b.textContent),
    calCells: document.querySelectorAll('.cal-cell.has').length,
    panels: [...document.querySelectorAll('.panel h3')].map((h) => h.textContent),
    monthRows: document.querySelectorAll('.mini-table tbody tr').length,
    metrics: [...document.querySelectorAll('.metric')].map((m) => m.innerText.replace(/\n/g, ': ')),
  }));
  check('5 charts painted (equity, waterfall, days, scatter, histogram)',
    widgets.canvases === 5 && widgets.painted, `got ${widgets.canvases} canvases, painted=${widgets.painted}`);
  check('period chips rendered', widgets.chips.length === 4, widgets.chips.join('|'));
  check('calendar heatmap marks both close days', widgets.calCells === 2, `got ${widgets.calCells}`);
  check('spread / holding / capital / weekday panels present',
    ['спреду входа', 'времени удержания', 'объёму позиции', 'дню недели']
      .every((t) => widgets.panels.some((p) => p.toLowerCase().includes(t))), widgets.panels.join(' | '));
  check('monthly table has a row per month', widgets.monthRows === 1, `got ${widgets.monthRows}`);
  const hasMetric = (re) => widgets.metrics.some((m) => re.test(m.toLowerCase()));
  check('profit factor metric shown (no losses -> ∞)', hasMetric(/профит-фактор.*∞/i), widgets.metrics.join(' / '));
  check('drawdown metric shown', hasMetric(/просадка/i));
  check('avg holding time metric shown', hasMetric(/время в сделке.*0,0 дн/i), widgets.metrics.join(' / '));
  check('streak metric shows +2', hasMetric(/серия сейчас.*\+2/i), widgets.metrics.join(' / '));

  console.log('\n[3c] period filter');
  await page.evaluate(() => window.api.trades.add({
    openDate: '2025-03-02', closeDate: '2025-03-02', type: 'Фьючи', ticker: 'OLD', tag: '',
    usdRub: 80, payout: 0, adjustment: 0, comment: 'e2e old',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 99, feeRub: 0 },
      { exchange: 'FOREX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
    ],
  }));
  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(300);
  const closedCount = () => page.evaluate(() =>
    document.querySelector('.metric .value')?.textContent.trim());
  check('all-time period counts the 2025 trade too', (await closedCount()) === '3', `got ${await closedCount()}`);
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => b.textContent === 'Месяц').click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, '05-stats-month.png'), fullPage: true });
  check('month period drops the 2025 trade', (await closedCount()) === '2', `got ${await closedCount()}`);
  const winrateMonth = await page.evaluate(() => document.querySelector('#view').innerText);
  check('month period winrate back to 100.0%', norm(winrateMonth).includes('100.0%'));
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => b.textContent === 'Всё время').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.api.trades.list().then((ts) => {
    const old = ts.find((t) => t.ticker === 'OLD');
    return old ? window.api.trades.remove(old.id) : null;
  }));

  console.log('\n[3d] stats survive an empty diary');
  const ids = await page.evaluate(() => window.api.trades.list().then((ts) => ts.map((t) => t.id)));
  for (const id of ids) await page.evaluate((i) => window.api.trades.remove(i), id);
  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(300);
  const emptyView = await page.evaluate(() => ({
    text: document.querySelector('#view .empty')?.textContent || '',
    canvases: document.querySelectorAll('#view canvas').length,
  }));
  check('empty diary shows the hint instead of charts',
    /нет закрытых сделок/i.test(emptyView.text) && emptyView.canvases === 0, JSON.stringify(emptyView));
  for (const t of [trade1, trade3]) await page.evaluate((x) => window.api.trades.add(x), t);
  await page.reload();
  await page.waitForSelector('#btn-add', { timeout: 10000 });

  console.log('\n[4] form live recompute');
  await page.evaluate(() => document.querySelector('#tab-journal').click());
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const res = await page.evaluate((t) => {
    const setVal = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const byLabel = (re) => [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => re.test(l.textContent))?.querySelector('input, select, textarea');
    setVal(byLabel(/дата открытия/i), t.openDate);
    setVal(byLabel(/дата закрытия/i), t.closeDate);
    setVal(byLabel(/тикер/i), t.ticker);
    setVal(byLabel(/курс/i), t.usdRub);
    const boxes = document.querySelectorAll('.leg-box');
    t.legs.forEach((leg, i) => {
      const box = boxes[i];
      const sideSel = box.querySelector('select'); // side is the only select now
      sideSel.value = leg.side; sideSel.dispatchEvent(new Event('input', { bubbles: true }));
      const [ex, e, u, x, f] = box.querySelectorAll('input'); // [exchange, entry, units, exit, fee]
      setVal(ex, leg.exchange);
      setVal(e, leg.entryPrice); setVal(u, leg.units); setVal(x, leg.exitPrice); setVal(f, leg.feeRub);
    });
    // payout is auto by default (6% MOEX tax estimate)
    const autoPayout = document.querySelector('.field-row > input').value;
    // switch to manual and pin the exact sheet value
    const cb = document.querySelector('.auto-toggle input[type=checkbox]');
    if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    setVal(document.querySelector('.field-row > input'), t.payout);
    return { autoPayout, manualLive: document.querySelector('.live').innerText };
  }, trade1);
  await page.screenshot({ path: path.join(SHOT, '04-form-live.png') });
  check('form auto-payout estimates MOEX tax (≈ -295 ₽)',
    Math.abs(parseFloat(res.autoPayout) + 295) < 2, `got ${res.autoPayout}`);
  check('form manual payout override → Чистый профит 1 044,40 ₽',
    norm(res.manualLive).includes('044,40₽'), res.manualLive);
} catch (err) {
  failures++;
  console.error('\nE2E ERROR:', err.message);
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(USERDATA, { recursive: true, force: true });
}

console.log(`\nscreenshots: ${SHOT}`);
if (failures) {
  console.error(`\nE2E FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nE2E PASSED: all checks green.');
