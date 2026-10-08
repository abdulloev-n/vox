// Paste check: opens a window with a text field, pastes two texts through lib/paste.js and prints the field value.
// Run: npx electron scripts/paste-test.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pasteText } = require(path.join(__dirname, '..', 'lib', 'paste.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 420, height: 200, show: true, alwaysOnTop: true });
  await win.loadURL('data:text/html,<body><textarea id=t autofocus style="width:380px;height:120px"></textarea></body>');
  win.focus();
  await sleep(1500);
  for (const text of ['first paste. ', 'second paste']) {
    const t0 = Date.now();
    await pasteText(text);
    console.log('pasted in', Date.now() - t0, 'ms');
  }
  await sleep(300);
  console.log('field:', JSON.stringify(await win.webContents.executeJavaScript('document.getElementById("t").value')));
  app.quit();
});
