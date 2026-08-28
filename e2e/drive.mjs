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

  // expanding a trade reveals the per-leg numbers
  await page.evaluate(() => document.querySelectorAll('.trade-row')[0].click());
  await page.waitForSelector('.trade-detail', { timeout: 5000 });
  const detail = await page.evaluate(() => document.querySelector('.trade-detail').innerText.replace(/\n/g, ' | '));
  check('expanded detail shows both legs with prices, size and fees',
    /MOEX/.test(detail) && /FOREX/.test(detail) && /→/.test(detail), detail);
  // the labels render uppercase via CSS, and innerText returns them transformed
  check('every column in the expanded trade is labelled',
    ['Биржа', 'Сделка', 'Цена вход', 'Кол-во', 'Позиция начало', 'Комиссия', 'PnL ноги']
      .every((l) => detail.toLowerCase().includes(l.toLowerCase())), detail);
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
  check('form live panel shows exit spread and position value',
    /спред выход/i.test(res.manualLive) && /Позиция/i.test(res.manualLive)
    && /\$[\d\s]+ → \$[\d\s]+/.test(res.manualLive), res.manualLive);

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
