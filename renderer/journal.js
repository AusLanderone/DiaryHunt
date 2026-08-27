function td(value, cls) {
  const el = document.createElement('td');
  if (cls) el.className = cls;
  el.textContent = value;
  return el;
}

function tdNode(node, cls) {
  const el = document.createElement('td');
  if (cls) el.className = cls;
  if (node) el.appendChild(node);
  return el;
}

function pill(text, kind) {
  const s = document.createElement('span');
  s.className = 'pill ' + kind;
  s.textContent = text;
  return s;
}

const signCls = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');

const HEAD = ['№', 'Откр', 'Закр', 'Тип', 'Тикер', 'Тег', 'Биржа', 'Сделка',
  'Цена вход', 'Кол-во', 'Цена выход', 'Комса', 'Вход спред', 'Спред итог',
  'PnL ноги', 'PnL net', 'Чистый ₽', ''];

function renderJournal(container, trades, { onEdit, onDelete }) {
  const F = window.format;
  container.innerHTML = '';

  if (!trades.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Пока нет сделок. Нажмите «Добавить сделку», чтобы внести первую.';
    container.appendChild(div);
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  HEAD.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i <= 7) th.className = 'text'; // labels through Сделка are left-aligned
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let total = 0;

  trades.forEach((trade) => {
    const c = window.calc.computeTrade(trade);
    if (c.closed) total += c.netProfitRub;
    const state = !c.closed ? 'open' : c.netProfitRub >= 0 ? 'pos' : 'neg';

    trade.legs.forEach((leg, i) => {
      const first = i === 0;
      const lc = c.legs[i];
      const tr = document.createElement('tr');
      tr.className = `${first ? 'leg1' : 'leg2'} state-${state}`;

      tr.appendChild(td(first ? trade.num : '', 'text'));
      tr.appendChild(td(first ? trade.openDate : '', 'text dim'));
      // close date, or an "открыта" pill for open trades
      if (first) {
        tr.appendChild(c.closed
          ? td(trade.closeDate, 'text dim')
          : tdNode(pill('открыта', 'open'), 'text'));
      } else {
        tr.appendChild(td('', 'text'));
      }
      tr.appendChild(td(first ? trade.type : '', 'text dim'));
      tr.appendChild(td(first ? trade.ticker : '', 'text strong'));
      tr.appendChild(td(first ? trade.tag : '', 'text dim'));
      tr.appendChild(td(leg.exchange, 'text'));
      tr.appendChild(td(leg.side, 'text'));
      tr.appendChild(td(F.fmtUsd(leg.entryPrice)));
      tr.appendChild(td(F.fmtNum(leg.units)));
      tr.appendChild(td(F.fmtUsd(leg.exitPrice)));
      tr.appendChild(td(F.fmtRub(leg.feeRub), 'dim'));
      tr.appendChild(td(first ? F.fmtPct(c.entrySpread) : '', 'dim'));
      tr.appendChild(td(first ? F.fmtPct(c.spreadTotal) : '', 'dim'));
      tr.appendChild(td(F.fmtUsd(lc.gross), signCls(lc.gross)));
      tr.appendChild(td(first ? F.fmtUsd(c.pnlNet) : '', first ? signCls(c.pnlNet) : ''));
      tr.appendChild(td(first ? F.fmtRub(c.netProfitRub) : '',
        first ? ('strong ' + signCls(c.netProfitRub)) : ''));

      if (first) {
        const act = document.createElement('td');
        act.rowSpan = 2;
        const wrap = document.createElement('span');
        wrap.className = 'row-actions';
        const edit = document.createElement('button');
        edit.textContent = '✎'; edit.className = 'btn icon'; edit.title = 'Редактировать';
        edit.onclick = () => onEdit(trade);
        const del = document.createElement('button');
        del.textContent = '✕'; del.className = 'btn icon'; del.title = 'Удалить';
        del.onclick = () => onDelete(trade);
        wrap.append(edit, del);
        act.appendChild(wrap);
        tr.appendChild(act);
      }
      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);

  // scrollable trade list + a thin fixed total bar at the bottom
  const scroll = document.createElement('div');
  scroll.className = 'journal-scroll';
  scroll.appendChild(table);

  const foot = document.createElement('div');
  foot.className = 'journal-total';
  const lbl = document.createElement('span');
  lbl.className = 'lbl'; lbl.textContent = 'Итого';
  const val = document.createElement('span');
  val.className = 'val ' + signCls(total); val.textContent = F.fmtRub(total);
  foot.append(lbl, val);

  const wrap = document.createElement('div');
  wrap.className = 'journal';
  wrap.append(scroll, foot);
  container.appendChild(wrap);
}

window.journal = { renderJournal };
