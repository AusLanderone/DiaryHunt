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
// the collected spread reads as a gain or a loss, so it carries its sign
const pctSigned = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—'
  : (n > 0 ? '+' : '') + pct2(n));
// arbitrage returns live in hundredths of a percent, so the column keeps a
// third decimal — at two, every trade would read the same
const pct3Signed = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—'
  : (n > 0 ? '+' : '') + (n * 100).toFixed(3).replace('.', ',') + '%');
const rub0 = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';
// position-sized money in a narrow column: millions read faster than seven
// digits, and the exact figure is one click away in the expanded trade
const rubShort = (n) => (n === null || n === undefined ? '—'
  : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',') + ' млн ₽' : rub0(n));
const days = (n) => (n === null || n === undefined ? '—' : `${n} д`);
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
  query: '', status: 'all', period: 'all',
  // { mode: 'include' | 'exclude', values: [...] } — empty values = not filtering
  tag: { mode: 'include', values: [] },
  ticker: { mode: 'include', values: [] },
  type: { mode: 'include', values: [] },
  openPicker: null,                 // which filter panel is unfolded, if any
  sortKey: null, sortDir: 'desc',   // null = default order (newest trade first)
  expanded: new Set(),
};
let ctx = null;   // { container, trades, onEdit, onDelete }

// a click anywhere else folds the open filter panel away
document.addEventListener('click', () => {
  if (!state.openPicker || !ctx) return;
  state.openPicker = null;
  renderJournal(ctx.container, ctx.trades, ctx);
});

const STATUSES = [['all', 'Все'], ['open', 'Открытые'], ['closed', 'Закрытые']];
const PERIODS = [['all', 'Всё время'], ['year', 'Год'], ['quarter', 'Квартал'], ['month', 'Месяц']];
const COLUMNS = [
  { key: 'num', label: '№', sortable: true },
  { key: 'date', label: 'Дата', sortable: true },
  { key: 'ticker', label: 'Тикер', sortable: true },
  { label: 'Тип · Тег' },
  { label: 'Ноги' },
  // shortened so the header stays one line beside the size / days / return columns
  { key: 'spread', label: 'Спред вх → вых', sortable: true, right: true },
  { key: 'spreadFact', label: 'Собран', sortable: true, right: true },
  { key: 'size', label: 'Объём', sortable: true, right: true },
  { key: 'hold', label: 'Дней', sortable: true, right: true },
  { key: 'ret', label: 'Доходность', sortable: true, right: true },
  { key: 'profit', label: 'Чистый', sortable: true, right: true },
  { label: '' },
];

const rerender = () => renderJournal(ctx.container, ctx.trades, ctx);

// ---------- tag / ticker / type pickers ----------

// Each dimension can keep only the values you tick, or drop them. The button
// says which without opening the panel: «Теги: Схождение», «Теги: 2»,
// «Теги: кроме 2».
const DIMS = [
  { key: 'tag', label: 'Теги', of: (t) => t.tag || '', blank: 'без тега' },
  { key: 'ticker', label: 'Тикеры', of: (t) => t.ticker || '', blank: 'без тикера' },
  { key: 'type', label: 'Типы', of: (t) => t.type || '', blank: 'без типа' },
];

const specOf = (key) => {
  const s = state[key];
  return s && typeof s === 'object' ? s : { mode: 'include', values: [] };
};

function setSpec(key, spec) {
  state[key] = spec;
  rerender();
}

function pickerLabel(dim, spec) {
  const n = spec.values.length;
  if (!n) return dim.label;
  const what = n === 1 ? (spec.values[0] || dim.blank) : String(n);
  return `${dim.label}: ${spec.mode === 'exclude' ? 'кроме ' : ''}${what}`;
}

// values actually present in the diary, with how many trades carry each
function dimCounts(dim, trades) {
  const counts = new Map();
  trades.forEach((t) => {
    const v = dim.of(t);
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
}

function dimPicker(dim, trades) {
  const spec = specOf(dim.key);
  const box = el('div', 'picker');

  const btn = el('button', 'chip picker-btn' + (spec.values.length ? ' active' : ''),
    pickerLabel(dim, spec));
  btn.title = `${dim.label}: оставить только выбранные или убрать их`;
  btn.onclick = (e) => {
    e.stopPropagation();
    state.openPicker = state.openPicker === dim.key ? null : dim.key;
    rerender();
  };
  box.appendChild(btn);
  if (state.openPicker === dim.key) box.appendChild(pickerPanel(dim, trades, spec));
  return box;
}

function pickerPanel(dim, trades, spec) {
  const panel = el('div', 'picker-panel');
  panel.onclick = (e) => e.stopPropagation();

  const modes = el('div', 'picker-modes');
  [['include', 'Оставить'], ['exclude', 'Убрать']].forEach(([mode, label]) => {
    const b = el('button', 'chip mini' + (spec.mode === mode ? ' active' : ''), label);
    b.title = mode === 'include' ? 'Показывать только отмеченные' : 'Прятать отмеченные';
    b.onclick = () => setSpec(dim.key, { ...spec, mode });
    modes.append(b);
  });
  panel.append(modes);

  const list = el('div', 'picker-list');
  const rows = dimCounts(dim, trades);
  if (!rows.length) list.append(el('div', 'picker-empty', 'нет значений'));
  rows.forEach(([value, count]) => {
    const row = el('label', 'picker-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = spec.values.includes(value);
    cb.onchange = () => setSpec(dim.key, {
      ...spec,
      values: cb.checked ? [...spec.values, value] : spec.values.filter((v) => v !== value),
    });
    row.append(cb, el('span', 'pv' + (value ? '' : ' blank'), value || dim.blank),
      el('span', 'pc', String(count)));
    list.append(row);
  });
  panel.append(list);

  const reset = el('button', 'btn ghost mini', 'Сбросить');
  reset.disabled = !spec.values.length;
  reset.onclick = () => setSpec(dim.key, { mode: 'include', values: [] });
  const foot = el('div', 'picker-foot');
  foot.append(reset);
  panel.append(foot);
  return panel;
}

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

  DIMS.forEach((dim) => bar.appendChild(dimPicker(dim, trades)));

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
    const cell = el('div', 'jh' + (col.right ? ' right' : '') + (col.key ? ' jh-' + col.key : ''));
    // the label is its own element so it can end exactly where the numbers
    // below it end — the sort arrow sits on the outer side, never between
    const label = el('span', 'lbl', col.label);
    cell.append(label);
    if (col.sortable) {
      cell.classList.add('sortable');
      const arrow = state.sortKey === col.key
        ? el('span', 'arrow', state.sortDir === 'asc' ? '▲' : '▼')
        // a pale ⇅ so the column reads as sortable before anyone hovers it
        : el('span', 'arrow hint', '⇅');
      if (state.sortKey === col.key) cell.classList.add('active');
      if (col.right) cell.insertBefore(arrow, label);
      else cell.append(arrow);
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

  // what the trade actually collected: the entry-to-exit difference, plus when
  // the trade closed in profit, minus when it closed in a loss
  const fact = el('div', 'jc spread-fact');
  if (closed && c.spreadCollected !== null) {
    const badge = el('span', 'sp-fact ' + signCls(c.spreadCollected), pctSigned(c.spreadCollected));
    badge.title = 'Фактически собранный спред: разница вход → выход, со знаком результата сделки';
    fact.append(badge);
  } else {
    fact.append(el('span', 'sp-fact none', '—'));
  }
  row.append(fact);

  // how big the trade was, how long it ran, what it returned — the same numbers
  // the header sorts by, read from one place so the two can't disagree
  const s = V().rowStats(trade);
  const size = el('div', 'jc size', rubShort(s.size));
  size.title = 'Объём позиции на одну ногу — сторона сделки, которую она реально занимает';
  row.append(size);

  const hold = el('div', 'jc hold' + (s.hold === null ? ' none' : ''), days(s.hold));
  hold.title = 'Дней от открытия до закрытия';
  row.append(hold);

  const ret = el('div', 'jc ret');
  ret.append(el('span', signCls(s.ret), pct3Signed(s.ret)));
  ret.title = 'Чистая доходность на объём одной ноги';
  row.append(ret);

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
    item('Спред собран', pct2(c.spreadCollected), signCls(c.spreadCollected)),
    item('Позиция на ногу', `${rub0(c.positionStartAvgRub)} → ${c.positionEndAvgRub === null ? '—' : rub0(c.positionEndAvgRub)}`),
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
