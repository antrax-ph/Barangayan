export class Input {
  constructor(canvas, state, renderer) {
    this.c = canvas; this.s = state; this.r = renderer;
    this.dragging = false; this.last = null;
    this.placing = false;
    this.bind();
  }
  bind() {
    const c = this.c;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('wheel', e => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }
  down(e) {
    this.dragging = true;
    this.last = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 };
    this.c.setPointerCapture(e.pointerId);
  }
  move(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
    this.last.moved += Math.abs(dx) + Math.abs(dy);
    this.s.view.cx -= dx / (32 * this.s.view.zoom);
    this.s.view.cy -= dy / (32 * this.s.view.zoom);
    this.last.x = e.clientX; this.last.y = e.clientY;
    if (this.placing) {
      const g = this.r.screenToGrid(e.clientX, e.clientY);
      this.r.placingGhost = { type: this.s.placing, x: g.x, y: g.y };
    }
  }
  up(e) {
    if (!this.dragging) return;
    this.dragging = false;
    const tapped = this.last && this.last.moved < 8 && (Date.now() - this.last.t) < 300;
    if (tapped) {
      const g = this.r.screenToGrid(e.clientX, e.clientY);
      if (this.placing) {
        this.onPlace?.(g.x, g.y);
      } else {
        const hit = (this.s.player?.buildings || []).find(b => {
          const sz = ({ barangay_hall: 4, sarisari_store: 3, kalamansi_farm: 3, jeepney_terminal: 3, balangay: 4, lantaka: 2, bantay_tower: 2 })[b.type] || 1;
          return g.x >= b.x && g.x < b.x + sz && g.y >= b.y && g.y < b.y + sz;
        });
        this.s.selected = hit || null;
        this.onSelect?.(hit);
      }
    }
  }
  wheel(e) {
    e.preventDefault();
    const z = this.s.view.zoom;
    this.s.view.zoom = Math.max(0.4, Math.min(2.2, z * (e.deltaY < 0 ? 1.1 : 0.9)));
  }
  enablePlacing() { this.placing = true; }
  disablePlacing() { this.placing = false; this.r.placingGhost = null; }
}