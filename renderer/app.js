const view = document.getElementById('view');
let trades = [];

async function refresh() {
  trades = await window.api.trades.list();
  showJournal();
}

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

function setActive(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('tab-journal').onclick = showJournal;
document.getElementById('tab-stats').onclick = showStats;
document.getElementById('btn-add').onclick = () => window.form.openForm(null, refresh);
document.getElementById('btn-export').onclick = async () => {
  const r = await window.api.exportCsv();
  if (r.saved) alert('Сохранено: ' + r.path);
};

refresh();
