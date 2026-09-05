'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  exchanges: ['MOEX', 'FOREX'],
  tags: ['Схождение', 'Раскор'],
  types: ['Фьючи', 'Крипто', 'RWA'],
  tickers: [],   // filled from what gets typed — every diary trades its own set
  // Values the diary should stop offering. A dropdown lists the dictionary plus
  // whatever the trades already hold, so dropping a value from the dictionary
  // alone would not remove it — the trades would keep handing it back.
  hidden: { exchanges: [], tags: [], types: [], tickers: [] },
};

const KINDS = ['exchanges', 'tags', 'types', 'tickers'];
const emptyHidden = () => Object.fromEntries(KINDS.map((k) => [k, []]));

const SETTINGS_DEFAULTS = {
  font: 'system',   // system | grotesk | rounded | serif
  theme: 'default', // default | emerald | ocean | violet | light
  scale: 1,         // UI zoom factor
};

function createConfig({ dataDir }) {
  const file = path.join(dataDir, 'config.json');

  function read() {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      saved = {};
    }
    return { ...DEFAULTS, ...saved, hidden: { ...emptyHidden(), ...(saved.hidden || {}) } };
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

  // Adding a value also un-hides it: typing it again is how a value comes back.
  function addItem(kind, value) {
    const data = read();
    const hidden = data.hidden[kind] || [];
    if (data[kind].includes(value) && !hidden.includes(value)) return;
    if (!data[kind].includes(value)) data[kind] = [...data[kind], value];
    data.hidden[kind] = hidden.filter((v) => v !== value);
    write(data);
  }

  // Removing drops the value from the dictionary AND remembers it as hidden, so
  // the trades that still carry it don't put it back in the dropdowns.
  function removeItem(kind, value) {
    const data = read();
    data[kind] = data[kind].filter((v) => v !== value);
    const hidden = data.hidden[kind] || [];
    if (!hidden.includes(value)) data.hidden[kind] = [...hidden, value];
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
    KINDS.forEach((k) => {
      if (Array.isArray(obj[k])) data[k] = obj[k];
      if (obj.hidden && Array.isArray(obj.hidden[k])) data.hidden[k] = obj.hidden[k];
    });
    if (obj.settings && typeof obj.settings === 'object') {
      data.settings = { ...SETTINGS_DEFAULTS, ...obj.settings };
    }
    write(data);
  }

  return { get, addItem, removeItem, getSettings, setSettings, importAll };
}

module.exports = { createConfig };
