function metric(label, value, cls) {
  const box = document.createElement('div');
  box.className = 'metric';
  const l = document.createElement('div');
  l.className = 'label'; l.textContent = label;
  const v = document.createElement('div');
  v.className = 'value' + (cls ? ' ' + cls : ''); v.textContent = value;
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

  // zero baseline
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padX, y(0)); ctx.lineTo(W - padX, y(0)); ctx.stroke();

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

  // last point marker + value label
  const lx = x(points.length - 1), ly = y(points[points.length - 1]);
  ctx.fillStyle = pos;
  ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = muted;
  ctx.font = '11px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'right';
  const label = window.format.fmtRub(points[points.length - 1]);
  ctx.fillText(label, W - padX, Math.max(padTop + 4, ly - 8));
}

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
  const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

  const metrics = document.createElement('div');
  metrics.className = 'metrics';
  metrics.append(
    metric('Закрытых сделок', String(closed.length)),
    metric('Открытых сделок', String(open)),
    metric('Суммарный профит', F.fmtRub(total), sign(total)),
    metric('Винрейт', winrate.toFixed(1) + '%'),
    metric('Средний профит', F.fmtRub(avg), sign(avg)),
  );
  container.appendChild(metrics);

  if (!closed.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Нет закрытых сделок для статистики. Закройте сделку, указав цену выхода и дату закрытия.';
    container.appendChild(div);
    return;
  }

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = 'Кривая капитала — накопительный профит, ₽';
  container.appendChild(title);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  let cum = 0;
  const cumulative = profits.map((v) => (cum += v));
  // canvas needs layout width before drawing
  requestAnimationFrame(() => drawEquity(canvas, cumulative));
}

window.stats = { renderStats };
