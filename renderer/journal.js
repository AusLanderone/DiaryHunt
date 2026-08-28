// The journal reads as a diary: one row per trade, months as blocks, details on
// demand. Filters/sort/grouping live in src/journalView.js — this file draws.
// IIFE-scoped so its helpers don't collide with form.js / stats.js.
(function () {

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function pill(text, kind) {
  return el('span', 'pill ' + kind, text);
}

const signCls = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const V = () => window.journalView;

// "13 авг", or "13 авг 2025" once the year stops being the current one
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function shortDate(iso) {
  const p = String(iso || '').split('-');
  if (p.length !== 3) return '—';
  const label = `${Number(p[2])} ${MON_SHORT[Number(p[1]) - 1] || p[1]}`;
  return Number(p[0]) === new Date().getFullYear() ? label : `${label} ${p[0]}`;
}

// prices carry 5 decimals in the data but read better trimmed in a list
const price = (n) => (n === null || n === undefined || n === '' ? '—'
  : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 5 }));
const pct2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—'
  : (n * 100).toFixed(2).replace('.', ',') + '%');
const rub0 = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';
// whole dollars for position-sized numbers, two decimals for small ones
const usd0 = (n) => {
  if (n === null || n === undefined) return '—';
  return Math.abs(n) < 1000
    ? (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$' + Math.round(n).toLocaleString('ru-RU');
};
const usd2 = (n) => (n === null || n === undefined ? '—'
  : (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// view state survives re-renders (adding a trade shouldn't reset the filters)
const state = {
  query: '', status: 'all', tag: 'all', type: 'all', period: 'all',
  sortKey: null, sortDir: 'desc',   // null = default order (newest trade first)
  expanded: new Set(),
};
let ctx = null;   // { container, trades, onEdit, onDelete }

const STATUSES = [['all', 'Все'], ['open', 'Открытые'], ['closed', 'Закрытые']];
const PERIODS = [['all', 'Всё время'], ['year', 'Год'], ['quarter', 'Квартал'], ['month', 'Месяц']];
const COLUMNS = [
  { key: 'num', label: '№', sortable: true },
  { key: 'date', label: 'Дата', sortable: true },
  { key: 'ticker', label: 'Тикер', sortable: true },
  { label: 'Тип · Тег' },
  { label: 'Ноги' },
  { key: 'spread', label: 'Спред вход → выход', sortable: true, right: true },
  { key: 'profit', label: 'Чистый', sortable: true, right: true },
  { label: '' },
];

const rerender = () => renderJournal(ctx.container, ctx.trades, ctx);

// ---------- filter bar ----------

function filterBar(trades) {
  const bar = el('div', 'journal-bar');

  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Поиск: тикер, тег, тип, комментарий';
  search.value = state.query;
  search.oninput = () => { state.query = search.value; rerender(); };
  bar.appendChild(search);

  const chips = el('div', 'chips');
  STATUSES.forEach(([key, label]) => {
    const b = el('button', 'chip' + (state.status === key ? ' active' : ''), label);
    b.onclick = () => { state.status = key; rerender(); };
    chips.appendChild(b);
  });
  bar.appendChild(chips);

  const tags = [...new Set(trades.map((t) => t.tag).filter(Boolean))].sort();
  const tagSel = el('select', 'sel');
  tagSel.append(new Option('Все теги', 'all'), ...tags.map((t) => new Option(t, t)));
  tagSel.value = tags.includes(state.tag) ? state.tag : 'all';
  tagSel.onchange = () => { state.tag = tagSel.value; rerender(); };
  bar.appendChild(tagSel);

  const types = [...new Set(trades.map((t) => t.type).filter(Boolean))].sort();
  const typeSel = el('select', 'sel');
  typeSel.append(new Option('Все типы', 'all'), ...types.map((t) => new Option(t, t)));
  typeSel.value = types.includes(state.type) ? state.type : 'all';
  typeSel.onchange = () => { state.type = typeSel.value; rerender(); };
  bar.appendChild(typeSel);

  const perSel = el('select', 'sel');
  perSel.append(...PERIODS.map(([k, l]) => new Option(l, k)));
  perSel.value = state.period;
  perSel.onchange = () => { state.period = perSel.value; rerender(); };
  bar.appendChild(perSel);

  return bar;
}

// ---------- sortable header ----------

function header() {
  const head = el('div', 'journal-head');
  COLUMNS.forEach((col) => {
    const cell = el('div', 'jh' + (col.right ? ' right' : ''));
    cell.textContent = col.label;
    if (col.sortable) {
      cell.classList.add('sortable');
      if (state.sortKey === col.key) {
        cell.classList.add('active');
        cell.append(el('span', 'arrow', state.sortDir === 'asc' ? '▲' : '▼'));
      }
      cell.title = state.sortKey === col.key
        ? 'Ещё клик — сбросить сортировку'
        : 'Клик — сортировать, третий клик — сбросить';
      cell.onclick = () => {
        const next = V().nextSort({ key: state.sortKey, dir: state.sortDir }, col.key);
        state.sortKey = next.key;
        state.sortDir = next.dir;
        rerender();
      };
    }
    head.appendChild(cell);
  });
  return head;
}

// ---------- one trade ----------

// "MOEX ↑" — the arrow says the side, so Лонг/Шорт doesn't need the words here
function legChip(leg) {
  const long = leg.side === 'Шорт' ? false : true;
  const chip = el('span', 'leg-chip ' + (long ? 'long' : 'short'));
  chip.append(el('span', 'ex', leg.exchange || '—'));
  chip.append(el('span', 'dir ' + (long ? 'pos' : 'neg'), long ? '↑' : '↓'));
  chip.title = `${leg.exchange}: ${leg.side}`;
  return chip;
}

function tradeRow(trade, c) {
  const closed = c.closed;
  const profit = closed ? c.netProfitRub : null;
  const stateCls = !closed ? 'open' : profit >= 0 ? 'pos' : 'neg';
  const row = el('div', `trade-row state-${stateCls}` + (state.expanded.has(trade.id) ? ' expanded' : ''));

  row.append(el('div', 'jc num', String(trade.num)));

  const date = el('div', 'jc date');
  date.append(el('span', 'd1', shortDate(trade.openDate)));
  if (closed && trade.closeDate !== trade.openDate) {
    date.append(el('span', 'd2', '→ ' + shortDate(trade.closeDate)));
  }
  row.append(date);

  const tick = el('div', 'jc ticker');
  tick.append(el('span', 'tk', trade.ticker || '—'));
  row.append(tick);

  const tagCell = el('div', 'jc tag');
  if (trade.type) tagCell.append(el('span', 'tag-chip type', trade.type));
  if (trade.tag) tagCell.append(el('span', 'tag-chip', trade.tag));
  row.append(tagCell);

  const legs = el('div', 'jc legs');
  trade.legs.forEach((leg, i) => {
    if (i) legs.append(el('span', 'vs', '·'));
    legs.append(legChip(leg));
  });
  row.append(legs);

  const spread = el('div', 'jc spread');
  spread.append(el('span', 'sp-in', pct2(c.entrySpread)));
  spread.append(el('span', 'sp-arrow', '→'));
  spread.append(el('span', 'sp-out' + (closed ? '' : ' muted'), closed ? pct2(c.exitSpread) : '—'));
  row.append(spread);

  const money = el('div', 'jc money');
  if (closed) money.append(el('span', 'sum ' + signCls(profit), window.format.fmtRub(profit)));
  else money.append(pill('открыта', 'open'));
  row.append(money);

  const act = el('div', 'jc actions');
  const edit = el('button', 'btn icon', '✎');
  edit.title = 'Редактировать';
  edit.onclick = (e) => { e.stopPropagation(); ctx.onEdit(trade); };
  const del = el('button', 'btn icon', '✕');
  del.title = 'Удалить';
  del.onclick = (e) => { e.stopPropagation(); ctx.onDelete(trade); };
  act.append(edit, del, el('span', 'caret', '⌄'));
  row.append(act);

  row.onclick = () => {
    if (state.expanded.has(trade.id)) state.expanded.delete(trade.id);
    else state.expanded.add(trade.id);
    rerender();
  };
  return row;
}

// the numbers that don't fit the row, shown when a trade is expanded
function tradeDetail(trade, c) {
  const F = window.format;
  const box = el('div', 'trade-detail');

  // the spread expression this trade is actually computing
  box.append(el('div', 'detail-formula', window.calc.spreadFormula(trade)));

  const legs = el('div', 'detail-legs');

  // a header row so each number in the leg lines says what it is
  const head = el('div', 'detail-leg head');
  ['Биржа', 'Сделка', 'Роль', 'Цена вход → выход', 'Кол-во', 'Позиция начало → конец', 'Комиссия', 'Своп', 'PnL ноги']
    .forEach((label, i) => head.append(el('span',
      ['ex', 'side', 'role', 'prices', 'units', 'pos', 'fee', 'swap', 'pnl'][i], label)));
  legs.append(head);

  trade.legs.forEach((leg, i) => {
    const lc = c.legs[i];
    const line = el('div', 'detail-leg');
    line.append(el('span', 'ex', leg.exchange || '—'));
    line.append(el('span', 'side ' + (leg.side === 'Шорт' ? 'neg' : 'pos'), leg.side || '—'));
    line.append(el('span', 'role', window.calc.legRole(leg, i) === 'div' ? '÷' : '×'));
    // prices read in the currency the leg is quoted in
    const p = window.calc.legPriceCcy(leg) === 'RUB'
      ? (v) => (v === null || v === undefined || v === '' ? '—' : rub0(v))
      : price;
    line.append(el('span', 'prices', `${p(leg.entryPrice)} → ${p(leg.exitPrice)}`));
    line.append(el('span', 'units', F.fmtNum(leg.units)));
    // position and PnL read in the leg's currency, not always dollars
    const money0 = window.calc.legPriceCcy(leg) === 'RUB' ? rub0 : usd0;
    line.append(el('span', 'pos', `${money0(lc.start)} → ${lc.end === null ? '—' : money0(lc.end)}`));
    line.append(el('span', 'fee', rub0(Number(leg.feeRub) || 0)));
    // shown as entered (₽ on MOEX, $ elsewhere); the meta line carries the ₽ total
    const swapRaw = leg.swap !== undefined && leg.swap !== null && leg.swap !== ''
      ? Number(leg.swap) : Number(leg.swapRub || 0);
    const swapIsRub = window.calc.isRubLeg(leg) || leg.swap === undefined || leg.swap === null || leg.swap === '';
    line.append(el('span', 'swap ' + signCls(swapRaw),
      swapIsRub ? rub0(swapRaw) : usd2(swapRaw)));
    line.append(el('span', 'pnl ' + signCls(lc.gross), lc.gross == null ? '—'
      : (window.calc.legPriceCcy(leg) === 'RUB' ? rub0(lc.gross) : F.fmtUsd(lc.gross))));
    legs.append(line);
  });
  box.append(legs);

  const meta = el('div', 'detail-meta');
  const item = (k, v, cls) => {
    const i = el('span', 'mi');
    i.append(el('span', 'k', k), el('span', 'v' + (cls ? ' ' + cls : ''), v));
    return i;
  };
  meta.append(
    item('Спред выход', pct2(c.exitSpread)),
    item('Спред итог', pct2(c.spreadTotal), signCls(c.spreadTotal)),
    item('Позиция', `${rub0(c.positionStartRub)} → ${c.positionEndRub === null ? '—' : rub0(c.positionEndRub)}`),
    item('Курс', String(trade.usdRub || '—')),
    item('PnL net', c.pnlNet == null ? '—' : F.fmtUsd(c.pnlNet), signCls(c.pnlNet)),
    item('PnL ₽', c.pnlRub == null ? '—' : F.fmtRub(c.pnlRub), signCls(c.pnlRub)),
    item('Комиссии', rub0(c.feeTotalRub), 'neg'),
    item('Payout', rub0(Number(trade.payout) || 0), signCls(Number(trade.payout) || 0)),
    item('Своп', rub0(c.swapTotalRub), signCls(c.swapTotalRub)),
  );
  if (Number(trade.adjustment)) meta.append(item('Правка', rub0(Number(trade.adjustment))));
  box.append(meta);

  if (trade.comment) box.append(el('div', 'detail-comment', trade.comment));
  return box;
}

// ---------- month block ----------

function monthBlock(group) {
  const box = el('div', 'month');
  const head = el('div', 'month-head');
  head.append(el('span', 'm-name', group.label));
  const counts = group.openCount
    ? `${group.count} сд · ${group.openCount} открыто`
    : `${group.count} сд`;
  head.append(el('span', 'm-count', counts));
  head.append(el('span', 'm-sum ' + signCls(group.profit), window.format.fmtRub(group.profit)));
  box.append(head);

  group.trades.forEach((trade) => {
    const c = window.calc.computeTrade(trade);
    box.append(tradeRow(trade, c));
    if (state.expanded.has(trade.id)) box.append(tradeDetail(trade, c));
  });
  return box;
}

// ---------- footer ----------

function totalBar(sum) {
  const foot = el('div', 'journal-total');
  const left = el('div', 'lbl');
  left.append(el('span', '', `${sum.count} сделок`));
  if (sum.open) left.append(el('span', 'sep', '·'), el('span', 'open-note', `${sum.open} открыто`));
  if (sum.winrate !== null) {
    left.append(el('span', 'sep', '·'), el('span', '', `винрейт ${sum.winrate.toFixed(0)}%`));
  }
  foot.append(left);
  foot.append(el('span', 'val ' + signCls(sum.total), window.format.fmtRub(sum.total)));
  return foot;
}

// ---------- entry point ----------

function renderJournal(container, trades, handlers) {
  ctx = { container, trades, onEdit: handlers.onEdit, onDelete: handlers.onDelete };
  container.innerHTML = '';

  if (!trades.length) {
    container.append(el('div', 'empty', 'Пока нет сделок. Нажмите «Добавить сделку», чтобы внести первую.'));
    return;
  }

  const wrap = el('div', 'journal');
  wrap.append(filterBar(trades), header());

  const visible = V().sortTrades(
    V().filterTrades(trades, state),
    state.sortKey, state.sortDir,
  );

  const scroll = el('div', 'journal-scroll');
  if (!visible.length) {
    scroll.append(el('div', 'empty', 'Под фильтры ничего не подошло. Смените период или очистите поиск.'));
  } else {
    V().groupByMonth(visible).forEach((g) => scroll.append(monthBlock(g)));
  }
  wrap.append(scroll, totalBar(V().summarize(visible)));
  container.append(wrap);
}

window.journal = { renderJournal };
})();
