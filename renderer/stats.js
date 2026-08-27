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

function drawEquity(canvas, points) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 900;
  const H = 300;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!points.length) return;

  const padX = 14, padTop = 16, padBot = 22;
  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i) => padX + (i * (W - 2 * padX)) / Math.max(1, points.length - 1);
  const y = (v) => H - padBot - ((v - min) * (H - padTop - padBot)) / Math.max(1e-9, max - min);
  const pos = CSS('--pos') || '#46c46a';
  const line = CSS('--line') || '#262d38';
  const muted = CSS('--muted') || '#8b95a6';

  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padX, y(0)); ctx.lineTo(W - padX, y(0)); ctx.stroke();

  const grad = ctx.createLinearGradient(0, padTop, 0, H - padBot);
  grad.addColorStop(0, 'rgba(70,196,106,0.22)');
  grad.addColorStop(1, 'rgba(70,196,106,0.01)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  points.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(points.length - 1), y(0));
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.strokeStyle = pos; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();

  const lx = x(points.length - 1), ly = y(points[points.length - 1]);
  ctx.fillStyle = pos;
  ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = muted;
  ctx.font = '11px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(window.format.fmtRub(points[points.length - 1]), W - padX, Math.max(padTop + 4, ly - 8));
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
  requestAnimationFrame(() => drawEquity(canvas, cumulative));

  // breakdowns
  const byDay = groupBy(closed, (t) => t.closeDate).sort((a, b) => (a.label < b.label ? -1 : 1));
  byDay.forEach((g) => (g.label = ddmm(g.label)));
  const byTicker = groupBy(closed, (t) => t.ticker).sort((a, b) => b.profit - a.profit);
  const byDir = groupBy(closed, (t) => `${t.legs[0].exchange} ${t.legs[0].side}`).sort((a, b) => b.profit - a.profit);
  const byTag = groupBy(closed, (t) => t.tag || '—').sort((a, b) => b.profit - a.profit);

  const panels = el('div', 'panels');
  panels.append(
    breakdownPanel('Профит по тикеру', byTicker),
    breakdownPanel('Профит по направлению (нога MOEX)', byDir),
    breakdownPanel('Профит по тегу', byTag),
    breakdownPanel('Профит по дням', byDay),
  );
  container.appendChild(panels);
}

window.stats = { renderStats };
})();
