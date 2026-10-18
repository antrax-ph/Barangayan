const BUILDINGS_UI = [
  { type: 'sarisari_store', name: 'Sari-Sari', cost: '150₱', icon: '🏪' },
  { type: 'kalamansi_farm', name: 'Kalamansi', cost: '150E', icon: '🍋' },
  { type: 'jeepney_terminal', name: 'Jeepney', cost: '200₱', icon: '🚌' },
  { type: 'balangay', name: 'Balangay', cost: '100₱ 100E', icon: '⛵' },
  { type: 'bakod', name: 'Bakod', cost: '50₱', icon: '🎋' },
  { type: 'lantaka', name: 'Lantaka', cost: '300₱', icon: '💣' },
  { type: 'bantay_tower', name: 'Bantay', cost: '400₱ 100E', icon: '🗼' },
];
const TROOPS_UI = [
  { type: 'mandirigma', name: 'Mandirigma', cost: '25E', icon: '🪓' },
  { type: 'mangangaso', name: 'Mangangaso', cost: '50E', icon: '🏹' },
  { type: 'higante', name: 'Higante', cost: '150E', icon: '🗿' },
];

export class UI {
  constructor(state, net, renderer) {
    this.s = state; this.net = net; this.r = renderer;
    this.handlers = {};
    this.buildDom();
    this.showAuth();
    setInterval(() => this.net.token && this.net.sync().catch(() => {}), 5000);
    setInterval(() => this.tickTimers(), 1000);
  }
  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, d) { this.handlers[evt]?.(d); }

  buildDom() {
    const auth = document.createElement('div');
    auth.id = 'auth'; auth.className = 'modal';
    auth.innerHTML = `
      <div class="modal-box">
        <h1>BARANGAY CLASH</h1>
        <p class="tagline">bayanihan · laban · tagumpay</p>
        <input id="u" placeholder="username" />
        <input id="p" type="password" placeholder="password" />
        <div class="row">
          <button id="loginBtn">Login</button>
          <button id="regBtn" class="primary">Register</button>
        </div>
        <p id="authErr" class="err"></p>
      </div>`;
    document.body.appendChild(auth);

    const hud = document.createElement('div');
    hud.id = 'hud'; hud.style.display = 'none';
    hud.innerHTML = `
      <div class="top">
        <div class="res pera"><span>₱</span><b id="pera">0</b></div>
        <div class="res energiya"><span>⚡</span><b id="energiya">0</b></div>
        <div class="res galing"><span>🏅</span><b id="galing">0</b></div>
        <div id="fiestaSlot"></div>
        <div class="spacer"></div>
        <button id="raidBtn" class="primary">⚔ PINTAKASI</button>
      </div>
      <div class="bottom">
        <div class="build-menu" id="buildMenu"></div>
        <div class="troop-menu" id="troopMenu"></div>
      </div>
      <div class="selected-panel" id="selPanel" style="display:none"></div>
      <div class="toast" id="toast"></div>
      <div class="queue" id="queue"></div>
    `;
    document.body.appendChild(hud);

    const raid = document.createElement('div');
    raid.id = 'raidModal'; raid.className = 'modal'; raid.style.display = 'none';
    raid.innerHTML = `<div class="modal-box wide">
      <h2>⚔ Pintakasi</h2>
      <div id="raidContent"></div>
      <div class="row"><button id="closeRaid">Close</button></div>
    </div>`;
    document.body.appendChild(raid);

    document.getElementById('loginBtn').onclick = () => this.tryAuth('login');
    document.getElementById('regBtn').onclick = () => this.tryAuth('register');
    document.getElementById('raidBtn').onclick = () => this.openRaid();
    document.getElementById('closeRaid').onclick = () => document.getElementById('raidModal').style.display = 'none';

    for (const b of BUILDINGS_UI) {
      const el = document.createElement('button');
      el.className = 'build-btn';
      el.innerHTML = `<span>${b.icon}</span><small>${b.name}</small><em>${b.cost}</em>`;
      el.onclick = () => { this.emit('placing', b.type); this.toast(`Ilalagay: ${b.name} — i-tap ang mapa`); };
      document.getElementById('buildMenu').appendChild(el);
    }
    for (const t of TROOPS_UI) {
      const el = document.createElement('button');
      el.className = 'train-btn';
      el.innerHTML = `<span>${t.icon}</span><small>${t.name}</small><em>${t.cost}</em>`;
      el.onclick = () => this.emit('train', t.type);
      document.getElementById('troopMenu').appendChild(el);
    }
  }
  showAuth() { document.getElementById('auth').style.display = 'flex'; }
  hideAuth() { document.getElementById('auth').style.display = 'none'; }
  showGame() { this.hideAuth(); document.getElementById('hud').style.display = 'block'; }

  async tryAuth(mode) {
    const u = document.getElementById('u').value.trim();
    const p = document.getElementById('p').value;
    const err = document.getElementById('authErr');
    err.textContent = '';
    try {
      if (mode === 'login') await this.net.login(u, p);
      else await this.net.register(u, p);
    } catch (e) { err.textContent = e.message; }
  }
  refresh() {
    const s = this.s.player;
    if (!s) return;
    document.getElementById('pera').textContent = Math.floor(s.pera);
    document.getElementById('energiya').textContent = Math.floor(s.energiya);
    document.getElementById('galing').textContent = s.galing;
    const slot = document.getElementById('fiestaSlot');
    if (s.fiesta?.active) {
      slot.innerHTML = `<div class="fiesta-badge">🎉 FIESTA ×1.5 — ${Math.ceil(s.fiesta.remaining/1000)}s</div>`;
    } else {
      slot.innerHTML = '';
    }
    if (this.s.selected) this.showSelected(this.s.selected);
    this.tickTimers();
  }
  showSelected(b) {
    const panel = document.getElementById('selPanel');
    if (!b) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const name = b.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    panel.innerHTML = `<b>${name}</b><div style="color:#c5a878;font-size:12px;margin-top:4px">Level ${b.level}</div><button id="closeSel">×</button>`;
    document.getElementById('closeSel').onclick = () => { this.s.selected = null; panel.style.display = 'none'; };
  }
  tickTimers() {
    const s = this.s.player; if (!s) return;
    const q = document.getElementById('queue');
    const now = Date.now();
    const items = s.queue.map(t => {
      const secs = Math.max(0, Math.ceil((t.ready_at - now) / 1000));
      return `<div class="q-item">${t.type} <em>${secs}s</em></div>`;
    }).join('');
    q.innerHTML = items;
    if (s.fiesta?.active) {
      const slot = document.getElementById('fiestaSlot');
      slot.innerHTML = `<div class="fiesta-badge">🎉 FIESTA ×1.5 — ${Math.ceil(s.fiesta.remaining/1000)}s</div>`;
    }
  }
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2500);
  }
  async openRaid() {
    const modal = document.getElementById('raidModal');
    const content = document.getElementById('raidContent');
    modal.style.display = 'flex';
    content.innerHTML = '<p>Nagsusubok...</p>';
    try {
      const { target, procedural } = await this.net.findRaid();
      this.s.raidTarget = target;
      content.innerHTML = `
        <p>Kalaban: <b>${target.username}</b> ${procedural ? '(NPC)' : `(${target.galing}🏅)`}</p>
        <p>Loot: ₱${target.pera} ⚡${target.energiya}</p>
        <p>I-deploy ang tropa:</p>
        <div id="deployList"></div>
        <div class="row">
          <button id="doAttack" class="primary">SIGE, LABAN!</button>
          <button id="cancelRaid">Bawi</button>
        </div>`;
      const list = document.getElementById('deployList');
      const deploy = {};
      for (const t of this.s.player.troops) {
        if (t.count <= 0) continue;
        const row = document.createElement('div');
        row.className = 'deploy-row';
        row.innerHTML = `<span>${t.type}</span> <input type="number" min="0" max="${t.count}" value="0" /> / ${t.count}`;
        const inp = row.querySelector('input');
        inp.oninput = () => { deploy[t.type] = parseInt(inp.value) || 0; };
        list.appendChild(row);
      }
      document.getElementById('doAttack').onclick = async () => {
        try {
          const r = await this.net.attack(target.id, deploy);
          this.s.raidTarget = null;
          if (r.win) this.r.shake();
          this.toast(r.win ? `Panalo! +${r.lootPera}₱ +${r.lootEnergiya}E` : `Talo. +${r.lootPera}₱ +${r.lootEnergiya}E`);
          modal.style.display = 'none';
        } catch (e) { this.toast(e.message); }
      };
      document.getElementById('cancelRaid').onclick = () => { this.s.raidTarget = null; modal.style.display = 'none'; };
    } catch (e) { content.innerHTML = `<p class="err">${e.message}</p>`; }
  }
}