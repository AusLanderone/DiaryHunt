function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
  children.forEach((c) => e.append(c));
  return e;
}
const txt = (s) => document.createTextNode(s);

function field(label, input, cls) {
  return el('label', cls ? { class: cls } : {}, [txt(label), input]);
}

function pill(text, kind) {
  const s = el('span', { class: 'pill ' + kind });
  s.textContent = text;
  return s;
}

const rub0 = (n) => (n === null || n === undefined ? '—'
  : Math.round(n).toLocaleString('ru-RU') + ' ₽');

function legInputs(title, leg, defaultEx, index, ctx) {
  // editable exchange: type a new one or pick from the shared datalist
  const ex = el('input', { type: 'text', list: 'dh-exlist', value: leg.exchange || defaultEx || '', placeholder: 'биржа ▾', autocomplete: 'off' });
  const side = el('select');
  ['Лонг', 'Шорт', 'Спот'].forEach((s) => side.append(new Option(s, s)));
  side.value = leg.side || 'Лонг';
  const entry = el('input', { type: 'number', step: 'any', value: leg.entryPrice ?? '' });
  const units = el('input', { type: 'number', step: 'any', value: leg.units ?? '' });
  const exit = el('input', { type: 'number', step: 'any', value: leg.exitPrice ?? '' });
  const fee = el('input', { type: 'number', step: 'any', value: leg.feeRub ?? '' });
  // role in the spread expression: numerator or denominator
  const role = el('select', { class: 'leg-role' });
  [['mul', '× числитель'], ['div', '÷ знаменатель']].forEach(([v, l]) => role.append(new Option(l, v)));
  role.value = window.calc.legRole(leg, index);
  // price currency: dollars by default, because most instruments here quote in
  // dollars even on MOEX (ED, SILV). Rouble-quoted ones (SI, CR) are switched
  // by hand — deriving this from the exchange silently broke dollar MOEX legs.
  const ccy = el('select', { class: 'leg-ccy' });
  [['USD', 'Цена в $'], ['RUB', 'Цена в ₽']].forEach(([v, l]) => ccy.append(new Option(l, v)));
  ccy.value = leg.priceCcy === 'RUB' ? 'RUB' : 'USD';
  ccy.title = 'В какой валюте котируется цена этой ноги: $ (ED, SILV, USDCNH) или ₽ (SI, CR)';
  // swap sits with the fee, but in the leg's own currency: ₽ on MOEX, $ elsewhere
  const swap = el('input', { type: 'number', step: 'any', value: leg.swap ?? leg.swapRub ?? '' });
  const swapLabel = el('label', {}, [txt('Своп ₽'), swap]);
  const syncSwapCurrency = () => {
    const rub = window.calc.isRubLeg({ exchange: ex.value });
    swapLabel.firstChild.nodeValue = rub ? 'Своп ₽' : 'Своп $';
    swap.title = rub ? 'Своп по ноге, в рублях (MOEX)' : 'Своп по ноге, в долларах — пересчитается по курсу сделки';
  };
  // How many roubles one point of price pays on this leg. A dollar leg on a
  // dollar venue is paid the dollar move at the trade's rate, and the field
  // stays empty. It exists for the leg that is not: a MOEX future quoted in
  // dollars credits variation margin in ROUBLES by the contract's price step
  // value — which is its own number, not the USD/RUB of the day.
  const rateRub = el('input', { type: 'number', step: 'any', value: leg.rateRub ?? '' });
  rateRub.title = 'Сколько рублей приносит 1 пункт цены на этой ноге. Пусто = по курсу сделки';
  const pvBtn = el('button', { type: 'button', class: 'btn mini' }, [txt('↻ MOEX')]);
  pvBtn.title = 'Подтянуть с MOEX по тикеру сделки: стоимость шага цены ÷ шаг цены';
  const rateField = el('label', {}, [
    txt('₽ за пункт'),
    el('div', { class: 'field-row' }, [rateRub, pvBtn]),
  ]);

  // The broker's own figure for this leg. Entered, it IS the leg's money and
  // the model becomes a check against it rather than the source of truth.
  const fact = el('input', { type: 'number', step: 'any', value: leg.pnlFactRub ?? '' });
  fact.title = 'Фактический PnL ноги в рублях из отчёта брокера. Заполнено — считается по нему';
  const calBtn = el('button', { type: 'button', class: 'btn mini' }, [txt('↧ в ₽/пункт')]);
  calBtn.title = 'Подобрать ₽ за пункт из факта: факт ÷ (движение цены × количество)';
  const factField = el('label', {}, [
    txt('Факт PnL ₽'),
    el('div', { class: 'field-row' }, [fact, calBtn]),
  ]);

  const srcNote = el('div', { class: 'leg-note' });   // where a fetched number came from
  const note = el('div', { class: 'leg-note' });      // what the leg currently computes

  const syncRatePlaceholder = () => {
    rateRub.placeholder = ccy.value === 'RUB' ? '1 ₽ за пункт' : 'по курсу сделки';
  };
  ccy.addEventListener('change', syncRatePlaceholder);
  syncRatePlaceholder();

  ex.addEventListener('input', syncSwapCurrency);
  ex.addEventListener('input', () => ctx && ctx.prefill && ctx.prefill());
  syncSwapCurrency();
  const box = el('div', { class: 'leg-box' }, [
    el('div', { class: 'leg-head' }, [txt(title)]),
    el('div', { class: 'grid' }, [
      field('Биржа', ex), field('Сделка', side),
      field('Роль в спреде', role), field('Валюта цены', ccy),
      field('Цена вход', entry), field('Кол-во единиц', units),
      field('Цена выход', exit), field('Комиссия ₽', fee),
      swapLabel, rateField, factField,
    ]),
    srcNote, note,
  ]);

  const read = () => ({
    exchange: ex.value.trim(), side: side.value,
    entryPrice: entry.value === '' ? null : Number(entry.value),
    units: Number(units.value),
    exitPrice: exit.value === '' ? null : Number(exit.value),
    feeRub: fee.value === '' ? 0 : Number(fee.value),
    swap: swap.value === '' ? 0 : Number(swap.value),
    role: role.value,
    priceCcy: ccy.value,
    rateRub: rateRub.value === '' ? null : Number(rateRub.value),
    pnlFactRub: fact.value === '' ? null : Number(fact.value),
  });

  const applyRate = (value) => {
    rateRub.value = Math.round(Number(value) * 1e6) / 1e6;
    rateRub.dispatchEvent(new Event('input', { bubbles: true }));
  };

  pvBtn.addEventListener('click', async () => {
    const code = ctx && ctx.ticker ? ctx.ticker() : '';
    if (!code) {
      srcNote.className = 'leg-note err';
      srcNote.textContent = 'сначала впишите тикер сделки';
      return;
    }
    pvBtn.disabled = true;
    srcNote.className = 'leg-note';
    srcNote.textContent = 'запрашиваю MOEX…';
    try {
      const r = await window.api.rates.pointValue(code);
      if (!r.ok) {
        srcNote.className = 'leg-note err';
        srcNote.textContent = r.error || 'MOEX не ответил';
        return;
      }
      applyRate(r.pointValue);
      srcNote.textContent = `${r.secid}: шаг ${r.minStep} = ${r.stepPrice} ₽`
        + (r.expired ? ' · контракт уже истёк' : '');
    } catch (err) {
      srcNote.className = 'leg-note err';
      srcNote.textContent = String(err.message || err);
    } finally {
      pvBtn.disabled = false;
    }
  });

  calBtn.addEventListener('click', () => {
    const implied = window.calc.impliedLegRate(read(), fact.value === '' ? null : Number(fact.value));
    if (implied === null) {
      srcNote.className = 'leg-note err';
      srcNote.textContent = 'нужны обе цены, количество и фактическая цифра';
      return;
    }
    applyRate(implied);
    srcNote.className = 'leg-note';
    srcNote.textContent = 'подобрано из факта';
  });

  // The line under the leg says what it currently earns and, when a broker
  // figure is in, how far the model stands from it.
  const setNote = (lc) => {
    note.className = 'leg-note';
    if (!lc) { note.textContent = ''; return; }
    const parts = [];
    if (lc.rateRub) parts.push(`1 пункт = ${(Math.round(lc.rateRub * 1e4) / 1e4).toLocaleString('ru-RU')} ₽`);
    if (lc.grossRub !== null && lc.grossRub !== undefined) parts.push(`нога ${rub0(lc.grossRub)}`);
    if (lc.factRub !== null && lc.factRub !== undefined && lc.grossCalcRub !== null) {
      parts.push(`расчёт ${rub0(lc.grossCalcRub)}`);
      if (lc.factDeviation !== null && lc.factDeviation !== undefined) {
        const d = lc.factDeviation * 100;
        parts.push(`Δ ${d > 0 ? '+' : ''}${d.toFixed(1).replace('.', ',')} %`);
        if (Math.abs(d) >= 1) note.className = 'leg-note warn';
      }
    }
    note.textContent = parts.join(' · ');
  };

  // A calibrated instrument fills an empty field on a MOEX leg; a number already
  // typed is never overwritten.
  const prefillRate = (value) => {
    if (rateRub.value !== '' || !window.calc.isRubLeg({ exchange: ex.value })) return false;
    rateRub.value = value;
    return true;
  };

  return { box, read, setNote, prefillRate,
    inputs: [ex, side, role, ccy, entry, units, exit, fee, swap, rateRub, fact] };
}

async function openForm(trade, onSaved) {
  const F = window.format;
  const cfg = await window.api.config.get();
  const all = await window.api.trades.list();
  const last = all.length ? [...all].sort((a, b) => b.num - a.num)[0] : null;
  const today = new Date().toISOString().slice(0, 10);

  // New trades auto-prefill the auxiliary fields (editable): date = today,
  // USD/RUB = last trade's rate, payout computed automatically.
  const t = trade || {
    openDate: today, closeDate: '', type: cfg.types[0], ticker: '', tag: '',
    usdRub: last ? last.usdRub : '', payout: 0, adjustment: 0, comment: '',
    payoutAuto: true, payoutRate: 0.06, legs: [{}, {}],
  };

  const openDate = el('input', { type: 'date', value: t.openDate || '' });
  const closeDate = el('input', { type: 'date', value: t.closeDate || '' });
  // Every editable dropdown offers the dictionary PLUS whatever the diary already
  // holds, minus what was removed in the settings — src/dicts.js is the single
  // place that decides this, so the form and the settings screen never disagree.
  const known = (kind) => window.dicts.options(kind, cfg, all);
  const combo = (id, list, value) => {
    const dl = el('datalist', { id }, list.map((x) => new Option(x, x)));
    const input = el('input', { type: 'text', list: id, value: value || '',
      placeholder: 'впиши свой или выбери ▾', autocomplete: 'off' });
    return { dl, input };
  };

  const typeCombo = combo('dh-typelist', known('types'), t.type);
  const typeList = typeCombo.dl, type = typeCombo.input;
  const tickerCombo = combo('dh-tickerlist', known('tickers'), t.ticker);
  const tickerList = tickerCombo.dl, ticker = tickerCombo.input;
  const tagCombo = combo('dh-taglist', known('tags'), t.tag);
  const tagList = tagCombo.dl, tag = tagCombo.input;
  const exList = el('datalist', { id: 'dh-exlist' },
    known('exchanges').map((x) => new Option(x, x)));
  const usdRub = el('input', { type: 'number', step: 'any', value: t.usdRub ?? '' });
  // "↻ курс" fills the field from MOEX (CBR as fallback); typing over it still wins
  const rateBtn = el('button', { type: 'button', class: 'btn mini' }, [txt('↻ курс')]);
  rateBtn.title = 'Подтянуть актуальный курс: MOEX USDRUBF, при недоступности — ЦБ РФ';
  const rateNote = el('span', { class: 'field-note' });
  const usdRubField = el('label', {}, [
    txt('Курс USD/RUB'),
    el('div', { class: 'field-row' }, [usdRub, rateBtn]),
    rateNote,
  ]);
  const rate = el('input', { type: 'number', step: 'any', value: t.payoutRate != null ? t.payoutRate * 100 : 6 });
  const comment = el('textarea', {}, [txt(t.comment || '')]);

  // payout with an "авто" toggle (computed estimate ↔ manual entry)
  const payout = el('input', { type: 'number', step: 'any', value: t.payout ?? 0 });
  const payoutAuto = el('input', { type: 'checkbox' });
  payoutAuto.checked = trade ? !!t.payoutAuto : true; // existing trades default to manual
  const autoToggle = el('label', { class: 'auto-toggle' }, [payoutAuto, txt('авто')]);
  const payoutField = el('label', {}, [
    txt('Payout / перелив ₽'),
    el('div', { class: 'field-row' }, [payout, autoToggle]),
  ]);

  // The free-form fix to the net profit: whatever neither the fees, the payout
  // nor the swap covers — a broker correction, a rounding difference. It has
  // always counted in netProfitRub and shown in the trade detail; until now the
  // form only carried the old value through, with no way to enter one.
  const adjustment = el('input', { type: 'number', step: 'any', value: t.adjustment ?? 0 });
  adjustment.title = 'Ручная поправка к чистому профиту: то, что не попало ни в комиссии, ни в payout, ни в своп';

  // legs live in a list: at least two, no upper bound
  const formulaLine = el('div', { class: 'formula-line' });
  const legsWrap = el('div', { class: 'legs' });
  let legFields = [];

  const defaultExchange = (i) => cfg.exchanges[i] || cfg.exchanges[0] || '';
  const legCtx = { ticker: () => ticker.value.trim(), prefill: () => prefillPointValues() };

  // An instrument calibrated once opens its next trade already calibrated.
  function prefillPointValues() {
    const pv = Number((cfg.pointValues || {})[ticker.value.trim().toUpperCase()]);
    if (!(pv > 0)) return;
    const filled = legFields.map((f) => f.prefillRate(pv));
    if (filled.some(Boolean)) recompute();
  }

  function renderLegs(source) {
    legsWrap.innerHTML = '';
    legFields = source.map((leg, i) => legInputs(`Нога ${i + 1}`, leg, defaultExchange(i), i, legCtx));
    legFields.forEach((f, i) => {
      if (i >= 2) {
        const del = el('button', { type: 'button', class: 'btn icon leg-remove' }, [txt('✕')]);
        del.title = 'Убрать ногу';
        del.onclick = () => {
          renderLegs(legFields.map((x) => x.read()).filter((_, j) => j !== i));
          recompute();
        };
        f.box.querySelector('.leg-head').appendChild(del);
      }
      legsWrap.appendChild(f.box);
      f.inputs.forEach((inp) => inp.addEventListener('input', recompute));
      f.inputs.forEach((inp) => inp.addEventListener('change', recompute));
    });
    const add = el('button', { type: 'button', class: 'btn ghost add-leg' }, [txt('+ Добавить ногу')]);
    add.onclick = () => {
      const next = legFields.map((x) => x.read());
      next.push({ exchange: defaultExchange(next.length), role: 'mul' });
      renderLegs(next);
      recompute();
    };
    legsWrap.appendChild(add);
  }

  const live = el('div', { class: 'live' });

  const currentRate = () => (Number(rate.value) || 0) / 100;
  function draft() {
    return { usdRub: Number(usdRub.value) || 0, payout: Number(payout.value) || 0,
      adjustment: Number(adjustment.value) || 0, closeDate: closeDate.value,
      legs: legFields.map((f) => f.read()) };
  }
  function item(k, v, cls) {
    return el('div', { class: 'item' }, [
      el('span', { class: 'k' }, [txt(k)]),
      el('span', { class: 'v' + (cls ? ' ' + cls : '') }, [txt(v)]),
    ]);
  }
  const sc = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  function recompute() {
    if (payoutAuto.checked) {
      const est = window.calc.estimatePayout(draft(), currentRate());
      payout.value = est == null ? '' : Math.round(est * 100) / 100;
    }
    payout.readOnly = payoutAuto.checked;
    formulaLine.textContent = window.calc.spreadFormula(draft());
    const c = window.calc.computeTrade(draft());
    const closed = window.calc.isClosed(draft());
    legFields.forEach((f, i) => f.setNote(c.legs[i]));
    live.innerHTML = '';
    // legs can be quoted in different currencies, so the position total is roubles
    const rub0 = (n) => (n === null || n === undefined ? '—'
      : Math.round(n).toLocaleString('ru-RU') + ' ₽');
    live.append(
      item('Вход спред', F.fmtPct(c.entrySpread) || '—'),
      item('Спред выход', F.fmtPct(c.exitSpread) || '—'),
      item('Спред собран', F.fmtPct(c.spreadCollected) || '—'),
      item('Позиция на ногу', `${rub0(c.positionStartAvgRub)} → ${rub0(c.positionEndAvgRub)}`),
      item('PnL net', F.fmtUsd(c.pnlNet) || '—', sc(c.pnlNet)),
      item('Своп', F.fmtRub(c.swapTotalRub), sc(c.swapTotalRub)),
      item('Чистый профит', F.fmtRub(c.netProfitRub) || '—', sc(c.netProfitRub)),
      el('div', { class: 'status' }, [pill(closed ? 'Закрыта' : 'Открыта', closed ? 'closed' : 'open')]),
    );
  }
  [usdRub, rate, payout, adjustment, closeDate].forEach((i) => i.addEventListener('input', recompute));
  ticker.addEventListener('input', prefillPointValues);
  renderLegs(t.legs.length ? t.legs : [{}, {}]);
  payoutAuto.addEventListener('change', recompute);

  // fetching only prefills the input; the field stays a plain editable number,
  // and typing in it clears the source note so it never claims a stale origin
  let applyingRate = false;
  usdRub.addEventListener('input', () => { if (!applyingRate) rateNote.textContent = ''; });
  rateBtn.addEventListener('click', async () => {
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
      applyingRate = true;
      usdRub.value = r.rate;
      usdRub.dispatchEvent(new Event('input', { bubbles: true }));
      applyingRate = false;
      rateNote.textContent = `${r.source}${r.time ? ', ' + r.time : r.date ? ', ' + r.date : ''}`;
    } catch (err) {
      rateNote.className = 'field-note err';
      rateNote.textContent = String(err.message || err);
    } finally {
      rateBtn.disabled = false;
    }
  });

  const save = el('button', { class: 'btn primary' }, [txt('Сохранить')]);
  const cancel = el('button', { class: 'btn ghost' }, [txt('Отмена')]);

  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, [txt(trade ? `Сделка №${trade.num}` : 'Новая сделка')]),
      el('p', { class: 'hint' }, [txt('Курс, дата и payout подставляются автоматически, «↻ курс» тянет актуальный с рынка — любое поле можно перебить вручную. Пустые «Цена выхода» и «Дата закрытия» = открытая сделка. У ноги MOEX деньги считаются в рублях: «₽ за пункт» — сколько даёт один пункт цены, «Факт PnL ₽» — цифра из отчёта, которая перебивает расчёт.')]),
      el('div', { class: 'grid' }, [
        field('Дата открытия', openDate), field('Дата закрытия', closeDate),
        el('label', {}, [txt('Тип'), type, typeList]), el('label', {}, [txt('Тикер'), ticker, tickerList]),
        el('label', {}, [txt('Тег'), tag, tagList]), usdRubField,
        field('Ставка payout, %', rate), payoutField,
        field('Правка ₽', adjustment),
        field('Комментарий', comment, 'full'),
      ]),
      exList,
      formulaLine,
      legsWrap,
      live,
      el('div', { class: 'modal-buttons' }, [cancel, save]),
    ]),
  ]);

  cancel.onclick = () => backdrop.remove();
  save.onclick = async () => {
    const legValues = legFields.map((f) => f.read());
    if (!ticker.value.trim() || legValues.length < 2 || legValues.some((l) => !l.units)) {
      alert('Укажите тикер и количество единиц по каждой ноге (минимум две ноги).');
      return;
    }
    // persist any newly-typed dictionary values so they appear next time
    const tagValue = tag.value.trim();
    const typeValue = type.value.trim();
    const tickerValue = ticker.value.trim();
    if (tickerValue && !(cfg.tickers || []).includes(tickerValue)) await window.api.config.addItem('tickers', tickerValue);
    if (tagValue && !cfg.tags.includes(tagValue)) await window.api.config.addItem('tags', tagValue);
    if (typeValue && !cfg.types.includes(typeValue)) await window.api.config.addItem('types', typeValue);
    // the rouble value of a point belongs to the instrument, not to this trade
    const calibrated = legValues.find((l) => window.calc.isRubLeg(l) && Number(l.rateRub) > 0);
    if (tickerValue && calibrated) await window.api.config.setPointValue(tickerValue, calibrated.rateRub);
    const seenEx = new Set(cfg.exchanges);
    for (const l of legValues) {
      if (l.exchange && !seenEx.has(l.exchange)) { await window.api.config.addItem('exchanges', l.exchange); seenEx.add(l.exchange); }
    }
    const payload = {
      openDate: openDate.value, closeDate: closeDate.value, type: typeValue,
      ticker: tickerValue, tag: tagValue, usdRub: Number(usdRub.value) || 0,
      payout: Number(payout.value) || 0, adjustment: Number(adjustment.value) || 0,
      payoutAuto: payoutAuto.checked, payoutRate: currentRate(),
      comment: comment.value, legs: legValues,
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
