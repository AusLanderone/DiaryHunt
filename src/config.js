'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  exchanges: ['MOEX', 'FOREX'],
  tags: ['Схождение', 'Раскор'],
  types: ['Фьючи', 'Крипто', 'RWA'],
  tickers: [],   // filled from what gets typed — every diary trades its own set
};

const SETTINGS_DEFAULTS = {
  font: 'system',   // system | grotesk | rounded | serif
  theme: 'default', // default | emerald | ocean | violet | light
  scale: 1,         // UI zoom factor
};

function createConfig({ dataDir }) {
  const file = path.join(dataDir, 'config.json');

  function read() {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function write(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  function get() {
    const data = read();
    if (!fs.existsSync(file)) write(data); // seed defaults
    return data;
  }

  function addItem(kind, value) {
    const data = read();
    if (!data[kind].includes(value)) {
      data[kind] = [...data[kind], value];
      write(data);
    }
  }

  function removeItem(kind, value) {
    const data = read();
    data[kind] = data[kind].filter((v) => v !== value);
    write(data);
  }

  function getSettings() {
    return { ...SETTINGS_DEFAULTS, ...(read().settings || {}) };
  }

  function setSettings(patch) {
    const data = read();
    data.settings = { ...SETTINGS_DEFAULTS, ...(data.settings || {}), ...patch };
    write(data);
    return data.settings;
  }

  // Merge a config snapshot (from DB import). Only known keys are applied.
  function importAll(obj) {
    if (!obj || typeof obj !== 'object') return;
    const data = read();
    ['exchanges', 'tags', 'types', 'tickers'].forEach((k) => {
      if (Array.isArray(obj[k])) data[k] = obj[k];
    });
    if (obj.settings && typeof obj.settings === 'object') {
      data.settings = { ...SETTINGS_DEFAULTS, ...obj.settings };
    }
    write(data);
  }

  return { get, addItem, removeItem, getSettings, setSettings, importAll };
}

module.exports = { createConfig };
