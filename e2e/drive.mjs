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
  const journal = await page.evaluate(() => document.querySelector('#view').innerText);
  const totalLine = journal.split('\n').find((l) => l.includes('ИТОГО')) || '';
  // total ≈ 1044.40 + 3923.97 = 4968.37 ₽ (may render 4968.36 — app sums raw
  // floats then rounds, vs summing already-rounded cents; ±1 kopeck is expected).
  const totalMatch = norm(totalLine).match(/(\d+),(\d{2})₽/);
  const totalNum = totalMatch ? parseFloat(`${totalMatch[1]}.${totalMatch[2]}`) : NaN;
  check('journal ИТОГО ≈ 4968.37 ₽ (±0.05)', near(totalNum, 4968.37, 0.05), `parsed ${totalNum} from "${totalLine.trim()}"`);

  console.log('\n[3] stats');
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT, '03-stats.png') });
  const stats = await page.evaluate(() => document.querySelector('#view').innerText);
  check('stats: 2 closed trades', /Всего сделок[^\d]*2/.test(stats.replace(/\n/g, ' ')), '');
  check('stats: winrate 100.0%', norm(stats).includes('100.0%'));

  console.log('\n[4] form live recompute');
  await page.evaluate(() => document.querySelector('#tab-journal').click());
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const live = await page.evaluate((t) => {
    const setVal = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const grid = document.querySelector('.modal > .grid');
    const dates = grid.querySelectorAll('input[type=date]');
    setVal(dates[0], t.openDate); setVal(dates[1], t.closeDate);
    setVal(grid.querySelector('input[type=text]'), t.ticker);
    const nums = grid.querySelectorAll('input[type=number]');
    setVal(nums[0], t.usdRub); setVal(nums[1], t.payout);
    const boxes = document.querySelectorAll('.leg-box');
    t.legs.forEach((leg, i) => {
      const box = boxes[i];
      const [exSel, sideSel] = box.querySelectorAll('select');
      exSel.value = leg.exchange; exSel.dispatchEvent(new Event('input', { bubbles: true }));
      sideSel.value = leg.side; sideSel.dispatchEvent(new Event('input', { bubbles: true }));
      const [e, u, x, f] = box.querySelectorAll('input');
      setVal(e, leg.entryPrice); setVal(u, leg.units); setVal(x, leg.exitPrice); setVal(f, leg.feeRub);
    });
    return document.querySelector('.live').innerText;
  }, trade1);
  await page.screenshot({ path: path.join(SHOT, '04-form-live.png') });
  check('form live line shows Чистый профит 1 044,40 ₽', norm(live).includes('044,40₽'), live);
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
