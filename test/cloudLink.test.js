// test/cloudLink.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const link = require('../src/cloudLink');

const SCRIPT = 'https://script.google.com/macros/s/AKfycbwSAMPLE123/exec';

test('classify — an Apps Script web app can be both read and written', () => {
  const k = link.classify(SCRIPT);
  assert.strictEqual(k.kind, 'script');
  assert.strictEqual(k.canWrite, true);
  assert.strictEqual(k.getUrl, SCRIPT);
  assert.strictEqual(k.postUrl, SCRIPT);
});

test('classify — a plain Drive link is read-only, and says so', () => {
  const k = link.classify('https://drive.google.com/file/d/1AbCdEf12345/view?usp=sharing');
  assert.strictEqual(k.kind, 'drive-file');
  assert.strictEqual(k.canWrite, false);
  assert.match(k.getUrl, /1AbCdEf12345/);
  assert.match(k.note, /чтени/i);
});

test('classify — the uc?id= form of a Drive link is recognised too', () => {
  const k = link.classify('https://drive.google.com/uc?export=download&id=1AbCdEf12345');
  assert.strictEqual(k.kind, 'drive-file');
  assert.match(k.getUrl, /1AbCdEf12345/);
});

test('classify — anything else is refused with a reason', () => {
  for (const bad of ['', '   ', 'не ссылка', 'ftp://x/y', 'https://example.com/db.json']) {
    const k = link.classify(bad);
    assert.strictEqual(k.kind, 'unknown', bad);
    assert.ok(k.error && k.error.length > 5, k.error);
  }
});

test('classify — a Google Sheets link is not a database and is refused', () => {
  const k = link.classify('https://docs.google.com/spreadsheets/d/11uDL/edit');
  assert.strictEqual(k.kind, 'unknown');
  assert.match(k.error, /таблиц/i);
});

test('classify — trims spaces around a pasted link', () => {
  assert.strictEqual(link.classify(`  ${SCRIPT}  `).kind, 'script');
});

test('parseResponse — reads the database out of a good answer', () => {
  const body = JSON.stringify({ app: 'DiaryHunt', trades: [{ num: 1 }], syncedAt: '2026-08-28T10:00:00.000Z' });
  const r = link.parseResponse(body);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.trades.length, 1);
});

test('parseResponse — an empty cloud is not an error, just nothing yet', () => {
  for (const empty of ['', '{}', '   ']) {
    const r = link.parseResponse(empty);
    assert.strictEqual(r.ok, true, empty);
    assert.strictEqual(r.data, null, 'nothing stored yet');
  }
});

test('parseResponse — a login page instead of JSON is reported clearly', () => {
  const r = link.parseResponse('<!DOCTYPE html><html><head><title>Sign in</title>');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /доступ|вход|html/i);
});

test('parseResponse — rubbish JSON is reported as such', () => {
  const r = link.parseResponse('{ трижды не json');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /json|прочитать/i);
});

test('SCRIPT_CODE — the snippet handed to the user covers both directions', () => {
  assert.match(link.SCRIPT_CODE, /function doGet/);
  assert.match(link.SCRIPT_CODE, /function doPost/);
  assert.match(link.SCRIPT_CODE, /diaryhunt-db\.json/);
});
