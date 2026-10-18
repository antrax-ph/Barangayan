// server.js — Barangay Clash backend. Express + ws + better-sqlite3.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './game.db';
const SECRET = process.env.SECRET || 'change-me-in-prod-' + crypto.randomBytes(8).toString('hex');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  pera REAL NOT NULL DEFAULT 500,
  energiya REAL NOT NULL DEFAULT 500,
  galing INTEGER NOT NULL DEFAULT 0,
  last_tick INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  built_at INTEGER NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_buildings_player ON buildings(player_id);
CREATE TABLE IF NOT EXISTS troops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_troops_player_type ON troops(player_id, type);
CREATE TABLE IF NOT EXISTS train_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  ready_at INTEGER NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_train_player ON train_queue(player_id);
CREATE TABLE IF NOT EXISTS raid_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id INTEGER NOT NULL,
  defender_id INTEGER NOT NULL,
  result TEXT NOT NULL,
  loot_pera INTEGER NOT NULL DEFAULT 0,
  loot_energiya INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
`);

// ---------- filipino-themed game config ----------
const BUILDINGS = {
  barangay_hall:    { name: 'Barangay Hall',    cost: 0,   pera: 0,   energiya: 0,   size: 4, hp: 2000, buildTime: 0,      accent: '#d4a04a', desc: 'Puso ng iyong barangay' },
  sarisari_store:   { name: 'Sari-Sari Store',  cost: 0,   pera: 150, energiya: 0,   size: 3, hp: 400,  buildTime: 15_000, rate: 3, accent: '#c9a24a', desc: 'Tindahan ng baryo — gumagawa ng pera' },
  kalamansi_farm:   { name: 'Kalamansi Farm',   cost: 0,   pera: 0,   energiya: 150, size: 3, hp: 400,  buildTime: 15_000, rate: 3, accent: '#9a4ac9', desc: 'Sakahan ng kalamansi — gumagawa ng energiya' },
  jeepney_terminal: { name: 'Jeepney Terminal', cost: 0,   pera: 200, energiya: 0,   size: 3, hp: 500,  buildTime: 30_000, accent: '#c96a4a', desc: 'Sakayan ng mga mandirigma' },
  balangay:         { name: 'Balangay',         cost: 0,   pera: 100, energiya: 100, size: 4, hp: 300,  buildTime: 20_000, cap: 20, accent: '#8ac96a', desc: 'Bangkang tirahan ng tropa' },
  bakod:            { name: 'Bakod',            cost: 0,   pera: 50,  energiya: 0,   size: 1, hp: 500,  buildTime: 2_000,  accent: '#999',    desc: 'Bamboo na harang' },
  lantaka:          { name: 'Lantaka',          cost: 0,   pera: 300, energiya: 0,   size: 2, hp: 600,  buildTime: 40_000, dmg: 40, range: 5, accent: '#888', desc: 'Kanon ng depensa' },
  bantay_tower:     { name: 'Bantay Tower',     cost: 0,   pera: 400, energiya: 100, size: 2, hp: 500,  buildTime: 60_000, dmg: 30, range: 7, accent: '#a88ac9', desc: 'Toreng nagbabantay' },
};

const TROOPS = {
  mandirigma: { name: 'Mandirigma', cost: 25,  time: 8_000,  hp: 100, dmg: 20, speed: 1.5, housing: 1, accent: '#c96a4a' },
  mangangaso: { name: 'Mangangaso', cost: 50,  time: 12_000, hp: 70,  dmg: 15, speed: 1.6, housing: 1, ranged: 4, accent: '#8ac96a' },
  higante:    { name: 'Higante',    cost: 150, time: 30_000, hp: 600, dmg: 40, speed: 1.0, housing: 5, targetsDefense: true, accent: '#c9a24a' },
};

const RES_RATE = 3;
const MAX_OFFLINE_SEC = 8 * 3600;

// ---------- fiesta event ----------
const FIESTA_PERIOD = 30 * 60 * 1000; // 30 min cycle
const FIESTA_DURATION = 3 * 60 * 1000; // 3 min fiesta
function fiestaState(now = Date.now()) {
  const phase = now % FIESTA_PERIOD;
  const active = phase < FIESTA_DURATION;
  const remaining = active ? FIESTA_DURATION - phase : FIESTA_PERIOD - phase;
  return { active, remaining, multiplier: active ? 1.5 : 1.0 };
}

// ---------- helpers ----------
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + h;
}
function checkPw(pw, stored) {
  const [salt, h] = stored.split(':');
  const c = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(c, 'hex'));
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(tok) {
  if (!tok) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expect)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}
function authMw(req, res, next) {
  const tok = req.headers.authorization?.replace('Bearer ', '');
  const p = verifyToken(tok);
  if (!p) return res.status(401).json({ error: 'auth' });
  req.playerId = p.id;
  next();
}

function tickPlayer(id) {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!p) return null;
  const now = Date.now();
  const elapsed = Math.min((now - (p.last_tick || now)) / 1000, MAX_OFFLINE_SEC);
  if (elapsed <= 0) { db.prepare('UPDATE players SET last_tick = ? WHERE id = ?').run(now, id); return db.prepare('SELECT * FROM players WHERE id = ?').get(id); }

  const stores = db.prepare("SELECT COUNT(*) c FROM buildings WHERE player_id = ? AND type = 'sarisari_store'").get(id).c;
  const farms  = db.prepare("SELECT COUNT(*) c FROM buildings WHERE player_id = ? AND type = 'kalamansi_farm'").get(id).c;
  const fm = fiestaState(now).multiplier;
  const peraGain = stores * RES_RATE * elapsed * fm;
  const energiyaGain = farms * RES_RATE * elapsed * fm;

  db.prepare('UPDATE players SET pera = pera + ?, energiya = energiya + ?, last_tick = ? WHERE id = ?')
    .run(peraGain, energiyaGain, now, id);

  const ready = db.prepare('SELECT * FROM train_queue WHERE player_id = ? AND ready_at <= ?').all(id, now);
  for (const r of ready) {
    db.prepare(`INSERT INTO troops (player_id, type, count) VALUES (?, ?, 1)
      ON CONFLICT(player_id, type) DO UPDATE SET count = count + 1`).run(id, r.type);
    db.prepare('DELETE FROM train_queue WHERE id = ?').run(r.id);
  }
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function publicState(id) {
  const p = tickPlayer(id);
  if (!p) return null;
  const buildings = db.prepare('SELECT * FROM buildings WHERE player_id = ?').all(id);
  const troops = db.prepare('SELECT type, count FROM troops WHERE player_id = ?').all(id);
  const queue = db.prepare('SELECT id, type, ready_at FROM train_queue WHERE player_id = ? ORDER BY ready_at').all(id);
  return {
    id: p.id, username: p.username, pera: Math.floor(p.pera), energiya: Math.floor(p.energiya),
    galing: p.galing, buildings, troops, queue,
    config: { BUILDINGS, TROOPS, RES_RATE },
    fiesta: fiestaState(),
    serverNow: Date.now(),
  };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4)
    return res.status(400).json({ error: 'invalid input' });
  try {
    const hash = hashPw(password);
    const now = Date.now();
    const info = db.prepare('INSERT INTO players (username, pw_hash, last_tick, created) VALUES (?, ?, ?, ?)')
      .run(username, hash, now, now);
    const id = info.lastInsertRowid;
    const start = [
      ['barangay_hall', 13, 13],
      ['sarisari_store', 10, 13], ['sarisari_store', 17, 13],
      ['kalamansi_farm', 13, 10], ['kalamansi_farm', 13, 17],
      ['jeepney_terminal', 8, 8], ['balangay', 18, 18],
    ];
    const stmt = db.prepare('INSERT INTO buildings (player_id, type, x, y, level, built_at) VALUES (?, ?, ?, ?, 1, ?)');
    for (const [t, x, y] of start) stmt.run(id, t, x, y, now);
    const token = signToken({ id, u: username, t: now });
    res.json({ token, state: publicState(id) });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'username taken' });
    console.error(e); res.status(500).json({ error: 'server' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const p = db.prepare('SELECT * FROM players WHERE username = ?').get(username);
  if (!p || !checkPw(password, p.pw_hash)) return res.status(401).json({ error: 'bad creds' });
  const token = signToken({ id: p.id, u: p.username, t: Date.now() });
  res.json({ token, state: publicState(p.id) });
});

app.get('/api/state', authMw, (req, res) => {
  res.json(publicState(req.playerId));
});

app.post('/api/build', authMw, (req, res) => {
  const { type, x, y } = req.body || {};
  const cfg = BUILDINGS[type];
  if (!cfg) return res.status(400).json({ error: 'unknown building' });
  const p = tickPlayer(req.playerId);
  const existing = db.prepare('SELECT * FROM buildings WHERE player_id = ?').all(req.playerId);
  const sz = cfg.size;
  for (const b of existing) {
    const bs = BUILDINGS[b.type].size;
    if (x < b.x + bs && x + sz > b.x && y < b.y + bs && y + sz > b.y)
      return res.status(400).json({ error: 'overlap' });
  }
  if (x < 0 || y < 0 || x + sz > 30 || y + sz > 30) return res.status(400).json({ error: 'out of bounds' });
  if (cfg.pera > p.pera || cfg.energiya > p.energiya) return res.status(400).json({ error: 'cost' });
  db.prepare('UPDATE players SET pera = pera - ?, energiya = energiya - ? WHERE id = ?').run(cfg.pera, cfg.energiya, req.playerId);
  db.prepare('INSERT INTO buildings (player_id, type, x, y, level, built_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(req.playerId, type, x, y, Date.now());
  res.json(publicState(req.playerId));
});

app.post('/api/train', authMw, (req, res) => {
  const { type } = req.body || {};
  const cfg = TROOPS[type];
  if (!cfg) return res.status(400).json({ error: 'unknown troop' });
  const p = tickPlayer(req.playerId);
  if (p.energiya < cfg.cost) return res.status(400).json({ error: 'cost' });
  const q = db.prepare('SELECT COUNT(*) c FROM train_queue WHERE player_id = ?').get(req.playerId).c;
  if (q >= 10) return res.status(400).json({ error: 'queue full' });
  const readyAt = Date.now() + cfg.time;
  db.prepare('UPDATE players SET energiya = energiya - ? WHERE id = ?').run(cfg.cost, req.playerId);
  db.prepare('INSERT INTO train_queue (player_id, type, ready_at) VALUES (?, ?, ?)').run(req.playerId, type, readyAt);
  res.json(publicState(req.playerId));
});

app.get('/api/raid/find', authMw, (req, res) => {
  const others = db.prepare('SELECT id, username, galing FROM players WHERE id != ? ORDER BY ABS(galing - ?) ASC LIMIT 5')
    .all(req.playerId, db.prepare('SELECT galing FROM players WHERE id = ?').get(req.playerId)?.galing || 0);
  if (others.length === 0) {
    return res.json({ procedural: true, target: {
      id: -1, username: 'Pintakasi Raider', galing: 0,
      buildings: genProceduralBase(), pera: 300 + Math.floor(Math.random() * 500), energiya: 300 + Math.floor(Math.random() * 500)
    }});
  }
  const t = others[Math.floor(Math.random() * others.length)];
  const buildings = db.prepare('SELECT * FROM buildings WHERE player_id = ?').all(t.id);
  const stores = buildings.filter(b => b.type === 'sarisari_store').length;
  const farms  = buildings.filter(b => b.type === 'kalamansi_farm').length;
  const pera = Math.min(500, 100 + stores * 80);
  const energiya = Math.min(500, 100 + farms * 80);
  res.json({ procedural: false, target: { id: t.id, username: t.username, galing: t.galing, buildings, pera, energiya } });
});

function genProceduralBase() {
  const out = [];
  const c = 15;
  out.push({ type: 'barangay_hall', x: c - 2, y: c - 2, level: 1, id: -1 });
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2, r = 5;
    out.push({ type: 'sarisari_store', x: Math.round(c + Math.cos(a) * r) - 1, y: Math.round(c + Math.sin(a) * r) - 1, level: 1, id: -100 - i });
  }
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2, r = 6;
    out.push({ type: 'kalamansi_farm', x: Math.round(c + Math.cos(a) * r) - 1, y: Math.round(c + Math.sin(a) * r) - 1, level: 1, id: -200 - i });
  }
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2, r = 4;
    out.push({ type: 'lantaka', x: Math.round(c + Math.cos(a) * r) - 1, y: Math.round(c + Math.sin(a) * r) - 1, level: 1, id: -300 - i });
  }
  return out;
}

app.post('/api/raid/attack', authMw, (req, res) => {
  const { targetId, troops } = req.body || {};
  const p = tickPlayer(req.playerId);
  const deployed = {};
  let totalHousing = 0;
  for (const [t, c] of Object.entries(troops || {})) {
    const cfg = TROOPS[t];
    if (!cfg) continue;
    const owned = db.prepare('SELECT count FROM troops WHERE player_id = ? AND type = ?').get(req.playerId, t);
    const use = Math.min(c, owned?.count || 0);
    if (use > 0) { deployed[t] = use; totalHousing += use * cfg.housing; }
  }
  if (totalHousing === 0) return res.status(400).json({ error: 'no troops' });

  const targetBuildings = targetId === -1
    ? genProceduralBase()
    : db.prepare('SELECT * FROM buildings WHERE player_id = ?').all(targetId);
  let defenderHp = 0;
  for (const b of targetBuildings) defenderHp += (BUILDINGS[b.type]?.hp || 100) * (b.level || 1);
  let attackerPower = 0;
  for (const [t, c] of Object.entries(deployed)) {
    attackerPower += TROOPS[t].dmg * c * (TROOPS[t].targetsDefense ? 2 : 1);
  }
  const win = attackerPower > defenderHp * 0.6;
  const ratio = Math.min(1, attackerPower / Math.max(1, defenderHp));

  let lootPera = 0, lootEnergiya = 0;
  if (targetId === -1) {
    lootPera = Math.floor((300 + Math.random() * 500) * ratio);
    lootEnergiya = Math.floor((300 + Math.random() * 500) * ratio);
  } else {
    const tp = db.prepare('SELECT pera, energiya FROM players WHERE id = ?').get(targetId);
    if (tp) {
      lootPera = Math.floor(Math.min(tp.pera * 0.3, 800) * ratio);
      lootEnergiya = Math.floor(Math.min(tp.energiya * 0.3, 800) * ratio);
      db.prepare('UPDATE players SET pera = MAX(0, pera - ?), energiya = MAX(0, energiya - ?) WHERE id = ?').run(lootPera, lootEnergiya, targetId);
    }
  }

  for (const [t, c] of Object.entries(deployed)) {
    db.prepare('UPDATE troops SET count = MAX(0, count - ?) WHERE player_id = ? AND type = ?').run(c, req.playerId, t);
  }

  const galingDelta = win ? 30 : -15;
  db.prepare('UPDATE players SET pera = pera + ?, energiya = energiya + ?, galing = MAX(0, galing + ?) WHERE id = ?')
    .run(lootPera, lootEnergiya, galingDelta, req.playerId);
  if (targetId !== -1) {
    db.prepare('UPDATE players SET galing = MAX(0, galing - ?) WHERE id = ?').run(win ? 30 : 0, targetId);
  }

  db.prepare('INSERT INTO raid_log (attacker_id, defender_id, result, loot_pera, loot_energiya, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.playerId, targetId, win ? 'win' : 'lose', lootPera, lootEnergiya, Date.now());

  if (targetId !== -1) {
    for (const c of wss.clients) if (c.playerId === targetId && c.readyState === 1) {
      c.send(JSON.stringify({ type: 'raided', by: p.username, win, lootPera, lootEnergiya }));
    }
  }

  res.json({ win, lootPera, lootEnergiya, galingDelta, state: publicState(req.playerId) });
});

app.get('/api/raid/log', authMw, (req, res) => {
  const rows = db.prepare(`SELECT r.*, p.username as attacker_name FROM raid_log r
    JOIN players p ON p.id = r.attacker_id
    WHERE r.defender_id = ? ORDER BY r.ts DESC LIMIT 20`).all(req.playerId);
  res.json(rows);
});

// ---------- ws ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const tok = url.searchParams.get('token');
  const p = verifyToken(tok);
  if (!p) return ws.close();
  ws.playerId = p.id;
  ws.send(JSON.stringify({ type: 'hello', id: p.id }));
});

server.listen(PORT, () => console.log(`🇵🇭 Barangay Clash listening on :${PORT}`));