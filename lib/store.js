const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// 19 = the R key in uiohook
const DEFAULTS = {
  hotkeyHold: ['ctrl', 19],
  hotkeyToggle: ['ctrl', 'shift', 19],
  cleanup: true,
  sttModel: 'gpt-4o-transcribe',
  cleanModel: 'gpt-4o-mini',
  mode: 'chat',
  dictionary: [],
  keepDays: 30,
  keepMax: 500,
  autostart: false,
  deviceId: '',
  apiKeyEnc: ''
};

let settings = null;
let history = null;

const file = (n) => path.join(app.getPath('userData'), n);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, p);
}

function load() {
  settings = { ...DEFAULTS, ...readJson(file('settings.json'), {}) };
  history = readJson(file('history.json'), []);
  prune();
}

function getSettings() { return settings; }

function setSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson(file('settings.json'), settings);
  return settings;
}

function setApiKey(key) {
  if (key && !safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is not available');
  const enc = key ? safeStorage.encryptString(key).toString('base64') : '';
  setSettings({ apiKeyEnc: enc });
}

function getApiKey() {
  if (!settings.apiKeyEnc) return '';
  try { return safeStorage.decryptString(Buffer.from(settings.apiKeyEnc, 'base64')); } catch { return ''; }
}

function prune() {
  const limit = settings.keepDays > 0 ? Date.now() - settings.keepDays * 86400000 : 0;
  history = history.filter((h) => h.ts >= limit);
  if (settings.keepMax > 0 && history.length > settings.keepMax) history = history.slice(0, settings.keepMax);
  writeJson(file('history.json'), history);
}

function addHistory(entry) {
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  history.unshift(entry);
  prune();
  return entry;
}

function listHistory() { return history; }
function removeHistory(id) {
  const item = history.find((h) => h.id === id);
  history = history.filter((h) => h.id !== id);
  writeJson(file('history.json'), history);
  return item || null;
}
function restoreHistory(item) {
  if (!item || history.some((h) => h.id === item.id)) return;
  history.push(item);
  history.sort((a, b) => b.ts - a.ts);
  prune();
}
function clearHistory() { history = []; writeJson(file('history.json'), history); }

module.exports = {
  load, getSettings, setSettings, setApiKey, getApiKey, prune,
  addHistory, listHistory, removeHistory, restoreHistory, clearHistory
};
