function metric(label, value) {
  const box = document.createElement('div');
  box.style.cssText = 'display:inline-block; margin:8px 16px 8px 0; padding:10px 16px; background:#252526; border-radius:6px;';
  box.innerHTML = `<div style="font-size:12px;color:#aaa">${label}</div><div style="font-size:20px">${value}</div>`;
  return box;
}

function drawEquity(canvas, points) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, pad = 30;
  ctx.clearRect(0, 0, W, H);
  if (points.length === 0) return;
  const min = Math.min(0, ...points), max = Math.max(0, ...points);
  const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1);
  const y = (v) => H - pad - ((v - min) * (H - 2 * pad)) / Math.max(1e-9, max - min);
  ctx.strokeStyle = '#444'; ctx.beginPath(); ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0)); ctx.stroke();
  ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
}

function renderStats(container, trades) {
  const F = window.format;
  container.innerHTML = '';
  const closed = trades.filter((t) => window.calc.isClosed(t))
    .sort((a, b) => a.num - b.num);
  const profits = closed.map((t) => window.calc.netProfitRub(t));
  const total = profits.reduce((s, v) => s + v, 0);
  const wins = profits.filter((v) => v > 0).length;
  const winrate = closed.length ? (wins / closed.length) * 100 : 0;
  const avg = closed.length ? total / closed.length : 0;

  const metrics = document.createElement('div');
  metrics.append(
    metric('Всего сделок (закрыто)', closed.length),
    metric('Суммарный профит', F.fmtRub(total)),
    metric('Винрейт', winrate.toFixed(1) + '%'),
    metric('Средний профит', F.fmtRub(avg)),
  );
  container.appendChild(metrics);

  const title = document.createElement('h3');
  title.textContent = 'Кривая капитала (₽, накопительно)';
  container.appendChild(title);

  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 320;
  canvas.style.cssText = 'background:#1b1b1b; border:1px solid #333; border-radius:6px;';
  container.appendChild(canvas);

  let cum = 0;
  drawEquity(canvas, profits.map((v) => (cum += v)));
}

window.stats = { renderStats };
