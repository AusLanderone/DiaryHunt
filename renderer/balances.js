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

// ---------- hover tooltip (shares #dh-chart-tip with the stats charts) ----------

function chartTip() {
  let tip = document.getElementById('dh-chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'dh-chart-tip';
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(html, e) {
  const tip = chartTip();
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8) + 'px';
}

const hideTip = () => { chartTip().style.display = 'none'; };

// ₽ or $ — the toggle above the curve; survives re-renders
const state = { unit: 'rub', editing: null };
let ctx = null;   // { container, snapshots, trades, flows }

const rerender = () => renderBalances(ctx.container, ctx.snapshots, ctx.trades, ctx.flows);

async function reload() {
  ctx.snapshots = await window.api.balances.list();
  ctx.flows = await window.api.flows.list();
  rerender();
}

// ---------- snapshot form ----------

// Creating a snapshot. Editing one happens in the table, in place — see
// snapshotEditor.
function openSnapshotForm() {
  const today = new Date().toISOString().slice(0, 10);
  const last = ctx.snapshots[ctx.snapshots.length - 1];
  // a new snapshot inherits the accounts of the previous one, emptied
  const base = {
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
    el('h2', null, 'Новая отметка баланса'),
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
    await window.api.balances.add(payload);
    backdrop.remove();
    reload();
  };

  document.body.append(backdrop);
}

// ---------- deposit / withdrawal form ----------

function openFlowForm(existing) {
  const today = new Date().toISOString().slice(0, 10);
  const last = ctx.snapshots[ctx.snapshots.length - 1];
  const base = existing || {
    date: today, account: '', amount: '', ccy: 'RUB', kind: 'in',
    usdRub: last ? last.usdRub : '', comment: '',
  };

  const date = el('input'); date.type = 'date'; date.value = base.date || today;
  const kind = el('select');
  [['in', 'Ввод средств'], ['out', 'Вывод средств']].forEach(([v, l]) => kind.append(new Option(l, v)));
  kind.value = base.kind === 'out' ? 'out' : 'in';

  // accounts already seen in snapshots, so the name doesn't get retyped
  const known = [...new Set(ctx.snapshots.flatMap((s) => (s.accounts || []).map((a) => a.name)).filter(Boolean))].sort();
  const list = el('datalist'); list.id = 'dh-acclist';
  known.forEach((n) => list.append(new Option(n, n)));
  const account = el('input');
  account.type = 'text'; account.value = base.account || '';
  account.setAttribute('list', 'dh-acclist');
  account.placeholder = 'счёт ▾'; account.autocomplete = 'off';

  const amount = el('input'); amount.type = 'number'; amount.step = 'any'; amount.value = base.amount ?? '';
  const ccy = el('select');
  [['RUB', '₽'], ['USD', '$']].forEach(([v, l]) => ccy.append(new Option(l, v)));
  ccy.value = base.ccy === 'USD' ? 'USD' : 'RUB';
  const rate = el('input'); rate.type = 'number'; rate.step = 'any'; rate.value = base.usdRub ?? '';
  const rateBtn = el('button', 'btn mini', '↻ курс');
  rateBtn.type = 'button';
  const rateNote = el('span', 'field-note');
  const comment = el('textarea'); comment.value = base.comment || '';

  const preview = el('div', 'acc-total');
  function recompute() {
    const v = B().flowRub({
      amount: Number(amount.value) || 0, ccy: ccy.value,
      kind: kind.value, usdRub: Number(rate.value) || 0,
    });
    preview.innerHTML = '';
    preview.append(
      el('span', 'k', kind.value === 'out' ? 'Уйдёт со счетов' : 'Придёт на счета'),
      el('span', 'v ' + sign(v), rub(v)),
    );
  }
  [amount, rate, date].forEach((i) => i.addEventListener('input', recompute));
  [ccy, kind].forEach((i) => i.addEventListener('change', recompute));
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

  const field = (label, node) => {
    const l = el('label');
    l.append(document.createTextNode(label), node);
    return l;
  };
  const rateField = el('label');
  rateField.append(document.createTextNode('Курс USD/RUB'), el('div', 'field-row'), rateNote);
  rateField.querySelector('.field-row').append(rate, rateBtn);
  const amountField = el('label');
  amountField.append(document.createTextNode('Сумма'), el('div', 'field-row'));
  amountField.querySelector('.field-row').append(amount, ccy);

  const save = el('button', 'btn primary', 'Сохранить');
  const cancel = el('button', 'btn ghost', 'Отмена');
  const modal = el('div', 'modal');
  modal.append(
    el('h2', null, existing ? 'Движение средств' : 'Ввод или вывод средств'),
    el('p', 'hint', 'Перевод денег на счёт или с него. Движения не считаются прибылью — они поднимают или опускают линию журнала, чтобы её можно было сравнивать с фактическим капиталом.'),
    el('div', 'grid', null),
    preview,
    el('div', 'modal-buttons', null),
    list,
  );
  modal.querySelector('.grid').append(
    field('Дата', date), field('Направление', kind),
    field('Счёт', account), amountField,
    rateField, field('Комментарий', comment),
  );
  modal.querySelector('.modal-buttons').append(cancel, save);

  const backdrop = el('div', 'modal-backdrop');
  backdrop.append(modal);
  cancel.onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  save.onclick = async () => {
    if (!date.value || !account.value.trim() || !Number(amount.value)) {
      alert('Укажите дату, счёт и сумму.');
      return;
    }
    const payload = {
      date: date.value,
      account: account.value.trim(),
      amount: Math.abs(Number(amount.value)),
      ccy: ccy.value,
      kind: kind.value,
      usdRub: Number(rate.value) || 0,
      comment: comment.value,
    };
    if (existing) await window.api.flows.update(existing.id, payload);
    else await window.api.flows.add(payload);
    backdrop.remove();
    reload();
  };

  document.body.append(backdrop);
}

// ---------- curve ----------

function drawCurve(canvas, rows, journal, unit, flows) {
  const H = 320, padL = 64, padR = 16, padTop = 18, padBot = 30;

  function render(hoverIdx) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const c = canvas.getContext('2d');
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.font = '10.5px "Cascadia Code", Consolas, monospace';
  if (!rows.length) return null;

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
  actual.forEach((v, i) => {
    c.beginPath();
    c.arc(x(i), y(v), i === hoverIdx ? 5.5 : 3, 0, Math.PI * 2);
    c.fill();
  });

  // the hovered snapshot: a vertical guide through both lines
  if (hoverIdx >= 0 && hoverIdx < rows.length) {
    c.strokeStyle = muted; c.globalAlpha = 0.5; c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(x(hoverIdx), padTop); c.lineTo(x(hoverIdx), H - padBot); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
    if (line[hoverIdx] !== null) {
      c.fillStyle = accent;
      c.beginPath(); c.arc(x(hoverIdx), y(line[hoverIdx]), 4, 0, Math.PI * 2); c.fill();
    }
  }

  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = muted;
  const step = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((W - padL - padR) / 70))));
  rows.forEach((r, i) => {
    if (i % step !== 0 && i !== rows.length - 1) return;
    c.fillText(shortDate(r.date).replace(/ \d{4}$/, ''), x(i), H - padBot + 8);
  });

  return { x, W };
  }

  let geom = render(-1);

  // money moved between the previous snapshot and this one
  const movedSince = (i) => B().flowsUpTo(flows, rows[i].date)
    - (i === 0 ? 0 : B().flowsUpTo(flows, rows[i - 1].date));

  // what the hovered snapshot actually held, plus how it compares to the journal
  function tipHtml(i) {
    const row = rows[i];
    const money = unit === 'rub' ? rub : usd;
    const toUnit = (v) => (unit === 'rub' ? v : (row.usdRub ? v / row.usdRub : null));
    const drift = journal[i] === null ? null : row.rub - journal[i];
    const accounts = (row.accounts || []).map((a) =>
      `<div class="tip-acc"><span>${a.name}</span><span>${Number(a.amount).toLocaleString('ru-RU')} ${a.ccy === 'RUB' ? '₽' : '$'}</span></div>`).join('');
    return `<b>${shortDate(row.date)}</b>`
      + `<div class="tip-row"><span>по отметкам</span><span class="tv">${money(toUnit(row.rub))}</span></div>`
      + `<div class="tip-row"><span>по журналу</span><span class="tv">${money(toUnit(journal[i]))}</span></div>`
      + `<div class="tip-row"><span>расхождение</span><span class="tv ${sign(drift)}">${money(toUnit(drift))}</span></div>`
      + (accounts ? `<div class="tip-sep"></div>${accounts}` : '')
      + (movedSince(i) ? `<div class="tip-row"><span>движения с прошлой</span><span class="tv ${sign(movedSince(i))}">${money(toUnit(movedSince(i)))}</span></div>` : '')
      + `<div class="tip-sub">курс ${row.usdRub || '—'}${row.comment ? ' · ' + row.comment : ''}</div>`;
  }

  canvas.onmousemove = (e) => {
    if (!geom || !rows.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0, bestD = Infinity;
    rows.forEach((_, i) => {
      const d = Math.abs(geom.x(i) - mx);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD > 60) { canvas.onmouseleave(); return; }
    geom = render(best);
    showTip(tipHtml(best), e);
  };
  canvas.onmouseleave = () => { hideTip(); geom = render(-1); };
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

// Editing a snapshot where it is read: the row opens into its own accounts,
// each amount editable in place, with the total recomputing as you type.
function snapshotEditor(snap) {
  const box = el('div', 'snap-editor');
  const rowsWrap = el('div', 'acc-rows');
  const totalLine = el('div', 'acc-total');
  let rows = [];

  const rate = el('input');
  rate.type = 'number'; rate.step = 'any'; rate.value = snap.usdRub ?? '';
  const comment = el('input');
  comment.type = 'text'; comment.value = snap.comment || '';
  comment.placeholder = 'комментарий';

  const readRows = () => rows.map((r) => ({
    name: r.name.value.trim(),
    amount: r.amount.value === '' ? 0 : Number(r.amount.value),
    ccy: r.ccy.value,
  }));

  function recompute() {
    const t = B().snapshotTotals({ usdRub: Number(rate.value) || 0, accounts: readRows() });
    totalLine.innerHTML = '';
    totalLine.append(
      el('span', 'k', 'Итого'), el('span', 'v', rub(t.rub)),
      el('span', 'sep', '·'), el('span', 'v', usd(t.usd)),
    );
  }

  function renderRows(source) {
    rowsWrap.innerHTML = '';
    rows = source.map((acc, i) => {
      const name = el('input');
      name.type = 'text'; name.value = acc.name || ''; name.placeholder = 'счёт';
      const amount = el('input');
      amount.type = 'number'; amount.step = 'any'; amount.value = acc.amount ?? '';
      amount.placeholder = 'сумма';
      const ccy = el('select');
      [['RUB', '₽'], ['USD', '$']].forEach(([v, l]) => ccy.append(new Option(l, v)));
      ccy.value = acc.ccy === 'RUB' ? 'RUB' : 'USD';
      const row = el('div', 'acc-row');
      row.append(name, amount, ccy);
      if (source.length > 1) {
        const del = el('button', 'btn icon', '✕');
        del.type = 'button';
        del.title = 'Убрать счёт';
        del.onclick = () => { renderRows(readRows().filter((_, j) => j !== i)); recompute(); };
        row.append(del);
      } else {
        row.append(el('span', 'acc-spacer'));
      }
      [name, amount].forEach((inp) => inp.addEventListener('input', recompute));
      ccy.addEventListener('change', recompute);
      rowsWrap.append(row);
      return { name, amount, ccy };
    });
    const add = el('button', 'btn ghost add-acc', '+ Счёт');
    add.type = 'button';
    add.onclick = () => { renderRows([...readRows(), { name: '', amount: '', ccy: 'USD' }]); recompute(); };
    rowsWrap.append(add);
  }

  renderRows(snap.accounts || []);
  rate.addEventListener('input', recompute);
  recompute();

  const meta = el('div', 'snap-meta');
  const rateLabel = el('label', 'snap-field');
  rateLabel.append(el('span', 'k', 'Курс USD/RUB'), rate);
  const commentLabel = el('label', 'snap-field wide');
  commentLabel.append(el('span', 'k', 'Комментарий'), comment);
  meta.append(rateLabel, commentLabel);

  const save = el('button', 'btn primary', 'Сохранить');
  const cancel = el('button', 'btn ghost', 'Отмена');
  const buttons = el('div', 'snap-buttons');
  buttons.append(cancel, save);

  cancel.onclick = () => { state.editing = null; rerender(); };
  save.onclick = async () => {
    const accounts = readRows().filter((a) => a.name);
    if (!accounts.length) {
      alert('Оставьте хотя бы один счёт с названием.');
      return;
    }
    await window.api.balances.update(snap.id, {
      accounts,
      usdRub: Number(rate.value) || 0,
      comment: comment.value,
    });
    state.editing = null;
    reload();
  };

  box.append(meta, rowsWrap, totalLine, buttons);
  return box;
}

function snapshotsTable(rows) {
  const panel = card('Все отметки', 'wide');
  panel.append(el('div', 'card-hint', 'Нажмите на строку, чтобы поправить суммы по счетам прямо здесь.'));
  const table = el('table', 'mini-table');
  const thead = el('thead');
  const htr = el('tr');
  ['Дата', 'Курс', 'Счета', 'Итого ₽', 'Итого $', 'Изменение', ''].forEach((t) => htr.append(el('th', null, t)));
  thead.append(htr);
  const tbody = el('tbody');
  [...rows].reverse().forEach((r) => {
    const open = state.editing === r.id;
    const tr = el('tr', 'snap-row' + (open ? ' open' : ''));
    tr.append(el('td', null, shortDate(r.date)));
    tr.append(el('td', 'num', String(r.usdRub || '—')));
    tr.append(el('td', null, (r.accounts || []).map((a) => a.name).join(' · ')));
    tr.append(el('td', 'num', rub(r.rub)));
    tr.append(el('td', 'num', usd(r.usd)));
    const delta = el('td', 'num ' + sign(r.deltaRub));
    delta.textContent = r.deltaRub == null ? '—' : `${rub(r.deltaRub)} · ${pct1(r.deltaPct)}`;
    tr.append(delta);
    const act = el('td', 'num');
    const edit = el('button', 'btn icon', open ? '⌃' : '✎');
    edit.title = open ? 'Свернуть' : 'Редактировать балансы';
    edit.onclick = (e) => { e.stopPropagation(); state.editing = open ? null : r.id; rerender(); };
    const del = el('button', 'btn icon', '✕');
    del.title = 'Удалить';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить отметку от ${shortDate(r.date)}?`)) return;
      await window.api.balances.remove(r.id);
      reload();
    };
    const wrap = el('span', 'row-actions');
    wrap.append(edit, del);
    act.append(wrap);
    tr.append(act);
    tr.onclick = () => { state.editing = open ? null : r.id; rerender(); };
    tbody.append(tr);

    if (open) {
      const editTr = el('tr', 'snap-edit-row');
      const cell = el('td');
      cell.colSpan = 7;
      cell.append(snapshotEditor(ctx.snapshots.find((s) => s.id === r.id)));
      editTr.append(cell);
      tbody.append(editTr);
    }
  });
  table.append(thead, tbody);
  panel.append(table);
  return panel;
}

function flowsTable(flows) {
  const panel = card('Ввод и вывод средств', 'wide');
  if (!flows.length) {
    panel.append(el('div', 'panel-empty', 'Движений пока нет. «+ Ввод / вывод» — если заводили или снимали деньги.'));
    return panel;
  }
  const table = el('table', 'mini-table');
  const thead = el('thead');
  const htr = el('tr');
  ['Дата', 'Счёт', 'Направление', 'Сумма', 'В рублях', 'Комментарий', ''].forEach((t) => htr.append(el('th', null, t)));
  thead.append(htr);
  const tbody = el('tbody');
  [...flows].reverse().forEach((f) => {
    const v = B().flowRub(f);
    const tr = el('tr');
    tr.append(el('td', null, shortDate(f.date)));
    tr.append(el('td', null, f.account || '—'));
    const dir = el('td');
    dir.append(el('span', 'pill ' + (f.kind === 'out' ? 'out' : 'in'), f.kind === 'out' ? 'вывод' : 'ввод'));
    tr.append(dir);
    tr.append(el('td', 'num', `${Number(f.amount).toLocaleString('ru-RU')} ${f.ccy === 'RUB' ? '₽' : '$'}`));
    tr.append(el('td', 'num ' + sign(v), rub(v)));
    tr.append(el('td', null, f.comment || ''));
    const act = el('td', 'num');
    const edit = el('button', 'btn icon', '✎');
    edit.title = 'Редактировать';
    edit.onclick = () => openFlowForm(f);
    const del = el('button', 'btn icon', '✕');
    del.title = 'Удалить';
    del.onclick = async () => {
      if (!confirm(`Удалить движение от ${shortDate(f.date)}?`)) return;
      await window.api.flows.remove(f.id);
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

function renderBalances(container, snapshots, trades, flows) {
  ctx = { container, snapshots, trades, flows: flows || [] };
  container.innerHTML = '';

  const bar = el('div', 'period-bar');
  const addBtn = el('button', 'btn primary', '+ Отметка баланса');
  addBtn.onclick = () => openSnapshotForm();
  const addFlowBtn = el('button', 'btn ghost', '+ Ввод / вывод');
  addFlowBtn.onclick = () => openFlowForm(null);
  bar.append(addBtn, addFlowBtn);

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
  const journal = B().journalLine(snapshots, trades, ctx.flows);
  const drift = latest.rub - journal[journal.length - 1];
  const moved = B().flowTotals(ctx.flows);

  const metrics = el('div', 'metrics');
  metrics.append(
    metric('Капитал сейчас', rub(latest.rub), 'pos'),
    metric('В долларах', usd(latest.usd)),
    metric('С прошлой отметки', latest.deltaRub == null ? '—' : rub(latest.deltaRub), sign(latest.deltaRub)),
    metric('Изменение, %', pct1(latest.deltaPct), sign(latest.deltaPct)),
    metric('Отметок', String(rows.length)),
    metric('Последняя', shortDate(latest.date)),
    metric('Заведено', rub(moved.in), moved.in ? 'pos' : ''),
    metric('Выведено', rub(moved.out), moved.out ? 'neg' : ''),
    metric('Расхождение с журналом', rub(drift), sign(drift),
      'Фактический капитал минус (капитал первой отметки + профит по сделкам + вводы − выводы). Остаётся то, что не попало в дневник.'),
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
  requestAnimationFrame(() => drawCurve(canvas, rows, journal, state.unit, ctx.flows));

  grid.append(accountsPanel(snapshots[snapshots.length - 1]));
  grid.append(snapshotsTable(rows));
  grid.append(flowsTable(ctx.flows));
}

window.balancesView = { renderBalances };
})();
