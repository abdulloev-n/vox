const { EventEmitter } = require('events');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const MOD = { 29: 'ctrl', 3613: 'ctrl', 42: 'shift', 54: 'shift', 56: 'alt', 3640: 'alt', 3675: 'meta', 3676: 'meta' };
const ORDER = ['ctrl', 'alt', 'shift', 'meta'];
const ACCEL_MOD = { ctrl: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Super' };
const LABEL_MOD = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
const SPECIAL = {
  Space: 'Space', Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
};
const NAMES = {};
for (const [name, code] of Object.entries(UiohookKey)) NAMES[code] = name;

const norm = (code) => MOD[code] || code;
const isMod = (k) => ORDER.includes(k);

function keyToAccel(code) {
  const name = NAMES[code];
  if (!name) return null;
  if (/^[A-Z0-9]$/.test(name) || /^F([1-9]|1[0-9]|2[0-4])$/.test(name)) return name;
  return SPECIAL[name] || null;
}

// ['ctrl', 'shift', 19] -> 'Control+Shift+R'. Returns null if the combination cannot be registered as a global shortcut.
function toAccelerator(combo) {
  const mods = combo.filter(isMod);
  const keys = combo.filter((k) => !isMod(k));
  if (keys.length !== 1) return null;
  const key = keyToAccel(keys[0]);
  if (!key) return null;
  return [...mods.map((m) => ACCEL_MOD[m]), key].join('+');
}

function label(combo) {
  return combo.map((k) => LABEL_MOD[k] || NAMES[k] || 'Key' + k).join(' + ');
}

function sortCombo(keys) {
  return [...ORDER.filter((m) => keys.includes(m)), ...keys.filter((k) => !isMod(k))];
}

// Listens to the keyboard globally. Used only to detect key releases and to record a new combination.
class Hotkey extends EventEmitter {
  constructor() {
    super();
    this.recording = false;
  }

  start() {
    uIOhook.on('keydown', (e) => this.down(norm(e.keycode)));
    uIOhook.on('keyup', (e) => this.up(norm(e.keycode)));
    uIOhook.start();
  }

  stop() { try { uIOhook.stop(); } catch {} }

  record() {
    return new Promise((resolve) => {
      this.recording = true;
      this.recAll = [];
      this.recHeld = new Set();
      this.recResolve = resolve;
    });
  }

  down(k) {
    if (!this.recording) return;
    if (k === 1 && !this.recAll.length) { this.recording = false; this.recResolve({ cancelled: true }); return; }
    this.recHeld.add(k);
    if (!this.recAll.includes(k)) this.recAll.push(k);
  }

  up(k) {
    if (this.recording) {
      this.recHeld.delete(k);
      if (!this.recHeld.size && this.recAll.length) {
        const combo = sortCombo(this.recAll);
        this.recording = false;
        const mods = combo.filter(isMod);
        const keys = combo.filter((c) => !isMod(c));
        if (!mods.length || keys.length !== 1 || !toAccelerator(combo)) {
          this.recResolve({ error: 'Use one regular key plus at least one modifier (Ctrl, Alt, Shift or Win)' });
        } else {
          this.recResolve({ combo });
        }
      }
      return;
    }
    this.emit('keyup', k);
  }
}

module.exports = { Hotkey, label, toAccelerator };
