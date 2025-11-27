// /opt/prompt-shim.js
// Emulates window.prompt/alert/confirm in Node.
// - If a TTY is attached (-it), use readline-sync for real interactive prompts.
// - Otherwise (piped input), read all stdin once and answer prompts in order.

const fs = require('fs');

function makeBuffered() {
  const MODE = (process.env.PROMPT_MODE || 'lines').toLowerCase(); // 'lines' | 'tokens'
  let buf = '';
  try { buf = fs.readFileSync(0, 'utf8'); } catch { buf = ''; }
  const items = MODE === 'tokens' ? buf.split(/\s+/) : buf.split(/\r?\n/);
  let idx = 0;

  global.prompt = (message = '', def) => {
    if (message) process.stdout.write(String(message) + ' ');
    if (idx < items.length) {
      const ans = items[idx++];
      return ans === '' && def !== undefined ? String(def) : ans;
    }
    return def !== undefined ? String(def) : null; // mimic cancel when no more input
  };
  global.confirm = (msg = '') => {
    if (msg) process.stdout.write(String(msg) + ' ');
    const v = idx < items.length ? (items[idx++] || '').trim().toLowerCase() : '';
    return v === 'y' || v === 'yes' || v === 'true' || v === '1';
  };
  global.alert = (msg) => console.log(String(msg));
}

function makeInteractive() {
  const question = require('readline-sync').question;
  global.prompt = (message = '', def) => {
    const ans = question(message ? String(message) + ' ' : '');
    return ans === '' && def !== undefined ? String(def) : ans;
  };
  global.confirm = (msg = '') => {
    const a = question((msg ? String(msg) + ' ' : '') + '[y/N] ');
    const v = a.trim().toLowerCase();
    return v === 'y' || v === 'yes' || v === 'true' || v === '1';
  };
  global.alert = (msg) => console.log(String(msg));
}

if (process.stdin.isTTY && process.stdout.isTTY) makeInteractive();
else makeBuffered();