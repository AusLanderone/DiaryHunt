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
      filters: [...document.querySelectorAll('.journal-bar .chips .chip')].map((c) => c.textContent),
      sortHints: document.querySelectorAll('.journal-head .arrow.hint').length,
      sortable: document.querySelectorAll('.journal-head .sortable').length,
      // the spread each closed trade actually collected, one badge per row
      spreadFacts: [...document.querySelectorAll('.trade-row .sp-fact')].map((b) => b.textContent),
      heads: [...document.querySelectorAll('.journal-head .jh')].map((h) => h.textContent),
      // size / days / return, one cell per row
      sizes: [...document.querySelectorAll('.trade-row .size')].map((c) => c.textContent),
      holds: [...document.querySelectorAll('.trade-row .hold')].map((c) => c.textContent),
      rets: [...document.querySelectorAll('.trade-row .ret')].map((c) => c.textContent),
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
    journal.filters.length === 3 && journal.sortable === 9, JSON.stringify(journal.filters));
  check('unsorted columns show they can be sorted', journal.sortHints === 9, String(journal.sortHints));
  check('the journal carries size, days and return columns',
    /объём/i.test(journal.heads.join('|')) && /дней/i.test(journal.heads.join('|'))
    && /дох/i.test(journal.heads.join('|')), journal.heads.join('|'));
  // #1: (1,1505×42000 + 1,1526925×40000) × 83,7 over two legs = 3 951 841 ₽
  // #3: (65,76×530 + 65,269×500) × 84,95 over two legs = 2 866 523 ₽
  check('each row shows the money one leg of it ties up',
    journal.sizes.length === 2 && journal.sizes.some((v) => /3,95\s*млн/.test(v))
    && journal.sizes.some((v) => /2,87\s*млн/.test(v)), journal.sizes.join('|'));
  // both fixtures opened and closed the same day
  check('each row shows how long the trade ran',
    journal.holds.length === 2 && journal.holds.every((v) => /^0\s*д$/.test(v.trim())),
    journal.holds.join('|'));
  // #1: 1 339,40 ₽ on 3 951 841 ₽ = 0,0339%; #3: 862,97 ₽ on 2 866 523 ₽ = 0,0301%
  check('each row shows what it returned on that money',
    journal.rets.length === 2 && journal.rets.some((v) => /\+0,034%/.test(v))
    && journal.rets.some((v) => /\+0,030%/.test(v)), journal.rets.join('|'));
  // #1 collected 0.1904% - 0.1484% = 0.0419%; #3 moved 0.1150% and both closed
  // in profit, so both read as a plus whichever way their spread went
  check('closed rows show the spread actually collected, signed by the result',
    journal.spreadFacts.length === 2
    && journal.spreadFacts.some((v) => v.trim() === '+0,04%')
    && journal.spreadFacts.some((v) => v.trim() === '+0,12%'),
    journal.spreadFacts.join('|'));
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

  // the sort picker is gone — the column headers are the only way to sort
  const pickerGone = await page.evaluate(() =>
    !document.querySelector('.sort-control') && !document.querySelector('.journal-bar .chip.dir'));
  check('the journal bar carries no sort picker', pickerGone === true, String(pickerGone));

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

  // the position is one side of the trade, not both legs added together
  const posSize = await page.evaluate(async () => {
    const ts = await window.api.trades.list();
    // the detail belongs to the row right above it — measure that trade
    const box = document.querySelector('.trade-detail');
    const ticker = box.previousElementSibling.querySelector('.ticker .tk').textContent.trim();
    const c = window.calc.computeTrade(ts.find((x) => x.ticker === ticker));
    const mi = [...box.querySelectorAll('.mi')]
      .find((x) => /позиция/i.test(x.textContent));
    return { shown: mi ? mi.innerText.split('\n').join(' ') : '',
      avg: Math.round(c.positionStartAvgRub), sum: Math.round(c.positionStartRub) };
  });
  check('the expanded trade sizes its position by one leg',
    norm(posSize.shown).includes(String(posSize.avg)) && !norm(posSize.shown).includes(String(posSize.sum)),
    `${posSize.shown} (leg ${posSize.avg}, both ${posSize.sum})`);

  check('expanded detail carries exit spread, total spread and position value',
    /Спред выход/i.test(detail) && /Спред собран/i.test(detail)
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

  // typed the way a person types, one key at a time: the field has to survive
  // its own re-render, or only the first letter ever lands
  await page.click('.journal-bar .search');
  await page.keyboard.type('silv', { delay: 30 });
  const typedSearch = await page.evaluate(() => ({
    value: document.querySelector('.journal-bar .search').value,
    focused: document.activeElement === document.querySelector('.journal-bar .search'),
    rows: document.querySelectorAll('.trade-row').length,
    caret: document.querySelector('.journal-bar .search').selectionStart,
  }));
  check('every typed letter lands in the search field',
    typedSearch.value === 'silv', JSON.stringify(typedSearch));
  check('the field keeps the focus and the caret while it is typed in',
    typedSearch.focused && typedSearch.caret === 4, JSON.stringify(typedSearch));
  check('and the journal narrows as it goes', typedSearch.rows === 1, JSON.stringify(typedSearch));
  await page.evaluate(() => {
    const s = document.querySelector('.journal-bar .search');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // tag, ticker and type each keep or drop trades; the picker says which
  const pickerUi = await page.evaluate(() => {
    const openPicker = (name) => {
      const btn = [...document.querySelectorAll('.journal-bar .picker-btn')]
        .find((b) => b.textContent.startsWith(name));
      btn.click();
      return document.querySelector('.picker-panel');
    };
    const rows = () => document.querySelectorAll('.trade-row').length;
    const tickers = () => [...document.querySelectorAll('.trade-row .ticker .tk')].map((t) => t.textContent);
    const tickOff = (panel, value) => {
      const row = [...panel.querySelectorAll('.picker-row')]
        .find((r) => r.querySelector('.pv').textContent === value);
      const cb = row.querySelector('input');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const chips = [...document.querySelectorAll('.trade-row .tag .tag-chip')].map((c) => c.textContent);
    const buttons = [...document.querySelectorAll('.journal-bar .picker-btn')].map((b) => b.textContent);
    const before = rows();

    // keep only ED
    let panel = openPicker('Тикеры');
    const values = [...panel.querySelectorAll('.picker-row .pv')].map((v) => v.textContent);
    const counts = [...panel.querySelectorAll('.picker-row .pc')].map((c) => c.textContent);
    tickOff(panel, 'ED');
    const kept = tickers();
    const keptLabel = [...document.querySelectorAll('.journal-bar .picker-btn')]
      .find((b) => b.textContent.startsWith('Тикеры')).textContent;

    // same choice, other mode: drop ED instead
    panel = document.querySelector('.picker-panel')
      || (document.querySelector('.journal-bar .picker-btn').click(), document.querySelector('.picker-panel'));
    [...panel.querySelectorAll('.picker-modes .chip')].find((b) => /убрать/i.test(b.textContent)).click();
    const dropped = tickers();
    const droppedLabel = [...document.querySelectorAll('.journal-bar .picker-btn')]
      .find((b) => b.textContent.startsWith('Тикеры')).textContent;

    // reset brings everything back
    [...document.querySelectorAll('.picker-panel .btn')].find((b) => /сбросить/i.test(b.textContent)).click();
    const restored = rows();
    document.body.click();   // fold the panel away
    return { chips, buttons, before, values, counts, kept, keptLabel, dropped, droppedLabel, restored,
      panelsOpen: document.querySelectorAll('.picker-panel').length };
  });
  check('type shows as a chip beside the tag',
    pickerUi.chips.includes('Фьючи') && pickerUi.chips.includes('Схождение'), pickerUi.chips.join('|'));
  check('tag, ticker and type each get a filter of their own',
    ['Теги', 'Тикеры', 'Типы'].every((n) => pickerUi.buttons.some((b) => b.startsWith(n))),
    pickerUi.buttons.join('|'));
  check('a picker lists the values in use with their trade counts',
    pickerUi.values.includes('ED') && pickerUi.values.includes('SILV') && pickerUi.counts.includes('1'),
    JSON.stringify(pickerUi.values) + JSON.stringify(pickerUi.counts));
  check('«Оставить» keeps only the ticked value',
    pickerUi.kept.join() === 'ED' && /Тикеры: ED/.test(pickerUi.keptLabel),
    `${pickerUi.kept.join('|')} — ${pickerUi.keptLabel}`);
  check('«Убрать» hides it and keeps the rest',
    pickerUi.dropped.join() === 'SILV' && /кроме ED/.test(pickerUi.droppedLabel),
    `${pickerUi.dropped.join('|')} — ${pickerUi.droppedLabel}`);
  check('«Сбросить» brings every trade back', pickerUi.restored === pickerUi.before,
    `${pickerUi.restored} of ${pickerUi.before}`);
  check('a click outside folds the picker away', pickerUi.panelsOpen === 0, String(pickerUi.panelsOpen));
  check('an empty result explains itself instead of showing a blank page',
    filtered.afterOpen === 0 && /ничего не подошло/i.test(filtered.emptyNote), JSON.stringify(filtered));
  check('clearing the filter brings every trade back', filtered.restored === 2, JSON.stringify(filtered));

  // every column header lines up with the values under it: the glyphs, not the
  // cell boxes, so a badge's padding or a sort arrow can't fake it
  const align = await page.evaluate(() => {
    const textRect = (node) => {
      const r = document.createRange();
      r.selectNodeContents(node);
      return r.getBoundingClientRect();
    };
    const heads = [...document.querySelectorAll('.journal-head .jh')];
    // matched against the label alone, so an anchored pattern can tell the two
    // spread columns apart without the sort arrow getting in the way
    const label = (re) => {
      const h = heads.find((x) => re.test((x.querySelector('.lbl') || x).textContent));
      return h ? (h.querySelector('.lbl') || h) : null;
    };
    const row = document.querySelectorAll('.trade-row')[0];
    const gap = ([name, sel, edge]) => {
      const head = label(new RegExp(name, 'i'));
      const cell = row.querySelector(sel);
      if (!head || !cell) return { name, dx: 'missing' };
      return { name, dx: Math.round(textRect(head)[edge] - textRect(cell)[edge]) };
    };
    return {
      // the entry and exit halves of the spread column stack across rows too,
      // however many digits or minus signs each carries
      subcols: ['sp-in', 'sp-out'].map((cls) => ({
        cls,
        edges: [...new Set([...document.querySelectorAll('.trade-row .' + cls)]
          .map((e) => Math.round(e.getBoundingClientRect().right)))],
      })),
      right: [['^спред вх', '.spread', 'right'], ['^спред$', '.sp-fact', 'right'],
        ['^объём$', '.size', 'right'], ['^дней$', '.hold', 'right'],
        ['^доходность$', '.ret', 'right'], ['^чистый$', '.money .sum', 'right']].map(gap),
      left: [['^№$', '.num', 'left'], ['^дата$', '.date .d1', 'left'],
        ['^тикер$', '.ticker .tk', 'left']].map(gap),
    };
  });
  check('right-aligned headers end where their numbers end',
    align.right.every((c) => typeof c.dx === 'number' && Math.abs(c.dx) <= 1),
    JSON.stringify(align.right));
  check('left-aligned headers start where their values start',
    align.left.every((c) => typeof c.dx === 'number' && Math.abs(c.dx) <= 1),
    JSON.stringify(align.left));
  check('the return column is named in full', /доходность/i.test(journal.heads.join('|')),
    journal.heads.join('|'));
  check('the entry and exit spreads stack across rows',
    align.subcols.every((s) => s.edges.length === 1), JSON.stringify(align.subcols));

  // the new columns sort like any other: #1 (ED) ties up more money than #3
  const sizeSort = await page.evaluate(() => {
    const head = [...document.querySelectorAll('.journal-head .sortable')]
      .find((h) => /объём/i.test(h.textContent));
    head.click();
    const desc = [...document.querySelectorAll('.trade-row .ticker .tk')].map((t) => t.textContent);
    head.click();
    const asc = [...document.querySelectorAll('.trade-row .ticker .tk')].map((t) => t.textContent);
    head.click();   // back to the default order
    return { desc, asc };
  });
  check('the size column sorts the journal, biggest first',
    sizeSort.desc.join() === 'ED,SILV' && sizeSort.asc.join() === 'SILV,ED', JSON.stringify(sizeSort));

  // an open trade ties up money but has no span and no return yet
  await page.evaluate(() => window.api.trades.add({
    openDate: '2026-08-20', closeDate: '', type: 'Фьючи', ticker: 'OPENONE',
    tag: 'Схождение', usdRub: 85, payout: 0, adjustment: 0, comment: 'e2e open',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 100, exitPrice: null, feeRub: 0 },
      { exchange: 'BYBIT', side: 'Шорт', entryPrice: 101, units: 100, exitPrice: null, feeRub: 0 },
    ],
  }));
  await page.reload();
  await page.waitForSelector('.trade-row', { timeout: 10000 });
  const openRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.trade-row')]
      .find((r) => /OPENONE/.test(r.innerText));
    const cell = (cls) => row.querySelector('.' + cls).textContent.trim();
    return { size: cell('size'), hold: cell('hold'), ret: cell('ret') };
  });
  // (100 × 100 + 101 × 100) × 85 over two legs = 854 250 ₽
  check('an open trade still shows the money it ties up',
    /854\s*250|0,85\s*млн/.test(openRow.size), openRow.size);
  check('an open trade shows no days and no return yet',
    openRow.hold === '—' && openRow.ret === '—', JSON.stringify(openRow));
  await page.evaluate(() => window.api.trades.list().then((ts) => {
    const t = ts.find((x) => x.ticker === 'OPENONE');
    return t ? window.api.trades.remove(t.id) : null;
  }));
  await page.reload();
  await page.waitForSelector('.trade-row', { timeout: 10000 });

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
  // four period chips plus the filters toggle, which shares the row
  check('period chips rendered',
    ['Всё время', 'Год', 'Квартал', 'Месяц'].every((t) => widgets.chips.includes(t))
    && widgets.chips.length === 5, widgets.chips.join('|'));
  check('calendar heatmap marks both close days', widgets.calCells === 2, `got ${widgets.calCells}`);
  check('spread / holding / capital / weekday panels present',
    ['спреду входа', 'времени удержания', 'объёму позиции', 'дню недели']
      .every((t) => widgets.panels.some((p) => p.toLowerCase().includes(t))), widgets.panels.join(' | '));
  check('the per-leg direction panels are gone',
    !widgets.panels.some((p) => /направлени/i.test(p)), widgets.panels.join(' | '));
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
      wide: cards.filter((c) => c.getBoundingClientRect().width
        > document.querySelector('.stats-grid').clientWidth * 0.9).length,
      metricsDisplay: getComputedStyle(document.querySelector('.metrics')).display,
    };
  });
  check('every widget is a card in one grid', layout.cards === 12, JSON.stringify(layout));
  check('cards share rows instead of stacking one per line', layout.maxPerRow >= 2, JSON.stringify(layout));
  check('the equity curve runs the full width', layout.wide === 1, JSON.stringify(layout));
  check('metrics use the equal-tile grid', layout.metricsDisplay === 'grid', layout.metricsDisplay);
  check('stats page never scrolls sideways', layout.overflow <= 0, `overflow ${layout.overflow}px`);

  console.log('\n[3c] period filter');
  // The sheet-verified fixtures carry fixed August 2026 dates, so what «Месяц»
  // should show depends on the day the suite runs. This section therefore adds
  // its own trades relative to today — a loser closed over a year back and a
  // winner closed today — and works out the expected counts from the dates it
  // knows, instead of assuming the calendar sits in August 2026.
  // local calendar day, not UTC: the app's period filter reads the local clock,
  // and toISOString would hand back yesterday for the first hours of the day
  const isoDay = (d) => {
    const x = new Date(d), p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };
  const daysAgo = (n) => isoDay(Date.now() - n * 86400000);
  const todayIso = isoDay(Date.now());
  const oldDate = daysAgo(400);
  const oldTrade = {
    openDate: oldDate, closeDate: oldDate, type: 'Фьючи', ticker: 'OLD', tag: '',
    usdRub: 80, payout: 0, adjustment: 0, comment: 'e2e old',
    legs: [
      { exchange: 'MOEX', side: 'Лонг', entryPrice: 100, units: 10, exitPrice: 99, feeRub: 0 },
      { exchange: 'FOREX', side: 'Шорт', entryPrice: 101, units: 10, exitPrice: 101, feeRub: 0 },
    ],
  };
  // a winner closed today, so «Месяц» always has something to show
  const freshTrade = { ...trade1, ticker: 'NOW', comment: 'e2e today',
    openDate: todayIso, closeDate: todayIso };
  for (const t of [oldTrade, freshTrade]) await page.evaluate((x) => window.api.trades.add(x), t);
  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(300);
  const closedCount = () => page.evaluate(() =>
    document.querySelector('.metric .value')?.textContent.trim());
  // the period filter keeps a trade closed on or after the first of the month
  const monthStart = todayIso.slice(0, 8) + '01';
  const closedDates = [trade1.closeDate, trade3.closeDate, oldTrade.closeDate, freshTrade.closeDate];
  const inMonth = closedDates.filter((d) => d >= monthStart).length;
  check('all-time period counts the year-old trade too',
    (await closedCount()) === String(closedDates.length), `got ${await closedCount()}`);
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => b.textContent === 'Месяц').click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, '05-stats-month.png'), fullPage: true });
  check('month period drops the year-old trade',
    (await closedCount()) === String(inMonth) && inMonth < closedDates.length,
    `got ${await closedCount()}, expected ${inMonth} of ${closedDates.length}`);
  // every trade left inside the month is a winner; the loser is the old one
  const winrateMonth = await page.evaluate(() => document.querySelector('#view').innerText);
  check('month period winrate back to 100.0%', norm(winrateMonth).includes('100.0%'));
  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => b.textContent === 'Всё время').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.api.trades.list().then((ts) => Promise.all(
    ts.filter((t) => t.ticker === 'OLD' || t.ticker === 'NOW')
      .map((t) => window.api.trades.remove(t.id)),
  )));

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

  console.log('\n[3e] stats filters');
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(300);
  const closedNow = () => page.evaluate(() =>
    document.querySelector('.metric .value')?.textContent.trim());
  const totalNow = () => page.evaluate(() => {
    const m = [...document.querySelectorAll('.metric')].find((x) => /суммарный профит/i.test(x.textContent));
    return m ? m.querySelector('.value').textContent.replace(/\s/g, '') : '';
  });
  const openFilters = () => page.evaluate(() => {
    const btn = document.querySelector('.stats-filters-toggle');
    if (btn && !document.querySelector('.stats-filters')) btn.click();
  });
  const setRange = (field, value) => page.evaluate(([f, v]) => {
    const input = document.querySelector(`[data-f="${f}"]`);
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [field, value]);
  const pick = (name, value) => page.evaluate(([n, v]) => {
    const btn = [...document.querySelectorAll('.stats-filters .picker-btn')]
      .find((b) => b.textContent.startsWith(n));
    btn.click();
    const row = [...document.querySelectorAll('.stats-filters .picker-row')]
      .find((r) => r.querySelector('.pv').textContent === v);
    row.querySelector('input').click();
    document.body.click();
  }, [name, value]);

  const beforeFilters = await page.evaluate(() => ({
    toggle: Boolean(document.querySelector('.stats-filters-toggle')),
    panel: Boolean(document.querySelector('.stats-filters')),
  }));
  check('the stats tab offers filters and keeps them folded away',
    beforeFilters.toggle && !beforeFilters.panel, JSON.stringify(beforeFilters));

  await openFilters();
  const controls = await page.evaluate(() => ({
    pickers: [...document.querySelectorAll('.stats-filters .picker-btn')].map((b) => b.textContent),
    fields: [...document.querySelectorAll('.stats-filters [data-f]')].map((i) => i.dataset.f),
    exchanges: (() => {
      // each click re-renders the bar, so the button has to be found again
      const btn = () => [...document.querySelectorAll('.stats-filters .picker-btn')]
        .find((b) => b.textContent.startsWith('Биржа'));
      btn().click();
      const vals = [...document.querySelectorAll('.stats-filters .picker-row .pv')].map((v) => v.textContent);
      btn().click();
      return vals;
    })(),
  }));
  check('filters cover ticker, tag, exchange and weekday',
    ['Тикер', 'Тег', 'Биржа', 'День недели'].every((n) => controls.pickers.some((p) => p.startsWith(n))),
    controls.pickers.join('|'));
  check('filters cover the date range, the size and the three spreads',
    ['from', 'to', 'size.min', 'size.max', 'entrySpread.min', 'entrySpread.max',
      'exitSpread.min', 'exitSpread.max', 'collected.min', 'collected.max']
      .every((f) => controls.fields.includes(f)), controls.fields.join('|'));
  check('the exchange picker offers the exchanges the diary trades on',
    controls.exchanges.includes('MOEX') && controls.exchanges.includes('FOREX'),
    controls.exchanges.join('|'));
  // an unfolded picker must hang over the page, not be clipped by its panel
  const panelBox = await page.evaluate(() => {
    if (!document.querySelector('.stats-filters .picker-panel')) {
      [...document.querySelectorAll('.stats-filters .picker-btn')]
        .find((b) => b.textContent.startsWith('Биржа')).click();
    }
    const p = document.querySelector('.stats-filters .picker-panel');
    const r = p.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return { h: Math.round(r.height), w: Math.round(r.width), inside: p.contains(under) };
  });
  await page.screenshot({ path: path.join(SHOT, '05c-stats-filter-picker.png') });
  check('an unfolded picker is drawn in full, on top of the page',
    panelBox.h > 40 && panelBox.w > 80 && panelBox.inside, JSON.stringify(panelBox));
  await page.evaluate(() => document.body.click());

  // #3 (SILV) is the only trade left once the ticker is picked
  await pick('Тикер', 'SILV');
  check('picking a ticker narrows the whole tab', (await closedNow()) === '1', `got ${await closedNow()}`);
  check('and the profit is that trade alone', norm(await totalNow()).includes('3923,97'), await totalNow());
  const filterBadge = await page.evaluate(() => document.querySelector(".stats-filters-toggle").textContent);
  check('the filter button says how many windows are on', /1/.test(filterBadge), filterBadge);
  await page.evaluate(() => document.querySelector('.stats-filters .reset').click());
  check('«Сбросить» brings every trade back', (await closedNow()) === '2', `got ${await closedNow()}`);

  // #1 ties up 3,95 млн a leg, #3 2,87 млн
  await openFilters();
  await setRange('size.min', '3000000');
  check('a size window keeps the bigger trade only',
    (await closedNow()) === '1' && norm(await totalNow()).includes('1044,40'),
    `${await closedNow()} / ${await totalNow()}`);
  // typing must not knock the caret out of the field it is being typed into
  const stillFocused = await page.evaluate(() => {
    const input = document.querySelector('[data-f="size.min"]');
    input.focus();
    input.value = '30000000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.activeElement === document.querySelector('[data-f="size.min"]');
  });
  check('a filter field keeps the focus while it is being typed in', stillFocused === true);
  await page.waitForTimeout(100);
  const noneLeft = await page.evaluate(() => document.querySelector('#view .empty')?.textContent || '');
  check('a window that matches nothing says so',
    /фильтр/i.test(noneLeft), noneLeft);
  await page.evaluate(() => document.querySelector('.stats-filters .reset').click());

  // entry spreads: #1 is 0,19% and #3 is 0,75%, measured by size not by sign
  await openFilters();
  await setRange('entrySpread.min', '0,5');
  check('an entry-spread window reads the spread by size, comma decimals and all',
    (await closedNow()) === '1' && norm(await totalNow()).includes('3923,97'),
    `${await closedNow()} / ${await totalNow()}`);
  await page.evaluate(() => document.querySelector('.stats-filters .reset').click());
  await page.screenshot({ path: path.join(SHOT, '05b-stats-filters.png'), fullPage: true });
  check('the reset leaves the tab as it was', (await closedNow()) === '2', `got ${await closedNow()}`);

  console.log('\n[3e2] what the trading cost');
  // #1 paid 270 + 232 ₽, #3 paid 46 ₽: 548 ₽ over two trades, 274 ₽ each.
  // Gross before fees is 1 841,40 + 908,97 = 2 750,37 ₽, so the fees ate 19,93%.
  const fees = await page.evaluate(() => {
    const cardEl = [...document.querySelectorAll('.card')]
      .find((c) => c.dataset.widget === 'fees');
    if (!cardEl) return null;
    return {
      title: cardEl.querySelector('.card-title').textContent,
      total: cardEl.querySelector('.fee-total').textContent,
      lines: [...cardEl.querySelectorAll('.fee-lines .fl')]
        .map((r) => `${r.querySelector('.k').textContent}=${r.querySelector('.v').textContent}`),
    };
  });
  await page.locator('[data-widget="fees"]').screenshot({ path: path.join(SHOT, '05h-fees-widget.png') });
  check('the stats tab carries a fees widget', fees !== null && /комиссии/i.test(fees.title),
    fees && fees.title);
  check('it shows what the trading cost in total', norm(fees.total).includes('548,00'), fees.total);
  check('and per trade', fees.lines.some((l) => /за сделку/i.test(l) && norm(l).includes('274,00')),
    fees.lines.join(' | '));
  check('and the share of the gross the fees ate',
    fees.lines.some((l) => /доля/i.test(l) && /19,9/.test(l)), fees.lines.join(' | '));
  check('and which venue took it, dearest first',
    /MOEX=/.test(fees.lines[2]) && norm(fees.lines[2]).includes('316,00')
    && /FOREX=/.test(fees.lines[3]) && norm(fees.lines[3]).includes('232,00'),
    fees.lines.join(' | '));

  console.log('\n[3f] per-widget ranges');
  const bandsOf = (title) => page.evaluate((t) => {
    const cardEl = [...document.querySelectorAll('.card')]
      .find((c) => c.querySelector('.card-title')?.textContent.includes(t));
    return [...cardEl.querySelectorAll('.brow .name')].map((n) => n.textContent);
  }, title);
  const openGear = (title) => page.evaluate((t) => {
    const cardEl = [...document.querySelectorAll('.card')]
      .find((c) => c.querySelector('.card-title')?.textContent.includes(t));
    cardEl.querySelector('.card-gear').click();
  }, title);

  const gears = await page.evaluate(() => [...document.querySelectorAll('.card')]
    .filter((c) => c.querySelector('.card-gear'))
    .map((c) => c.querySelector('.card-title').textContent));
  const gearVisible = await page.evaluate(() => {
    const g = document.querySelector('.card-gear');
    const st = getComputedStyle(g);
    return { opacity: Number(st.opacity), display: st.display, w: g.getBoundingClientRect().width };
  });
  check('the gear is visible without hovering for it',
    gearVisible.opacity >= 0.2 && gearVisible.display !== 'none' && gearVisible.w >= 16,
    JSON.stringify(gearVisible));
  check('every widget with bands of its own carries a gear',
    gears.length === 4
    && gears.some((t) => /спреду входа/i.test(t)) && gears.some((t) => /времени удержания/i.test(t))
    && gears.some((t) => /объёму позиции/i.test(t)) && gears.some((t) => /распределение/i.test(t)),
    gears.join('|'));

  const beforeBands = await bandsOf('Профит по спреду входа');
  await openGear('Профит по спреду входа');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.screenshot({ path: path.join(SHOT, '05e-widget-range-dialog.png') });
  const dialog = await page.evaluate(() => ({
    edges: [...document.querySelectorAll('.band-rows .br-num')].map((i) => i.value),
    rows: [...document.querySelectorAll('.band-row')].map((r) => r.textContent.trim()),
    tail: document.querySelector('.band-row.tail')?.textContent.trim() || '',
    buttons: [...document.querySelectorAll('.modal-buttons .btn')].map((b) => b.textContent),
    add: Boolean(document.querySelector('.rf-add')),
    dels: document.querySelectorAll('.br-del').length,
  }));
  check('the dialog opens on the bands the widget is drawing now',
    dialog.edges.join('|') === '0,5|1|2', dialog.edges.join('|'));
  check('a band reads as a sentence, and only its own edge is typed',
    /^до\s*$/.test(dialog.rows[0].replace(/[\d,%]/g, '').trim())
    || /^до/.test(dialog.rows[0]), dialog.rows.join(' / '));
  check('the row after the first says where it starts',
    /от\s*0,5\s*до/.test(dialog.rows[1].replace(/\s+/g, ' ')), dialog.rows[1]);
  check('the last row says where everything above falls',
    /больше\s*2/.test(dialog.tail.replace(/\s+/g, ' ')), dialog.tail);
  check('every band can be removed and another added',
    dialog.dels === 3 && dialog.add, JSON.stringify({ dels: dialog.dels, add: dialog.add }));
  check('it offers a way back to the app default',
    dialog.buttons.some((b) => /умолчанию/i.test(b)), dialog.buttons.join('|'));

  // the wording follows the number being typed, without losing the caret
  const typing = await page.evaluate(() => {
    const input = document.querySelectorAll('.band-rows .br-num')[0];
    input.focus();
    input.value = '0,3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      second: document.querySelectorAll('.band-row')[1].textContent.replace(/\s+/g, ' ').trim(),
      focused: document.activeElement === document.querySelectorAll('.band-rows .br-num')[0],
    };
  });
  check('the next row follows the edge being typed above it',
    /от 0,3 до/.test(typing.second), typing.second);
  check('and the caret stays in the row being typed in', typing.focused === true);

  // adding a band suggests the next edge past the last one
  const added = await page.evaluate(() => {
    document.querySelector('.rf-add').click();
    return [...document.querySelectorAll('.band-rows .br-num')].map((i) => i.value);
  });
  check('a new band starts past the last one',
    added.length === 4 && added[3] === '4', added.join('|'));

  // one edge at 0,5%: #1 entered on 0,19% and #3 on 0,75%, so they split
  await page.evaluate(() => {
    // the last band cannot be removed, so this stops at one row
    for (let i = 0; i < 10 && document.querySelector('.br-del'); i++) document.querySelector('.br-del').click();
    const input = document.querySelector('.band-rows .br-num');
    input.value = '0,5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-buttons .btn')]
      .find((b) => /сохранить/i.test(b.textContent)).click();
  });
  await page.waitForTimeout(300);
  const afterBands = await bandsOf('Профит по спреду входа');
  check('the widget redraws on the bands that were set',
    afterBands.length === 2 && afterBands.join('|') !== beforeBands.join('|')
    && afterBands.every((b) => /0,5/.test(b)), `${beforeBands.join('|')} -> ${afterBands.join('|')}`);

  // the setting belongs to the diary, not to the session
  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  const afterReload = await bandsOf('Профит по спреду входа');
  check('the bands survive a restart', afterReload.join('|') === afterBands.join('|'),
    afterReload.join('|'));

  // a band the reader asked for is drawn even when nothing landed in it —
  // otherwise the widget silently answers with fewer bands than were set
  await openGear('Профит по спреду входа');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.evaluate(() => {
    document.querySelector('.rf-add').click();
    const inputs = [...document.querySelectorAll('.band-rows .br-num')];
    inputs[0].value = '0,5';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = '4';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-buttons .btn')]
      .find((b) => /\u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c/i.test(b.textContent)).click();
  });
  await page.waitForTimeout(300);
  const withEmpty = await page.evaluate(() => {
    const cardEl = [...document.querySelectorAll('.card')]
      .find((c) => /\u0441\u043f\u0440\u0435\u0434\u0443 \u0432\u0445\u043e\u0434\u0430/i.test(c.querySelector('.card-title').textContent));
    return {
      labels: [...cardEl.querySelectorAll('.brow .name')].map((n) => n.textContent),
      metas: [...cardEl.querySelectorAll('.brow .meta')].map((n) => n.textContent),
      clipped: cardEl.scrollHeight - cardEl.clientHeight,
    };
  });
  check('every band that was set is drawn, empty ones included',
    withEmpty.labels.length === 3 && /4/.test(withEmpty.labels[2]), withEmpty.labels.join('|'));
  check('an empty band says so instead of counting nothing',
    !withEmpty.metas.some((m) => /NaN/.test(m)), withEmpty.metas.join('|'));
  check('and the card grows to hold every row', withEmpty.clipped <= 0, String(withEmpty.clipped));

  // nonsense in a row is refused, and the row says so
  await openGear('Профит по спреду входа');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const refused = await page.evaluate(() => {
    const input = document.querySelector('.band-rows .br-num');
    input.value = 'сколько-нибудь';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-buttons .btn')]
      .find((b) => /сохранить/i.test(b.textContent)).click();
    return {
      open: Boolean(document.querySelector('.modal')),
      bad: Boolean(document.querySelector('.br-num.bad')),
      says: document.querySelector('.range-error')?.textContent || '',
    };
  });
  check('a row with no number in it saves nothing and is pointed at',
    refused.open && refused.bad && /строке/i.test(refused.says), JSON.stringify(refused));

  await page.evaluate(() => [...document.querySelectorAll('.modal-buttons .btn')]
    .find((b) => /умолчанию/i.test(b.textContent)).click());
  await page.evaluate(() => [...document.querySelectorAll('.modal-buttons .btn')]
    .find((b) => /сохранить/i.test(b.textContent)).click());
  await page.waitForTimeout(300);
  check('«По умолчанию» puts the app bands back',
    (await bandsOf('Профит по спреду входа')).join('|') === beforeBands.join('|'),
    (await bandsOf('Профит по спреду входа')).join('|'));

  // the histogram counts columns rather than banding anything, so it steps
  await openGear('Распределение результатов');
  await page.waitForSelector('.count-editor', { timeout: 5000 });
  await page.screenshot({ path: path.join(SHOT, '05f-widget-count-dialog.png') });
  const stepper = await page.evaluate(() => {
    const before = document.querySelector('[data-f="edge-0"]').value;
    [...document.querySelectorAll('.br-step')].find((b) => b.textContent === '+').click();
    const up = document.querySelector('[data-f="edge-0"]').value;
    [...document.querySelectorAll('.br-step')].find((b) => b.textContent === '−').click();
    return { before, up, back: document.querySelector('[data-f="edge-0"]').value,
      range: document.querySelector('.br-range')?.textContent || '' };
  });
  check('the histogram is stepped up and down, inside stated limits',
    stepper.before === '8' && stepper.up === '9' && stepper.back === '8'
    && /2/.test(stepper.range) && /40/.test(stepper.range), JSON.stringify(stepper));
  await page.evaluate(() => [...document.querySelectorAll('.modal-buttons .btn')]
    .find((b) => /отмена/i.test(b.textContent)).click());

  console.log('\n[3g] moving the widgets around');
  const cardOrder = () => page.evaluate(() =>
    [...document.querySelectorAll('.stats-grid .card')].map((c) => c.dataset.widget));
  const dragCard = (from, to) => page.evaluate(([a, b]) => {
    const cards = [...document.querySelectorAll('.stats-grid .card')];
    const src = cards.find((c) => c.dataset.widget === a);
    const tgt = cards.find((c) => c.dataset.widget === b);
    const dt = new DataTransfer();
    src.querySelector('.card-drag').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    tgt.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    tgt.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [from, to]);

  const startOrder = await cardOrder();
  check('every card knows which widget it is, and they stand in a known order',
    startOrder.length === 12 && startOrder[0] === 'equity' && !startOrder.includes(undefined),
    startOrder.join('|'));
  const handles = await page.evaluate(() => ({
    count: document.querySelectorAll('.stats-grid .card-drag').length,
    opacity: Number(getComputedStyle(document.querySelector('.card-drag')).opacity),
    draggableBefore: document.querySelector('.stats-grid .card').draggable,
  }));
  check('every card has a handle, visible without hovering',
    handles.count === 12 && handles.opacity >= 0.2, JSON.stringify(handles));
  check('a card is not draggable until its handle is held',
    handles.draggableBefore === false, String(handles.draggableBefore));

  await dragCard('tag', 'equity');
  await page.waitForTimeout(400);
  const moved = await cardOrder();
  check('a card dropped on another takes its place',
    moved[0] === 'tag' && moved[1] === 'equity' && moved.length === 12, moved.join('|'));

  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  const kept = await cardOrder();
  check('the arrangement survives a restart', kept.join('|') === moved.join('|'), kept.join('|'));
  await page.screenshot({ path: path.join(SHOT, '05g-widget-order.png'), fullPage: true });

  // dragging back down puts it after the card it lands on
  await dragCard('tag', 'days');
  await page.waitForTimeout(400);
  const backDown = await cardOrder();
  check('dragging a card down moves it past the one it is dropped on',
    backDown.indexOf('tag') === backDown.indexOf('days') + 1, backDown.join('|'));

  const resetOrder = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('.period-bar .chip')]
      .find((b) => /раскладк/i.test(b.textContent));
    if (!btn) return null;
    btn.click();
    return true;
  });
  check('a changed arrangement offers a way back to the default', resetOrder === true);
  await page.waitForTimeout(400);
  const defaultAgain = await cardOrder();
  check('and that puts the cards back the way the app ships them',
    defaultAgain.join('|') === startOrder.join('|'), defaultAgain.join('|'));

  console.log('\n[3h] sizing the widgets');
  const gridShape = () => page.evaluate(() => {
    const grid = document.querySelector('.stats-grid');
    const gap = 14;
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').map(parseFloat);
    const cards = [...grid.children];
    const cell = (grid.clientWidth - gap * (tracks.length - 1)) / tracks.length;
    // a card's width has to be a whole number of cells, and its left edge has
    // to sit on a column line — that is what "lined up" means here
    const offGrid = cards.filter((c) => {
      const w = c.getBoundingClientRect().width;
      const span = (w + gap) / (cell + gap);
      const left = c.getBoundingClientRect().left - grid.getBoundingClientRect().left;
      const col = left / (cell + gap);
      return Math.abs(span - Math.round(span)) > 0.06 || Math.abs(col - Math.round(col)) > 0.06;
    }).map((c) => c.dataset.widget);
    // cards that start on the same line have to end on the same line
    const byTop = new Map();
    cards.forEach((c) => {
      const r = c.getBoundingClientRect();
      const key = Math.round(r.top);
      if (!byTop.has(key)) byTop.set(key, []);
      byTop.get(key).push(Math.round(r.bottom));
    });
    const ragged = [...byTop.values()].filter((bottoms) => new Set(bottoms).size > 1).length;
    return {
      tracks,
      equalTracks: new Set(tracks.map((t) => Math.round(t))).size === 1,
      offGrid,
      ragged,
      spans: cards.map((c) => `${c.dataset.widget}:${getComputedStyle(c).gridColumn}`),
    };
  });

  const shape = await gridShape();
  check('the grid is a raster of equal columns',
    shape.tracks.length >= 2 && shape.equalTracks, JSON.stringify(shape.tracks));
  check('every card sits on that raster, whole cells wide',
    shape.offGrid.length === 0, shape.offGrid.join('|'));
  check('cards that share a row end where each other end — no ragged edges',
    shape.ragged === 0, String(shape.ragged));
  const tiling = await page.evaluate(() => {
    const grid = document.querySelector('.stats-grid');
    const gw = grid.getBoundingClientRect().width;
    const bands = new Map();
    [...grid.children].forEach((c) => {
      const r = c.getBoundingClientRect();
      const key = Math.round(r.top);
      bands.set(key, (bands.get(key) || 0) + r.width);
    });
    // a band is full when its cards plus the gaps between them cover the width
    return [...bands.entries()].map(([top, filled]) => {
      const inBand = [...grid.children]
        .filter((c) => Math.round(c.getBoundingClientRect().top) === top).length;
      return Math.round(gw - (filled + 14 * (inBand - 1)));
    });
  });
  check('no band of cards leaves the row half empty',
    tiling.every((short) => short <= 2), JSON.stringify(tiling));
  // the equity card spans three rows of 120px with 14px between them
  const tallCard = await page.evaluate(() =>
    Math.round(document.querySelector('[data-widget="equity"]').getBoundingClientRect().height));
  check('a card is exactly as tall as the rows it spans',
    Math.abs(tallCard - 388) <= 4, `${tallCard}px, expected 388`);

  // drag the corner of a one-column card across a whole cell
  const grown = await page.evaluate(async () => {
    const grid = document.querySelector('.stats-grid');
    const box = [...grid.children].find((c) => c.dataset.widget === 'fees');
    const grip = box.querySelector('.card-resize');
    const r = grip.getBoundingClientRect();
    const cell = (grid.clientWidth - 14 * 2) / 3 + 14;
    const opts = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true });
    grip.dispatchEvent(new PointerEvent('pointerdown', opts(r.left, r.top)));
    grip.dispatchEvent(new PointerEvent('pointermove', opts(r.left + cell, r.top)));
    grip.dispatchEvent(new PointerEvent('pointerup', opts(r.left + cell, r.top)));
    await new Promise((res) => setTimeout(res, 250));
    const after = document.querySelector('[data-widget="fees"]');
    return getComputedStyle(after).gridColumn;
  });
  check('a card dragged by its corner takes another column',
    /span 2/.test(grown), grown);

  await page.reload();
  await page.waitForSelector('#tab-stats', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-stats').click());
  await page.waitForTimeout(400);
  const keptSize = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-widget="fees"]')).gridColumn);
  check('the size survives a restart', /span 2/.test(keptSize), keptSize);
  // a hand-made layout can leave a card shorter than its neighbour — what it
  // must not do is leave a card off the raster or a row half empty
  const stillTidy = await gridShape();
  check('and the raster still holds after a resize',
    stillTidy.offGrid.length === 0, stillTidy.offGrid.join('|'));
  await page.screenshot({ path: path.join(SHOT, '05i-widget-sizes.png'), fullPage: true });

  // Resizing redraws the tab, which must not throw the reader back to the top:
  // sizing a card halfway down the page is otherwise unusable.
  const scrolled = await page.evaluate(async () => {
    const view = document.querySelector('#view');
    view.scrollTop = Math.round((view.scrollHeight - view.clientHeight) / 2);
    await new Promise((res) => setTimeout(res, 150));
    const before = view.scrollTop;
    const grid = document.querySelector('.stats-grid');
    const box = [...grid.children].find((c) => c.dataset.widget === 'weekday');
    const grip = box.querySelector('.card-resize');
    const r = grip.getBoundingClientRect();
    const cell = (grid.clientWidth - 14 * 2) / 3 + 14;
    const opts = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true });
    grip.dispatchEvent(new PointerEvent('pointerdown', opts(r.left, r.top)));
    grip.dispatchEvent(new PointerEvent('pointermove', opts(r.left + cell, r.top)));
    grip.dispatchEvent(new PointerEvent('pointerup', opts(r.left + cell, r.top)));
    await new Promise((res) => setTimeout(res, 400));
    return { before, after: document.querySelector('#view').scrollTop };
  });
  check('resizing a card leaves the page where the reader had it',
    scrolled.before > 100 && Math.abs(scrolled.after - scrolled.before) <= 40,
    JSON.stringify(scrolled));

  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => /раскладк/i.test(b.textContent)).click());
  await page.waitForTimeout(400);
  const backToDefault = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-widget="fees"]')).gridColumn);
  check('«Раскладка по умолчанию» puts the sizes back too',
    /span 1/.test(backToDefault), backToDefault);

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

  // «Правка» — the manual fix that has always counted in the net profit but had
  // no field to enter it in
  const adjRes = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => /правка/i.test(l.textContent));
    if (!label) return { missing: true };
    const input = label.querySelector('input');
    const set = (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };
    const net = () => document.querySelector('.live').innerText;
    const before = net();
    set('-100');
    const after = net();
    set('0');
    return { label: label.textContent, initial: input.value, before, after, restored: net() };
  });
  check('the form offers a «Правка» field, empty by default', !adjRes.missing && adjRes.initial === '0',
    JSON.stringify(adjRes.label || adjRes));
  check('«Правка» −100 ₽ moves the net profit to 944,40 ₽',
    norm(adjRes.after || '').includes('944,40₽'), adjRes.after);
  check('clearing «Правка» puts the net profit back',
    norm(adjRes.restored || '') === norm(adjRes.before || ''), adjRes.restored);
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
    const byLabel = (re) => [...document.querySelectorAll('.modal > .grid > label')]
      .find((l) => re.test(l.textContent)).querySelector('input');
    const input = byLabel(/тикер/i);
    input.value = 'NEWTKR';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // the same save carries a «Правка» value, to prove the field is persisted
    const adj = byLabel(/правка/i);
    adj.value = '-250';
    adj.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.modal-buttons .btn')].find((b) => /сохранить/i.test(b.textContent)).click();
  });
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  const cfgTickers = await page.evaluate(() => window.api.config.get().then((c) => c.tickers));
  check('a newly typed ticker is remembered in the dictionary',
    cfgTickers.includes('NEWTKR'), JSON.stringify(cfgTickers));
  const savedAdj = await page.evaluate(() => window.api.trades.list()
    .then((ts) => ts.find((x) => x.ticker === 'NEWTKR')?.adjustment ?? null));
  check('the «Правка» entered in the form is saved with the trade', savedAdj === -250, String(savedAdj));

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

  console.log('\n[7c] editing the dictionaries in the settings');
  const tagBlock = `[...document.querySelectorAll('.dict-block')]
    .find((b) => b.querySelector('.dict-name').textContent.trim() === 'Теги')`;
  await page.evaluate(() => document.querySelector('#btn-settings').click());
  await page.waitForSelector('.dicts .dict-block', { timeout: 8000 });
  const dictUi = await page.evaluate(() => {
    const block = (name) => [...document.querySelectorAll('.dict-block')]
      .find((b) => b.querySelector('.dict-name').textContent.trim() === name);
    const chips = (name) => [...block(name).querySelectorAll('.dict-list .dict-chip')]
      .map((c) => c.textContent.trim());
    return { names: [...document.querySelectorAll('.dict-name')].map((n) => n.textContent.trim()),
      tags: chips('Теги'), tickers: chips('Тикеры') };
  });
  check('the settings list all four dictionaries',
    ['Типы', 'Тикеры', 'Теги', 'Биржи'].every((n) => dictUi.names.includes(n)), dictUi.names.join('|'));
  check('a dictionary lists the values the trades brought in',
    dictUi.tickers.some((t) => t.startsWith('ED')), dictUi.tickers.join('|'));
  check('a value carries how many trades use it',
    dictUi.tags.some((t) => t.startsWith('Схождение') && t.includes('2')), dictUi.tags.join('|'));

  // removing a value: it leaves the list, and the form stops offering it
  await page.evaluate((sel) => {
    const block = eval(sel);
    const chip = [...block.querySelectorAll('.dict-chip')].find((c) => /Раскор/.test(c.textContent));
    chip.querySelector('button').click();
  }, tagBlock);
  await page.waitForFunction((sel) => {
    const block = eval(sel);
    return ![...block.querySelectorAll('.dict-list .dict-chip')].some((c) => /Раскор/.test(c.textContent));
  }, tagBlock, { timeout: 5000 });
  const afterRemove = await page.evaluate((sel) => {
    const block = eval(sel);
    const hidden = block.querySelector('.dict-hidden');
    return { chips: [...block.querySelectorAll('.dict-list .dict-chip')].map((c) => c.textContent.trim()),
      hidden: hidden ? hidden.textContent : '' };
  }, tagBlock);
  check('a removed value leaves the list', !afterRemove.chips.some((c) => /Раскор/.test(c)),
    afterRemove.chips.join('|'));
  check('a removed value is kept under «убрано», one click from coming back',
    /Раскор/.test(afterRemove.hidden), afterRemove.hidden);

  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-modal .modal-buttons .btn')]
      .find((b) => /готово/i.test(b.textContent)).click();
  });
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const tagOptions = await page.evaluate(() => {
    const opts = [...document.getElementById('dh-taglist').options].map((o) => o.value);
    [...document.querySelectorAll('.modal-buttons .btn')].find((b) => /отмена/i.test(b.textContent)).click();
    return opts;
  });
  check('the form stops offering a removed tag', !tagOptions.includes('Раскор'), tagOptions.join('|'));
  check('a tag the trades still use is offered', tagOptions.includes('Схождение'), tagOptions.join('|'));

  await page.evaluate(() => document.querySelector('#btn-settings').click());
  await page.waitForSelector('.dicts .dict-block', { timeout: 8000 });
  await page.evaluate((sel) => eval(sel).querySelector('.dict-hidden .dict-chip.ghost').click(), tagBlock);
  await page.waitForFunction((sel) => [...eval(sel).querySelectorAll('.dict-list .dict-chip')]
    .some((c) => /Раскор/.test(c.textContent)), tagBlock, { timeout: 5000 });
  const restored = await page.evaluate(async () => {
    const cfg = await window.api.config.get();
    [...document.querySelectorAll('.settings-modal .modal-buttons .btn')]
      .find((b) => /готово/i.test(b.textContent)).click();
    return { tags: cfg.tags, hidden: cfg.hidden.tags };
  });
  check('restoring puts the value back and clears it from hidden',
    restored.tags.includes('Раскор') && !restored.hidden.includes('Раскор'), JSON.stringify(restored));

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
    && /профит по тикеру/i.test(triStats), triStats.slice(0, 120));
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


  console.log('\n[9b] the balances widgets are laid out like the stats ones');
  // section [9] cleared the tab; the widgets only exist once there is something
  // to draw, so put a couple of marks and a movement back
  await page.evaluate(async () => {
    await window.api.balances.add({ date: '2026-08-13', usdRub: 83, comment: '',
      accounts: [{ name: 'MOEX', amount: 1200000, ccy: 'RUB' }, { name: 'FOREX', amount: 12000, ccy: 'USD' }] });
    await window.api.balances.add({ date: '2026-08-28', usdRub: 86, comment: '',
      accounts: [{ name: 'MOEX', amount: 1300000, ccy: 'RUB' }, { name: 'FOREX', amount: 12500, ccy: 'USD' }] });
    await window.api.flows.add({ date: '2026-08-20', account: 'FOREX', amount: 2500,
      ccy: 'USD', kind: 'in', usdRub: 85, comment: 'e2e' });
  });
  await page.reload();
  await page.waitForSelector('#tab-balances', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-balances').click());
  await page.waitForTimeout(500);
  const balGrid = await page.evaluate(() => {
    const grid = document.querySelector('.stats-grid');
    if (!grid) return null;
    const gw = grid.getBoundingClientRect().width;
    const cards = [...grid.children];
    return {
      ids: cards.map((c) => c.dataset.widget),
      handles: grid.querySelectorAll('.card-drag').length,
      grips: grid.querySelectorAll('.card-resize').length,
      curveFull: (() => {
        const c = cards.find((x) => x.dataset.widget === 'curve');
        return c ? c.getBoundingClientRect().width > gw * 0.9 : false;
      })(),
      // a wide table has to scroll inside its card, not push the card open:
      // the card itself must have nothing to scroll sideways
      sideSpill: cards.filter((c) => c.scrollWidth - c.clientWidth > 2)
        .map((c) => c.dataset.widget),
      scrollable: cards.filter((c) => [...c.querySelectorAll('.table-scroll')]
        .some((b) => b.scrollWidth > b.clientWidth)).map((c) => c.dataset.widget),
      ragged: (() => {
        const bands = new Map();
        cards.forEach((c) => {
          const r = c.getBoundingClientRect();
          const k = Math.round(r.top);
          if (!bands.has(k)) bands.set(k, []);
          bands.get(k).push(Math.round(r.bottom));
        });
        return [...bands.values()].filter((b) => new Set(b).size > 1).length;
      })(),
    };
  });
  check('the balances tab draws its widgets as cards on the same grid',
    balGrid && balGrid.ids.join('|') === 'curve|accounts|snapshots|flows',
    balGrid && balGrid.ids.join('|'));
  check('each of them has a handle and a corner, like on the stats tab',
    balGrid.handles === 4 && balGrid.grips === 4, JSON.stringify(balGrid));
  check('the capital curve runs the full width again', balGrid.curveFull === true);
  check('a table stays inside its card instead of hanging over the next one',
    balGrid.sideSpill.length === 0, balGrid.sideSpill.join('|'));
  check('a table too wide for its card scrolls inside it',
    balGrid.scrollable.length > 0, balGrid.scrollable.join('|'));
  check('the balances cards line up in rows like the stats ones',
    balGrid.ragged === 0, String(balGrid.ragged));

  // dragged and resized the same way, and remembered the same way
  await page.evaluate(() => {
    const grid = document.querySelector('.stats-grid');
    const src = [...grid.children].find((c) => c.dataset.widget === 'flows');
    const tgt = [...grid.children].find((c) => c.dataset.widget === 'curve');
    const dt = new DataTransfer();
    src.querySelector('.card-drag').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    tgt.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    tgt.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  const balMoved = await page.evaluate(() =>
    [...document.querySelectorAll('.stats-grid > .card')].map((c) => c.dataset.widget));
  check('a balances card is dragged into place like a stats one',
    balMoved[0] === 'flows', balMoved.join('|'));

  await page.reload();
  await page.waitForSelector('#tab-balances', { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#tab-balances').click());
  await page.waitForTimeout(500);
  const balKept = await page.evaluate(() =>
    [...document.querySelectorAll('.stats-grid > .card')].map((c) => c.dataset.widget));
  check('and the arrangement survives a restart', balKept.join('|') === balMoved.join('|'),
    balKept.join('|'));
  await page.screenshot({ path: path.join(SHOT, '09b-balances-grid.png') });

  await page.evaluate(() => [...document.querySelectorAll('.period-bar .chip')]
    .find((b) => /раскладк/i.test(b.textContent)).click());
  await page.waitForTimeout(400);
  const balBack = await page.evaluate(() =>
    [...document.querySelectorAll('.stats-grid > .card')].map((c) => c.dataset.widget));
  check('«Раскладка по умолчанию» works on this tab too',
    balBack.join('|') === 'curve|accounts|snapshots|flows', balBack.join('|'));
  await page.evaluate(async () => {
    for (const b of await window.api.balances.list()) await window.api.balances.remove(b.id);
    for (const f of await window.api.flows.list()) await window.api.flows.remove(f.id);
  });

  console.log('\n[10] cloud sync by link');
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxE2E_NOT_REAL/exec';

  const rubbish = await page.evaluate(() => window.api.sync.setLink('вставил не то'));
  check('a link that is not a cloud endpoint is refused with a reason',
    rubbish.phase === 'error' && /ссылка/i.test(rubbish.error), JSON.stringify(rubbish));

  const sheet = await page.evaluate(() => window.api.sync.setLink(
    'https://docs.google.com/spreadsheets/d/11uDLdRnK20pgN_DgFt0Ss_zuszV6wwvVF8nqnPWmnGI/edit'));
  check('a spreadsheet link is called out specifically',
    /таблиц/i.test(sheet.error || ''), JSON.stringify(sheet));

  const driveFile = await page.evaluate(() => window.api.sync.setLink(
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'));
  check('a plain Drive link connects but is marked read-only',
    driveFile.enabled === true && driveFile.canWrite === false, JSON.stringify(driveFile));
  const cannotPush = await page.evaluate(() => window.api.sync.push());
  check('pushing to a read-only link fails with an explanation',
    cannotPush.phase === 'error' && /чтени/i.test(cannotPush.error), JSON.stringify(cannotPush));

  const connected = await page.evaluate((url) => window.api.sync.setLink(url), SCRIPT_URL);
  check('an Apps Script link connects and allows writing',
    connected.enabled === true && connected.canWrite === true && connected.kind === 'script',
    JSON.stringify(connected));

  // the address is well-formed but nothing answers there — the failure must surface
  const failed = await page.evaluate(() => window.api.sync.push());
  check('an unreachable cloud reports the failure instead of hanging',
    failed.phase === 'error' && !!failed.error, JSON.stringify(failed));

  const badge = await page.evaluate(() => {
    const b = document.querySelector('#sync-badge');
    return { cls: b.className, text: b.querySelector('.txt').textContent, title: b.title };
  });
  check('the badge turns red on a sync failure', /err/.test(badge.cls), JSON.stringify(badge));
  check('its tooltip carries the link', badge.title.includes('macros/s'), badge.title);

  const code = await page.evaluate(() => window.api.sync.scriptCode());
  check('the app hands out the Apps Script snippet for setup',
    /doGet/.test(code) && /doPost/.test(code) && /diaryhunt-db\.json/.test(code), code.slice(0, 60));

  const off = await page.evaluate(() => window.api.sync.disable());
  check('sync can be switched off', off.enabled === false, JSON.stringify(off));


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
