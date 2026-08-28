// The Балансы tab: manual snapshots of what actually sits on each account, the
// real equity curve they draw, and the journal's line beside it.
// IIFE-scoped so its helpers don't collide with the other renderer files.
(function () {

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const B = () => window.balances;
const sign = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const CSS = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const rub = (n) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU') + ' ₽');
const usd = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('ru-RU'));
const pct1 = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + '%');
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const shortDate = (iso) => {
  const p = String(iso || '').split('-');
  return p.length === 3 ? `${Number(p[2])} ${MON[Number(p[1]) - 1] || p[1]} ${p[0]}` : '—';
};

// ₽ or $ — the toggle above the curve; survives re-renders
const state = { unit: 'rub' };
let ctx = null;   // { container, snapshots, trades }

const rerender = () => renderBalances(ctx.container, ctx.snapshots, ctx.trades);

async function reload() {
  ctx.snapshots = await window.api.balances.list();
  rerender();
}

// ---------- snapshot form ----------

function openSnapshotForm(existing) {
  const today = new Date().toISOString().slice(0, 10);
  const last = ctx.snapshots[ctx.snapshots.length - 1];
  // a new snapshot inherits the accounts of the previous one, emptied
  const base = existing || {
    date: today,
    usdRub: last ? last.usdRub : '',
    comment: '',
    accounts: last && last.accounts.length
      ? last.accounts.map((a) => ({ name: a.name, amount: '', ccy: a.ccy }))
      : [{ name: 'MOEX', amount: '', ccy: 'RUB' }, { name: 'FOREX', amount: '', ccy: 'USD' }],
  };

  const date = el('input'); date.type = 'date'; date.value = base.date || today;
  const rate = el('input'); rate.type = 'number'; rate.step = 'any'; rate.value = base.usdRub ?? '';
  const rateBtn = el('button', 'btn mini', '↻ курс');
  rateBtn.type = 'button';
  rateBtn.title = 'Подтянуть актуальный курс: MOEX USDRUBF, при недоступности — ЦБ РФ';
  const rateNote = el('span', 'field-note');
  const comment = el('textarea');
  comment.value = base.comment || '';

  const rowsWrap = el('div', 'acc-rows');
  const totalLine = el('div', 'acc-total');
  let rows = [];

  function readRows() {
    return rows.map((r) => ({
      name: r.name.value.trim(),
      amount: r.amount.value === '' ? 0 : Number(r.amount.value),
      ccy: r.ccy.value,
    }));
  }

  function recompute() {
    const t = B().snapshotTotals({ usdRub: Number(rate.value) || 0, accounts: readRows() });
    totalLine.innerHTML = '';
    totalLine.append(
      el('span', 'k', 'Итого'),
      el('span', 'v', rub(t.rub)),
      el('span', 'sep', '·'),
      el('span', 'v', usd(t.usd)),
    );
  }

  function renderRows(source) {
    rowsWrap.innerHTML = '';
    rows = source.map((acc, i) => {
      const name = el('input');
      name.type = 'text'; name.value = acc.name || ''; name.setAttribute('list', 'dh-exlist');
      name.placeholder = 'счёт ▾'; name.autocomplete = 'off';
      const amount = el('input');
      amount.type = 'number'; amount.step = 'any'; amount.value = acc.amount ?? '';
      amount.placeholder = 'сумма';
      const ccy = el('select');
      [['RUB', '₽'], ['USD', '$']].forEach(([v, l]) => ccy.append(new Option(l, v)));
      ccy.value = acc.ccy === 'RUB' ? 'RUB' : 'USD';

      const row = el('div', 'acc-row');
      row.append(name, amount, ccy);
      if (i > 0) {
        const del = el('button', 'btn icon', '✕');
        del.type = 'button';
        del.title = 'Убрать счёт';
        del.onclick = () => { renderRows(readRows().filter((_, j) => j !== i)); recompute(); };
        row.append(del);
      } else {
        row.append(el('span', 'acc-spacer'));
      }
      [name, amount, ccy].forEach((inp) => inp.addEventListener('input', recompute));
      ccy.addEventListener('change', recompute);
      rowsWrap.append(row);
      return { name, amount, ccy };
    });
    const add = el('button', 'btn ghost add-acc', '+ Счёт');
    add.type = 'button';
    add.onclick = () => { renderRows([...readRows(), { name: '', amount: '', ccy: 'USD' }]); recompute(); };
    rowsWrap.append(add);
  }

  renderRows(base.accounts);
  [date, rate].forEach((i) => i.addEventListener('input', recompute));
  recompute();

  rateBtn.onclick = async () => {
    rateBtn.disabled = true;
    rateNote.className = 'field-note';
    rateNote.textContent = 'запрашиваю…';
    try {
      const r = await window.api.rates.usdRub();
      if (!r.ok) {
        rateNote.className = 'field-note err';
        rateNote.textContent = r.error || 'не удалось получить курс';
        return;
      }
      rate.value = r.rate;
      recompute();
      rateNote.textContent = `${r.source}${r.time ? ', ' + r.time : r.date ? ', ' + r.date : ''}`;
    } finally {
      rateBtn.disabled = false;
    }
  };

  const save = el('button', 'btn primary', 'Сохранить');
  const cancel = el('button', 'btn ghost', 'Отмена');
  const field = (label, node) => {
    const l = el('label');
    l.append(document.createTextNode(label), node);
    return l;
  };
  const rateField = el('label');
  rateField.append(document.createTextNode('Курс USD/RUB'),
    el('div', 'field-row'), rateNote);
  rateField.querySelector('.field-row').append(rate, rateBtn);

  const modal = el('div', 'modal');
  modal.append(
    el('h2', null, existing ? 'Отметка баланса' : 'Новая отметка баланса'),
    el('p', 'hint', 'Введите текущий объём средств на каждом счёте. Курс нужен, чтобы свести всё в одну валюту.'),
    el('div', 'grid', null),
    el('div', 'section-head', 'Счета'),
    rowsWrap,
    totalLine,
    el('div', 'modal-buttons', null),
  );
  modal.querySelector('.grid').append(field('Дата', date), rateField, field('Комментарий', comment));
  modal.querySelector('.grid').lastChild.className = 'full';
  modal.querySelector('.modal-buttons').append(cancel, save);

  const backdrop = el('div', 'modal-backdrop');
  backdrop.append(modal);
  cancel.onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  save.onclick = async () => {
    const accounts = readRows().filter((a) => a.name);
    if (!date.value || !accounts.length) {
      alert('Укажите дату и хотя бы один счёт с названием.');
      return;
    }
    const payload = {
      date: date.value,
      usdRub: Number(rate.value) || 0,
      comment: comment.value,
      accounts,
    };
    if (existing) await window.api.balances.update(existing.id, payload);
    else await window.api.balances.add(payload);
    backdrop.remove();
    reload();
  };

  document.body.append(backdrop);
}

// ---------- curve ----------

function drawCurve(canvas, rows, journal, unit) {
  const H = 320, padL = 64, padR = 16, padTop = 18, padBot = 30;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const c = canvas.getContext('2d');
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.font = '10.5px "Cascadia Code", Consolas, monospace';
  if (!rows.length) return;

  const toUnit = (v, row) => (unit === 'rub' ? v : (row.usdRub ? v / row.usdRub : null));
  const actual = rows.map((r) => toUnit(r.rub, r));
  const line = journal.map((v, i) => toUnit(v, rows[i]));
  const all = [...actual, ...line].filter((v) => v !== null);
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;

  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, rows.length - 1);
  const y = (v) => H - padBot - ((v - lo) * (H - padTop - padBot)) / Math.max(1e-9, hi - lo);
  const fmt = (v) => (unit === 'rub'
    ? (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'к' : String(Math.round(v)))
    : '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'к' : String(Math.round(v))));

  const lineColor = CSS('--line') || '#262d38';
  const muted = CSS('--muted') || '#8b95a6';
  const pos = CSS('--pos') || '#46c46a';
  const accent = CSS('--accent') || '#4c8dff';

  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    c.strokeStyle = lineColor; c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, y(v)); c.lineTo(W - padR, y(v)); c.stroke();
    c.fillStyle = muted; c.fillText(fmt(v), padL - 8, y(v));
  }

  // journal line first, so the real capital sits on top of it
  c.strokeStyle = accent; c.lineWidth = 1.6; c.setLineDash([5, 4]);
  c.beginPath();
  line.forEach((v, i) => (v === null ? null : (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v)))));
  c.stroke();
  c.setLineDash([]);

  const grad = c.createLinearGradient(0, padTop, 0, H - padBot);
  grad.addColorStop(0, 'rgba(70,196,106,0.20)');
  grad.addColorStop(1, 'rgba(70,196,106,0.01)');
  c.beginPath();
  c.moveTo(x(0), H - padBot);
  actual.forEach((v, i) => c.lineTo(x(i), y(v)));
  c.lineTo(x(rows.length - 1), H - padBot);
  c.closePath();
  c.fillStyle = grad; c.fill();

  c.strokeStyle = pos; c.lineWidth = 2.2; c.lineJoin = 'round';
  c.beginPath();
  actual.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.stroke();
  c.fillStyle = pos;
  actual.forEach((v, i) => { c.beginPath(); c.arc(x(i), y(v), 3, 0, Math.PI * 2); c.fill(); });

  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = muted;
  const step = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((W - padL - padR) / 70))));
  rows.forEach((r, i) => {
    if (i % step !== 0 && i !== rows.length - 1) return;
    c.fillText(shortDate(r.date).replace(/ \d{4}$/, ''), x(i), H - padBot + 8);
  });
}

// ---------- pieces of the page ----------

function metric(label, value, cls, hint) {
  const box = el('div', 'metric');
  box.append(el('div', 'label', label), el('div', 'value' + (cls ? ' ' + cls : ''), value));
  if (hint) box.title = hint;
  return box;
}

function card(title, cls) {
  const box = el('section', 'card' + (cls ? ' ' + cls : ''));
  box.append(el('h3', 'card-title', title));
  return box;
}

function accountsPanel(snap) {
  const panel = card('Счета на последнюю отметку');
  const rows = B().byAccount(snap);
  if (!rows.length) {
    panel.append(el('div', 'panel-empty', 'нет счетов'));
    return panel;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.rub)), 1);
  rows.forEach((r) => {
    const row = el('div', 'brow');
    const bl = el('div', 'bl');
    bl.append(el('div', 'name', r.name),
      el('div', 'meta', `${r.amount.toLocaleString('ru-RU')} ${r.ccy === 'RUB' ? '₽' : '$'} · ${r.share.toFixed(0)}%`));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill pos');
    fill.style.width = (Math.abs(r.rub) / max) * 100 + '%';
    track.append(fill);
    row.append(bl, track, el('div', 'bv', rub(r.rub)));
    panel.append(row);
  });
  return panel;
}

function snapshotsTable(rows) {
  const panel = card('Все отметки', 'wide');
  const table = el('table', 'mini-table');
  const thead = el('thead');
  const htr = el('tr');
  ['Дата', 'Курс', 'Счета', 'Итого ₽', 'Итого $', 'Изменение', ''].forEach((t) => htr.append(el('th', null, t)));
  thead.append(htr);
  const tbody = el('tbody');
  [...rows].reverse().forEach((r) => {
    const tr = el('tr');
    tr.append(el('td', null, shortDate(r.date)));
    tr.append(el('td', 'num', String(r.usdRub || '—')));
    tr.append(el('td', null, (r.accounts || []).map((a) => a.name).join(' · ')));
    tr.append(el('td', 'num', rub(r.rub)));
    tr.append(el('td', 'num', usd(r.usd)));
    const delta = el('td', 'num ' + sign(r.deltaRub));
    delta.textContent = r.deltaRub == null ? '—' : `${rub(r.deltaRub)} · ${pct1(r.deltaPct)}`;
    tr.append(delta);
    const act = el('td', 'num');
    const edit = el('button', 'btn icon', '✎');
    edit.title = 'Редактировать';
    edit.onclick = () => openSnapshotForm(ctx.snapshots.find((s) => s.id === r.id));
    const del = el('button', 'btn icon', '✕');
    del.title = 'Удалить';
    del.onclick = async () => {
      if (!confirm(`Удалить отметку от ${shortDate(r.date)}?`)) return;
      await window.api.balances.remove(r.id);
      reload();
    };
    const wrap = el('span', 'row-actions');
    wrap.append(edit, del);
    act.append(wrap);
    tr.append(act);
    tbody.append(tr);
  });
  table.append(thead, tbody);
  panel.append(table);
  return panel;
}

// ---------- entry point ----------

function renderBalances(container, snapshots, trades) {
  ctx = { container, snapshots, trades };
  container.innerHTML = '';

  const bar = el('div', 'period-bar');
  const addBtn = el('button', 'btn primary', '+ Отметка баланса');
  addBtn.onclick = () => openSnapshotForm(null);
  bar.append(addBtn);

  if (snapshots.length) {
    const label = el('span', 'period-label', 'График:');
    bar.append(label);
    [['rub', '₽'], ['usd', '$']].forEach(([key, text]) => {
      const b = el('button', 'chip' + (state.unit === key ? ' active' : ''), text);
      b.onclick = () => { state.unit = key; rerender(); };
      bar.append(b);
    });
  }
  container.append(bar);

  if (!snapshots.length) {
    container.append(el('div', 'empty',
      'Отметок баланса пока нет. Нажмите «+ Отметка баланса», чтобы записать, сколько сейчас на счетах.'));
    return;
  }

  const rows = B().deltas(snapshots);
  const latest = rows[rows.length - 1];
  const journal = B().journalLine(snapshots, trades);
  const drift = latest.rub - journal[journal.length - 1];

  const metrics = el('div', 'metrics');
  metrics.append(
    metric('Капитал сейчас', rub(latest.rub), 'pos'),
    metric('В долларах', usd(latest.usd)),
    metric('С прошлой отметки', latest.deltaRub == null ? '—' : rub(latest.deltaRub), sign(latest.deltaRub)),
    metric('Изменение, %', pct1(latest.deltaPct), sign(latest.deltaPct)),
    metric('Отметок', String(rows.length)),
    metric('Последняя', shortDate(latest.date)),
    metric('Расхождение с журналом', rub(drift), sign(drift),
      'Фактический капитал минус капитал первой отметки плюс профит по сделкам. Это вводы, выводы и неучтённые издержки.'),
  );
  container.append(metrics);

  const grid = el('div', 'stats-grid');
  container.append(grid);

  const curve = card('Кривая капитала — по отметкам и по журналу', 'wide');
  const canvas = document.createElement('canvas');
  curve.append(canvas);
  const legend = el('div', 'curve-legend');
  const legendItem = (cls, text) => {
    const item = el('span', 'lg');
    item.append(el('span', 'swatch ' + cls), el('span', 'lg-text', text));
    return item;
  };
  legend.append(legendItem('actual', 'по отметкам'), legendItem('journal', 'по журналу'));
  curve.append(legend);
  grid.append(curve);
  requestAnimationFrame(() => drawCurve(canvas, rows, journal, state.unit));

  grid.append(accountsPanel(snapshots[snapshots.length - 1]));
  grid.append(snapshotsTable(rows));
}

window.balancesView = { renderBalances };
})();
