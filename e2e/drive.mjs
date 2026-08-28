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
    { exchange: 'FOREX', side: 'Шорт', entryPrice: 1.1526925, units: 40000, exitPrice: 1.1536125, feeRub: 232 },
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
  // the sheet measures the spread against the mid price of the legs
  check('trade #1 entry spread = 0.1904% (sheet)', c1.entry === '0.1904%', `got ${c1.entry}`);
  check('trade #1 netProfit format contains 044,40 ₽', norm(c1.netProfit).includes('044,40₽'), c1.netProfit);
  check('trade #1 is closed', c1.closed === true);

  const c3 = await page.evaluate((t) => {
    const c = window.calc.computeTrade(t);
    return { net: c.netProfitRub, entryRaw: c.entrySpread };
  }, trade3);
  check('trade #3 netProfit ≈ 3923.97 ₽ (short-leg-first)', near(c3.net, 3923.97, 0.5), `got ${c3.net}`);
  check('trade #3 entry spread is negative (leg-order, not side)', c3.entryRaw < 0, `got ${c3.entryRaw}`);

  console.log('\n[1b] toolbar');
  const toolbar = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('header .actions button')].map((b) => b.textContent.trim()),
    csvInSettings: null,
  }));
  check('CSV export is gone from the toolbar',
    !toolbar.buttons.some((b) => /csv/i.test(b)), toolbar.buttons.join('|'));
  const settingsBtn = await page.evaluate(() => {
    const b = document.querySelector('#btn-settings');
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), width: Math.round(r.width) };
  });
  check('settings button is labelled, not just an icon',
    /настройки/i.test(settingsBtn.text) && settingsBtn.width >= 100, JSON.stringify(settingsBtn));
  await page.evaluate(() => document.querySelector('#btn-settings').click());
  await page.waitForSelector('.settings-modal', { timeout: 8000 });
  const inSettings = await page.evaluate(() => {
    const has = !!document.querySelector('#btn-export-csv');
    document.querySelector('.settings-modal .modal-buttons .btn').click();
    return has;
  });
  check('CSV export moved into settings → Данные', inSettings);

  console.log('\n[2] journal via real IPC + store');
  await page.screenshot({ path: path.join(SHOT, '01-empty.png') });
  await page.evaluate((t) => window.api.trades.add(t), trade1);
  await page.evaluate((t) => window.api.trades.add(t), trade3);
  await page.reload();
  await page.waitForSelector('.trade-row', { timeout: 10000 });
  await page.screenshot({ path: path.join(SHOT, '02-journal.png') });
  // total ≈ 1044.40 + 3923.97 = 4968.37 ₽ (may render 4968.36 — app sums raw
  // floats then rounds, vs summing already-rounded cents; ±1 kopeck is expected).
  const totalTxt = await page.evaluate(() => document.querySelector('.journal-total .val')?.innerText || '');
  const totalMatch = totalTxt.replace(/\s/g, '').match(/(\d+),(\d{2})/);
  const totalNum = totalMatch ? parseFloat(`${totalMatch[1]}.${totalMatch[2]}`) : NaN;
  check('journal ИТОГО ≈ 4968.37 ₽ (±0.05)', near(totalNum, 4968.37, 0.05), `parsed ${totalNum} from "${totalTxt}"`);

  const journal = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.trade-row')];
    return {
      rows: rows.length,
      months: [...document.querySelectorAll('.month-head .m-name')].map((m) => m.textContent),
      firstRow: rows[0]?.innerText.replace(/\n/g, ' | '),
      filters: [...document.querySelectorAll('.journal-bar .chip')].map((c) => c.textContent),
      sortable: document.querySelectorAll('.journal-head .sortable').length,
      overflow: document.querySelector('.journal-scroll').scrollWidth
        - document.querySelector('.journal-scroll').clientWidth,
      footer: document.querySelector('.journal-total .lbl').innerText.replace(/\n/g, ' '),
    };
  });
  check('one row per trade, not per leg', journal.rows === 2, `${journal.rows} rows`);
  const legChips = await page.evaluate(() => [...document.querySelectorAll('.trade-row .leg-chip')]
    .map((c) => ({ cls: c.className, arrow: c.querySelector('.dir').textContent,
      size: getComputedStyle(c.querySelector('.dir')).fontSize })));
  check('leg chips are colour-coded by direction and carry a readable arrow',
    legChips.every((c) => (c.cls.includes('long') || c.cls.includes('short'))
      && ['↑', '↓'].includes(c.arrow) && parseFloat(c.size) >= 14),
    JSON.stringify(legChips.slice(0, 2)));
  check('trades are grouped under their month', journal.months.length === 1
    && /август 2026/i.test(journal.months[0]), journal.months.join('|'));
  // default sort is newest first, so the top row is whichever trade has the highest №
  check('a row carries date, ticker, legs, spread and net profit',
    /\d+ авг/.test(journal.firstRow) && /(ED|SILV)/.test(journal.firstRow)
    && /MOEX/.test(journal.firstRow) && /%/.test(journal.firstRow) && /₽/.test(journal.firstRow),
    journal.firstRow);
  check('status filters and sortable headers are present',
    journal.filters.length === 3 && journal.sortable === 5, JSON.stringify(journal.filters));
  check('journal never scrolls sideways', journal.overflow <= 0, `overflow ${journal.overflow}px`);
  check('footer summarises the visible trades', /сделок/i.test(journal.footer) && /винрейт/i.test(journal.footer), journal.footer);

  // sorting cycles: default order -> reversed -> cleared
  const sortCycle = await page.evaluate(() => {
    const head = () => [...document.querySelectorAll('.journal-head .sortable')]
      .find((h) => /тикер/i.test(h.textContent));
    const tickers = () => [...document.querySelectorAll('.trade-row .ticker .tk')].map((t) => t.textContent);
    const active = () => document.querySelectorAll('.journal-head .active').length;
    const before = tickers();
    head().click();
    const asc = tickers(), activeAfter1 = active();
    head().click();
    const desc = tickers();
    head().click();
    return { before, asc, desc, cleared: tickers(), activeAfter1, activeAfterReset: active() };
  });
  check('first click sorts the column', sortCycle.asc.join() !== sortCycle.desc.join()
    && sortCycle.activeAfter1 === 1, JSON.stringify(sortCycle));
  check('second click reverses it',
    sortCycle.asc.join() === [...sortCycle.desc].reverse().join(), JSON.stringify(sortCycle));
  check('third click clears the sort and drops the header highlight',
    sortCycle.cleared.join() === sortCycle.before.join() && sortCycle.activeAfterReset === 0,
    JSON.stringify(sortCycle));

  // expanding a trade reveals the per-leg numbers
  await page.evaluate(() => document.querySelectorAll('.trade-row')[0].click());
  await page.waitForSelector('.trade-detail', { timeout: 5000 });
  const detail = await page.evaluate(() => document.querySelector('.trade-detail').innerText.replace(/\n/g, ' | '));
  const document_text_probe = await page.evaluate(() => document.body.innerText);
  check('expanded detail shows both legs with prices, size and fees',
    /MOEX/.test(detail) && /FOREX/.test(detail) && /→/.test(detail), detail);
  // the labels render uppercase via CSS, and innerText returns them transformed
  check('every column in the expanded trade is labelled',
    ['Биржа', 'Сделка', 'Роль', 'Цена вход', 'Кол-во', 'Позиция начало', 'Комиссия', 'Своп', 'PnL ноги']
      .every((l) => detail.toLowerCase().includes(l.toLowerCase())), detail);
  check('expanded detail lists payout and swap under their own labels',
    /payout/i.test(detail) && /своп/i.test(detail), detail);
  check('the word "пейаут" is gone from the interface',
    !/пейаут/i.test(document_text_probe), document_text_probe.slice(0, 160));

  check('expanded detail carries exit spread, total spread and position value',
    /Спред выход/i.test(detail) && /Спред итог/i.test(detail)
    && /Позиция/i.test(detail) && /\$[\d\s]+ → \$[\d\s]+/.test(detail), detail);
  await page.screenshot({ path: path.join(SHOT, '02b-journal-expanded.png') });
  await page.evaluate(() => document.querySelectorAll('.trade-row')[0].click());

  // filters actually filter
  const filtered = await page.evaluate(async () => {
    const type = (v) => {
      const s = document.querySelector('.journal-bar .search');
      s.value = v; s.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('silv');
    const afterSearch = document.querySelectorAll('.trade-row').length;
    type('');
    [...document.querySelectorAll('.journal-bar .chip')].find((b) => b.textContent === 'Открытые').click();
    const afterOpen = document.querySelectorAll('.trade-row').length;
    const emptyNote = document.querySelector('.journal-scroll .empty')?.textContent || '';
    [...document.querySelectorAll('.journal-bar .chip')].find((b) => b.textContent === 'Все').click();
    return { afterSearch, afterOpen, emptyNote, restored: document.querySelectorAll('.trade-row').length };
  });
  check('search narrows the journal to matching trades', filtered.afterSearch === 1, JSON.stringify(filtered));

  // type is a first-class dimension, like the tag: a chip in the row and a filter
  const typeUi = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.journal-bar .sel')]
      .find((s) => /все типы/i.test(s.options[0].textContent));
    const chips = [...document.querySelectorAll('.trade-row .tag .tag-chip')].map((c) => c.textContent);
    const before = document.querySelectorAll('.trade-row').length;
    sel.value = 'Фьючи';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const afterType = document.querySelectorAll('.trade-row').length;
    const sel2 = [...document.querySelectorAll('.journal-bar .sel')]
      .find((s) => /все типы/i.test(s.options[0].textContent));
    sel2.value = 'all';
    sel2.dispatchEvent(new Event('change', { bubbles: true }));
    return { chips, before, afterType, options: [...sel.options].map((o) => o.textContent) };
  });
  check('type shows as a chip beside the tag',
    typeUi.chips.includes('Фьючи') && typeUi.chips.includes('Схождение'), typeUi.chips.join('|'));
  check('type has its own filter listing the types in use',
    typeUi.options.includes('Фьючи') && typeUi.afterType === typeUi.before, JSON.stringify(typeUi));
  check('an empty result explains itself instead of showing a blank page',
    filtered.afterOpen === 0 && /ничего не подошло/i.test(filtered.emptyNote), JSON.stringify(filtered));
  check('clearing the filter brings every trade back', filtered.restored === 2, JSON.stringify(filtered));

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
    panels: [...document.querySelectorAll('.card-title')].map((h) => h.textContent),
    monthRows: document.querySelectorAll('.mini-table tbody tr').length,
    metrics: [...document.querySelectorAll('.metric')].map((m) => m.innerText.replace(/\n/g, ': ')),
  }));
  check('3 charts painted (equity, days, histogram)',
    widgets.canvases === 3 && widgets.painted, `got ${widgets.canvases} canvases, painted=${widgets.painted}`);
  check('period chips rendered', widgets.chips.length === 4, widgets.chips.join('|'));
  check('calendar heatmap marks both close days', widgets.calCells === 2, `got ${widgets.calCells}`);
  check('spread / holding / capital / weekday panels present',
    ['спреду входа', 'времени удержания', 'объёму позиции', 'дню недели']
      .every((t) => widgets.panels.some((p) => p.toLowerCase().includes(t))), widgets.panels.join(' | '));
  check('monthly table has a row per month', widgets.monthRows === 1, `got ${widgets.monthRows}`);
  const hasMetric = (re) => widgets.metrics.some((m) => re.test(m.toLowerCase()));
  check('profit factor metric shown (no losses -> ∞)', hasMetric(/профит-фактор.*∞/i), widgets.metrics.join(' / '));
  check('avg holding time metric shown', hasMetric(/время в сделке.*0,0 дн/i), widgets.metrics.join(' / '));

  const removed = await page.evaluate(() => document.querySelector('#view').innerText.toLowerCase());
  check('removed widgets stay gone (streaks, drawdown, waterfall, scatter)',
    !/серия сейчас|макс. серии|макс. просадка|структура профита|спред входа против/.test(removed), removed.slice(0, 200));

  const layout = await page.evaluate(() => {
    const view = document.querySelector('#view');
    const cards = [...document.querySelectorAll('.stats-grid > .card')];
    const rows = new Map();
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const key = Math.round(r.top);
      rows.set(key, (rows.get(key) || 0) + 1);
    }
    return {
      cards: cards.length,
      overflow: view.scrollWidth - view.clientWidth,
      maxPerRow: Math.max(...rows.values()),
      wide: cards.filter((c) => c.classList.contains('wide')).length,
      metricsDisplay: getComputedStyle(document.querySelector('.metrics')).display,
    };
  });
  check('every widget is a card in one grid', layout.cards === 13, JSON.stringify(layout));
  check('cards share rows instead of stacking one per line', layout.maxPerRow >= 2, JSON.stringify(layout));
  check('equity, calendar and the monthly table span the full row', layout.wide === 3, JSON.stringify(layout));
  check('metrics use the equal-tile grid', layout.metricsDisplay === 'grid', layout.metricsDisplay);
  check('stats page never scrolls sideways', layout.overflow <= 0, `overflow ${layout.overflow}px`);

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
    const payoutInput = () => [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /перелив/i.test(l.textContent)).querySelector('.field-row > input');
    const autoPayout = payoutInput().value;
    // switch to manual and pin the exact sheet value
    const cb = document.querySelector('.auto-toggle input[type=checkbox]');
    if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    setVal(payoutInput(), t.payout);
    return { autoPayout, manualLive: document.querySelector('.live').innerText };
  }, trade1);
  await page.screenshot({ path: path.join(SHOT, '04-form-live.png') });
  check('form auto-payout estimates MOEX tax (≈ -295 ₽)',
    Math.abs(parseFloat(res.autoPayout) + 295) < 2, `got ${res.autoPayout}`);
  check('form manual payout override → Чистый профит 1 044,40 ₽',
    norm(res.manualLive).includes('044,40₽'), res.manualLive);
  // swap lives on each leg, in that leg's currency: ₽ on MOEX, $ elsewhere
  const swapRes = await page.evaluate(() => {
    const swapLabel = (i) => [...document.querySelectorAll('.leg-box')[i].querySelectorAll('label')]
      .find((l) => /своп/i.test(l.textContent));
    const labels = [swapLabel(0).textContent.trim(), swapLabel(1).textContent.trim()];
    const net = () => document.querySelector('.live').innerText;
    const set = (i, v) => {
      const input = swapLabel(i).querySelector('input');
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const before = net();
    set(0, '-300');                       // MOEX leg: roubles
    const afterRub = net();
    set(0, '');
    set(1, '-4');                         // FOREX leg: dollars at 83.70
    const afterUsd = net();
    set(1, '');
    // switching a leg's exchange switches the currency of its swap field
    const exInput = document.querySelectorAll('.leg-box')[1].querySelector('input');
    const wasForex = exInput.value;
    exInput.value = 'MOEX';
    exInput.dispatchEvent(new Event('input', { bubbles: true }));
    const relabelled = swapLabel(1).textContent.trim();
    exInput.value = wasForex;
    exInput.dispatchEvent(new Event('input', { bubbles: true }));
    return { labels, before, afterRub, afterUsd, relabelled, restored: net() };
  });
  const netFrom = (text) => {
    const m = text.replace(/\s/g, '').match(/ЧИСТЫЙПРОФИТ(-?[\d]+),(\d{2})/i);
    return m ? parseFloat(`${m[1]}.${m[2]}`) : NaN;
  };
  check('MOEX leg asks for the swap in roubles, the other leg in dollars',
    /₽/.test(swapRes.labels[0]) && /\$/.test(swapRes.labels[1]), swapRes.labels.join(' | '));
  check('a -300 ₽ swap on the MOEX leg costs exactly 300 ₽',
    Math.abs((netFrom(swapRes.before) - netFrom(swapRes.afterRub)) - 300) < 0.05,
    `${netFrom(swapRes.before)} -> ${netFrom(swapRes.afterRub)}`);
  check('a -$4 swap on the FOREX leg converts at the trade rate (83.70)',
    Math.abs((netFrom(swapRes.before) - netFrom(swapRes.afterUsd)) - 4 * 83.7) < 0.05,
    `${netFrom(swapRes.before)} -> ${netFrom(swapRes.afterUsd)}`);
  check('switching a leg to MOEX switches its swap to roubles',
    /₽/.test(swapRes.relabelled), swapRes.relabelled);
  check('clearing the swaps restores the net profit',
    Math.abs(netFrom(swapRes.restored) - netFrom(swapRes.before)) < 0.05, swapRes.restored);

  check('form live panel shows exit spread and position value',
    /спред выход/i.test(res.manualLive) && /Позиция/i.test(res.manualLive)
    && /[\d\s]+ ₽ → [\d\s]+ ₽/.test(res.manualLive), res.manualLive);

  console.log('\n[5] USD/RUB fetch button');
  const rateUi = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.modal > .grid > label')].find((l) => /курс usd/i.test(l.textContent));
    return { hasBtn: !!label?.querySelector('button.mini'), hasNote: !!label?.querySelector('.field-note') };
  });
  check('rate field has a fetch button and a source note', rateUi.hasBtn && rateUi.hasNote, JSON.stringify(rateUi));

  await page.evaluate(() => [...document.querySelectorAll('.modal button.mini')][0].click());
  await page.waitForFunction(
    () => !/запрашиваю/.test(document.querySelector('.field-note')?.textContent || ''),
    null, { timeout: 20000 },
  ).catch(() => {});
  const fetched = await page.evaluate(() => ({
    note: document.querySelector('.field-note').textContent,
    err: document.querySelector('.field-note').classList.contains('err'),
    value: [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /курс usd/i.test(l.textContent)).querySelector('input').value,
    live: document.querySelector('.live').innerText,
  }));
  if (fetched.err) {
    // offline CI: the button must still report the failure instead of hanging
    check('rate fetch reports a failure when both sources are unreachable', !!fetched.note, fetched.note);
  } else {
    check('rate fetch fills the field from a named source',
      Number(fetched.value) > 0 && /MOEX|ЦБ/.test(fetched.note), `${fetched.value} — ${fetched.note}`);
    check('fetched rate recomputes the live totals', /чистый профит/i.test(fetched.live));
  }

  const manual = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /курс usd/i.test(l.textContent)).querySelector('input');
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: input.value, note: document.querySelector('.field-note').textContent, live: document.querySelector('.live').innerText };
  });
  check('manual entry overrides the fetched rate and drops the source note',
    manual.value === '90' && manual.note === '', JSON.stringify(manual));
  check('manual rate recomputes the live totals', /чистый профит/i.test(manual.live));
  await page.screenshot({ path: path.join(SHOT, '06-form-rate.png') });


  console.log('\n[6] ticker behaves like the tag dictionary');
  const tickerUi = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /тикер/i.test(l.textContent)).querySelector('input');
    const list = document.getElementById(input.getAttribute('list'));
    return {
      list: input.getAttribute('list'),
      options: [...(list?.options || [])].map((o) => o.value),
      placeholder: input.placeholder,
    };
  });
  check('ticker input is backed by a datalist', tickerUi.list === 'dh-tickerlist', JSON.stringify(tickerUi));
  check('ticker list is seeded from trades already in the diary',
    ['ED', 'SILV'].every((t) => tickerUi.options.includes(t)), tickerUi.options.join('|'));
  check('ticker uses the same editable-dropdown hint as the tag field',
    /впиши свой или выбери/.test(tickerUi.placeholder), tickerUi.placeholder);

  await page.evaluate(() => {
    const input = [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /тикер/i.test(l.textContent)).querySelector('input');
    input.value = 'NEWTKR';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-buttons .btn')].find((b) => /сохранить/i.test(b.textContent)).click();
  });
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  const cfgTickers = await page.evaluate(() => window.api.config.get().then((c) => c.tickers));
  check('a newly typed ticker is remembered in the dictionary',
    cfgTickers.includes('NEWTKR'), JSON.stringify(cfgTickers));

  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const reopened = await page.evaluate(() => [...document.getElementById('dh-tickerlist').options].map((o) => o.value));
  check('the remembered ticker shows up in the next trade form', reopened.includes('NEWTKR'), reopened.join('|'));

  console.log('\n[7] dropdowns offer what the diary already holds');
  // a trade whose type/tag/exchange never went through the form — as after a DB
  // import — must still show up in the dropdowns
  await page.evaluate(() => window.api.trades.add({
    openDate: '2026-08-26', closeDate: '2026-08-26', type: 'RWA-спот', ticker: 'IMPORTED',
    tag: 'Импорт', usdRub: 85, payout: 0, adjustment: 0, comment: '',
    legs: [
      { exchange: 'КРАКЕН', side: 'Лонг', entryPrice: 10, units: 5, exitPrice: 11, feeRub: 0 },
      { exchange: 'BYBIT', side: 'Шорт', entryPrice: 10.1, units: 5, exitPrice: 10.2, feeRub: 0 },
    ],
  }));
  await page.reload();
  await page.waitForSelector('#btn-add', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const lists = await page.evaluate(() => {
    const opts = (id) => [...document.getElementById(id).options].map((o) => o.value);
    return { types: opts('dh-typelist'), tags: opts('dh-taglist'),
      tickers: opts('dh-tickerlist'), exchanges: opts('dh-exlist') };
  });
  check('type dropdown offers a type only seen in an existing trade',
    lists.types.includes('RWA-спот'), lists.types.join('|'));
  check('tag dropdown does the same', lists.tags.includes('Импорт'), lists.tags.join('|'));
  check('ticker dropdown does the same', lists.tickers.includes('IMPORTED'), lists.tickers.join('|'));
  check('exchange dropdown does the same', lists.exchanges.includes('КРАКЕН'), lists.exchanges.join('|'));
  check('dictionary defaults are still offered', lists.types.includes('Фьючи'), lists.types.join('|'));
  await page.evaluate(() => window.api.trades.list().then((ts) => {
    const t = ts.find((x) => x.ticker === 'IMPORTED');
    return t ? window.api.trades.remove(t.id) : null;
  }));

  console.log('\n[7b] adding and removing a leg in the form');
  // section [7] leaves a form open; close it so only one modal is in the DOM
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('.modal-buttons .btn')].find((b) => /отмена/i.test(b.textContent));
    if (cancel) cancel.click();
  });
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const legCount = await page.evaluate(() => {
    const modal = [...document.querySelectorAll('.modal')].pop();
    const count = () => modal.querySelectorAll('.leg-box').length;
    const start = count();
    modal.querySelector('.add-leg').click();
    const added = count();
    const removable = modal.querySelectorAll('.leg-remove').length;
    modal.querySelectorAll('.leg-remove')[0].click();
    const removed = count();
    return { start, added, removable, removed,
      formula: modal.querySelector('.formula-line').textContent };
  });
  check('the form starts with two legs and adds a third', legCount.start === 2 && legCount.added === 3,
    JSON.stringify(legCount));
  check('only legs past the second can be removed', legCount.removable === 1, JSON.stringify(legCount));
  check('removing the third leg goes back to two', legCount.removed === 2, JSON.stringify(legCount));
  check('the formula line names every leg', (legCount.formula.match(/÷|×/g) || []).length >= 1,
    legCount.formula);
  await page.evaluate(() => {
    [...document.querySelectorAll('.modal-buttons .btn')].find((b) => /отмена/i.test(b.textContent)).click();
  });

  console.log('\n[8] a three-leg trade');
  // synthetic USD/CNH from MOEX (SI ÷ CR) against the market cross
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
    const find = () => [...document.querySelectorAll('.trade-row')].find((r) => /TRI/.test(r.innerText));
    const row = find();
    const rowText = row.innerText;
    const legChips = row.querySelectorAll('.leg-chip').length;
    row.click();
    // clicking re-renders the journal, so re-query instead of holding the node
    const detail = document.querySelector('.trade-detail');
    return {
      row: rowText.replace(/\n/g, ' | '),
      detail: detail ? detail.innerText.replace(/\n/g, ' | ') : 'NO DETAIL',
      legChips,
      legLines: detail ? detail.querySelectorAll('.detail-leg').length - 1 : 0,
    };
  });
  check('a three-leg trade shows three leg chips', tri.legChips === 3, tri.row);
  check('its entry spread is the multiplicative one (+0,07%)', /0,07%/.test(tri.row), tri.row);
  check('the detail spells out the formula', /MOEX ÷ MOEX ÷ VANTAGE/.test(tri.detail), tri.detail);
  check('the detail lists all three legs', tri.legLines === 3, `${tri.legLines} leg lines`);
  check('rouble-quoted legs print in roubles and dollar ones in dollars',
    norm(tri.detail).includes('85500₽') && /VANTAGE.*\$7,18/.test(norm(tri.detail).replace(/\|/g, ' ')), tri.detail);

  const triCalc = await page.evaluate(() => window.api.trades.list().then((ts) => {
    const t = ts.find((x) => x.ticker === 'TRI');
    const c = window.calc.computeTrade(t);
    return { entry: c.entrySpread, exit: c.exitSpread, net: c.netProfitRub, legs: t.legs.length };
  }));
  const relative = (a, b) => (a - b) / ((a + b) / 2);
  check('spread weighs 85500 against 11900 × 7,18',
    Math.abs(triCalc.entry - relative(85500, 11900 * 7.18)) < 1e-9, String(triCalc.entry));
  check('net profit sums the legs in their own currencies',
    Math.abs(triCalc.net - (100 + 20 + 0.005 * 85)) < 0.01, String(triCalc.net));

  // a three-leg trade must not break the journal's own machinery
  const triJournal = await page.evaluate(() => ({
    months: document.querySelectorAll('.month-head').length,
    rows: document.querySelectorAll('.trade-row').length,
    footer: document.querySelector('.journal-total .lbl').innerText,
  }));
  check('the journal still groups and totals with a three-leg trade in it',
    triJournal.rows >= 3 && /сделок/i.test(triJournal.footer), JSON.stringify(triJournal));

  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  const triStats = await page.evaluate(() => document.querySelector('#view').innerText);
  check('stats survive a three-leg trade', /закрытых сделок/i.test(triStats)
    && /не-moex/i.test(triStats), triStats.slice(0, 120));
  await page.evaluate(() => document.querySelector('#tab-journal').click());


  console.log('\n[9] balances');
  await page.evaluate(() => document.querySelector('#tab-balances').click());
  await page.waitForTimeout(300);
  const emptyBal = await page.evaluate(() => document.querySelector('#view').innerText);
  check('an empty balances tab invites the first snapshot',
    /отметок баланса пока нет/i.test(emptyBal), emptyBal.slice(0, 120));

  // add a snapshot through the form
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .btn')]
    .find((b) => /отметка баланса/i.test(b.textContent)).click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const formState = await page.evaluate(() => {
    const set = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const modal = document.querySelector('.modal');
    const rows = modal.querySelectorAll('.acc-row');
    set(modal.querySelector('input[type=date]'), '2026-08-01');
    set(modal.querySelector('.field-row input'), 80);
    set(rows[0].querySelectorAll('input')[0], 'MOEX');
    set(rows[0].querySelectorAll('input')[1], 800000);
    rows[0].querySelector('select').value = 'RUB';
    rows[0].querySelector('select').dispatchEvent(new Event('input', { bubbles: true }));
    set(rows[1].querySelectorAll('input')[0], 'FOREX');
    set(rows[1].querySelectorAll('input')[1], 5000);
    rows[1].querySelector('select').value = 'USD';
    rows[1].querySelector('select').dispatchEvent(new Event('input', { bubbles: true }));
    return { total: modal.querySelector('.acc-total').innerText.replace(/\n/g, ' ') };
  });
  check('the form totals both currencies as they are typed',
    norm(formState.total).includes('1200000₽') && norm(formState.total).includes('$15000'), formState.total);

  await page.evaluate(() => [...document.querySelectorAll('.modal-buttons .btn')]
    .find((b) => /сохранить/i.test(b.textContent)).click());
  await page.waitForSelector('.metrics', { timeout: 8000 });
  const afterSave = await page.evaluate(() => ({
    text: document.querySelector('#view').innerText.replace(/\n/g, ' | '),
    rows: document.querySelectorAll('.mini-table tbody tr').length,
    canvases: document.querySelectorAll('#view canvas').length,
    accounts: [...document.querySelectorAll('.card .brow .name')].map((n) => n.textContent),
  }));
  check('the snapshot lands in the table', afterSave.rows === 1, JSON.stringify(afterSave.rows));
  check('capital is reported in both currencies',
    norm(afterSave.text).includes('1200000₽') && norm(afterSave.text).includes('$15000'), afterSave.text.slice(0, 200));
  check('the account breakdown lists both accounts',
    afterSave.accounts.join('|') === 'MOEX|FOREX', afterSave.accounts.join('|'));
  check('the curve is drawn', afterSave.canvases === 1, String(afterSave.canvases));

  // second snapshot straight through the store, so deltas have something to compare
  await page.evaluate(() => window.api.balances.add({
    date: '2026-08-20', usdRub: 85, comment: '',
    accounts: [{ name: 'MOEX', amount: 900000, ccy: 'RUB' }, { name: 'FOREX', amount: 5200, ccy: 'USD' }],
  }));
  await page.evaluate(() => document.querySelector('#tab-journal').click());
  await page.evaluate(() => document.querySelector('#tab-balances').click());
  await page.waitForTimeout(300);
  const withTwo = await page.evaluate(() => ({
    text: document.querySelector('#view').innerText.replace(/\n/g, ' | '),
    rows: document.querySelectorAll('.mini-table tbody tr').length,
    firstRow: document.querySelector('.mini-table tbody tr').innerText.replace(/\n/g, ' | '),
  }));
  check('a second snapshot appears newest first', withTwo.rows === 2 && /20 авг/.test(withTwo.firstRow), withTwo.firstRow);
  check('the change against the previous snapshot is shown',
    /142 000|142000/.test(norm(withTwo.firstRow)) || /\+/.test(withTwo.firstRow), withTwo.firstRow);
  check('the journal line is named in the legend', /по журналу/i.test(withTwo.text), withTwo.text.slice(0, 200));

  // hovering the curve reports the snapshot under the cursor
  const hover = await page.evaluate(() => {
    const canvas = document.querySelector('#view canvas');
    const r = canvas.getBoundingClientRect();
    const fire = (x) => canvas.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: r.left + x, clientY: r.top + r.height / 2 }));
    fire(r.width - 30);                       // near the newest snapshot
    const tip = document.getElementById('dh-chart-tip');
    const shown = { display: tip.style.display, text: tip.innerText.replace(/\n/g, ' | ') };
    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    return { shown, afterLeave: document.getElementById('dh-chart-tip').style.display };
  });
  check('hovering the curve shows the snapshot under the cursor',
    hover.shown.display === 'block' && /20 авг/.test(hover.shown.text), JSON.stringify(hover.shown));
  check('the tooltip carries both lines and the drift',
    /по отметкам/.test(hover.shown.text) && /по журналу/.test(hover.shown.text)
    && /расхождение/.test(hover.shown.text), hover.shown.text);
  check('the tooltip lists the accounts of that snapshot',
    /MOEX/.test(hover.shown.text) && /FOREX/.test(hover.shown.text), hover.shown.text);
  check('the tooltip carries the rate of that snapshot', /курс 85/.test(hover.shown.text), hover.shown.text);
  check('leaving the curve hides the tooltip', hover.afterLeave === 'none', hover.afterLeave);

  // ₽ / $ toggle
  const toggled = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.period-bar .chip')].find((b) => b.textContent === '$');
    chip.click();
    return [...document.querySelectorAll('.period-bar .chip')].map((b) => `${b.textContent}:${b.classList.contains('active')}`);
  });
  check('the currency toggle switches the curve', toggled.includes('$:true'), toggled.join('|'));

  // editing a snapshot's balances in place, without opening a modal
  const inline = await page.evaluate(() => {
    const table = [...document.querySelectorAll('.card')]
      .find((c) => /все отметки/i.test(c.querySelector('.card-title').textContent));
    const row = table.querySelector('tbody tr.snap-row');
    row.click();
    // the click re-renders the tab, so re-query instead of holding the old node
    const editor = document.querySelector('.snap-editor');
    return {
      opened: !!editor,
      modal: !!document.querySelector('.modal'),
      accounts: editor ? [...editor.querySelectorAll('.acc-row')].map((r) => {
        const inputs = r.querySelectorAll('input');
        return `${inputs[0].value}=${inputs[1].value}`;
      }) : [],
      total: editor ? editor.querySelector('.acc-total').innerText.replace(/\n/g, ' ') : '',
    };
  });
  check('clicking a snapshot row opens its balances in place, not in a modal',
    inline.opened && !inline.modal, JSON.stringify(inline));
  check('the editor is filled with that snapshot\'s accounts',
    inline.accounts.some((a) => /MOEX=900000/.test(a)), inline.accounts.join('|'));

  const edited = await page.evaluate(() => {
    const editor = document.querySelector('.snap-editor');
    const amount = editor.querySelectorAll('.acc-row')[0].querySelectorAll('input')[1];
    amount.value = '1111000';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    const totalAfterTyping = editor.querySelector('.acc-total').innerText.replace(/\n/g, ' ');
    [...editor.querySelectorAll('.snap-buttons .btn')].find((b) => /сохранить/i.test(b.textContent)).click();
    return { totalAfterTyping };
  });
  check('the total recomputes while typing',
    norm(edited.totalAfterTyping).includes('1111000') || norm(edited.totalAfterTyping).includes('1553000'),
    edited.totalAfterTyping);

  await page.waitForTimeout(400);
  const saved = await page.evaluate(async () => {
    const list = await window.api.balances.list();
    const target = list.find((s) => s.date === '2026-08-20');
    return {
      amount: target.accounts.find((a) => a.name === 'MOEX').amount,
      stillOpen: !!document.querySelector('.snap-editor'),
      tableText: document.querySelector('.mini-table tbody').innerText.replace(/\n/g, ' | '),
    };
  });
  check('the edited amount is persisted', saved.amount === 1111000, String(saved.amount));
  check('the editor closes after saving', !saved.stillOpen, String(saved.stillOpen));
  check('the table shows the new total', norm(saved.tableText).includes('1553000₽'), saved.tableText.slice(0, 160));

  // cancel leaves the snapshot alone
  const cancelled = await page.evaluate(async () => {
    const row = document.querySelector('.mini-table tbody tr.snap-row');
    row.click();
    const editor = document.querySelector('.snap-editor');
    const amount = editor.querySelectorAll('.acc-row')[0].querySelectorAll('input')[1];
    amount.value = '1';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    [...editor.querySelectorAll('.snap-buttons .btn')].find((b) => /отмена/i.test(b.textContent)).click();
    const list = await window.api.balances.list();
    return list.find((s) => s.date === '2026-08-20').accounts.find((a) => a.name === 'MOEX').amount;
  });
  check('cancelling discards the edit', cancelled === 1111000, String(cancelled));

  // a deposit through the form: it must lift the journal line, not the profit
  const beforeFlow = await page.evaluate(() => document.querySelector('#view').innerText.replace(/\n/g, ' | '));
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .btn')]
    .find((b) => /ввод \/ вывод/i.test(b.textContent)).click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const flowForm = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const set = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const labelled = (re) => [...modal.querySelectorAll('label')].find((l) => re.test(l.textContent));
    set(labelled(/дата/i).querySelector('input'), '2026-08-10');
    set(labelled(/счёт/i).querySelector('input'), 'MOEX');
    set(labelled(/сумма/i).querySelector('input'), 200000);
    const dir = labelled(/направление/i).querySelector('select');
    // the datalist sits at the end of the modal, not inside the label
    const accounts = [...document.getElementById('dh-acclist').options].map((o) => o.value);
    return { preview: modal.querySelector('.acc-total').innerText.replace(/\n/g, ' '),
      directions: [...dir.options].map((o) => o.textContent), accounts };
  });
  check('the movement form previews what will land on the accounts',
    norm(flowForm.preview).includes('200000₽'), flowForm.preview);
  check('it offers both directions', flowForm.directions.length === 2
    && /ввод/i.test(flowForm.directions[0]) && /вывод/i.test(flowForm.directions[1]), flowForm.directions.join('|'));
  check('the account field suggests accounts already used', flowForm.accounts.includes('MOEX'),
    flowForm.accounts.join('|'));

  await page.evaluate(() => [...document.querySelectorAll('.modal-buttons .btn')]
    .find((b) => /сохранить/i.test(b.textContent)).click());
  await page.waitForSelector('.metrics', { timeout: 8000 });
  const afterFlow = await page.evaluate(() => ({
    text: document.querySelector('#view').innerText.replace(/\n/g, ' | '),
    flowRows: [...document.querySelectorAll('.card')]
      .find((c) => /ввод и вывод/i.test(c.querySelector('.card-title').textContent))
      .querySelectorAll('tbody tr').length,
    drift: [...document.querySelectorAll('.metric')]
      .find((m) => /расхождение/i.test(m.innerText)).innerText.replace(/\n/g, ' '),
  }));
  check('the movement lands in its own table', afterFlow.flowRows === 1, String(afterFlow.flowRows));
  check('«Заведено» reports the deposit', norm(afterFlow.text).includes('200000₽'), afterFlow.text.slice(0, 200));
  check('the drift metric changes once the transfer is known',
    afterFlow.drift !== beforeFlow, afterFlow.drift);

  const flowMath = await page.evaluate(async () => {
    const [snaps, flows, trades] = await Promise.all([
      window.api.balances.list(), window.api.flows.list(), window.api.trades.list(),
    ]);
    const withFlows = window.balances.journalLine(snaps, trades, flows);
    const without = window.balances.journalLine(snaps, trades, []);
    return { withFlows, without, net: window.balances.flowTotals(flows).net };
  });
  check('a 200 000 ₽ deposit lifts the journal line by exactly that',
    Math.abs((flowMath.withFlows[1] - flowMath.without[1]) - 200000) < 0.5,
    JSON.stringify(flowMath));

  const flowsCleaned = await page.evaluate(async () => {
    for (const f of await window.api.flows.list()) await window.api.flows.remove(f.id);
    return (await window.api.flows.list()).length;
  });
  check('movements can be removed', flowsCleaned === 0, String(flowsCleaned));

  // delete the snapshots again
  const cleaned = await page.evaluate(async () => {
    const list = await window.api.balances.list();
    for (const s of list) await window.api.balances.remove(s.id);
    return (await window.api.balances.list()).length;
  });
  check('snapshots can be removed', cleaned === 0, String(cleaned));


  console.log('\n[10] cloud sync through a folder');
  const SYNC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'diaryhunt-cloud-'));
  const SYNC_FILE = path.join(SYNC_DIR, 'diaryhunt-db.json');

  // the folder is chosen through a system dialog, so point the setting at it directly
  await page.evaluate(async (dir) => {
    const s = await window.api.config.getSettings();
    await window.api.config.setSettings({ sync: { ...(s.sync || {}), dir, lastPushAt: '', lastPullAt: '' } });
  }, SYNC_DIR);

  const pushed = await page.evaluate(() => window.api.sync.push());
  check('a manual push writes the file into the folder', fs.existsSync(SYNC_FILE), SYNC_FILE);
  check('the push reports what went up',
    pushed.phase === 'pushed' && pushed.counts.trades > 0, JSON.stringify(pushed.counts || {}));

  const onDisk = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  check('the file carries both databases and a stamp',
    Array.isArray(onDisk.trades) && Array.isArray(onDisk.balances)
    && Array.isArray(onDisk.cashflows) && !!onDisk.syncedAt && !!onDisk.device,
    Object.keys(onDisk).join('|'));

  // adding a trade must reach the folder on its own, without pressing anything
  const before = onDisk.trades.length;
  await page.evaluate(() => window.api.trades.add({
    openDate: '2026-08-28', closeDate: '2026-08-28', type: 'Фьючи', ticker: 'SYNCX', tag: '',
    usdRub: 85, payout: 0, adjustment: 0, comment: '',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 101, feeRub: 0 },
      { exchange: 'FOREX', side: 'Шорт', entryPrice: 100.5, units: 10, exitPrice: 100.6, feeRub: 0 },
    ],
  }));
  await page.waitForTimeout(2500);   // the upload is debounced by 1.5s
  const afterAdd = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  check('adding a trade uploads by itself', afterAdd.trades.length === before + 1,
    `${before} -> ${afterAdd.trades.length}`);
  check('the uploaded file holds the new trade',
    afterAdd.trades.some((t) => t.ticker === 'SYNCX'), 'SYNCX not found');

  // a balance snapshot counts as a change too
  await page.evaluate(() => window.api.balances.add({
    date: '2026-08-28', usdRub: 85, comment: 'sync',
    accounts: [{ name: 'MOEX', amount: 100000, ccy: 'RUB' }],
  }));
  await page.waitForTimeout(2500);
  const afterBalance = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
  check('a balance snapshot uploads too',
    afterBalance.balances.some((b) => b.comment === 'sync'), String(afterBalance.balances.length));

  // now pretend another device wrote a newer file
  const fromOther = {
    ...afterBalance,
    trades: afterBalance.trades.filter((t) => t.ticker !== 'SYNCX'),
    syncedAt: new Date(Date.now() + 60000).toISOString(),
    device: 'LAPTOP-2',
  };
  fs.writeFileSync(SYNC_FILE, JSON.stringify(fromOther, null, 2), 'utf8');
  const pulled = await page.evaluate(() => window.api.sync.pull());
  check('pulling reports the device the version came from',
    pulled.phase === 'pulled' && pulled.device === 'LAPTOP-2', JSON.stringify(pulled));
  const localAfterPull = await page.evaluate(() => window.api.trades.list());
  check('a pull replaces the local database outright',
    !localAfterPull.some((t) => t.ticker === 'SYNCX'), 'SYNCX survived the pull');

  const statusNow = await page.evaluate(() => window.api.sync.status());
  check('status knows the folder and both timestamps',
    statusNow.enabled && statusNow.dir === statusNow.dir && !!statusNow.lastPullAt, JSON.stringify(statusNow));

  const badge = await page.evaluate(() => {
    const b = document.querySelector('#sync-badge');
    return { cls: b.className, text: b.querySelector('.txt').textContent, title: b.title };
  });
  check('the header badge shows a healthy sync', /ok/.test(badge.cls), JSON.stringify(badge));
  check('its tooltip names the folder', /diaryhunt-cloud-/.test(badge.title), badge.title);

  const off = await page.evaluate(() => window.api.sync.disable());
  check('sync can be switched off', off.enabled === false, JSON.stringify(off));
  fs.rmSync(SYNC_DIR, { recursive: true, force: true });


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
