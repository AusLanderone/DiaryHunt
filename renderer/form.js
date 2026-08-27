function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
  children.forEach((c) => e.append(c));
  return e;
}
const txt = (s) => document.createTextNode(s);

function field(label, input) {
  return el('label', {}, [txt(label), input]);
}

function pill(text, kind) {
  const s = el('span', { class: 'pill ' + kind });
  s.textContent = text;
  return s;
}

function legInputs(title, leg, cfg) {
  const ex = el('select');
  cfg.exchanges.forEach((x) => ex.append(new Option(x, x)));
  ex.value = leg.exchange || cfg.exchanges[0];
  const side = el('select');
  ['Лонг', 'Шорт', 'Спот'].forEach((s) => side.append(new Option(s, s)));
  side.value = leg.side || 'Лонг';
  const entry = el('input', { type: 'number', step: 'any', value: leg.entryPrice ?? '' });
  const units = el('input', { type: 'number', step: 'any', value: leg.units ?? '' });
  const exit = el('input', { type: 'number', step: 'any', value: leg.exitPrice ?? '' });
  const fee = el('input', { type: 'number', step: 'any', value: leg.feeRub ?? '' });
  const box = el('div', { class: 'leg-box' }, [
    el('div', { class: 'leg-head' }, [txt(title)]),
    el('div', { class: 'grid' }, [
      field('Биржа', ex), field('Сделка', side),
      field('Цена вход', entry), field('Кол-во единиц', units),
      field('Цена выход', exit), field('Комиссия ₽', fee),
    ]),
  ]);
  return { box, read: () => ({
    exchange: ex.value, side: side.value,
    entryPrice: entry.value === '' ? null : Number(entry.value),
    units: Number(units.value),
    exitPrice: exit.value === '' ? null : Number(exit.value),
    feeRub: fee.value === '' ? 0 : Number(fee.value),
  }), inputs: [ex, side, entry, units, exit, fee] };
}

async function openForm(trade, onSaved) {
  const F = window.format;
  const cfg = await window.api.config.get();
  const t = trade || { openDate: '', closeDate: '', type: cfg.types[0], ticker: '',
    tag: cfg.tags[0], usdRub: '', payout: 0, adjustment: 0, comment: '',
    legs: [{}, {}] };

  const openDate = el('input', { type: 'date', value: t.openDate || '' });
  const closeDate = el('input', { type: 'date', value: t.closeDate || '' });
  const type = el('select'); cfg.types.forEach((x) => type.append(new Option(x, x))); type.value = t.type;
  const ticker = el('input', { type: 'text', value: t.ticker || '', placeholder: 'напр. ED' });
  const tag = el('select'); cfg.tags.forEach((x) => tag.append(new Option(x, x))); tag.value = t.tag;
  const usdRub = el('input', { type: 'number', step: 'any', value: t.usdRub ?? '' });
  const payout = el('input', { type: 'number', step: 'any', value: t.payout ?? 0 });
  const comment = el('textarea', {}, [txt(t.comment || '')]);

  const leg1 = legInputs('Нога 1', t.legs[0] || {}, cfg);
  const leg2 = legInputs('Нога 2', t.legs[1] || {}, cfg);
  const live = el('div', { class: 'live' });

  function draft() {
    return { usdRub: Number(usdRub.value) || 0, payout: Number(payout.value) || 0,
      adjustment: Number(t.adjustment) || 0, closeDate: closeDate.value,
      legs: [leg1.read(), leg2.read()] };
  }
  function item(k, v, cls) {
    return el('div', { class: 'item' }, [
      el('span', { class: 'k' }, [txt(k)]),
      el('span', { class: 'v' + (cls ? ' ' + cls : '') }, [txt(v)]),
    ]);
  }
  const sc = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  function recompute() {
    const d = draft();
    const c = window.calc.computeTrade(d);
    const closed = window.calc.isClosed(d);
    live.innerHTML = '';
    live.append(
      item('Вход спред', F.fmtPct(c.entrySpread) || '—'),
      item('Спред итог', F.fmtPct(c.spreadTotal) || '—'),
      item('PnL net', F.fmtUsd(c.pnlNet) || '—', sc(c.pnlNet)),
      item('Чистый профит', F.fmtRub(c.netProfitRub) || '—', sc(c.netProfitRub)),
      el('div', { class: 'status' }, [pill(closed ? 'Закрыта' : 'Открыта', closed ? 'closed' : 'open')]),
    );
  }
  [usdRub, payout, closeDate, ...leg1.inputs, ...leg2.inputs].forEach((i) =>
    i.addEventListener('input', recompute));

  const save = el('button', { class: 'btn primary' }, [txt('Сохранить')]);
  const cancel = el('button', { class: 'btn ghost' }, [txt('Отмена')]);

  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, [txt(trade ? `Сделка №${trade.num}` : 'Новая сделка')]),
      el('p', { class: 'hint' }, [txt('Оставьте «Цену выхода» и «Дату закрытия» пустыми — сделка сохранится как открытая.')]),
      el('div', { class: 'grid' }, [
        field('Дата открытия', openDate), field('Дата закрытия', closeDate),
        field('Тип', type), field('Тикер', ticker),
        field('Тег', tag), field('Курс USD/RUB', usdRub),
        field('Пейаут / перелив ₽', payout), field('Комментарий', comment),
      ]),
      leg1.box, leg2.box,
      live,
      el('div', { class: 'modal-buttons' }, [cancel, save]),
    ]),
  ]);

  cancel.onclick = () => backdrop.remove();
  save.onclick = async () => {
    if (!ticker.value.trim() || !leg1.read().units || !leg2.read().units) {
      alert('Укажите тикер и количество единиц по обеим ногам.');
      return;
    }
    const payload = {
      openDate: openDate.value, closeDate: closeDate.value, type: type.value,
      ticker: ticker.value.trim(), tag: tag.value, usdRub: Number(usdRub.value) || 0,
      payout: Number(payout.value) || 0, adjustment: Number(t.adjustment) || 0,
      comment: comment.value, legs: [leg1.read(), leg2.read()],
    };
    if (trade) await window.api.trades.update(trade.id, payload);
    else await window.api.trades.add(payload);
    backdrop.remove();
    onSaved();
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  document.body.appendChild(backdrop);
  recompute();
}

window.form = { openForm };
