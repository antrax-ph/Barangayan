export class Net {
  constructor() {
    this.token = localStorage.getItem('token');
    this.handlers = {};
    this.ws = null;
    if (this.token) this.connectWs();
  }
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); }
  emit(evt, data) { (this.handlers[evt] || []).forEach(fn => fn(data)); }
  headers() { return this.token ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } : { 'Content-Type': 'application/json' }; }
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error || 'err');
    return r.json();
  }
  async get(path) {
    const r = await fetch(path, { headers: this.headers() });
    if (!r.ok) throw new Error((await r.json()).error || 'err');
    return r.json();
  }
  async register(u, p) {
    const { token, state } = await this.post('/api/register', { username: u, password: p });
    this.token = token; localStorage.setItem('token', token);
    this.connectWs(); this.emit('auth', state);
  }
  async login(u, p) {
    const { token, state } = await this.post('/api/login', { username: u, password: p });
    this.token = token; localStorage.setItem('token', token);
    this.connectWs(); this.emit('auth', state);
  }
  async sync() { const s = await this.get('/api/state'); this.emit('state', s); }
  async build(type, x, y) { const s = await this.post('/api/build', { type, x, y }); this.emit('state', s); }
  async train(type) { const s = await this.post('/api/train', { type }); this.emit('state', s); }
  async findRaid() { return this.get('/api/raid/find'); }
  async attack(targetId, troops) { const r = await this.post('/api/raid/attack', { targetId, troops }); this.emit('state', r.state); return r; }
  connectWs() {
    if (this.ws) this.ws.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws?token=${this.token}`);
    this.ws.onmessage = (e) => { try { const m = JSON.parse(e.data); this.emit(m.type, m); } catch {} };
    this.ws.onclose = () => setTimeout(() => this.token && this.connectWs(), 3000);
  }
}