// A value picker: a chip that unfolds into a list of checkboxes with
// «Оставить / Убрать». The journal filters its rows with it and the stats tab
// narrows its widgets — one control, one implementation, so the two never drift
// apart in look or behaviour.
// IIFE-scoped like the rest of the renderer files.
(function () {

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const specOf = (spec) => (spec && typeof spec === 'object' && Array.isArray(spec.values)
  ? spec : { mode: 'include', values: [] });

// «Теги», «Теги: Схождение», «Теги: 2», «Теги: кроме 2» — the state reads off
// the button without opening it
function buttonLabel(name, spec, blank) {
  const n = spec.values.length;
  if (!n) return name;
  const what = n === 1 ? (spec.values[0] || blank) : String(n);
  return `${name}: ${spec.mode === 'exclude' ? 'кроме ' : ''}${what}`;
}

function panel(opts, spec) {
  const box = el('div', 'picker-panel');
  box.onclick = (e) => e.stopPropagation();

  const modes = el('div', 'picker-modes');
  [['include', 'Оставить'], ['exclude', 'Убрать']].forEach(([mode, label]) => {
    const b = el('button', 'chip mini' + (spec.mode === mode ? ' active' : ''), label);
    b.title = mode === 'include' ? 'Показывать только отмеченные' : 'Прятать отмеченные';
    b.onclick = () => opts.onChange({ ...spec, mode });
    modes.append(b);
  });
  box.append(modes);

  const list = el('div', 'picker-list');
  const rows = opts.rows || [];
  if (!rows.length) list.append(el('div', 'picker-empty', 'нет значений'));
  rows.forEach(([value, count]) => {
    const row = el('label', 'picker-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = spec.values.includes(value);
    cb.onchange = () => opts.onChange({
      ...spec,
      values: cb.checked ? [...spec.values, value] : spec.values.filter((v) => v !== value),
    });
    row.append(cb, el('span', 'pv' + (value ? '' : ' blank'), value || opts.blank),
      el('span', 'pc', String(count)));
    list.append(row);
  });
  box.append(list);

  const reset = el('button', 'btn ghost mini', 'Сбросить');
  reset.disabled = !spec.values.length;
  reset.onclick = () => opts.onChange({ mode: 'include', values: [] });
  const foot = el('div', 'picker-foot');
  foot.append(reset);
  box.append(foot);
  return box;
}

// opts: { name, blank, rows: [[value, count]], spec, open, onOpen(bool),
//         onChange(spec), title }
function valuePicker(opts) {
  const spec = specOf(opts.spec);
  const box = el('div', 'picker');
  const btn = el('button', 'chip picker-btn' + (spec.values.length ? ' active' : ''),
    buttonLabel(opts.name, spec, opts.blank));
  btn.title = opts.title || `${opts.name}: оставить только выбранные или убрать их`;
  btn.onclick = (e) => {
    e.stopPropagation();
    opts.onOpen(!opts.open);
  };
  box.append(btn);
  if (opts.open) box.append(panel(opts, spec));
  return box;
}

window.pickers = { valuePicker, buttonLabel };
})();
