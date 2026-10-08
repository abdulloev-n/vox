const { app, BrowserWindow, Tray, Menu, ipcMain, screen, session, nativeImage, clipboard, globalShortcut } = require('electron');
const path = require('path');
const store = require('./lib/store');
const ai = require('./lib/openai');
const { pasteText } = require('./lib/paste');
const { Hotkey, label, toAccelerator } = require('./lib/hotkey');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const fs = require('fs');
function log(...args) {
  try {
    const line = args.map((a) => (a && a.stack) || String(a)).join(' ');
    fs.appendFileSync(path.join(app.getPath('userData'), 'vox.log'), new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

let mainWin = null, widget = null, tray = null, hk = null;
let state = 'idle';            // idle | recording | processing
let recMode = 'hold';          // hold | toggle
let holdLatch = false, toggleLatch = false;
let hotkeyErrors = [];
let hideTimer = null, quitting = false;

const preload = path.join(__dirname, 'preload.js');
const iconPath = path.join(__dirname, 'assets', 'icon.png');
const WIDGET_W = 340, WIDGET_H = 56;

const MODES = ['chat', 'prompt'];
const MODEL_RE = /^[A-Za-z0-9._:\/-]{1,100}$/;

/* ---------- windows ---------- */

function createWidget() {
  widget = new BrowserWindow({
    width: WIDGET_W, height: WIDGET_H, show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  widget.setAlwaysOnTop(true, 'screen-saver');
  widget.setIgnoreMouseEvents(true);
  widget.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
}

function placeWidget() {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  widget.setPosition(Math.round(wa.x + wa.width / 2 - WIDGET_W / 2), Math.round(wa.y + wa.height - WIDGET_H - 28));
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 980, height: 680, minWidth: 780, minHeight: 520, show: false, backgroundColor: '#ffffff',
    title: 'Vox', icon: iconPath, autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
}

function showMain(tab) {
  if (!mainWin) createMain();
  mainWin.show();
  mainWin.focus();
  if (tab) mainWin.webContents.send('nav', tab);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Vox', click: () => showMain() },
    {
      label: 'Text cleanup', type: 'checkbox', checked: store.getSettings().cleanup,
      click: (item) => applySettings({ cleanup: item.checked })
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Vox');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showMain());
}

/* ---------- recording ---------- */

function widgetState(s, message) {
  widget.webContents.send('widget:state', { state: s, message });
}

function hideWidgetSoon(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (state === 'idle') widget.hide(); }, ms);
}

function startRecording() {
  if (state !== 'idle') return;
  if (!store.getApiKey()) { showMain('settings'); return; }
  clearTimeout(hideTimer);
  state = 'recording';
  globalShortcut.register('Escape', cancelRecording);
  placeWidget();
  widget.showInactive();
  const s = store.getSettings();
  widget.webContents.send('rec:start', { deviceId: s.deviceId, cleanup: s.cleanup });
}

function stopRecording() {
  if (state !== 'recording') return;
  state = 'processing';
  globalShortcut.unregister('Escape');
  widget.webContents.send('rec:stop');
}

function cancelRecording() {
  if (state !== 'recording') return;
  state = 'idle';
  globalShortcut.unregister('Escape');
  widget.webContents.send('rec:cancel');
  widget.hide();
}

function finish(ok, message) {
  state = 'idle';
  widgetState(ok ? 'done' : 'error', message);
  hideWidgetSoon(ok ? 700 : 2500);
}

ipcMain.on('rec:error', (_e, msg) => {
  globalShortcut.unregister('Escape');
  state = 'idle';
  widgetState('error', msg || 'No microphone access');
  hideWidgetSoon(2500);
});

ipcMain.on('rec:data', async (_e, { buffer, durationMs, peak }) => {
  if (state !== 'processing') return;
  if (durationMs < 500 || peak < 0.02) { finish(false, 'Too quiet or too short'); return; }
  const s = store.getSettings();
  const apiKey = store.getApiKey();
  try {
    const prompt = s.dictionary.length ? 'Terms: ' + s.dictionary.join(', ') : undefined;
    const raw = await ai.transcribe(Buffer.from(buffer), { apiKey, model: s.sttModel, prompt });
    if (!raw) { finish(false, 'No speech detected'); return; }
    let text = raw, language = '', cleaned = false, cleanFailed = false;
    if (s.cleanup) {
      try {
        const c = await ai.clean(raw, { apiKey, model: s.cleanModel, mode: s.mode, dictionary: s.dictionary });
        text = c.text; language = c.language; cleaned = true;
      } catch (e) { cleanFailed = true; log('cleanup error', e); }
    }
    await pasteText(text);
    store.addHistory({ ts: Date.now(), durationMs, language, raw, text, cleaned, cleanFailed });
    if (mainWin) mainWin.webContents.send('history:updated');
    finish(true, cleanFailed ? 'Pasted without cleanup' : 'Done');
  } catch (err) {
    log('pipeline error', err);
    finish(false, err.message || 'Error');
  }
});

/* ---------- hotkeys ---------- */

function onHold() {
  if (holdLatch) return;
  holdLatch = true;
  if (state === 'idle') { recMode = 'hold'; startRecording(); }
}

function onToggle() {
  if (toggleLatch) return;
  toggleLatch = true;
  if (state === 'idle') { recMode = 'toggle'; startRecording(); }
  else if (state === 'recording') stopRecording();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = [];
  const s = store.getSettings();
  for (const [name, handler] of [['hotkeyHold', onHold], ['hotkeyToggle', onToggle]]) {
    const accel = toAccelerator(s[name]);
    let ok = false;
    try { ok = !!accel && globalShortcut.register(accel, handler); } catch {}
    if (!ok) hotkeyErrors.push(name);
  }
}

function onKeyUp(k) {
  const s = store.getSettings();
  if (s.hotkeyHold.includes(k) && holdLatch) {
    holdLatch = false;
    if (recMode === 'hold' && state === 'recording') stopRecording();
  }
  if (s.hotkeyToggle.includes(k)) toggleLatch = false;
}

/* ---------- settings ---------- */

function publicSettings() {
  const { apiKeyEnc, ...rest } = store.getSettings();
  return {
    ...rest,
    hasKey: !!apiKeyEnc,
    holdLabel: label(rest.hotkeyHold),
    toggleLabel: label(rest.hotkeyToggle),
    hotkeyErrors
  };
}

function applySettings(patch) {
  const clean = {};
  for (const k of ['sttModel', 'cleanModel']) {
    const v = typeof patch[k] === 'string' ? patch[k].trim() : '';
    if (MODEL_RE.test(v)) clean[k] = v;
  }
  if (MODES.includes(patch.mode)) clean.mode = patch.mode;
  if (Array.isArray(patch.dictionary)) clean.dictionary = patch.dictionary.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 200);
  if ([0, 7, 30, 90].includes(patch.keepDays)) clean.keepDays = patch.keepDays;
  if ([0, 100, 500, 2000].includes(patch.keepMax)) clean.keepMax = patch.keepMax;
  if (typeof patch.cleanup === 'boolean') clean.cleanup = patch.cleanup;
  if (typeof patch.autostart === 'boolean') {
    clean.autostart = patch.autostart;
    app.setLoginItemSettings({ openAtLogin: patch.autostart, args: ['--hidden'] });
  }
  if (typeof patch.deviceId === 'string') clean.deviceId = patch.deviceId;
  store.setSettings(clean);
  store.prune();
  if (tray) tray.setContextMenu(buildTrayMenu());
  if (mainWin) {
    mainWin.webContents.send('settings:changed', publicSettings());
    mainWin.webContents.send('history:updated');
  }
  return publicSettings();
}

ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => applySettings(patch || {}));

ipcMain.handle('apikey:set', async (_e, key) => {
  key = String(key || '').trim();
  store.setApiKey(key);
  let check = key ? 'ok' : 'removed';
  if (key) {
    try { await ai.checkKey(key); } catch (e) { check = e.message || 'Could not verify the key'; }
  }
  return { settings: publicSettings(), check };
});

ipcMain.handle('hotkey:record', async (_e, target) => {
  const field = target === 'toggle' ? 'hotkeyToggle' : 'hotkeyHold';
  const other = target === 'toggle' ? 'hotkeyHold' : 'hotkeyToggle';
  globalShortcut.unregisterAll();
  const r = await hk.record();
  let error = r.error || '';
  if (r.combo) {
    if (JSON.stringify(r.combo) === JSON.stringify(store.getSettings()[other])) error = 'This combination is already used by the other hotkey';
    else store.setSettings({ [field]: r.combo });
  }
  registerHotkeys();
  if (!error && hotkeyErrors.includes(field)) error = 'Another app is using this combination. Pick a different one';
  return { settings: publicSettings(), error };
});

ipcMain.handle('history:list', () => store.listHistory());
ipcMain.handle('history:delete', (_e, id) => store.removeHistory(String(id)));
ipcMain.handle('history:restore', (_e, item) => { store.restoreHistory(item); return true; });
ipcMain.handle('history:clear', () => { store.clearHistory(); return true; });
ipcMain.handle('clipboard:copy', async (_e, text) => { await Promise.resolve(clipboard.writeText(String(text))); return true; });

/* ---------- startup ---------- */

app.whenReady().then(() => {
  app.setAppUserModelId('com.nazir.vox');
  Menu.setApplicationMenu(null);
  store.load();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  createWidget();
  createMain();
  createTray();

  hk = new Hotkey();
  hk.on('keyup', onKeyUp);
  hk.start();
  registerHotkeys();

  if (!process.argv.includes('--hidden')) showMain(store.getApiKey() ? undefined : 'settings');
});

app.on('second-instance', () => showMain());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (hk) hk.stop(); });
