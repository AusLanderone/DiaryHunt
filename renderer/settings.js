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
    document.body.style.zoom = ''; // clear any legacy CSS zoom
    if (window.api && window.api.setZoom) window.api.setZoom(s.scale || 1);
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

    // --- Данные: backup / restore ---
    const expBtn = el('button', { class: 'btn ghost' }, [txt('Экспорт всех данных (.json)')]);
    const impBtn = el('button', { class: 'btn ghost' }, [txt('Импорт данных')]);
    const csvBtn = el('button', { class: 'btn ghost', id: 'btn-export-csv' }, [txt('Экспорт в CSV')]);
    csvBtn.onclick = async () => {
      const r = await window.api.exportCsv();
      if (r.saved) alert('Сохранено: ' + r.path);
    };
    expBtn.onclick = async () => {
      const r = await window.api.db.export();
      if (r.saved) alert(`Сохранено: ${r.summary}\n${r.path}`);
    };
    impBtn.onclick = async () => {
      if (!confirm('Импорт заменит текущие сделки, балансы и движения средств данными из файла. Прежние данные уйдут в резервную копию. Продолжить?')) return;
      const r = await window.api.db.import();
      if (r.imported) {
        alert(`Восстановлено: ${r.summary}`);
        if (window.diary) window.diary.refresh();
        backdrop.remove();
      } else if (r.error) {
        alert('Ошибка импорта: ' + r.error);
      }
    };

    // --- Синхронизация: папка облачного клиента ---
    const syncPath = el('div', { class: 'sync-path' }, [txt('—')]);
    const syncInfo = el('div', { class: 'sync-info' }, [txt('')]);
    const chooseBtn = el('button', { class: 'btn ghost' }, [txt('Выбрать папку')]);
    const offBtn = el('button', { class: 'btn ghost' }, [txt('Отключить')]);
    const pushBtn = el('button', { class: 'btn ghost' }, [txt('Выгрузить сейчас')]);
    const pullBtn = el('button', { class: 'btn ghost' }, [txt('Загрузить из облака')]);

    function showSync(state) {
      if (!state) return;
      syncPath.textContent = state.dir || 'папка не выбрана';
      const bits = [];
      if (state.lastPushAt) bits.push(`выгружено ${new Date(state.lastPushAt).toLocaleString('ru-RU')}`);
      if (state.lastPullAt) bits.push(`загружено ${new Date(state.lastPullAt).toLocaleString('ru-RU')}`);
      if (state.error) bits.push(`ошибка: ${state.error}`);
      syncInfo.textContent = bits.join(' · ') || 'обмена ещё не было';
      [offBtn, pushBtn, pullBtn].forEach((b) => { b.disabled = !state.enabled; });
    }
    chooseBtn.onclick = async () => showSync(await window.api.sync.choose());
    offBtn.onclick = async () => showSync(await window.api.sync.disable());
    pushBtn.onclick = async () => showSync(await window.api.sync.push());
    pullBtn.onclick = async () => {
      if (!confirm('Данные из облака полностью заменят текущие сделки и балансы. Прежние уйдут в резервную копию. Продолжить?')) return;
      showSync(await window.api.sync.pull());
      if (window.diary) window.diary.refresh();
    };
    window.api.sync.status().then(showSync);

    const backdrop = el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal settings-modal' }, [
        el('h2', {}, [txt('Настройки')]),
        el('p', { class: 'hint' }, [txt('Изменения применяются сразу и сохраняются между запусками.')]),
        el('div', { class: 'grid' }, [
          field('Шрифт интерфейса', fontSel),
          field('Цветовая палитра', themeSel),
          field('Масштаб интерфейса', scaleSel),
        ]),
        el('div', { class: 'section-head' }, [txt('Данные')]),
        el('p', { class: 'hint' }, [txt('Полный бэкап в JSON: сделки, отметки баланса, движения средств, справочники и настройки — и восстановление из него. CSV — плоская выгрузка сделок для таблиц.')]),
        el('div', { class: 'data-row' }, [expBtn, impBtn, csvBtn]),
        el('div', { class: 'section-head' }, [txt('Синхронизация')]),
        el('p', { class: 'hint' }, [txt('Укажите папку внутри Google Диска для компьютера, Яндекс.Диска, OneDrive или Dropbox. Приложение пишет туда один файл после каждого изменения и читает его при запуске — облако само разносит данные между устройствами.')]),
        syncPath,
        el('div', { class: 'data-row' }, [chooseBtn, offBtn, pushBtn, pullBtn]),
        syncInfo,
        el('div', { class: 'modal-buttons' }, [done]),
      ]),
    ]);
    done.onclick = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  }

  window.settings = { applySettings, openSettings };
})();
