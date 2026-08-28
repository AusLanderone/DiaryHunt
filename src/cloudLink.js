'use strict';

// Sync by pasting one link.
//
// Google Drive cannot be written to through a shared link — uploads need an
// OAuth token. What *can* be written through a plain URL is a Google Apps
// Script web app running in the user's own account: it receives the database
// as a POST and keeps it as a file on their Drive, and returns it on GET.
// So the supported link is that web app's /exec address; a bare Drive file
// link is still accepted, but only for reading.

const SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/i;
const DRIVE_FILE_RE = /drive\.google\.com\/file\/d\/([\w-]{10,})/i;
const DRIVE_UC_RE = /drive\.google\.com\/uc\?[^\s]*\bid=([\w-]{10,})/i;

// The snippet the user pastes into script.google.com. Kept here so the app can
// show it and copy it to the clipboard — the setup is two minutes, once.
const SCRIPT_CODE = `const FILE_NAME = 'diaryhunt-db.json';

function doGet() {
  const files = DriveApp.getFilesByName(FILE_NAME);
  const body = files.hasNext() ? files.next().getBlob().getDataAsString() : '{}';
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const content = e.postData.contents;
  const files = DriveApp.getFilesByName(FILE_NAME);
  if (files.hasNext()) files.next().setContent(content);
  else DriveApp.createFile(FILE_NAME, content, MimeType.PLAIN_TEXT);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

function classify(raw) {
  const url = String(raw || '').trim();
  if (!url) return { kind: 'unknown', error: 'Ссылка не указана' };

  if (SCRIPT_RE.test(url)) {
    return { kind: 'script', canWrite: true, getUrl: url, postUrl: url };
  }
  if (/docs\.google\.com\/spreadsheets/i.test(url)) {
    return { kind: 'unknown', error: 'Это ссылка на таблицу, а не на хранилище базы' };
  }
  const file = url.match(DRIVE_FILE_RE) || url.match(DRIVE_UC_RE);
  if (file) {
    return {
      kind: 'drive-file',
      canWrite: false,
      getUrl: `https://drive.google.com/uc?export=download&id=${file[1]}`,
      note: 'Обычная ссылка Google Drive работает только на чтение — выгружать по ней нельзя',
    };
  }
  return {
    kind: 'unknown',
    error: 'Нужна ссылка веб-приложения Apps Script (…/macros/s/…/exec) или ссылка на файл Google Drive',
  };
}

// The cloud answers with the database, with an empty object when nothing has
// been stored yet, or — when the web app was published for the wrong audience —
// with a Google sign-in page.
function parseResponse(text) {
  const body = String(text == null ? '' : text).trim();
  if (!body || body === '{}') return { ok: true, data: null };
  if (/^\s*</.test(body)) {
    return { ok: false, error: 'Вместо данных пришла HTML-страница — проверьте, что веб-приложение открыто для всех' };
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: 'Ответ облака не удалось прочитать как JSON' };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, error: 'Ответ облака не похож на базу DiaryHunt' };
  }
  if (!Object.keys(json).length) return { ok: true, data: null };
  return { ok: true, data: json };
}

// Apps Script answers 403 to an anonymous request whenever the deployment was
// published for «Все, у кого есть аккаунт Google» rather than «Все» — the app
// has no browser session, so that is the one to name first.
function explainHttp(status) {
  if (status === 403) {
    return 'Скрипт отвечает «доступ запрещён». В развёртывании выберите «У кого есть доступ: Все» '
      + '(вариант «Все, у кого есть аккаунт Google» не подойдёт) и разверните новую версию.';
  }
  if (status === 401) return 'Скрипт требует входа в аккаунт — откройте доступ «Все» в развёртывании';
  if (status === 404) return 'По ссылке ничего нет — проверьте, что скопирован адрес развёртывания …/exec';
  if (status >= 500) return `Скрипт ответил ошибкой ${status} — проверьте код в Apps Script`;
  return `Облако ответило ${status}`;
}

module.exports = { classify, parseResponse, explainHttp, SCRIPT_CODE, SCRIPT_RE };
