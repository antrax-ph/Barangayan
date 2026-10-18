const TILE_W = 64, TILE_H = 32;

const COLORS = {
  ground: ['#1a2818', '#162214'],
  grid: '#2a3a22',
  barangay_hall:    { top: '#d4752c', side: '#8a4515', accent: '#ffd966' },
  sarisari_store:   { top: '#c9a24a', side: '#7a5a2a', accent: '#ffe08a' },
  kalamansi_farm:   { top: '#a35c2a', side: '#5a2a1a', accent: '#c98aff' },
  jeepney_terminal: { top: '#b8451f', side: '#6a2010', accent: '#ffb060' },
  balangay:         { top: '#4a7a3a', side: '#2a4a1a', accent: '#8ac96a' },
  bakod:            { top: '#8a6a3a', side: '#5a4a1a', accent: '#c9a24a' },
  lantaka:          { top: '#555a5a', side: '#2a2e2e', accent: '#a8b8b8' },
  bantay_tower:     { top: '#7a4a5a', side: '#4a1a2a', accent: '#ff8a9a' },
};

export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.particles = [];
    this.shakeT = 0;
    this.placingGhost = null;
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = window.innerWidth; this.H = window.innerHeight;
  }
  iso(x, y) {
    const v = this.state.view;
    const z = v.zoom;
    return {
      x: (x - y) * (TILE_W / 2) * z + this.W / 2 - (v.cx - v.cy) * (TILE_W / 2) * z,
      y: (x + y) * (TILE_H / 2) * z + this.H / 2 - (v.cx + v.cy) * (TILE_H / 2) * z,
    };
  }
  shake() { this.shakeT = 30; }
  render(ts) {
    const ctx = this.ctx;
    ctx.save();
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { this.shakeT--; sx = (Math.random() - 0.5) * 8; sy = (Math.random() - 0.5) * 8; }
    ctx.translate(sx, sy);

    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#0a0f14'); g.addColorStop(0.6, '#1a1a10'); g.addColorStop(1, '#2a1a0a');
    ctx.fillStyle = g; ctx.fillRect(-10, -10, this.W + 20, this.H + 20);

    this.drawGrid();

    const buildings = (this.state.player?.buildings || []).slice();
    if (this.state.raidTarget) buildings.push(...this.state.raidTarget.buildings);
    buildings.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const b of buildings) this.drawBuilding(b);

    if (this.placingGhost) this.drawGhost();
    this.drawParticles();
    ctx.restore();
  }
  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(120,150,90,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 30; i++) {
      const a = this.iso(i, 0), b = this.iso(i, 30);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = this.iso(0, i), d = this.iso(30, i);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }
  drawBuilding(b) {
    const ctx = this.ctx;
    const col = COLORS[b.type] || COLORS.bakod;
    const size = ({ barangay_hall: 4, sarisari_store: 3, kalamansi_farm: 3, jeepney_terminal: 3, balangay: 4, bakod: 1, lantaka: 2, bantay_tower: 2 })[b.type] || 1;
    const z = this.state.view.zoom;
    const height = ({ barangay_hall: 70, jeepney_terminal: 40, lantaka: 30, bantay_tower: 60 }[b.type] || 36) * z;

    for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) {
      const p = this.iso(b.x + dx, b.y + dy);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      this.isoTile(p.x, p.y, '#0a1a0a', z);
    }

    const top = this.iso(b.x, b.y);
    const bx = top.x - (size - 1) * (TILE_W / 2) * z + TILE_W / 2 * z;
    const by = top.y - (size - 1) * (TILE_H / 2) * z;

    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (size * TILE_W / 2) * z, by + (size * TILE_H / 2) * z);
    ctx.lineTo(bx + (size * TILE_W / 2) * z, by + (size * TILE_H / 2) * z - height);
    ctx.lineTo(bx, by - height);
    ctx.closePath(); ctx.fillStyle = col.side; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bx, by - height);
    ctx.lineTo(bx + (size * TILE_W / 2) * z, by + (size * TILE_H / 2) * z - height);
    ctx.lineTo(bx + (size * TILE_W) * z, by - height);
    ctx.lineTo(bx + (size * TILE_W / 2) * z, by - (size * TILE_H / 2) * z - height);
    ctx.closePath(); ctx.fillStyle = col.top; ctx.fill();

    // fiesta glow on town hall
    const fiesta = this.state.fiesta?.active;
    ctx.save();
    ctx.shadowColor = fiesta && b.type === 'barangay_hall' ? '#ff6a1a' : col.accent;
    ctx.shadowBlur = (fiesta && b.type === 'barangay_hall' ? 30 : 15) * z;
    ctx.fillStyle = col.accent;
    const cx = bx + (size * TILE_W / 2) * z, cy = by - height + 6;
    ctx.beginPath(); ctx.arc(cx, cy, 3 * z, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (b.level > 1 || b.type === 'barangay_hall') {
      ctx.fillStyle = '#000a';
      const label = `Lv${b.level}`;
      ctx.font = `${11 * z}px ui-monospace, monospace`;
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(cx - w / 2, by - height - 22 * z, w, 16 * z);
      ctx.fillStyle = col.accent;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, by - height - 14 * z);
    }

    if (this.state.selected === b) {
      ctx.strokeStyle = '#ffd966'; ctx.lineWidth = 2;
      ctx.beginPath();
      const c0 = this.iso(b.x, b.y), c1 = this.iso(b.x + size, b.y), c2 = this.iso(b.x + size, b.y + size), c3 = this.iso(b.x, b.y + size);
      ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath(); ctx.stroke();
    }
  }
  isoTile(x, y, color, z) {
    const ctx = this.ctx;
    const w = TILE_W * z / 2, h = TILE_H * z / 2;
    ctx.beginPath();
    ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }
  drawGhost() {
    const ctx = this.ctx;
    const { type, x, y } = this.placingGhost;
    const col = COLORS[type] || COLORS.bakod;
    ctx.globalAlpha = 0.55;
    const p = this.iso(x, y);
    this.isoTile(p.x, p.y, col.top, this.state.view.zoom);
    ctx.globalAlpha = 1;
  }
  drawParticles() {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.4; p.life -= 0.03;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
  screenToGrid(sx, sy) {
    const v = this.state.view, z = v.zoom;
    const ox = sx - this.W / 2 + (v.cx - v.cy) * (TILE_W / 2) * z;
    const oy = sy - this.H / 2 + (v.cx + v.cy) * (TILE_H / 2) * z;
    const gx = (ox / (TILE_W / 2 * z) + oy / (TILE_H / 2 * z)) / 2;
    const gy = (oy / (TILE_H / 2 * z) - ox / (TILE_W / 2 * z)) / 2;
    return { x: Math.floor(gx), y: Math.floor(gy) };
  }
}