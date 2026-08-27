'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  exchanges: ['MOEX', 'FOREX'],
  tags: ['Схождение', 'Раскор'],
  types: ['Фьючи', 'Крипто', 'RWA'],
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

  return { get, addItem, removeItem, getSettings, setSettings };
}

module.exports = { createConfig };
