// Clipboard diagnostics: shows which clipboard calls work in the installed Electron version.
// Run: npx electron scripts/diag.js
const { app, clipboard } = require('electron');

async function step(name, fn) {
  try { await fn(); console.log('OK  ', name); }
  catch (e) { console.log('FAIL', name, '->', String(e && e.message).slice(0, 60)); }
}

app.whenReady().then(async () => {
  const prev = await Promise.resolve(clipboard.readText());
  await step('write plain', () => clipboard.writeText('hello'));
  await step('write multiline', () => clipboard.writeText('a\nb\r\nc'));
  await step('write emoji', () => clipboard.writeText('ok 😀'));
  await step('write empty string', () => clipboard.writeText(''));
  await step('write undefined (expected to fail)', () => clipboard.writeText(undefined));
  if (typeof prev === 'string' && prev) await clipboard.writeText(prev);
  app.quit();
});
