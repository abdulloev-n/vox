const { clipboard } = require('electron');
const { execFile } = require('child_process');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fallback: press Ctrl+V through PowerShell and keybd_event.
// WScript.Shell.SendKeys is not used because it did not deliver keys on some Windows setups.
const PS_PASTE = [
  "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);}'",
  '[K]::keybd_event(0x11,0,0,[UIntPtr]::Zero);[K]::keybd_event(0x56,0,0,[UIntPtr]::Zero)',
  '[K]::keybd_event(0x56,0,2,[UIntPtr]::Zero);[K]::keybd_event(0x11,0,2,[UIntPtr]::Zero)'
].join('; ');

function pressPasteFallback() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_PASTE], { windowsHide: true }, () => resolve());
  });
}

// Main path: uiohook can press keys without starting an external process.
async function pressPaste() {
  try {
    uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
  } catch {
    await pressPasteFallback();
  }
}

// Recent Electron versions return a Promise from clipboard methods. Promise.resolve handles both cases.
const readClipboard = async () => {
  try { const v = await Promise.resolve(clipboard.readText()); return typeof v === 'string' ? v : ''; } catch { return ''; }
};

// Puts the text on the clipboard, presses Ctrl+V in the active window, then restores the previous clipboard text.
async function pasteText(text) {
  const prev = await readClipboard();
  await Promise.resolve(clipboard.writeText(String(text)));
  await sleep(60);
  await pressPaste();
  await sleep(400);
  // A failed restore must not fail the dictation.
  if (prev) { try { await Promise.resolve(clipboard.writeText(prev)); } catch {} }
}

module.exports = { pasteText };
