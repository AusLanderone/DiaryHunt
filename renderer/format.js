const isNil = (n) => n === null || n === undefined || Number.isNaN(n);
function fmtUsd(n) { return isNil(n) ? '' : '$' + Number(n).toFixed(5); }
function fmtRub(n) { return isNil(n) ? '' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽'; }
function fmtPct(n) { return isNil(n) ? '' : (Number(n) * 100).toFixed(4) + '%'; }
function fmtNum(n) { return isNil(n) ? '' : String(n); }
window.format = { fmtUsd, fmtRub, fmtPct, fmtNum };
