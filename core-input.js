// Bemenet: billentyűzet + Gamepad API, két játékos, konfigurálható kiosztás
export const ACTIONS = ['up', 'down', 'left', 'right', 'interact', 'ability1', 'ability2', 'menu'];

export const DEFAULT_KEYS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'KeyF', ability1: 'KeyG', ability2: 'KeyH', menu: 'KeyQ' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', interact: 'Comma', ability1: 'Period', ability2: 'Slash', menu: 'Semicolon' },
];

// Gamepad: gomb-index kiosztás (standard mapping)
export const DEFAULT_PAD = { interact: 0, ability2: 1, ability1: 2, menu: 9 };
const DEADZONE = 0.3;

export class Input {
  constructor(target = window) {
    this.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    this.pad = { ...DEFAULT_PAD };
    this.down = new Set();
    this.players = [this._blank(), this._blank()];
    this.prev = [this._blank(), this._blank()];
    const block = new Set();
    this.keys.forEach(k => Object.values(k).forEach(c => block.add(c)));
    target.addEventListener('keydown', e => {
      if (block.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    target.addEventListener('keyup', e => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  _blank() {
    return { x: 0, y: 0, interact: false, ability1: false, ability2: false, menu: false,
             interactPressed: false, ability1Pressed: false, ability2Pressed: false, menuPressed: false };
  }

  setKeys(player, map) { Object.assign(this.keys[player], map); }
  setPadButtons(map) { Object.assign(this.pad, map); }

  // Minden logikai lépés elején hívd.
  update() {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    for (let p = 0; p < 2; p++) {
      const st = this.players[p];
      this.prev[p] = { ...st };
      const k = this.keys[p];
      let x = (this.down.has(k.right) ? 1 : 0) - (this.down.has(k.left) ? 1 : 0);
      let y = (this.down.has(k.down) ? 1 : 0) - (this.down.has(k.up) ? 1 : 0);
      const btn = { interact: this.down.has(k.interact), ability1: this.down.has(k.ability1),
                    ability2: this.down.has(k.ability2), menu: this.down.has(k.menu) };
      const gp = pads[p];
      if (gp) {
        let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        if (Math.abs(ax) < DEADZONE) ax = 0;
        if (Math.abs(ay) < DEADZONE) ay = 0;
        const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
        if (b(14)) ax = -1; if (b(15)) ax = 1;
        if (b(12)) ay = -1; if (b(13)) ay = 1;
        if (ax !== 0) x = ax;
        if (ay !== 0) y = ay;
        for (const a of ['interact', 'ability1', 'ability2', 'menu']) btn[a] = btn[a] || b(this.pad[a]);
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      st.x = x; st.y = y;
      for (const a of ['interact', 'ability1', 'ability2', 'menu']) {
        st[a] = btn[a];
        st[a + 'Pressed'] = btn[a] && !this.prev[p][a];
      }
    }
  }

  get(player) { return this.players[player]; }
}
