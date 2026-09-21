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

// Every FORTS contract with the two fields that say what a price move pays:
// MINSTEP (the price step) and STEPPRICE (what one step is worth in roubles).
const FORTS_URL = 'https://iss.moex.com/iss/engines/futures/markets/forts/securities.json'
  + '?iss.meta=off&iss.only=securities'
  + '&securities.columns=SECID,SHORTNAME,ASSETCODE,LASTTRADEDATE,MINSTEP,STEPPRICE';

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

// Roubles per one point of price, for a MOEX leg that quotes in dollars. The
// asset code (GOLD, SILV, ED) matches every contract of the series, so the
// nearest one still trading is the one the diary means; a SECID asks for that
// contract outright. When they have all expired the last of them still answers,
// flagged, because a stale step value beats no answer while entering an old trade.
function parseStepPrice(text, code, today) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const sec = json && json.securities;
  if (!sec || !Array.isArray(sec.data) || !Array.isArray(sec.columns)) return null;
  const idx = Object.fromEntries(sec.columns.map((c, i) => [c, i]));
  const want = String(code || '').trim().toUpperCase();
  if (!want) return null;

  const rows = sec.data
    .filter((r) => String(r[idx.ASSETCODE] || '').toUpperCase() === want
      || String(r[idx.SECID] || '').toUpperCase() === want)
    .map((r) => ({
      secid: String(r[idx.SECID] || ''),
      shortName: String(r[idx.SHORTNAME] || ''),
      assetCode: String(r[idx.ASSETCODE] || ''),
      lastTradeDate: r[idx.LASTTRADEDATE] || null,
      minStep: Number(r[idx.MINSTEP]) || 0,
      stepPrice: Number(r[idx.STEPPRICE]) || 0,
    }))
    .filter((r) => r.minStep > 0 && r.stepPrice > 0)
    .sort((a, b) => String(a.lastTradeDate).localeCompare(String(b.lastTradeDate)));
  if (!rows.length) return null;

  const day = String(today || new Date().toISOString().slice(0, 10));
  const live = rows.find((r) => String(r.lastTradeDate) >= day);
  const row = live || rows[rows.length - 1];
  return { ...row, pointValue: row.stepPrice / row.minStep, expired: !live };
}

async function fetchPointValue({ get, code, today }) {
  const found = parseStepPrice(await get(FORTS_URL), code, today);
  if (!found) throw new Error(`MOEX не знает инструмент «${code}» или не отдаёт стоимость шага`);
  return { ...found, source: 'MOEX ISS' };
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

module.exports = { parseMoex, parseCbr, parseStepPrice, fetchUsdRub, fetchPointValue,
  MOEX_URL, CBR_URL, FORTS_URL };
