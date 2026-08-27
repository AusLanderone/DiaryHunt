function td(value, cls) {
  const el = document.createElement('td');
  if (cls) el.className = cls;
  el.textContent = value;
  return el;
}

function renderJournal(container, trades, { onEdit, onDelete }) {
  const F = window.format;
  container.innerHTML = '';
  const table = document.createElement('table');

  const headCols = ['№', 'Откр', 'Закр', 'Тип', 'Тикер', 'Тег', 'Биржа', 'Сделка',
    'Цена вход', 'Кол-во', 'Цена выход', 'Комса ₽', 'Поз. начало', 'Вход спред',
    'Спред итог', 'Поз. конец', 'PnL ноги', 'PnL net', 'Чистый ₽', ''];
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  headCols.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i >= 1 && i <= 5) th.className = 'text';
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let totalProfit = 0;

  trades.forEach((trade) => {
    const c = window.calc.computeTrade(trade);
    if (c.closed) totalProfit += c.netProfitRub;
    const openCls = c.closed ? '' : ' open';

    trade.legs.forEach((leg, i) => {
      const first = i === 0;
      const lc = c.legs[i];
      const tr = document.createElement('tr');
      tr.className = (first ? 'leg1' : 'leg2') + openCls;
      tr.appendChild(td(first ? trade.num : '', 'text'));
      tr.appendChild(td(first ? trade.openDate : '', 'text'));
      tr.appendChild(td(first ? trade.closeDate : '', 'text'));
      tr.appendChild(td(first ? trade.type : '', 'text'));
      tr.appendChild(td(first ? trade.ticker : '', 'text'));
      tr.appendChild(td(first ? trade.tag : '', 'text'));
      tr.appendChild(td(leg.exchange, 'text'));
      tr.appendChild(td(leg.side, 'text'));
      tr.appendChild(td(F.fmtUsd(leg.entryPrice)));
      tr.appendChild(td(F.fmtNum(leg.units)));
      tr.appendChild(td(F.fmtUsd(leg.exitPrice)));
      tr.appendChild(td(F.fmtRub(leg.feeRub)));
      tr.appendChild(td(F.fmtUsd(lc.start), 'calc'));
      tr.appendChild(td(first ? F.fmtPct(c.entrySpread) : '', 'calc'));
      tr.appendChild(td(first ? F.fmtPct(c.spreadTotal) : '', 'calc'));
      tr.appendChild(td(F.fmtUsd(lc.end), 'calc'));
      tr.appendChild(td(F.fmtUsd(lc.gross), 'calc'));
      tr.appendChild(td(first ? F.fmtUsd(c.pnlNet) : '', 'calc'));
      tr.appendChild(td(first ? F.fmtRub(c.netProfitRub) : '', 'calc'));
      if (first) {
        const act = document.createElement('td');
        act.rowSpan = 2;
        const edit = document.createElement('button');
        edit.textContent = '✎'; edit.className = 'secondary';
        edit.onclick = () => onEdit(trade);
        const del = document.createElement('button');
        del.textContent = '🗑'; del.className = 'secondary';
        del.onclick = () => onDelete(trade);
        act.append(edit, del);
        tr.appendChild(act);
      }
      tbody.appendChild(tr);
    });
  });

  const totalTr = document.createElement('tr');
  totalTr.className = 'totals';
  totalTr.appendChild(td('ИТОГО', 'text'));
  for (let i = 1; i < 18; i++) totalTr.appendChild(td(''));
  totalTr.appendChild(td(F.fmtRub(totalProfit)));
  totalTr.appendChild(td(''));
  tbody.appendChild(totalTr);

  table.appendChild(tbody);
  container.appendChild(table);
}

window.journal = { renderJournal };
