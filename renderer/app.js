const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let S = null;            // settings
let entries = [];        // history
let query = '';
let toastTimer = null;
let lastDeleted = null;

const DEFAULT_STT = 'gpt-4o-transcribe';
const DEFAULT_CLEAN = 'gpt-4o-mini';

const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

/* ---------- tabs ---------- */

function showTab(name) {
  $$('.nav-item').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#tab-history').hidden = name !== 'history';
  $('#tab-settings').hidden = name !== 'settings';
  if (name === 'settings') loadMics();
}
$$('.nav-item').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
window.vox.on('nav', showTab);

/* ---------- toast ---------- */

function toast(text, undo) {
  clearTimeout(toastTimer);
  $('#toastText').textContent = text;
  $('#toastUndo').hidden = !undo;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; lastDeleted = null; }, undo ? 7000 : 2200);
}
$('#toastUndo').addEventListener('click', async () => {
  if (!lastDeleted) return;
  await window.vox.invoke('history:restore', lastDeleted);
  lastDeleted = null;
  $('#toast').hidden = true;
  loadHistory();
});

/* ---------- history ---------- */

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(d);
}

function dur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function block(labelText, text, cls) {
  const p = h('p', { class: 'blk-text', text });
  const wrap = h('div', { class: 'blk ' + (cls || '') }, h('div', { class: 'blk-label', text: labelText }), p);
  if (text.length > 280) {
    p.classList.add('clamp');
    const more = h('button', { class: 'blk-more', text: 'Show more', 'aria-expanded': 'false' });
    more.addEventListener('click', () => {
      const open = p.classList.toggle('clamp') === false;
      more.textContent = open ? 'Show less' : 'Show more';
      more.setAttribute('aria-expanded', String(open));
    });
    wrap.append(more);
  }
  return wrap;
}

function entryEl(e) {
  const copy = h('button', { class: 'btn btn-quiet', text: 'Copy' });
  copy.addEventListener('click', async () => {
    await window.vox.invoke('clipboard:copy', e.text);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  const del = h('button', { class: 'btn btn-quiet', text: 'Delete' });
  del.addEventListener('click', async () => {
    lastDeleted = await window.vox.invoke('history:delete', e.id);
    toast('Entry deleted', true);
    loadHistory();
  });

  const head = h('div', { class: 'entry-head' },
    h('span', { class: 'entry-time', text: fmtTime.format(e.ts) }),
    h('span', { text: dur(e.durationMs) }),
    e.language ? h('span', { class: 'chip', text: e.language.toUpperCase() }) : null,
    !e.cleaned ? h('span', { class: 'chip', text: e.cleanFailed ? 'Cleanup failed' : 'No cleanup' }) : null,
    h('div', { class: 'entry-actions' }, copy, del)
  );
  const body = e.cleaned
    ? [block('Said', e.raw, 'raw'), block('Result', e.text)]
    : [block('Pasted as is', e.text)];
  return h('article', { class: 'entry' }, head, body);
}

function renderHistory() {
  const q = query.trim().toLowerCase();
  const items = q ? entries.filter((e) => (e.raw + ' ' + e.text).toLowerCase().includes(q)) : entries;
  const list = $('#list');
  list.replaceChildren();
  let lastDay = '';
  for (const e of items) {
    const d = dayLabel(e.ts);
    if (d !== lastDay) { list.append(h('div', { class: 'day', text: d })); lastDay = d; }
    list.append(entryEl(e));
  }
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  if (!items.length) {
    if (q) {
      $('#emptyTitle').textContent = 'Nothing found';
      $('#emptyText').textContent = 'Try a different word.';
    } else {
      $('#emptyTitle').textContent = 'No entries yet';
      $('#emptyText').textContent = S
        ? `Press ${S.holdLabel} and talk while you hold it, or ${S.toggleLabel} to start and stop with separate presses.`
        : '';
    }
  }
}

async function loadHistory() {
  entries = await window.vox.invoke('history:list');
  renderHistory();
}
$('#search').addEventListener('input', (e) => { query = e.target.value; renderHistory(); });
window.vox.on('history:updated', loadHistory);

/* ---------- settings ---------- */

function applyToUi(s) {
  S = s;
  $$('[data-bind]').forEach((el) => el.setAttribute('aria-checked', String(!!s[el.dataset.bind])));
  $('#sideCleanSub').textContent = s.cleanup ? 'On' : 'Off. Text is pasted as is';
  $('#mode').value = s.mode;
  $('#mode').disabled = !s.cleanup;
  $('#dict').value = s.dictionary.join('\n');
  $('#holdLabel').textContent = s.holdLabel;
  $('#toggleLabel').textContent = s.toggleLabel;
  if (document.activeElement !== $('#stt')) $('#stt').value = s.sttModel;
  if (document.activeElement !== $('#clean')) $('#clean').value = s.cleanModel;
  $('#days').value = String(s.keepDays);
  $('#max').value = String(s.keepMax);
  $('#keyState').textContent = s.hasKey ? 'Key saved. It is stored encrypted on this computer.' : 'No key yet. Recording does not work without one.';
  $('#keyRemove').hidden = !s.hasKey;
  const bad = s.hotkeyErrors || [];
  if (bad.length) {
    setNote($('#hkNote'), 'Another app is using one of these combinations. Change it.', 'err');
  } else if (!$('#hkNote').classList.contains('err')) {
    setNote($('#hkNote'), 'Esc cancels a recording.');
  }
}

function setNote(el, text, kind) {
  el.textContent = text;
  el.classList.remove('ok', 'err');
  if (kind) el.classList.add(kind);
}

async function patch(p) {
  applyToUi(await window.vox.invoke('settings:set', p));
  renderHistory();
}

$$('.switch').forEach((sw) => sw.addEventListener('click', () => {
  const key = sw.dataset.bind;
  patch({ [key]: sw.getAttribute('aria-checked') !== 'true' });
}));
window.vox.on('settings:changed', (s) => { applyToUi(s); });

$('#mode').addEventListener('change', (e) => patch({ mode: e.target.value }));
$('#days').addEventListener('change', (e) => patch({ keepDays: Number(e.target.value) }));
$('#max').addEventListener('change', (e) => patch({ keepMax: Number(e.target.value) }));
$('#mic').addEventListener('change', (e) => patch({ deviceId: e.target.value }));
$('#dict').addEventListener('change', (e) => patch({ dictionary: e.target.value.split('\n') }));

/* models: free text */
async function saveModel(inputId, field, fallback) {
  const input = $(inputId);
  const value = input.value.trim() || fallback;
  input.value = value;
  const before = S[field];
  const next = await window.vox.invoke('settings:set', { [field]: value });
  applyToUi(next);
  if (next[field] === before && value !== before) {
    input.value = before;
    setNote($('#modelNote'), 'That model name has characters that are not allowed. Use letters, digits, dots, dashes, colons and slashes.', 'err');
  } else {
    setNote($('#modelNote'), 'Saved.', 'ok');
  }
}
$('#stt').addEventListener('change', () => saveModel('#stt', 'sttModel', DEFAULT_STT));
$('#clean').addEventListener('change', () => saveModel('#clean', 'cleanModel', DEFAULT_CLEAN));

/* hotkeys */
$$('[data-record]').forEach((btn) => btn.addEventListener('click', async () => {
  const target = btn.dataset.record;
  const kbd = target === 'hold' ? $('#holdLabel') : $('#toggleLabel');
  const old = kbd.textContent;
  btn.disabled = true;
  btn.textContent = 'Press keys…';
  kbd.textContent = '…';
  setNote($('#hkNote'), 'Press the new combination. Esc cancels.');
  const r = await window.vox.invoke('hotkey:record', target);
  btn.disabled = false;
  btn.textContent = 'Change';
  S = r.settings;
  kbd.textContent = old;
  $('#hkNote').classList.remove('err', 'ok');
  applyToUi(r.settings);
  if (r.error) setNote($('#hkNote'), r.error, 'err');
  else setNote($('#hkNote'), 'Saved. Esc cancels a recording.', 'ok');
}));

/* API key */
$('#keyShow').addEventListener('click', (e) => {
  const input = $('#key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  e.target.textContent = show ? 'Hide' : 'Show';
  e.target.setAttribute('aria-pressed', String(show));
});
$('#keySave').addEventListener('click', async () => {
  const value = $('#key').value.trim();
  if (!value) { setNote($('#keyNote'), 'Paste your key into the field.', 'err'); return; }
  setNote($('#keyNote'), 'Checking the key…');
  try {
    const r = await window.vox.invoke('apikey:set', value);
    $('#key').value = '';
    applyToUi(r.settings);
    if (r.check === 'ok') setNote($('#keyNote'), 'Key saved and verified.', 'ok');
    else setNote($('#keyNote'), 'Key saved, but the check failed: ' + r.check, 'err');
  } catch (err) {
    setNote($('#keyNote'), 'Could not save the key: ' + (err.message || err), 'err');
  }
});
$('#keyRemove').addEventListener('click', async () => {
  const r = await window.vox.invoke('apikey:set', '');
  applyToUi(r.settings);
  setNote($('#keyNote'), 'Key removed.');
});

/* microphone */
async function loadMics() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch {}
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch {}
  const sel = $('#mic');
  sel.replaceChildren(h('option', { value: '', text: 'System default' }));
  for (const d of devices) sel.append(h('option', { value: d.deviceId, text: d.label || 'Microphone' }));
  sel.value = S && S.deviceId && devices.some((d) => d.deviceId === S.deviceId) ? S.deviceId : '';
}

/* erase history */
const entriesWord = (n) => (n === 1 ? 'entry' : 'entries');
$('#wipe').addEventListener('click', () => {
  $('#wipeText').textContent = `Delete ${entries.length} ${entriesWord(entries.length)}? This cannot be undone.`;
  $('#wipeYes').textContent = `Delete ${entries.length} ${entriesWord(entries.length)}`;
  $('#wipeConfirm').hidden = false;
  $('#wipeYes').disabled = entries.length === 0;
});
$('#wipeNo').addEventListener('click', () => { $('#wipeConfirm').hidden = true; });
$('#wipeYes').addEventListener('click', async () => {
  await window.vox.invoke('history:clear');
  $('#wipeConfirm').hidden = true;
  await loadHistory();
  toast('History erased');
});

/* ---------- start ---------- */

(async function init() {
  applyToUi(await window.vox.invoke('settings:get'));
  await loadHistory();
})();
