// Appearance settings: font, color palette, UI scale. Applied live via CSS
// variables / data-theme, persisted through config. IIFE-scoped so its helpers
// don't leak into the shared script global scope.
(function () {
  const FONTS = {
    system: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    grotesk: 'Verdana, "Segoe UI", Geneva, sans-serif',
    rounded: '"Trebuchet MS", "Segoe UI", "Century Gothic", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
  };
  const FONT_OPTS = [
    ['system', 'Системный (Segoe UI)'],
    ['grotesk', 'Verdana — широкий'],
    ['rounded', 'Trebuchet — округлый'],
    ['serif', 'Georgia — с засечками'],
  ];
  const THEME_OPTS = [
    ['default', 'По умолчанию (синий)'],
    ['emerald', 'Изумруд'],
    ['ocean', 'Океан'],
    ['violet', 'Пурпур'],
    ['light', 'Светлая'],
  ];
  const SCALE_OPTS = [['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']];

  function el(tag, attrs = {}, kids = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
    kids.forEach((c) => e.append(c));
    return e;
  }
  const txt = (s) => document.createTextNode(s);

  function applySettings(s) {
    const root = document.documentElement;
    root.dataset.theme = s.theme || 'default';
    root.style.setProperty('--sans', FONTS[s.font] || FONTS.system);
    document.body.style.zoom = String(s.scale || 1);
  }

  async function openSettings() {
    const s = await window.api.config.getSettings();
    const mk = (opts, cur) => {
      const sel = el('select');
      opts.forEach(([v, l]) => sel.append(new Option(l, v)));
      sel.value = String(cur);
      return sel;
    };
    const fontSel = mk(FONT_OPTS, s.font);
    const themeSel = mk(THEME_OPTS, s.theme);
    const scaleSel = mk(SCALE_OPTS, s.scale);

    async function apply() {
      const patch = { font: fontSel.value, theme: themeSel.value, scale: Number(scaleSel.value) };
      applySettings(patch);
      await window.api.config.setSettings(patch);
    }
    [fontSel, themeSel, scaleSel].forEach((x) => x.addEventListener('change', apply));

    const field = (label, input) => el('label', {}, [txt(label), input]);
    const done = el('button', { class: 'btn primary' }, [txt('Готово')]);
    const backdrop = el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal settings-modal' }, [
        el('h2', {}, [txt('Настройки')]),
        el('p', { class: 'hint' }, [txt('Изменения применяются сразу и сохраняются между запусками.')]),
        el('div', { class: 'grid' }, [
          field('Шрифт интерфейса', fontSel),
          field('Цветовая палитра', themeSel),
          field('Масштаб интерфейса', scaleSel),
        ]),
        el('div', { class: 'modal-buttons' }, [done]),
      ]),
    ]);
    done.onclick = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  window.settings = { applySettings, openSettings };
})();
