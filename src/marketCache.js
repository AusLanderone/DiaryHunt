'use strict';

const fs = require('fs');
const path = require('path');

// A disk cache for market history that has already happened.
//
// Settlement prices of a finished session and the official rate of a past day
// never change, so a trade's variation margin is worth fetching once and no
// more — the diary keeps working when MOEX is unreachable, and a bulk recompute
// over the whole journal costs one request per trade instead of one per open.
// Anything that reaches into today is deliberately NOT kept: today's clearing
// has not happened yet.
function createMarketCache({ dataDir, file = 'market-cache.json' }) {
  const target = path.join(dataDir, file);

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(target, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data), 'utf8');
  }

  async function remember(key, cacheable, produce) {
    if (cacheable) {
      const data = read();
      if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
    }
    const value = await produce();       // a failure is not an answer: nothing is stored
    if (cacheable) {
      const data = read();
      data[key] = value;
      write(data);
    }
    return value;
  }

  function clear() {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* an absent cache is already clear */
    }
  }

  return { remember, clear, file: target };
}

module.exports = { createMarketCache };
