// Bemenet: billentyűzet + Gamepad API, két játékos, konfigurálható kiosztás.
export const ACTIONS = ['interact', 'ability1', 'ability2', 'menu'];
export const DEFAULT_BINDINGS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], interact: ['KeyE'], ability1: ['KeyQ'], ability2: ['KeyR'], menu: ['Tab'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], interact: ['Slash'], ability1: ['Period'], ability2: ['Comma'], menu: ['Backspace'] },
];
export const PAD_BUTTONS = { interact: 0, ability1: 2, ability2: 3, menu: 9, up: 12, down: 13, left: 14, right: 15 };
const DEADZONE = 0.25;
const blank = () => ({ x: 0, y: 0, held: {}, pressed: {} });

export class Input {
  constructor({ target = globalThis.window, nav = globalThis.navigator, bindings = DEFAULT_BINDINGS } = {}) {
    this.bindings = JSON.parse(JSON.stringify(bindings));
    this.nav = nav;
    this.keys = new Set();
    this.players = [blank(), blank()];
    if (target && target.addEventListener) {
      target.addEventListener('keydown', (e) => this._key(e, true));
      target.addEventListener('keyup', (e) => this._key(e, false));
      target.addEventListener('blur', () => this.keys.clear());
    }
  }
  setBinding(player, action, codes) { this.bindings[player][action] = [...codes]; }
  setKey(code, down) { if (down) this.keys.add(code); else this.keys.delete(code); }
  _key(e, down) {
    if (this.bindings.some((b) => Object.values(b).some((c) => c.includes(e.code)))) e.preventDefault();
    this.setKey(e.code, down);
  }
  _pads() {
    const l = this.nav && this.nav.getGamepads ? this.nav.getGamepads() : [];
    return Array.from(l || []).filter((p) => p && p.connected !== false);
  }
  // Tickenként egyszer hívandó. players[i]: { x, y (-1..1), held{}, pressed{} }
  update() {
    const pads = this._pads();
    this.players.forEach((st, p) => {
      const b = this.bindings[p];
      const pad = pads[p];
      const key = (a) => b[a].some((c) => this.keys.has(c));
      const btn = (a) => !!(pad && pad.buttons[PAD_BUTTONS[a]] && pad.buttons[PAD_BUTTONS[a]].pressed);
      const dir = (a) => (key(a) || btn(a) ? 1 : 0);
      let x = dir('right') - dir('left');
      let y = dir('down') - dir('up');
      if (pad && x === 0 && y === 0) {
        const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
        if (Math.hypot(ax, ay) > DEADZONE) { x = ax; y = ay; }
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      for (const a of ACTIONS) {
        const h = key(a) || btn(a);
        st.pressed[a] = h && !st.held[a];
        st.held[a] = h;
      }
      st.x = x; st.y = y;
    });
  }
}
