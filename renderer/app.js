const view = document.getElementById('view');
let trades = [];

async function refresh() {
  trades = await window.api.trades.list();
  showJournal();
}
window.diary = { refresh };

function showJournal() {
  setActive('tab-journal');
  window.journal.renderJournal(view, trades, {
    onEdit: (t) => window.form.openForm(t, refresh),
    onDelete: async (t) => {
      if (confirm(`Удалить сделку №${t.num}?`)) { await window.api.trades.remove(t.id); refresh(); }
    },
  });
}

function showStats() {
  setActive('tab-stats');
  window.stats.renderStats(view, trades);
}

async function showBalances() {
  setActive('tab-balances');
  const [snapshots, flows] = await Promise.all([
    window.api.balances.list(), window.api.flows.list(),
  ]);
  window.balancesView.renderBalances(view, snapshots, trades, flows);
}

function setActive(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('tab-journal').onclick = showJournal;
document.getElementById('tab-stats').onclick = showStats;
document.getElementById('tab-balances').onclick = showBalances;
document.getElementById('btn-add').onclick = () => window.form.openForm(null, refresh);
document.getElementById('btn-settings').onclick = () => window.settings.openSettings();

// ---------- cloud sync indicator ----------

const badge = document.getElementById('sync-badge');
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

const PHASES = {
  off: { cls: 'off', text: 'Облако не настроено' },
  idle: { cls: 'ok', text: 'Синхронизировано' },
  pushing: { cls: 'busy', text: 'Выгружаю…' },
  pushed: { cls: 'ok', text: 'Выгружено' },
  pulled: { cls: 'ok', text: 'Обновлено из облака' },
  error: { cls: 'err', text: 'Ошибка синхронизации' },
};

function renderSync(state) {
  if (!state) return;
  const phase = PHASES[state.phase] || PHASES.idle;
  badge.className = 'sync-badge ' + phase.cls;
  const at = state.at || state.lastPushAt;
  badge.querySelector('.txt').textContent =
    state.phase === 'off' ? phase.text : `${phase.text}${at ? ' ' + hhmm(at) : ''}`;
  const lines = [];
  if (state.url) lines.push(`Облако: ${state.url}`);
  if (state.note && !state.error) lines.push(state.note);
  if (state.lastPushAt) lines.push(`Выгружено: ${new Date(state.lastPushAt).toLocaleString('ru-RU')}`);
  if (state.lastPullAt) lines.push(`Загружено: ${new Date(state.lastPullAt).toLocaleString('ru-RU')}`);
  if (state.device) lines.push(`Последняя версия с устройства: ${state.device}`);
  if (state.error) lines.push(`Ошибка: ${state.error}`);
  if (!state.enabled) lines.push('Нажмите, чтобы вставить ссылку на облако');
  badge.title = lines.join('\n');
  // a pull replaces the local data, so what is on screen is stale
  if (state.phase === 'pulled') refresh();
}

badge.onclick = () => window.settings.openSettings();
window.api.sync.onState(renderSync);
window.api.sync.status().then(renderSync);

async function applySavedSettings() {
  try { window.settings.applySettings(await window.api.config.getSettings()); } catch { /* defaults */ }
}

applySavedSettings();
refresh();
