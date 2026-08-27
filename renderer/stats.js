// IIFE-scoped so helpers (el/sign/metric/…) don't leak into the shared global
// scope and collide with form.js / journal.js (which also define `el`, `pill`).
(function () {
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

function metric(label, value, cls) {
  const box = el('div', 'metric');
  const l = el('div', 'label'); l.textContent = label;
  const v = el('div', 'value' + (cls ? ' ' + cls : '')); v.textContent = value;
  box.append(l, v);
  return box;
}

const CSS = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// compact ₽ label for the value axis: 39179 -> "39к", 1465 -> "1,5к"
function axisRub(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',') + 'к';
  return String(Math.round(v));
}

function drawEquity(canvas, points, dates) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const H = 320;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!points.length) return;

  const padL = 56, padR = 16, padTop = 16, padBot = 30;
  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v) => H - padBot - ((v - min) * (H - padTop - padBot)) / Math.max(1e-9, max - min);
  const pos = CSS('--pos') || '#46c46a';
  const line = CSS('--line') || '#262d38';
  const muted = CSS('--muted') || '#8b95a6';
  ctx.font = '10.5px "Cascadia Code", Consolas, monospace';

  // Y axis: horizontal gridlines + ₽ value labels (vertical scale)
  const TICKS = 4;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= TICKS; i++) {
    const v = min + ((max - min) * i) / TICKS;
    const yy = y(v);
    ctx.strokeStyle = line; ctx.lineWidth = Math.abs(v) < 1e-9 ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(axisRub(v), padL - 8, yy);
  }

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
  const step = Math.max(1, Math.ceil(points.length / 8));
  for (let i = 0; i < points.length; i++) {
    if (i % step !== 0 && i !== points.length - 1) continue;
    ctx.fillText(ddmm(dates[i] || ''), x(i), H - padBot + 8);
  }

  // final point marker
  ctx.fillStyle = pos;
  ctx.beginPath(); ctx.arc(x(points.length - 1), y(points[points.length - 1]), 3.5, 0, Math.PI * 2); ctx.fill();
}

// group closed trades by keyFn -> [{ label, profit, count, wins }]
function groupBy(trades, keyFn) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, { label: k, profit: 0, count: 0, wins: 0 });
    const g = map.get(k);
    const np = window.calc.netProfitRub(t);
    g.profit += np; g.count += 1; if (np > 0) g.wins += 1;
  }
  return [...map.values()];
}

// vertical bar chart: profit per group (day), green/red by sign
function drawBars(canvas, groups) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const H = 260;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!groups.length) return;

  const padL = 56, padR = 16, padTop = 18, padBot = 30;
  const vals = groups.map((g) => g.profit);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const y = (v) => H - padBot - ((v - min) * (H - padTop - padBot)) / Math.max(1e-9, max - min);
  const slot = (W - padL - padR) / groups.length;
  const bw = Math.min(48, slot * 0.6);
  const cx = (i) => padL + slot * i + slot / 2;
  const pos = CSS('--pos') || '#46c46a';
  const neg = CSS('--neg') || '#f26d78';
  const line = CSS('--line') || '#262d38';
  const muted = CSS('--muted') || '#8b95a6';
  ctx.font = '10.5px "Cascadia Code", Consolas, monospace';

  // Y axis: gridlines + ₽ labels
  const TICKS = 4;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= TICKS; i++) {
    const v = min + ((max - min) * i) / TICKS;
    const yy = y(v);
    ctx.strokeStyle = line; ctx.lineWidth = Math.abs(v) < 1e-9 ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(axisRub(v), padL - 8, yy);
  }

  // bars
  const y0 = y(0);
  groups.forEach((g, i) => {
    const yv = y(g.profit);
    ctx.fillStyle = g.profit >= 0 ? pos : neg;
    ctx.fillRect(cx(i) - bw / 2, Math.min(yv, y0), bw, Math.max(1, Math.abs(yv - y0)));
  });

  // X axis: date labels (thinned when crowded)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = muted;
  const step = Math.max(1, Math.ceil(groups.length / 12));
  groups.forEach((g, i) => {
    if (i % step !== 0 && i !== groups.length - 1) return;
    ctx.fillText(g.label, cx(i), H - padBot + 8);
  });
}

function breakdownPanel(title, groups) {
  const F = window.format;
  const panel = el('div', 'panel');
  const h = el('h3'); h.textContent = title;
  panel.append(h);
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.profit)));
  for (const g of groups) {
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

const ddmm = (iso) => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}` : iso; };

function renderStats(container, trades) {
  const F = window.format;
  container.innerHTML = '';
  const closed = trades.filter((t) => window.calc.isClosed(t)).sort((a, b) => a.num - b.num);
  const open = trades.length - closed.length;
  const profits = closed.map((t) => window.calc.netProfitRub(t));
  const total = profits.reduce((s, v) => s + v, 0);
  const wins = profits.filter((v) => v > 0).length;
  const winrate = closed.length ? (wins / closed.length) * 100 : 0;
  const avg = closed.length ? total / closed.length : 0;
  const best = closed.length ? Math.max(...profits) : 0;
  const worst = closed.length ? Math.min(...profits) : 0;

  const metrics = el('div', 'metrics');
  metrics.append(
    metric('Закрытых сделок', String(closed.length)),
    metric('Открытых сделок', String(open)),
    metric('Суммарный профит', F.fmtRub(total), sign(total)),
    metric('Винрейт', winrate.toFixed(1) + '%'),
    metric('Средний профит', F.fmtRub(avg), sign(avg)),
    metric('Лучшая сделка', F.fmtRub(best), sign(best)),
    metric('Худшая сделка', F.fmtRub(worst), sign(worst)),
  );
  container.appendChild(metrics);

  if (!closed.length) {
    const div = el('div', 'empty');
    div.textContent = 'Нет закрытых сделок для статистики. Закройте сделку, указав цену выхода и дату закрытия.';
    container.appendChild(div);
    return;
  }

  // equity curve
  const title = el('div', 'chart-title');
  title.textContent = 'Кривая капитала — накопительный профит, ₽';
  container.appendChild(title);
  const wrap = el('div', 'chart-wrap');
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  container.appendChild(wrap);
  let cum = 0;
  const cumulative = profits.map((v) => (cum += v));
  const dates = closed.map((t) => t.closeDate);
  requestAnimationFrame(() => drawEquity(canvas, cumulative, dates));

  // profit by day — vertical bars
  const byDay = groupBy(closed, (t) => t.closeDate).sort((a, b) => (a.label < b.label ? -1 : 1));
  byDay.forEach((g) => (g.label = ddmm(g.label)));
  const dayTitle = el('div', 'chart-title');
  dayTitle.textContent = 'Профит по дням, ₽';
  dayTitle.style.marginTop = '22px';
  container.appendChild(dayTitle);
  const dayWrap = el('div', 'chart-wrap');
  const dayCanvas = document.createElement('canvas');
  dayWrap.appendChild(dayCanvas);
  container.appendChild(dayWrap);
  requestAnimationFrame(() => drawBars(dayCanvas, byDay));

  // breakdowns
  const moexLeg = (t) => t.legs.find((l) => l.exchange === 'MOEX') || t.legs[0];
  const otherLeg = (t) => t.legs.find((l) => l !== moexLeg(t)) || t.legs[1] || t.legs[0];
  const byTicker = groupBy(closed, (t) => t.ticker).sort((a, b) => b.profit - a.profit);
  const byDirMoex = groupBy(closed, (t) => `${moexLeg(t).exchange} ${moexLeg(t).side}`).sort((a, b) => b.profit - a.profit);
  const byDirOther = groupBy(closed, (t) => `${otherLeg(t).exchange} ${otherLeg(t).side}`).sort((a, b) => b.profit - a.profit);
  const byTag = groupBy(closed, (t) => t.tag || '—').sort((a, b) => b.profit - a.profit);

  const panels = el('div', 'panels');
  panels.append(
    breakdownPanel('Профит по тикеру', byTicker),
    breakdownPanel('Профит по направлению (нога MOEX)', byDirMoex),
    breakdownPanel('Профит по направлению (2-я нога)', byDirOther),
    breakdownPanel('Профит по тегу', byTag),
  );
  container.appendChild(panels);
}

window.stats = { renderStats };
})();
