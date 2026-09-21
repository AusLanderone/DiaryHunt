const view = document.getElementById('view');
let trades = [];

async function refresh() {
  trades = await window.api.trades.list();
  showJournal();
  // A restore from a backup or a pull from the cloud replaces the trades
  // wholesale, computed figures and all. Whatever came back short is worked out
  // again here, so the diary is not left waiting for the next restart.
  catchUpClearing();
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
  try {
    // stashed whole: settings.js applies the look, stats.js reads the widget bands
    window.appSettings = await window.api.config.getSettings();
    window.settings.applySettings(window.appSettings);
  } catch { /* defaults */ }
}

// ---------- the variation margin catches itself up ----------
//
// Nothing to press: on startup the diary looks for closed MOEX legs whose
// roubles it has not worked out yet — restored from a backup, entered offline,
// or closed before MOEX published the session — and computes them. What fails
// stays in the queue for the next start.
const clearingBadge = document.getElementById('clearing-badge');

function showClearing(text, cls) {
  clearingBadge.hidden = !text;
  clearingBadge.className = 'clearing-badge' + (cls ? ' ' + cls : '');
  clearingBadge.textContent = text || '';
}

let catchingUp = false;

async function catchUpClearing() {
  if (catchingUp) return;                                // one pass at a time
  if (window.api.env && window.api.env.e2e) return;      // tests do not call the exchange
  const settings = window.appSettings || await window.api.config.getSettings();
  if (settings.clearingAuto === false) return;
  const todo = window.clearing.outstanding(trades);
  if (!todo) return;
  catchingUp = true;
  showClearing(`считаю вариационку · 0 / ${todo}`, 'busy');
  let res;
  try {
    res = await window.clearing.runClearing(trades, ({ total, done }) => {
      showClearing(`считаю вариационку · ${done} / ${total}`, 'busy');
    });
    trades = await window.api.trades.list();
    showJournal();
  } finally {
    catchingUp = false;
  }
  if (res.failed.length) {
    showClearing(`вариационка: ${res.done} из ${res.total}`, 'warn');
    clearingBadge.title = 'Не вышло посчитать:\n' + res.failed.join('\n')
      + '\n\nСделку, закрытую сегодня, MOEX публикует только после вечернего клиринга — она посчитается при следующем запуске.';
    setTimeout(() => showClearing(''), 30000);
  } else {
    showClearing(`вариационка посчитана: ${res.done}`, 'ok');
    clearingBadge.title = '';
    setTimeout(() => showClearing(''), 6000);
  }
}

applySavedSettings();
refresh();
