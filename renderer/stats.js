// IIFE-scoped so helpers (el/sign/metric/…) don't leak into the shared global
// scope and collide with form.js / journal.js (which also define `el`, `pill`).
(function () {
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const A = () => window.analytics;

function metric(label, value, cls, hint) {
  const box = el('div', 'metric');
  const l = el('div', 'label'); l.textContent = label;
  const v = el('div', 'value' + (cls ? ' ' + cls : '')); v.textContent = value;
  box.append(l, v);
  if (hint) box.title = hint;
  return box;
}

const CSS = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// compact ₽ label for the value axis: 39179 -> "39к", 1465 -> "1,5к"
function axisRub(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',') + 'к';
  return String(Math.round(v));
}

const pct = (v, digits = 2) => (v * 100).toFixed(digits).replace('.', ',') + '%';
const ddmm = (iso) => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}` : iso; };

// ---------- shared tooltip ----------

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
  const w = tip.offsetWidth;
  const left = Math.min(e.clientX + 14, window.innerWidth - w - 8);
  tip.style.left = left + 'px';
  tip.style.top = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8) + 'px';
}

const hideTip = () => { chartTip().style.display = 'none'; };

// tooltip body shared by every profit-carrying widget
const tipBody = (title, profit, sub) =>
  `<b>${title}</b><span class="tv ${sign(profit)}">${window.format.fmtRub(profit)}</span>` +
  (sub ? `<div class="tip-sub">${sub}</div>` : '');

// ---------- canvas helpers ----------

// Prepare a HiDPI canvas and hand back its context and its real size. The
// canvas fills whatever room its card has, so the height comes from the layout
// — `fallback` only covers the moment before there is one.
function setupCanvas(canvas, fallback) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const H = Math.max(120, Math.round(canvas.clientHeight || fallback));
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10.5px "Cascadia Code", Consolas, monospace';
  return { ctx, W, H };
}

// horizontal gridlines + left-hand value labels; returns the value->y mapper
function valueAxis(ctx, { W, H, padL, padR, padTop, padBot, min, max, fmt = axisRub, ticks = 4 }) {
  const y = (v) => H - padBot - ((v - min) * (H - padTop - padBot)) / Math.max(1e-9, max - min);
  const line = CSS('--line') || '#262d38';
  const muted = CSS('--muted') || '#8b95a6';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const yy = y(v);
    ctx.strokeStyle = line; ctx.lineWidth = Math.abs(v) < 1e-9 ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(fmt(v), padL - 8, yy);
  }
  return y;
}

// X labels are thinned by available width, not by a fixed count — the same
// chart is rendered full-width and in a half-width card.
function labelStep(count, usableWidth, minPx) {
  const fits = Math.max(1, Math.floor(usableWidth / minPx));
  return Math.max(1, Math.ceil(count / fits));
}

// One card = one widget. Everything the page renders is a card in .stats-grid,
// so the layout stays even no matter how many widgets are on screen; `wide`
// makes a card span the full row (charts that need the horizontal room).
// `cfg` names the widget's own bands in src/widgetRanges.js — the card then
// carries a gear that opens them for editing.
function card(title, cls, cfg) {
  const box = el('section', 'card' + (cls ? ' ' + cls : ''));
  const h = el('h3', 'card-title');
  h.textContent = title;
  const tools = el('div', 'card-tools');
  box.append(h, tools);
  if (cfg) tools.appendChild(gearButton(cfg));
  return box;
}

function chartCard(title, cls, cfg) {
  const box = card(title, cls, cfg);
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  return { box, canvas };
}

// ---------- equity curve (with the deepest drawdown marked) ----------

function drawEquity(canvas, points, dates) {
  const padL = 56, padR = 16, padTop = 16, padBot = 30;
  const { ctx, W, H } = setupCanvas(canvas, 320);
  if (!points.length) return;

  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, points.length - 1);
  const y = valueAxis(ctx, { W, H, padL, padR, padTop, padBot, min, max });
  const pos = CSS('--pos') || '#46c46a';
  const muted = CSS('--muted') || '#8b95a6';

  // area fill under the curve
  const grad = ctx.createLinearGradient(0, padTop, 0, H - padBot);
  grad.addColorStop(0, 'rgba(70,196,106,0.22)');
  grad.addColorStop(1, 'rgba(70,196,106,0.01)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  points.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(points.length - 1), y(0));
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // the line
  ctx.strokeStyle = pos; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();

  // X axis: date labels (horizontal), thinned out when crowded
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
  const step = labelStep(points.length, W - padL - padR, 52);
  for (let i = 0; i < points.length; i++) {
    if (i % step !== 0 && i !== points.length - 1) continue;
    ctx.fillText(ddmm(dates[i] || ''), x(i), H - padBot + 8);
  }

  // final point marker
  ctx.fillStyle = pos;
  ctx.beginPath(); ctx.arc(x(points.length - 1), y(points[points.length - 1]), 3.5, 0, Math.PI * 2); ctx.fill();
}

// ---------- vertical bars: profit per day ----------

function drawBars(canvas, groups) {
  const padL = 56, padR = 16, padTop = 18, padBot = 30;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const muted = CSS('--muted') || '#8b95a6';

  function render(hoverIdx) {
    const { ctx, W, H } = setupCanvas(canvas, 260);
    if (!groups.length) return {};

    const vals = groups.map((g) => g.profit);
    const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
    const slot = (W - padL - padR) / groups.length;
    const bw = Math.min(48, slot * 0.6);
    const cx = (i) => padL + slot * i + slot / 2;

    // hovered column highlight (behind everything)
    if (hoverIdx >= 0 && hoverIdx < groups.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(padL + slot * hoverIdx, padTop, slot, H - padTop - padBot);
    }

    const y = valueAxis(ctx, { W, H, padL, padR, padTop, padBot, min, max });

    const y0 = y(0);
    groups.forEach((g, i) => {
      const yv = y(g.profit);
      ctx.fillStyle = g.profit >= 0 ? pos : neg;
      ctx.globalAlpha = hoverIdx === -1 || hoverIdx === i ? 1 : 0.55;
      ctx.fillRect(cx(i) - bw / 2, Math.min(yv, y0), bw, Math.max(1, Math.abs(yv - y0)));
      ctx.globalAlpha = 1;
    });

    // X axis: date labels (thinned when crowded)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
    const step = labelStep(groups.length, W - padL - padR, 52);
    groups.forEach((g, i) => {
      if (i % step !== 0 && i !== groups.length - 1) return;
      ctx.fillText(g.label, cx(i), H - padBot + 8);
    });

    return { slot };
  }

  let geom = render(-1);

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = geom.slot ? Math.floor((mx - padL) / geom.slot) : -1;
    if (idx < 0 || idx >= groups.length || mx < padL || mx > rect.width - padR) {
      canvas.onmouseleave();
      return;
    }
    const g = groups[idx];
    geom = render(idx);
    showTip(tipBody(g.label, g.profit, `${g.count} сд · ${Math.round((g.wins / g.count) * 100)}% в плюс`), e);
  };
  canvas.onmouseleave = () => { hideTip(); geom = render(-1); };
}

// ---------- histogram: distribution of trade results ----------

function drawHistogram(canvas, bins) {
  const padL = 56, padR = 16, padTop = 18, padBot = 34;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const muted = CSS('--muted') || '#8b95a6';

  function render(hoverIdx) {
    const { ctx, W, H } = setupCanvas(canvas, 260);
    if (!bins.length) return {};
    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    const y = valueAxis(ctx, {
      W, H, padL, padR, padTop, padBot, min: 0, max: maxCount,
      fmt: (v) => String(Math.round(v)), ticks: Math.min(4, maxCount),
    });
    const slot = (W - padL - padR) / bins.length;

    bins.forEach((b, i) => {
      const x0 = padL + slot * i + slot * 0.1;
      const bw = slot * 0.8;
      const yv = y(b.count), y0 = y(0);
      ctx.fillStyle = b.to <= 0 ? neg : b.from >= 0 ? pos : muted;
      ctx.globalAlpha = hoverIdx === -1 || hoverIdx === i ? 1 : 0.55;
      ctx.fillRect(x0, yv, bw, Math.max(b.count ? 2 : 0, y0 - yv));
      ctx.globalAlpha = 1;
    });

    // X labels at the bin edges, thinned when crowded
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
    const step = labelStep(bins.length, W - padL - padR, 56);
    bins.forEach((b, i) => {
      if (i % step !== 0) return;
      ctx.fillText(axisRub(b.from), padL + slot * i, H - padBot + 8);
    });
    ctx.fillText(axisRub(bins[bins.length - 1].to), padL + slot * bins.length, H - padBot + 8);

    return { slot };
  }

  let geom = render(-1);
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = geom.slot ? Math.floor((mx - padL) / geom.slot) : -1;
    if (idx < 0 || idx >= bins.length) { canvas.onmouseleave(); return; }
    const b = bins[idx];
    geom = render(idx);
    showTip(`<b>${axisRub(b.from)} … ${axisRub(b.to)} ₽</b><div class="tip-sub">${b.count} сделок</div>`, e);
  };
  canvas.onmouseleave = () => { hideTip(); geom = render(-1); };
}

// ---------- calendar heatmap ----------

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pad2 = (n) => String(n).padStart(2, '0');

function calendarWidget(map) {
  const F = window.format;
  const days = Object.keys(map).sort();
  const wrap = el('div', 'calendars');
  if (!days.length) return wrap;

  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(map[d].profit)));

  // every month between the first and last traded day
  const [y0, m0] = days[0].split('-').map(Number);
  const [y1, m1] = days[days.length - 1].split('-').map(Number);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (m = 1, y++) : m++) {
    const month = el('div', 'cal');
    const head = el('div', 'cal-head');
    head.textContent = `${A().MONTHS[m - 1]} ${y}`;
    const monthProfit = days
      .filter((d) => d.startsWith(`${y}-${pad2(m)}`))
      .reduce((s, d) => s + map[d].profit, 0);
    const mv = el('span', 'cal-sum ' + sign(monthProfit));
    mv.textContent = F.fmtRub(monthProfit);
    head.appendChild(mv);
    month.appendChild(head);

    const grid = el('div', 'cal-grid');
    WD.forEach((w) => { const c = el('div', 'cal-wd'); c.textContent = w; grid.appendChild(c); });

    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    // 'cal-blank', not 'empty': .empty is the page-level "no trades" placeholder
    for (let i = 0; i < lead; i++) grid.appendChild(el('div', 'cal-cell cal-blank'));

    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      const cell = el('div', 'cal-cell');
      cell.textContent = String(d);
      const info = map[iso];
      if (info) {
        const intensity = 0.18 + 0.62 * (Math.abs(info.profit) / maxAbs);
        cell.classList.add('has', sign(info.profit));
        cell.style.setProperty('--a', intensity.toFixed(3));
        cell.onmousemove = (e) => showTip(tipBody(iso.split('-').reverse().join('.'), info.profit, `${info.count} сд · ${info.wins} в плюс`), e);
        cell.onmouseleave = hideTip;
      }
      grid.appendChild(cell);
    }
    month.appendChild(grid);
    wrap.appendChild(month);
  }
  return wrap;
}

// ---------- DOM panels ----------

function breakdownPanel(title, groups, opts = {}) {
  const F = window.format;
  // A band the reader set by hand is theirs and stays on the chart even when
  // nothing landed in it — a widget that quietly answers with fewer bands than
  // were asked for reads as a bug. Bands the app derives from the trades
  // themselves (weekday, ticker, tag) still drop the empty ones.
  const rows = (opts.keepEmpty || opts.cfg) ? groups : groups.filter((g) => g.count > 0);
  const panel = card(title, null, opts.cfg);
  if (!rows.length) {
    const e = el('div', 'panel-empty'); e.textContent = 'нет данных';
    panel.append(e);
    return panel;
  }
  const maxAbs = Math.max(1, ...rows.map((g) => Math.abs(g.profit)));
  for (const g of rows) {
    const row = el('div', 'brow');
    const bl = el('div', 'bl');
    const name = el('div', 'name'); name.textContent = g.label;
    const meta = el('div', 'meta');
    meta.textContent = g.count
      ? `${g.count} шт · ${Math.round((g.wins / g.count) * 100)}% в плюс`
      : 'нет сделок';
    bl.append(name, meta);
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill ' + sign(g.profit));
    fill.style.width = (Math.abs(g.profit) / maxAbs) * 100 + '%';
    track.append(fill);
    const bv = el('div', 'bv ' + sign(g.profit));
    bv.textContent = F.fmtRub(g.profit);
    row.append(bl, track, bv);
    panel.append(row);
  }
  return panel;
}

function monthlyTable(rows) {
  const F = window.format;
  const panel = card('Итоги по месяцам', 'wide');
  const table = el('table', 'mini-table');
  const thead = el('thead');
  const htr = el('tr');
  ['Месяц', 'Сделок', 'В плюс', 'Винрейт', 'Средний', 'Профит'].forEach((t) => {
    const th = el('th'); th.textContent = t; htr.appendChild(th);
  });
  thead.appendChild(htr);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    const cells = [
      r.label,
      String(r.count),
      String(r.wins),
      Math.round((r.wins / r.count) * 100) + '%',
      F.fmtRub(r.profit / r.count),
      F.fmtRub(r.profit),
    ];
    cells.forEach((c, i) => {
      const td = el('td', i >= 4 ? 'num ' + (i === 5 ? sign(r.profit) : '') : i ? 'num' : '');
      td.textContent = c;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  panel.appendChild(table);
  return panel;
}

// ---------- period filter ----------

const PERIODS = [
  ['all', 'Всё время'],
  ['year', 'Год'],
  ['quarter', 'Квартал'],
  ['month', 'Месяц'],
];
let period = 'all';

// ---------- per-widget bands ----------

// What the app ships is a starting point: a diary's own scale decides what
// counts as a wide spread or a big trade, so every banded widget carries a gear.
// The values live in the settings, so they survive a restart and ride along in
// the DB export.
const WR = () => window.widgetRanges;
let bands = null;

const ranges = () => (bands || (bands = WR().normalize((window.appSettings || {}).widgets)));

async function saveRanges(next) {
  bands = next;
  window.appSettings = { ...(window.appSettings || {}), widgets: next };
  try {
    await window.api.config.setSettings({ widgets: next });
  } catch { /* the view is already right; the disk write is best effort */ }
}

// The labels a set of edges produces, asked of the widget that draws them —
// no second definition of what a band is called.
function bandPreview(key, value) {
  if (key === 'bins') return `${value} ${WR().SPECS.bins.unit}`;
  const of = { spread: A().spreadBuckets, hold: A().holdingBuckets, capital: A().capitalBuckets }[key];
  return of([], value).map((b) => b.label).join(' · ');
}

function gearButton(key) {
  const btn = el('button', 'card-gear');
  btn.textContent = '⚙';
  btn.title = `Настроить диапазоны: ${WR().SPECS[key].title}`;
  btn.onclick = (e) => { e.stopPropagation(); openRangeDialog(key); };
  return btn;
}

// One row per band, each reading as a sentence: «до 0,5 %», «от 0,5 до 1 %»,
// and a last row saying where everything above the final edge falls. Only the
// row's own upper edge is typed — the lower one is its neighbour's and updates
// itself, so nothing has to be worked out in the head.
function bandEditor(key, values) {
  const spec = WR().SPECS[key];
  const box = el('div', 'band-rows');

  // the wording between the fields, refreshed in place so typing never moves
  // the caret out of the row being typed in
  const labels = () => {
    [...box.querySelectorAll('.band-row')].forEach((row, i) => {
      const from = row.querySelector('.br-from');
      if (row.classList.contains('tail')) {
        const last = String(values[values.length - 1] === undefined ? '' : values[values.length - 1]).trim();
        from.textContent = last ? `больше ${last}` : 'всё остальное';
        row.querySelector('.br-tail-unit').textContent = last ? spec.unit : '';
      } else {
        const prev = i === 0 ? '' : String(values[i - 1] === undefined ? '' : values[i - 1]).trim();
        from.textContent = prev ? `от ${prev} до` : 'до';
      }
    });
  };

  const render = () => {
    box.innerHTML = '';
    values.forEach((value, i) => {
      const row = el('div', 'band-row');
      const input = el('input', 'br-num');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.dataset.f = 'edge-' + i;
      input.value = String(value).replace('.', ',');
      input.oninput = () => { values[i] = input.value; input.classList.remove('bad'); labels(); };

      const unit = el('span', 'br-unit');
      unit.textContent = spec.unit;
      row.append(el('span', 'br-from'), input, unit);

      if (values.length > 1) {
        const del = el('button', 'br-del');
        del.textContent = '✕';
        del.title = 'Убрать полосу';
        // a widget with no bands has nothing to draw, so the last one stays
        del.onclick = () => {
          if (values.length <= 1) return;
          values.splice(i, 1);
          render();
        };
        row.append(del);
      }
      box.append(row);
    });

    const tail = el('div', 'band-row tail');
    tail.append(el('span', 'br-from'), el('span', 'br-tail-unit'));
    box.append(tail);

    if (values.length < WR().MAX_EDGES) {
      const add = el('button', 'btn ghost mini rf-add');
      add.textContent = '+ Добавить полосу';
      add.onclick = () => {
        values.push(String(WR().suggestEdge(key, values)).replace('.', ','));
        render();
        const last = box.querySelector('[data-f="edge-' + (values.length - 1) + '"]');
        if (last) { last.focus(); last.select(); }
      };
      box.append(add);
    }
    labels();
  };

  render();
  return box;
}

// The histogram has no bands, only a number of columns — a stepper says that
// better than a text field does.
function countEditor(key, state) {
  const spec = WR().SPECS[key];
  const box = el('div', 'count-editor');
  const input = el('input', 'br-num wide');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.dataset.f = 'edge-0';
  input.value = String(state.value);
  input.oninput = () => { state.value = input.value; input.classList.remove('bad'); };

  const step = (by) => {
    const now = WR().parse(key, input.value) || spec.min;
    input.value = String(Math.min(spec.max, Math.max(spec.min, now + by)));
    state.value = input.value;
    input.classList.remove('bad');
  };
  const minus = el('button', 'br-step');
  minus.textContent = '−';
  minus.title = 'Меньше столбцов';
  minus.onclick = () => step(-1);
  const plus = el('button', 'br-step');
  plus.textContent = '+';
  plus.title = 'Больше столбцов';
  plus.onclick = () => step(1);

  const unit = el('span', 'br-unit');
  unit.textContent = spec.unit;
  const range = el('span', 'br-range');
  range.textContent = `от ${spec.min} до ${spec.max}`;
  box.append(minus, input, plus, unit, range);
  return box;
}

// a refused save should say which row it tripped over
function markBadRows(modal, values) {
  values.forEach((raw, i) => {
    const input = modal.querySelector('[data-f="edge-' + i + '"]');
    if (!input) return;
    const text = String(raw).trim();
    const n = Number(text.replace(',', '.'));
    input.classList.toggle('bad', Boolean(text) && !(Number.isFinite(n) && n >= 0));
  });
}

function openRangeDialog(key) {
  const spec = WR().SPECS[key];
  const isCount = spec.kind === 'count';

  // the editor works on its own copy; nothing reaches the widget until save
  const values = isCount ? []
    : WR().toDisplay(key, ranges()[key]).map((v) => String(v).replace('.', ','));
  const state = { value: isCount ? ranges()[key] : null };

  const modal = el('div', 'modal range-modal');
  const title = el('h2');
  title.textContent = spec.title;
  const hint = el('p', 'hint');
  hint.textContent = isCount
    ? 'На сколько столбцов делить размах профита.'
    : `Полосы, по которым виджет делит сделки. В каждой строке — её верхняя граница, ${spec.unit}.`;
  const error = el('p', 'range-error');
  const buttons = el('div', 'modal-buttons');
  modal.append(title, hint, isCount ? countEditor(key, state) : bandEditor(key, values), error, buttons);

  const backdrop = el('div', 'modal-backdrop');
  backdrop.append(modal);

  const rebuild = () => {
    const sel = isCount ? '.count-editor' : '.band-rows';
    modal.replaceChild(isCount ? countEditor(key, state) : bandEditor(key, values),
      modal.querySelector(sel));
  };

  const toDefault = el('button', 'btn ghost');
  toDefault.textContent = 'По умолчанию';
  toDefault.onclick = () => {
    error.textContent = '';
    if (isCount) {
      state.value = WR().defaults()[key];
    } else {
      values.length = 0;
      WR().toDisplay(key, WR().defaults()[key])
        .forEach((v) => values.push(String(v).replace('.', ',')));
    }
    rebuild();
  };
  const cancel = el('button', 'btn ghost');
  cancel.textContent = 'Отмена';
  cancel.onclick = () => backdrop.remove();
  const save = el('button', 'btn primary');
  save.textContent = 'Сохранить';
  save.onclick = async () => {
    const next = isCount ? WR().parse(key, state.value) : WR().fromDisplay(key, values);
    if (next === null) {
      const anyFilled = values.some((v) => String(v).trim());
      error.textContent = isCount
        ? 'Впишите число столбцов.'
        : anyFilled
          ? 'В подсвеченной строке не число. Исправьте её или уберите полосу.'
          : 'Оставьте хотя бы одну полосу.';
      markBadRows(modal, isCount ? [state.value] : values);
      return;
    }
    await saveRanges({ ...ranges(), [key]: next });
    backdrop.remove();
    redrawBody();
  };
  buttons.append(toDefault, cancel, save);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  const first = modal.querySelector('[data-f="edge-0"]');
  if (first) { first.focus(); first.select(); }
}

// ---------- the order the cards stand in ----------

// Dragged by the handle in a card's corner and kept with the settings, so a
// layout survives a restart the way the bands do.
const WO = () => window.widgetOrder;
let cardOrder = null;
let draggingId = null;

const order = () => (cardOrder || (cardOrder = WO().normalize((window.appSettings || {}).widgetOrder)));
const orderChanged = () => order().join() !== WO().DEFAULT_ORDER.join();

async function saveOrder(next) {
  cardOrder = next;
  window.appSettings = { ...(window.appSettings || {}), widgetOrder: next };
  try {
    await window.api.config.setSettings({ widgetOrder: next });
  } catch { /* the view is already right; the disk write is best effort */ }
}

const WS = () => window.widgetSize;
let cardSizes = null;

const sizes = () => (cardSizes || (cardSizes = WS().normalize(
  (window.appSettings || {}).widgetSize, (window.appSettings || {}).widgetSizeV)));
const sizesChanged = () => JSON.stringify(sizes()) !== JSON.stringify(WS().defaults());

async function saveSizes(next) {
  cardSizes = next;
  window.appSettings = { ...(window.appSettings || {}), widgetSize: next, widgetSizeV: WS().VERSION };
  try {
    await window.api.config.setSettings({ widgetSize: next, widgetSizeV: WS().VERSION });
  } catch { /* the view is already right; the disk write is best effort */ }
}

// How many columns the grid has right now, and how big one cell is — the raster
// every card is measured against, so nothing ever lands between two columns.
function gridMetrics(grid) {
  const cols = WS().columnsFor(grid.clientWidth || 1000);
  const gap = 14;
  const cellW = (grid.clientWidth - gap * (cols - 1)) / cols + gap;
  return { cols, gap, cellW, cellH: ROW_UNIT + gap };
}

const ROW_UNIT = 120;   // mirrors widgetSize.ROW_UNIT, for the drag arithmetic

// Puts a card on the raster: as many columns as it asks for, clamped to the
// columns there are, and a floor under its height. Height is a minimum rather
// than a row span — every card then occupies exactly one grid row, so a row of
// cards shares one top and one bottom whatever sizes they carry.
function applySpan(box, id, cols) {
  const span = WS().spanFor(sizes()[id], cols);
  box.style.gridColumn = `span ${span.cols}`;
  box.style.minHeight = WS().minHeight(span) + 'px';
}

// Dragging the corner resizes by whole cells, with the card itself following
// the pointer so the size being chosen is the size on screen.
function resizable(box, id) {
  const grip = el('div', 'card-resize');
  grip.title = 'Потянуть за угол, чтобы изменить размер';
  box.appendChild(grip);

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = box.parentElement;
    const metrics = gridMetrics(grid);
    const start = { ...sizes()[id] };
    const from = { x: e.clientX, y: e.clientY };
    let next = start;
    box.classList.add('resizing');
    grip.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      next = WS().resize(start, ev.clientX - from.x, ev.clientY - from.y,
        { cellW: metrics.cellW, cellH: metrics.cellH, maxCols: metrics.cols });
      box.style.gridColumn = `span ${next.cols}`;
      box.style.minHeight = WS().minHeight(next) + 'px';
    };
    const onUp = async () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      box.classList.remove('resizing');
      if (next.cols !== start.cols || next.rows !== start.rows) {
        await saveSizes({ ...sizes(), [id]: next });
      }
      redrawBody();   // the charts redraw at whatever height they now have
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });
  return box;
}

const clearDropHints = () => document.querySelectorAll('.stats-grid .card')
  .forEach((c) => c.classList.remove('drop-target', 'dragging'));

// A card is only draggable while its handle is held: otherwise every stray
// drag over a chart would pick the whole widget up.
function dragify(box, id, cols) {
  box.dataset.widget = id;
  applySpan(box, id, cols);
  resizable(box, id);
  const tools = box.querySelector('.card-tools');
  const handle = el('button', 'card-drag');
  handle.textContent = '⠿';
  handle.title = 'Перетащить виджет на другое место';
  handle.onmousedown = () => { box.draggable = true; };
  handle.onmouseup = () => { box.draggable = false; };
  handle.onclick = (e) => e.stopPropagation();
  if (tools) tools.prepend(handle);

  box.addEventListener('dragstart', (e) => {
    draggingId = id;
    box.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch { /* older engines */ }
    }
  });
  box.addEventListener('dragend', () => {
    draggingId = null;
    box.draggable = false;
    clearDropHints();
  });
  box.addEventListener('dragover', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    box.classList.add('drop-target');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop-target'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault();
    const from = draggingId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    draggingId = null;
    clearDropHints();
    if (!from || from === id) return;
    await saveOrder(WO().move(order(), from, id));
    redrawBody();
  });
  return box;
}

// ---------- extra filters ----------

// The windows live in src/statsFilter.js; this is only their control panel.
// Module state, so switching tabs and coming back keeps what was set.
const SF = () => window.statsFilter;
let filter = null;                  // null until the first render, then a spec
let filtersOpen = false;
let openPicker = null;              // which value picker is unfolded, if any

const theFilter = () => (filter || (filter = { ...SF().EMPTY }));
const filtersActive = () => SF().activeCount(theFilter()) > 0;

// A comma is how a decimal is written here, and a blank field is no bound.
function parseNum(text) {
  const s = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
const showNum = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

const setDim = (key, value) => { filter = { ...theFilter(), [key]: value }; };

// closing the open picker on a click elsewhere — the panel itself stops the
// click, so ticking values keeps it unfolded
document.addEventListener('click', () => {
  if (!openPicker || !document.querySelector('.stats-filters')) return;
  openPicker = null;
  rerenderAll();
});

const VALUE_DIMS = [
  { key: 'ticker', name: 'Тикер', blank: 'без тикера' },
  { key: 'tag', name: 'Тег', blank: 'без тега' },
  { key: 'exchange', name: 'Биржа', blank: 'без биржи' },
  { key: 'weekday', name: 'День недели', blank: 'без дня' },
];

const RANGE_DIMS = [
  { key: 'size', name: 'Объём на ногу, ₽', hint: 'Сколько денег занимает одна сторона сделки' },
  { key: 'entrySpread', name: 'Спред входа, %', hint: 'По величине, без учёта порядка ног' },
  { key: 'exitSpread', name: 'Спред выхода, %', hint: 'По величине, без учёта порядка ног' },
  { key: 'collected', name: 'Спред, %', hint: 'Собранный спред, со знаком: минус — сделка закрыта в убыток' },
];

function rangeField(dim) {
  const box = el('div', 'filter-field');
  const label = el('span', 'ff-label'); label.textContent = dim.name;
  if (dim.hint) box.title = dim.hint;
  box.append(label);
  const side = (which, placeholder) => {
    const input = el('input', 'ff-num');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = placeholder;
    input.dataset.f = `${dim.key}.${which}`;
    input.value = showNum(theFilter()[dim.key][which]);
    input.oninput = () => {
      setDim(dim.key, { ...theFilter()[dim.key], [which]: parseNum(input.value) });
      // only the body is redrawn, so the field keeps the caret being typed into
      redrawBody();
      refreshToggle();
    };
    return input;
  };
  box.append(side('min', 'от'), el('span', 'ff-dash'), side('max', 'до'));
  return box;
}

function dateField() {
  const box = el('div', 'filter-field');
  box.title = 'По дате закрытия; открытые сделки окно по датам не отбрасывает';
  const label = el('span', 'ff-label'); label.textContent = 'Даты закрытия';
  box.append(label);
  const side = (key) => {
    const input = el('input', 'ff-date');
    input.type = 'date';
    input.dataset.f = key;
    input.value = theFilter()[key] || '';
    input.onchange = () => { setDim(key, input.value); redrawBody(); refreshToggle(); };
    return input;
  };
  box.append(side('from'), el('span', 'ff-dash'), side('to'));
  return box;
}

function filtersPanel(pool) {
  const panel = el('div', 'stats-filters');
  const options = SF().options(pool);

  const values = el('div', 'filter-row');
  values.append(dateField());
  VALUE_DIMS.forEach((dim) => {
    values.append(window.pickers.valuePicker({
      name: dim.name,
      blank: dim.blank,
      rows: options[dim.key],
      spec: theFilter()[dim.key],
      open: openPicker === dim.key,
      onOpen: (open) => { openPicker = open ? dim.key : null; rerenderAll(); },
      onChange: (spec) => { setDim(dim.key, spec); rerenderAll(); },
    }));
  });
  panel.append(values);

  const ranges = el('div', 'filter-row');
  RANGE_DIMS.forEach((dim) => ranges.append(rangeField(dim)));
  panel.append(ranges);

  const foot = el('div', 'filter-foot');
  const reset = el('button', 'btn ghost mini reset');
  reset.textContent = 'Сбросить';
  reset.disabled = !filtersActive();
  reset.onclick = () => { filter = { ...SF().EMPTY }; openPicker = null; rerenderAll(); };
  foot.append(reset);
  panel.append(foot);
  return panel;
}

const toggleLabel = () => {
  const n = SF().activeCount(theFilter());
  return n ? `Фильтры · ${n}` : 'Фильтры';
};

// the count changes as ranges are typed into, and only the body is redrawn then
function refreshToggle() {
  const btn = document.querySelector('.stats-filters-toggle');
  if (!btn) return;
  btn.textContent = toggleLabel();
  btn.classList.toggle('active', filtersActive());
  const reset = document.querySelector('.stats-filters .reset');
  if (reset) reset.disabled = !filtersActive();
}

function periodBar(onChange) {
  const bar = el('div', 'period-bar');
  const label = el('span', 'period-label'); label.textContent = 'Период:';
  bar.appendChild(label);
  PERIODS.forEach(([key, text]) => {
    const b = el('button', 'chip' + (period === key ? ' active' : ''));
    b.textContent = text;
    b.onclick = () => { period = key; onChange(); };
    bar.appendChild(b);
  });

  // only worth offering once something has actually been rearranged
  if (orderChanged() || sizesChanged()) {
    const back = el('button', 'chip order-reset');
    back.textContent = 'Раскладка по умолчанию';
    back.title = 'Вернуть виджетам исходный порядок и размеры';
    back.onclick = async (e) => {
      e.stopPropagation();
      await saveOrder([...WO().DEFAULT_ORDER]);
      await saveSizes(WS().defaults());
      rerenderAll();
    };
    bar.appendChild(back);
  }

  const toggle = el('button', 'chip stats-filters-toggle' + (filtersActive() ? ' active' : ''));
  toggle.textContent = toggleLabel();
  toggle.title = 'Дополнительные окна: даты, тикер, тег, биржа, день недели, объём и спреды';
  toggle.onclick = (e) => {
    e.stopPropagation();
    filtersOpen = !filtersOpen;
    rerenderAll();
  };
  bar.appendChild(toggle);
  return bar;
}

// ---------- main render ----------

// The bar is drawn once per render; the body is redrawn on its own whenever a
// filter changes, so a field being typed into keeps the caret.
function renderStats(container, trades) {
  lastRender = { container, trades };
  container.innerHTML = '';
  hideTip();

  const bar = el('div', 'stats-bar');
  bar.append(periodBar(rerenderAll));
  if (filtersOpen) bar.append(filtersPanel(A().filterByPeriod(trades, period)));
  container.append(bar);

  const body = el('div', 'stats-body');
  container.append(body);
  renderBody(body, trades);
}

function rerenderAll() {
  if (lastRender) renderStats(lastRender.container, lastRender.trades);
}

function redrawBody() {
  const body = document.querySelector('.stats-body');
  if (body && lastRender) renderBody(body, lastRender.trades);
}

function renderBody(container, trades) {
  const F = window.format;
  const an = A();
  container.innerHTML = '';
  hideTip();

  const inPeriod = SF().apply(an.filterByPeriod(trades, period), theFilter());
  const closed = inPeriod.filter((t) => window.calc.isClosed(t)).sort((a, b) => a.num - b.num);
  const open = inPeriod.length - closed.length;
  const profits = closed.map((t) => window.calc.netProfitRub(t));
  const total = profits.reduce((s, v) => s + v, 0);
  const wins = profits.filter((v) => v > 0).length;
  const winrate = closed.length ? (wins / closed.length) * 100 : 0;
  const avg = closed.length ? total / closed.length : 0;
  const best = closed.length ? Math.max(...profits) : 0;
  const worst = closed.length ? Math.min(...profits) : 0;

  let cum = 0;
  const cumulative = profits.map((v) => (cum += v));
  const pf = an.profitFactor(profits);
  const aw = an.avgWin(profits);
  const al = an.avgLoss(profits);
  const ret = an.avgReturnPct(closed);
  const holds = closed.map((t) => an.holdingDays(t)).filter((d) => d !== null);
  const avgHold = holds.length ? holds.reduce((s, v) => s + v, 0) / holds.length : null;

  const dash = '—';
  const metrics = el('div', 'metrics');
  metrics.append(
    metric('Закрытых сделок', String(closed.length)),
    metric('Открытых сделок', String(open)),
    metric('Суммарный профит', F.fmtRub(total), sign(total)),
    metric('Винрейт', winrate.toFixed(1) + '%'),
    metric('Средний профит', F.fmtRub(avg), sign(avg), 'Математическое ожидание одной сделки'),
    metric('Профит-фактор', pf === null ? dash : pf === Infinity ? '∞' : pf.toFixed(2).replace('.', ','),
      pf !== null && pf !== Infinity ? (pf >= 1 ? 'pos' : 'neg') : 'pos',
      'Сумма прибылей / сумма убытков. Больше 1 — система в плюсе'),
    metric('Средний плюс', aw === null ? dash : F.fmtRub(aw), 'pos'),
    metric('Средний минус', al === null ? dash : F.fmtRub(al), 'neg'),
    metric('Ср. доходность', ret === null ? dash : pct(ret), sign(ret || 0), 'Средний чистый % на объём одной ноги — той стороны позиции, которую сделка реально занимает'),
    metric('Ср. время в сделке', avgHold === null ? dash : avgHold.toFixed(1).replace('.', ',') + ' дн'),
    metric('Лучшая сделка', F.fmtRub(best), sign(best)),
    metric('Худшая сделка', F.fmtRub(worst), sign(worst)),
  );
  container.appendChild(metrics);

  if (filtersActive()) {
    const note = el('div', 'filter-note');
    note.textContent = `Фильтры оставили ${inPeriod.length} из ${an.filterByPeriod(trades, period).length} сделок`;
    container.appendChild(note);
  }

  if (!closed.length) {
    const div = el('div', 'empty');
    div.textContent = filtersActive()
      ? 'Под фильтры не подошла ни одна закрытая сделка. Снимите часть условий или нажмите «Сбросить».'
      : period === 'all'
        ? 'Нет закрытых сделок для статистики. Закройте сделку, указав цену выхода и дату закрытия.'
        : 'В выбранном периоде нет закрытых сделок. Переключите период выше.';
    container.appendChild(div);
    return;
  }

  const grid = el('div', 'stats-grid');
  container.appendChild(grid);
  const draw = (fn) => requestAnimationFrame(fn);

  const dates = closed.map((t) => t.closeDate);
  const byDay = an.groupBy(closed, (t) => t.closeDate).sort((a, b) => (a.key < b.key ? -1 : 1));
  byDay.forEach((g) => (g.label = ddmm(g.key)));
  const R = ranges();
  const byProfit = (a, b) => b.profit - a.profit;
  const byTicker = an.groupBy(closed, (t) => t.ticker).sort(byProfit);
  const byTag = an.groupBy(closed, (t) => t.tag || '—').sort(byProfit);

  // One builder per widget, keyed by the id src/widgetOrder.js knows it as —
  // the cards then go up in whatever order the reader dragged them into.
  const build = {
    // full width: it reads by shape rather than by value
    equity: () => {
      const eq = chartCard('Кривая капитала — накопительный профит, ₽');
      draw(() => drawEquity(eq.canvas, cumulative, dates));
      return eq.box;
    },
    days: () => {
      const day = chartCard('Профит по дням, ₽');
      draw(() => drawBars(day.canvas, byDay));
      return day.box;
    },
    hist: () => {
      const hist = chartCard('Распределение результатов — сделок в диапазоне', null, 'bins');
      draw(() => drawHistogram(hist.canvas, an.profitHistogram(profits, R.bins)));
      return hist.box;
    },
    // small: what the trading cost, and which venue took it
    fees: () => {
      const box = card('Комиссии');
      const s = an.feeSummary(closed);
      const total = el('div', 'fee-total');
      total.textContent = F.fmtRub(s.total);
      box.append(total);

      const lines = el('div', 'fee-lines');
      const line = (k, v, cls) => {
        const row = el('div', 'fl' + (cls ? ' ' + cls : ''));
        const key = el('span', 'k'); key.textContent = k;
        const val = el('span', 'v'); val.textContent = v;
        row.append(key, val);
        return row;
      };
      lines.append(
        line('За сделку', s.perTrade === null ? dash : F.fmtRub(s.perTrade)),
        line('Доля от валовой прибыли', s.share === null ? dash : pct(s.share)),
      );
      s.byExchange.forEach((r, i) => lines.append(line(r.label, F.fmtRub(r.fee), i ? '' : 'sep')));
      box.append(lines);
      return box;
    },
    // full width: it already tiles its own months
    calendar: () => {
      const cal = card('Календарь — профит по дням закрытия');
      cal.appendChild(calendarWidget(an.calendarMap(closed)));
      return cal;
    },
    spread: () => breakdownPanel('Профит по спреду входа',
      an.spreadBuckets(closed, R.spread), { cfg: 'spread' }),
    hold: () => breakdownPanel('Профит по времени удержания',
      an.holdingBuckets(closed, R.hold), { cfg: 'hold' }),
    capital: () => breakdownPanel('Профит по объёму позиции — средняя нога',
      an.capitalBuckets(closed, R.capital), { cfg: 'capital' }),
    weekday: () => breakdownPanel('Профит по дню недели', an.byWeekday(closed)),
    ticker: () => breakdownPanel('Профит по тикеру', byTicker),
    tag: () => breakdownPanel('Профит по тегу', byTag),
    months: () => monthlyTable(an.byMonth(closed)),
  };

  const cols = WS().columnsFor(container.clientWidth || 1000);
  grid.style.setProperty('--cols', String(cols));
  grid.style.setProperty('--unit', ROW_UNIT + 'px');
  order().forEach((id) => {
    if (!build[id]) return;
    grid.appendChild(dragify(build[id](), id, cols));
  });
}

// Canvases are sized from their card's width, so a window resize has to redraw
// them; re-rendering the whole view is cheap (everything is already in memory).
let lastRender = null;
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!lastRender || !document.querySelector('.stats-grid')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderStats(lastRender.container, lastRender.trades), 120);
});

window.stats = { renderStats };
})();
