'use strict';

// USD/RUB lookup for the trade form. Two sources, in order:
//   1. MOEX ISS — the USDRUBF perpetual future, i.e. the rate actually traded
//      on the exchange leg of an arbitrage (live during the session).
//   2. Central Bank of Russia — the official daily fix, used when MOEX is
//      unreachable or quotes nothing (weekends, holidays, outages).
// Parsing is separated from fetching so both formats are covered by node:test;
// the caller injects `get(url) -> Promise<string>` (main.js passes fetch).

const MOEX_URL = 'https://iss.moex.com/iss/engines/futures/markets/forts/securities/USDRUBF.json'
  + '?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,SETTLEPRICE,UPDATETIME';
const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';

function parseMoex(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const md = json && json.marketdata;
  const row = md && Array.isArray(md.data) ? md.data[0] : null;
  if (!row || !Array.isArray(md.columns)) return null;
  const at = (name) => {
    const i = md.columns.indexOf(name);
    return i === -1 ? null : row[i];
  };
  const rate = Number(at('LAST')) || Number(at('SETTLEPRICE')) || null;
  if (!rate) return null;
  return { rate, source: 'MOEX USDRUBF', time: at('UPDATETIME') || null };
}

// The CBR feed is windows-1251; only ASCII digits matter, so a regex over the
// decoded text is safe even when the Cyrillic names come out mangled.
function parseCbr(text) {
  const usd = /<Valute[^>]*ID="R01235"[\s\S]*?<Value>([\d.,]+)<\/Value>/.exec(String(text));
  if (!usd) return null;
  const rate = Number(usd[1].replace(',', '.'));
  if (!rate) return null;
  const date = /<ValCurs[^>]*Date="([^"]+)"/.exec(String(text));
  return { rate, source: 'ЦБ РФ', date: date ? date[1] : null };
}

async function fetchUsdRub({ get }) {
  try {
    const moex = parseMoex(await get(MOEX_URL));
    if (moex) return moex;
  } catch {
    /* fall through to the CBR */
  }
  try {
    const cbr = parseCbr(await get(CBR_URL));
    if (cbr) return cbr;
  } catch {
    /* both sources are down */
  }
  throw new Error('Не удалось получить курс: MOEX и ЦБ не отвечают');
}

module.exports = { parseMoex, parseCbr, fetchUsdRub, MOEX_URL, CBR_URL };
