'use strict';

// Synchronisation through a cloud client's folder (Google Диск для компьютера,
// Яндекс.Диск, OneDrive, Dropbox): the app writes one file, the client carries
// it between devices. An open Drive link can only be read, never written to,
// which is why there is no API here at all.
//
// Deciding what to do is pure and tested; the file work lives in main.js.

const os = require('os');
const backup = require('./backup');

const FILE_NAME = 'diaryhunt-db.json';

const time = (v) => {
  const t = Date.parse(v || '');
  return Number.isNaN(t) ? 0 : t;
};

// Which way the data should move on startup. There is no merging: whichever
// side is newer replaces the other outright.
function decide({ dir, url, cloud, state }) {
  const target = url || dir;                    // `dir` kept for the older call shape
  if (!target) return { action: 'off', reason: 'Облако не подключено' };
  const s = state || {};
  if (!cloud) return { action: 'push', reason: 'В облаке пусто — выгружаем впервые' };

  const cloudAt = time(cloud.syncedAt);
  const pushedAt = time(s.lastPushAt);
  const changedAt = time(s.lastChangeAt);

  if (cloudAt > pushedAt) {
    const from = cloud.device ? ` (устройство ${cloud.device})` : '';
    return { action: 'pull', reason: `В облаке версия свежее${from}` };
  }
  if (changedAt > pushedAt) return { action: 'push', reason: 'Локальные изменения ещё не выгружены' };
  return { action: 'idle', reason: 'Данные совпадают с облаком' };
}

// the payload plus who wrote it and when
function stamp(data, { device, now } = {}) {
  return {
    ...data,
    syncedAt: (now instanceof Date ? now : new Date()).toISOString(),
    device: device || os.hostname(),
  };
}

function parse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл синхронизации не читается как JSON' };
  }
  const read = backup.read(json);
  if (!read.ok) return { ok: false, error: read.error };
  return { ok: true, data: json, sections: read };
}

module.exports = { decide, stamp, parse, FILE_NAME };
