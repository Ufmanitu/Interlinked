// Hibák és riportok a képernyőn, másolás gombbal; FPS-kijelző.
export function createDebug(doc = globalThis.document, win = globalThis.window) {
  const lines = [];
  let panel, pre, fpsEl;
  const text = () => lines.join('\n');
  const copy = async () => {
    const t = text();
    try { await win.navigator.clipboard.writeText(t); }
    catch { const a = doc.createElement('textarea'); a.value = t; doc.body.append(a); a.select(); doc.execCommand('copy'); a.remove(); }
  };
  function ui() {
    if (panel || !doc || !doc.body) return;
    fpsEl = doc.createElement('div');
    fpsEl.style.cssText = 'position:fixed;top:2px;left:4px;font:12px monospace;color:#9fb4d8;z-index:9';
    panel = doc.createElement('div');
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;background:#300d;color:#fcc;font:12px monospace;padding:4px;z-index:10;display:none';
    pre = doc.createElement('pre');
    pre.style.cssText = 'margin:0;white-space:pre-wrap';
    const btn = doc.createElement('button');
    btn.textContent = 'Copy';
    btn.onclick = copy;
    panel.append(btn, pre);
    doc.body.append(fpsEl, panel);
  }
  function render() {
    ui();
    if (!panel) return;
    pre.textContent = text();
    panel.style.display = lines.length ? 'block' : 'none';
  }
  const dbg = {
    lines, text, copy,
    log(msg) { lines.push(String(msg)); if (lines.length > 200) lines.shift(); render(); },
    report(t) { lines.length = 0; lines.push(...String(t).split('\n')); render(); },
    setFps(n) { ui(); if (fpsEl) fpsEl.textContent = n + ' FPS'; },
  };
  if (win && win.addEventListener) {
    win.addEventListener('error', (e) => {
      const f = (e.filename || '').split('/').pop().split('?')[0];
      dbg.log(`${f}:${e.lineno}:${e.colno} ${e.message}` + (e.error && e.error.stack ? '\n' + e.error.stack : ''));
    });
    win.addEventListener('unhandledrejection', (e) => dbg.log('Promise: ' + ((e.reason && e.reason.stack) || e.reason)));
  }
  return dbg;
}
