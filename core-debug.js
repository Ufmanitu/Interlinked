// Hibák és teszt-eredmények a képernyőn, másolás gombbal
const S = { copy: 'Másolás', copied: 'Másolva', errors: 'Hibák' };

const errors = [];
let box = null, pre = null, btn = null, head = null;

function ensureBox() {
  if (box || typeof document === 'undefined') return;
  box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:40%;overflow:auto;' +
    'background:rgba(60,0,0,.92);color:#fff;font:12px monospace;padding:6px;z-index:9999;display:none;';
  head = document.createElement('div');
  head.style.cssText = 'font-weight:bold;margin-bottom:4px;';
  btn = document.createElement('button');
  btn.textContent = S.copy;
  btn.style.cssText = 'margin-left:8px;font:12px monospace;';
  btn.onclick = async () => {
    await copyText(pre.textContent);
    btn.textContent = S.copied;
    setTimeout(() => { btn.textContent = S.copy; }, 1200);
  };
  head.appendChild(btn);
  pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;';
  box.appendChild(head);
  box.appendChild(pre);
  document.body.appendChild(box);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* nincs mit tenni */ }
    ta.remove();
  }
}

export function logError(msg) {
  errors.push(String(msg));
  ensureBox();
  if (!box) return;
  head.firstChild === btn ? head.insertBefore(document.createTextNode(S.errors + ' (' + errors.length + ')'), btn)
    : (head.firstChild.textContent = S.errors + ' (' + errors.length + ')');
  pre.textContent = errors.join('\n');
  box.style.display = 'block';
}

// Általános jelentés (pl. tesztek): fixen nyitva, ok -> zöld, különben piros
export function showReport(title, lines, ok) {
  ensureBox();
  if (!box) return;
  head.firstChild === btn ? head.insertBefore(document.createTextNode(title), btn)
    : (head.firstChild.textContent = title);
  pre.textContent = lines.join('\n');
  box.style.background = ok ? 'rgba(0,60,0,.95)' : 'rgba(60,0,0,.95)';
  box.style.maxHeight = '100%';
  box.style.top = '0';
  box.style.display = 'block';
}

export function initDebug() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', e => {
    logError(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    logError('Promise: ' + (r && r.stack ? r.stack : r));
  });
}
