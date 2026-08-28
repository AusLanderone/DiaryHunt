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

async function applySavedSettings() {
  try { window.settings.applySettings(await window.api.config.getSettings()); } catch { /* defaults */ }
}

applySavedSettings();
refresh();
