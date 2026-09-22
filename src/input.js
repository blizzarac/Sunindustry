'use strict';
// Keyboard + mouse. Building happens here: click places, drag paints a line, right-click removes.
class Input {
  constructor(canvas, renderer, getGame, ui) {
    this.canvas = canvas; this.renderer = renderer; this.getGame = getGame; this.ui = ui;
    this.keys = new Set();
    this.mouseX = 0; this.mouseY = 0; this.tileX = 0; this.tileY = 0;
    this.selected = null; this.rot = 0;
    this.dragButton = -1; this.dragLast = null; this.dragPlaced = new Set();

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mouseup', () => { this.dragButton = -1; this.dragLast = null; this.dragPlaced.clear(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const z = renderer.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1);
      renderer.cam.zoom = clamp(z, 0.45, 2.2);
    }, { passive: false });
  }
  isDown(code) { return this.keys.has(code); }
  select(type) { this.selected = this.selected === type ? null : type; this.ui.refreshToolbar(); }

  onKey(e) {
    if (e.repeat) return;
    if (this.ui.overlayOpen) { if (e.code !== 'F5' && e.code !== 'F12') { e.preventDefault(); this.ui.dismissOverlay(); } return; }
    this.keys.add(e.code);
    const game = this.getGame();
    if (/^Digit[1-9]$/.test(e.code)) { const t = BUILDABLE[+e.code.slice(5) - 1]; if (t) this.select(t); }
    else if (e.code === 'KeyR') this.rot = (this.rot + 1) % 4;
    else if (e.code === 'KeyQ' || e.code === 'Escape') { this.selected = null; this.ui.refreshToolbar(); }
    else if (e.code === 'KeyN') { if (!game.over) game.nextWave(); }
    else if (e.code === 'KeyP') { game.paused = !game.paused; }
    else if (e.code === 'KeyH') this.ui.showHelp();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }
  updateTile() {
    const [wx, wy] = this.renderer.screenToWorld(this.mouseX, this.mouseY);
    this.tileX = Math.floor(wx / TILE); this.tileY = Math.floor(wy / TILE);
  }
  onMove(e) {
    this.mouseX = e.clientX; this.mouseY = e.clientY; this.updateTile();
    if (this.dragButton === 0 && this.selected) this.dragTo(this.tileX, this.tileY);
    else if (this.dragButton === 2) this.removeAt(this.tileX, this.tileY);
  }
  onDown(e) {
    if (this.ui.overlayOpen) return;
    this.mouseX = e.clientX; this.mouseY = e.clientY; this.updateTile();
    this.dragButton = e.button;
    if (e.button === 0) {
      if (this.selected) { this.placeAt(this.tileX, this.tileY); this.dragLast = [this.tileX, this.tileY]; }
    } else if (e.button === 2) {
      if (this.selected) { this.selected = null; this.ui.refreshToolbar(); this.dragButton = -1; }
      else this.removeAt(this.tileX, this.tileY);
    }
  }
  placeAt(x, y) {
    const b = this.getGame().place(this.selected, x, y, this.rot);
    if (b) this.dragPlaced.add(b);
    return b;
  }
  removeAt(x, y) {
    const game = this.getGame(); const b = game.map.buildingAt(x, y);
    if (b) game.removeBuilding(b);
  }
  // Walk orthogonally from the last drag tile to the new one, placing as we go.
  // Conveyors follow the drag direction, and the previously placed belt turns to face the new tile.
  dragTo(x, y) {
    if (!this.dragLast) { this.dragLast = [x, y]; this.placeAt(x, y); return; }
    let [px, py] = this.dragLast;
    if (px === x && py === y) return;
    const game = this.getGame();
    let guard = 0;
    while ((px !== x || py !== y) && guard++ < 200) {
      const dx = Math.sign(x - px), dy = Math.sign(y - py);
      const stepX = dx !== 0 && (dy === 0 || Math.abs(x - px) >= Math.abs(y - py));
      const nx = px + (stepX ? dx : 0), ny = py + (stepX ? 0 : dy);
      if (this.selected === 'conveyor') {
        const dir = DIRS.findIndex(([a, b]) => a === nx - px && b === ny - py);
        if (dir >= 0) {
          this.rot = dir;
          const prev = game.map.buildingAt(px, py);
          if (prev && prev.type === 'conveyor' && this.dragPlaced.has(prev)) prev.rot = dir;
        }
      }
      this.placeAt(nx, ny);
      px = nx; py = ny;
    }
    this.dragLast = [x, y];
  }
}
