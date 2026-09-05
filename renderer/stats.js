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

// prepare a HiDPI canvas of the given CSS height, return its 2d context and width
function setupCanvas(canvas, H) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10.5px "Cascadia Code", Consolas, monospace';
  return { ctx, W };
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
function card(title, cls) {
  const box = el('section', 'card' + (cls ? ' ' + cls : ''));
  const h = el('h3', 'card-title');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

function chartCard(title, cls) {
  const box = card(title, cls);
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  return { box, canvas };
}

// ---------- equity curve (with the deepest drawdown marked) ----------

function drawEquity(canvas, points, dates) {
  const H = 320, padL = 56, padR = 16, padTop = 16, padBot = 30;
  const { ctx, W } = setupCanvas(canvas, H);
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
  const H = 260, padL = 56, padR = 16, padTop = 18, padBot = 30;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const muted = CSS('--muted') || '#8b95a6';

  function render(hoverIdx) {
    const { ctx, W } = setupCanvas(canvas, H);
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
  const H = 260, padL = 56, padR = 16, padTop = 18, padBot = 34;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const muted = CSS('--muted') || '#8b95a6';

  function render(hoverIdx) {
    const { ctx, W } = setupCanvas(canvas, H);
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

// ---------- waterfall: how gross becomes the net profit ----------

// Each article moves the running balance; the last bar restates the balance
// itself, so the eye can compare what was earned with what was kept.
function waterfallBars(s) {
  const steps = [
    { label: 'Gross', delta: s.gross },
    { label: 'Комиссии', delta: -s.fees },
    { label: 'Payout', delta: s.payout },
    { label: 'Свопы', delta: s.swap },
    { label: 'Правка', delta: s.adjustment },
  ].filter((step, i) => i === 0 || Math.abs(step.delta) > 0.005);

  let run = 0;
  const bars = steps.map((step) => {
    const from = run;
    run += step.delta;
    return { ...step, from, to: run };
  });
  bars.push({ label: 'Чистый', delta: s.net, from: 0, to: s.net, isTotal: true });
  return bars;
}

function drawWaterfall(canvas, s) {
  const H = 260, padL = 56, padR = 16, padTop = 26, padBot = 34;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const accent = CSS('--accent') || '#4c8dff';
  const muted = CSS('--muted') || '#8b95a6';
  const text = CSS('--text') || '#e9edf3';
  const bars = waterfallBars(s);

  function render(hoverIdx) {
    const { ctx, W } = setupCanvas(canvas, H);
    const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
    const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
    const y = valueAxis(ctx, { W, H, padL, padR, padTop, padBot, min: lo, max: hi });
    const slot = (W - padL - padR) / bars.length;
    const bw = Math.min(56, slot * 0.55);
    const cx = (i) => padL + slot * i + slot / 2;

    // fees and swaps are tiny next to gross — floor their height so a cost that
    // rounds to a pixel is still visible as a bar
    const MIN_H = 6;
    bars.forEach((b, i) => {
      const y1 = y(b.from), y2 = y(b.to);
      const drawn = Math.abs(y2 - y1);
      const h = Math.max(MIN_H, drawn);
      const top = b.to >= b.from ? Math.min(y1, y2) - (h - drawn) : Math.min(y1, y2);
      ctx.fillStyle = b.isTotal ? accent : b.delta >= 0 ? pos : neg;
      ctx.globalAlpha = hoverIdx === -1 || hoverIdx === i ? 1 : 0.55;
      ctx.fillRect(cx(i) - bw / 2, top, bw, h);
      ctx.globalAlpha = 1;

      // dashed connector carrying the running balance into the next article
      if (i < bars.length - 1 && !bars[i + 1].isTotal) {
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.45; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cx(i) + bw / 2, y2); ctx.lineTo(cx(i + 1) - bw / 2, y2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(axisRub(b.isTotal ? b.to : b.delta), cx(i), top - 4);
      ctx.fillStyle = muted; ctx.textBaseline = 'top';
      ctx.fillText(b.label, cx(i), H - padBot + 8);
    });

    return { slot };
  }

  let geom = render(-1);
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = geom.slot ? Math.floor((mx - padL) / geom.slot) : -1;
    if (idx < 0 || idx >= bars.length) { canvas.onmouseleave(); return; }
    const b = bars[idx];
    geom = render(idx);
    const share = s.gross ? ` · ${pct(Math.abs(b.delta / s.gross), 1)} от gross` : '';
    showTip(tipBody(b.label, b.isTotal ? b.to : b.delta,
      b.isTotal ? 'итог после всех статей' : `вклад в результат${share}`), e);
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
  const rows = opts.keepEmpty ? groups : groups.filter((g) => g.count > 0);
  const panel = card(title);
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
    meta.textContent = `${g.count} шт · ${Math.round((g.wins / g.count) * 100)}% в плюс`;
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
  return bar;
}

// ---------- main render ----------

function renderStats(container, trades) {
  lastRender = { container, trades };
  const F = window.format;
  const an = A();
  container.innerHTML = '';
  hideTip();

  container.appendChild(periodBar(() => renderStats(container, trades)));

  const inPeriod = an.filterByPeriod(trades, period);
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
    metric('Ср. доходность', ret === null ? dash : pct(ret), sign(ret || 0), 'Средний чистый % на задействованный капитал'),
    metric('Ср. время в сделке', avgHold === null ? dash : avgHold.toFixed(1).replace('.', ',') + ' дн'),
    metric('Лучшая сделка', F.fmtRub(best), sign(best)),
    metric('Худшая сделка', F.fmtRub(worst), sign(worst)),
  );
  container.appendChild(metrics);

  if (!closed.length) {
    const div = el('div', 'empty');
    div.textContent = period === 'all'
      ? 'Нет закрытых сделок для статистики. Закройте сделку, указав цену выхода и дату закрытия.'
      : 'В выбранном периоде нет закрытых сделок. Переключите период выше.';
    container.appendChild(div);
    return;
  }

  const grid = el('div', 'stats-grid');
  container.appendChild(grid);
  const draw = (fn) => requestAnimationFrame(fn);

  // equity curve — full width, it reads by shape rather than by value
  const dates = closed.map((t) => t.closeDate);
  const eq = chartCard('Кривая капитала — накопительный профит, ₽', 'wide');
  grid.appendChild(eq.box);
  draw(() => drawEquity(eq.canvas, cumulative, dates));

  // profit by day + distribution share a row
  const byDay = an.groupBy(closed, (t) => t.closeDate).sort((a, b) => (a.key < b.key ? -1 : 1));
  byDay.forEach((g) => (g.label = ddmm(g.key)));
  const day = chartCard('Профит по дням, ₽');
  grid.appendChild(day.box);
  draw(() => drawBars(day.canvas, byDay));

  const hist = chartCard('Распределение результатов — сделок в диапазоне');
  grid.appendChild(hist.box);
  draw(() => drawHistogram(hist.canvas, an.profitHistogram(profits, Math.min(10, Math.max(4, closed.length)))));

  // calendar — full width, it already tiles its own months
  const cal = card('Календарь — профит по дням закрытия', 'wide');
  cal.appendChild(calendarWidget(an.calendarMap(closed)));
  grid.appendChild(cal);

  // where the profit comes from: gross, then every article that eats into it
  const wf = chartCard('Структура профита — от gross до чистого, ₽');
  grid.appendChild(wf.box);
  draw(() => drawWaterfall(wf.canvas, an.profitStructure(closed)));

  // breakdowns
  const byProfit = (a, b) => b.profit - a.profit;
  const byTicker = an.groupBy(closed, (t) => t.ticker).sort(byProfit);
  const byTag = an.groupBy(closed, (t) => t.tag || '—').sort(byProfit);

  grid.append(
    breakdownPanel('Профит по спреду входа', an.spreadBuckets(closed)),
    breakdownPanel('Профит по времени удержания', an.holdingBuckets(closed)),
    breakdownPanel('Профит по объёму позиции', an.capitalBuckets(closed)),
    breakdownPanel('Профит по дню недели', an.byWeekday(closed)),
    breakdownPanel('Профит по тикеру', byTicker),
    breakdownPanel('Профит по тегу', byTag),
    monthlyTable(an.byMonth(closed)),
  );
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
