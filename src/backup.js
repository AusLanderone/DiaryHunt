'use strict';

// The backup file carries both databases — trades and balances (snapshots plus
// cash movements) — together with the dictionaries and the appearance settings.
// Building and reading it lives here rather than in the IPC handler so it can
// be tested without a file dialog.

const SECTIONS = ['trades', 'balances', 'cashflows'];

function build({ trades, balances, cashflows, config, settings }) {
  const data = {
    app: 'DiaryHunt',
    schema: 2,                       // 1 was trades + config only
    exportedAt: new Date().toISOString(),
    trades: trades || [],
    balances: balances || [],
    cashflows: cashflows || [],
    config: {
      exchanges: (config && config.exchanges) || [],
      tags: (config && config.tags) || [],
      types: (config && config.types) || [],
      tickers: (config && config.tickers) || [],
      settings: settings || {},
    },
  };
  data.counts = {
    trades: data.trades.length,
    balances: data.balances.length,
    cashflows: data.cashflows.length,
  };
  return data;
}

// A section that is absent stays untouched on import (older backups predate the
// balances tab); a section present but empty is a deliberate "clear this".
function read(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Файл не похож на бэкап DiaryHunt.' };
  }
  const picked = {};
  let any = false;
  for (const key of SECTIONS) {
    const value = parsed[key];
    if (Array.isArray(value)) { picked[key] = value; any = true; } else picked[key] = null;
  }
  if (!any) {
    return { ok: false, error: 'В файле нет ни сделок, ни балансов — восстанавливать нечего.' };
  }
  return {
    ok: true,
    ...picked,
    config: parsed.config && typeof parsed.config === 'object' ? parsed.config : null,
    counts: {
      trades: picked.trades ? picked.trades.length : 0,
      balances: picked.balances ? picked.balances.length : 0,
      cashflows: picked.cashflows ? picked.cashflows.length : 0,
    },
  };
}

// "сделок 14, отметок баланса 3, движений 2"
function summary(counts) {
  const parts = [];
  if (counts.trades) parts.push(`сделок ${counts.trades}`);
  if (counts.balances) parts.push(`отметок баланса ${counts.balances}`);
  if (counts.cashflows) parts.push(`движений средств ${counts.cashflows}`);
  return parts.length ? parts.join(', ') : 'ничего — файл пуст';
}

module.exports = { build, read, summary, SECTIONS };
