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

    // --- Синхронизация: одна ссылка на облако ---
    const syncUrl = el('input', { type: 'text', class: 'sync-url',
      placeholder: 'https://script.google.com/macros/s/…/exec' });
    const syncInfo = el('div', { class: 'sync-info' }, [txt('')]);
    const saveLinkBtn = el('button', { class: 'btn primary' }, [txt('Подключить')]);
    const offBtn = el('button', { class: 'btn ghost' }, [txt('Отключить')]);
    const pushBtn = el('button', { class: 'btn ghost' }, [txt('Выгрузить сейчас')]);
    const pullBtn = el('button', { class: 'btn ghost' }, [txt('Загрузить из облака')]);
    const howBtn = el('button', { class: 'btn ghost' }, [txt('Как получить ссылку')]);

    function showSync(state) {
      if (!state) return;
      if (document.activeElement !== syncUrl) syncUrl.value = state.url || '';
      const bits = [];
      if (state.error) bits.push(`ошибка: ${state.error}`);
      else if (state.note) bits.push(state.note);
      if (state.lastPushAt) bits.push(`выгружено ${new Date(state.lastPushAt).toLocaleString('ru-RU')}`);
      if (state.lastPullAt) bits.push(`загружено ${new Date(state.lastPullAt).toLocaleString('ru-RU')}`);
      syncInfo.className = 'sync-info' + (state.error ? ' err' : '');
      syncInfo.textContent = bits.join(' · ') || (state.enabled ? 'обмена ещё не было' : 'облако не подключено');
      [offBtn, pushBtn, pullBtn].forEach((b) => { b.disabled = !state.enabled; });
      pushBtn.disabled = !state.canWrite;
    }
    saveLinkBtn.onclick = async () => {
      syncInfo.textContent = 'проверяю ссылку…';
      showSync(await window.api.sync.setLink(syncUrl.value));
    };
    offBtn.onclick = async () => showSync(await window.api.sync.disable());
    pushBtn.onclick = async () => {
      syncInfo.textContent = 'выгружаю…';
      showSync(await window.api.sync.push());
    };
    pullBtn.onclick = async () => {
      if (!confirm('Данные из облака полностью заменят текущие сделки и балансы. Прежние уйдут в резервную копию. Продолжить?')) return;
      syncInfo.textContent = 'загружаю…';
      showSync(await window.api.sync.pull());
      if (window.diary) window.diary.refresh();
    };
    howBtn.onclick = async () => {
      const code = await window.api.sync.scriptCode();
      const box = el('div', { class: 'modal how-modal' }, [
        el('h2', {}, [txt('Ссылка на облако за две минуты')]),
        el('ol', { class: 'how-steps' }, [
          el('li', {}, [txt('Откройте script.google.com и создайте новый проект')]),
          el('li', {}, [txt('Замените весь код на этот и сохраните:')]),
        ]),
        el('pre', { class: 'how-code' }, [txt(code)]),
        el('ol', { class: 'how-steps', start: '3' }, [
          el('li', {}, [txt('Развернуть → Новое развёртывание → тип «Веб-приложение»')]),
          el('li', {}, [txt('Выполнять от имени: я. Доступ: все (это нужно, чтобы приложение могло писать)')]),
          el('li', {}, [txt('Скопируйте выданный URL вида …/macros/s/…/exec и вставьте его сюда')]),
        ]),
        el('p', { class: 'hint' }, [txt('База ляжет файлом diaryhunt-db.json на ваш Google Диск. На втором устройстве вставьте ту же ссылку.')]),
        el('div', { class: 'modal-buttons' }, []),
      ]);
      const copy = el('button', { class: 'btn ghost' }, [txt('Скопировать код')]);
      const close = el('button', { class: 'btn primary' }, [txt('Понятно')]);
      copy.onclick = () => { navigator.clipboard.writeText(code); copy.textContent = 'Скопировано'; };
      box.querySelector('.modal-buttons').append(copy, close);
      const layer = el('div', { class: 'modal-backdrop' }, [box]);
      close.onclick = () => layer.remove();
      layer.addEventListener('click', (e) => { if (e.target === layer) layer.remove(); });
      document.body.appendChild(layer);
    };
    window.api.sync.status().then(showSync);
    window.api.sync.onState(showSync);

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
        el('div', { class: 'section-head' }, [txt('Синхронизация с облаком')]),
        el('p', { class: 'hint' }, [txt('Вставьте ссылку веб-приложения Google Apps Script — база будет храниться файлом на вашем Google Диске: выгружаться после каждого изменения и подтягиваться при запуске. Та же ссылка на другом устройстве даёт те же данные.')]),
        syncUrl,
        el('div', { class: 'data-row' }, [saveLinkBtn, howBtn, pushBtn, pullBtn, offBtn]),
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
