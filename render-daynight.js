// S018: nap/éjszaka színezés (egyetlen multiply-réteg), beltéri keverés, óra-felirat.
// A színek MULTIPLY szorzók: 255 = nincs hatás. A tintAt tiszta; a rajz csak ctx-et használ (DOM nélkül tesztelhető).

export const DAYNIGHT_CONFIG = {
  // [óra 0..24, [r,g,b]]; az első és az utolsó azonos (körbeér); simított (smoothstep) átmenet
  keys: [
    [0, [60, 74, 128]], [5, [68, 82, 136]], [6, [168, 128, 150]], [7, [255, 190, 150]], [8.5, [255, 246, 236]],
    [10, [255, 255, 255]], [16, [255, 255, 255]], [18, [255, 226, 190]], [19.5, [255, 150, 120]],
    [21, [110, 100, 150]], [22.5, [70, 80, 134]], [24, [60, 74, 128]],
  ],
  indoorKeep: 0.25, // beltérben a színezés ennyi része marad
  smooth: 5,        // 1/mp: a beltéri átmenet sebessége
};

// Ideiglenes szövegek (S019-től i18n): 'clock.*' kulcsok.
export const CLOCK_TEXT = {
  hu: { 'clock.day': '{d}. nap', 'clock.paused': 'szünet', 'clock.phase.dawn': 'Hajnal', 'clock.phase.day': 'Nappal', 'clock.phase.dusk': 'Alkonyat', 'clock.phase.night': 'Éjszaka' },
  en: { 'clock.day': 'Day {d}', 'clock.paused': 'paused', 'clock.phase.dawn': 'Dawn', 'clock.phase.day': 'Day', 'clock.phase.dusk': 'Dusk', 'clock.phase.night': 'Night' },
};

const WHITE = [255, 255, 255];
const smooth = u => u * u * (3 - 2 * u);

// A nap perce (0..1440, körbeér) -> [r,g,b] szorzó. Hibás bemenet/kulcsok -> fehér (nincs színezés).
export function tintAt(minuteOfDay, cfg = DAYNIGHT_CONFIG) {
  const keys = cfg && cfg.keys;
  if (typeof minuteOfDay !== 'number' || !isFinite(minuteOfDay) || !Array.isArray(keys) || keys.length < 2) return WHITE.slice();
  const h = (((minuteOfDay % 1440) + 1440) % 1440) / 60;
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, c0] = keys[i], [h1, c1] = keys[i + 1];
    if (h >= h0 && h < h1) {
      const s = smooth((h - h0) / (h1 - h0));
      return [0, 1, 2].map(k => c0[k] + (c1[k] - c0[k]) * s);
    }
  }
  return keys[keys.length - 1][1].slice();
}

// A színezés erőssége mix (0 = nincs, 1 = teljes): 255 + (c-255)·mix, egészre kerekítve, 0..255-re vágva.
export function tintMix(rgb, mix) {
  const m = typeof mix === 'number' && isFinite(mix) ? Math.min(1, Math.max(0, mix)) : 1;
  return rgb.map(c => Math.min(255, Math.max(0, Math.round(255 + (c - 255) * m))));
}

export function createDayNight() { return { indoor: 0, css: null }; }

// indoorTarget: 0 kint, 1 bent; a váltás simított, fps-független. Hibás dt -> nincs változás.
export function stepDayNight(dn, indoorTarget, dt, cfg = DAYNIGHT_CONFIG) {
  if (typeof dt !== 'number' || !(dt > 0) || !isFinite(dt)) return dn.indoor;
  const target = indoorTarget ? 1 : 0;
  dn.indoor += (target - dn.indoor) * (1 - Math.exp(-cfg.smooth * dt));
  if (Math.abs(target - dn.indoor) < 0.001) dn.indoor = target;
  return dn.indoor;
}

// A tényleges szorzó a beltéri keveréssel.
export function dayNightTint(dn, minuteOfDay, cfg = DAYNIGHT_CONFIG) {
  const indoor = dn && typeof dn.indoor === 'number' && isFinite(dn.indoor) ? Math.min(1, Math.max(0, dn.indoor)) : 0;
  return tintMix(tintAt(minuteOfDay, cfg), 1 - (1 - cfg.indoorKeep) * indoor);
}

// Multiply-réteg a teljes nézetre; ha nincs színezés (nappal / beltérben nappal), nem rajzol. -> rajzolt-e
export function drawDayNight(ctx, dn, minuteOfDay, vw, vh, cfg = DAYNIGHT_CONFIG) {
  if (!ctx || !dn) return false;
  const c = dayNightTint(dn, minuteOfDay, cfg);
  if (c[0] >= 255 && c[1] >= 255 && c[2] >= 255) { dn.css = null; return false; }
  const css = `rgb(${c[0]},${c[1]},${c[2]})`;
  dn.css = css;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();
  return true;
}

const two = n => String(n).padStart(2, '0');

// "3. nap 07:05 · Hajnal" (+ " · ×4" ha a sebesség nem 1, " · szünet" ha áll). Hibás info -> ''.
export function clockLabel(info, lang = 'hu', speed = 1) {
  if (!info || !isFinite(info.day) || !isFinite(info.hour) || !isFinite(info.minute)) return '';
  const tab = CLOCK_TEXT[lang] || CLOCK_TEXT.hu;
  const phase = tab['clock.phase.' + info.phase] || '?';
  let s = `${tab['clock.day'].replace('{d}', info.day)} ${two(info.hour)}:${two(info.minute)} · ${phase}`;
  if (speed === 0) s += ' · ' + tab['clock.paused'];
  else if (typeof speed === 'number' && isFinite(speed) && speed !== 1) s += ' · ×' + Number(speed.toFixed(2));
  return s;
}

// Felirat a nézet jobb felső sarkában (sötét árnyékkal az olvashatóságért).
export function drawClockLabel(ctx, text, vw) {
  if (!ctx || !text) return false;
  ctx.save();
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(8,12,20,0.75)';
  ctx.fillText(text, vw - 7, 9);
  ctx.fillStyle = '#e8d9a8';
  ctx.fillText(text, vw - 8, 8);
  ctx.restore();
  return true;
}
