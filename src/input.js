'use strict';
// Keyboard, mouse and touch, unified through Pointer Events.
//
// Desktop: WASD flies the ship, click places, drag paints a line, right-click (or the Remove tool) deconstructs.
// Touch (Mindustry-style): one finger drags the camera, pinch zooms, tap empty ground to send the ship there,
// tap with a block selected to place it, long-press then drag to paint a line, tap the selected tile to deselect.
class Input {
  constructor(canvas, renderer, getGame, ui) {
    this.canvas = canvas; this.renderer = renderer; this.getGame = getGame; this.ui = ui;
    this.keys = new Set();
    this.mouseX = 0; this.mouseY = 0; this.tileX = 0; this.tileY = 0;
    this.selected = null; this.rot = 0;
    this.dragButton = -1; this.dragPointer = null; this.dragLast = null; this.dragPlaced = new Set();
    this.pointers = new Map(); this.pinch = null;
    this.gesture = null;       // touch gesture in progress: { id, x0, y0, lastX, lastY, t0, kind: 'tap' | 'pan' | 'line', timer }
    this.moveTarget = null;    // [tileX, tileY] the ship flies to (touch tap-to-move)
    this.touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(renderer.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    }, { passive: false });
    if (this.touch) document.body.classList.add('touch');
  }
  isDown(code) { return this.keys.has(code); }
  setZoom(z) { this.renderer.cam.zoom = clamp(z, 0.45, 2.2); }
  // Keyboard movement vector for the ship, length <= 1. Any key press cancels a tap-to-move target.
  moveVector() {
    let mx = 0, my = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) my -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) my += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) mx -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) mx += 1;
    if (mx || my) this.moveTarget = null;
    const len = Math.hypot(mx, my) || 1;
    return [mx / len, my / len];
  }
  select(type) { this.selected = this.selected === type ? null : type; this.ui.refreshToolbar(); }
  rotate() { this.rot = (this.rot + 1) % 4; }
  centerOnShip() { const p = this.getGame().player; this.renderer.cam.x = p.x * TILE; this.renderer.cam.y = p.y * TILE; }

  onKey(e) {
    if (e.repeat) return;
    if (this.ui.overlayOpen) { if (e.code !== 'F5' && e.code !== 'F12') { e.preventDefault(); this.ui.dismissOverlay(); } return; }
    this.keys.add(e.code);
    const game = this.getGame();
    if (/^Digit[1-9]$/.test(e.code)) { const t = BUILDABLE[+e.code.slice(5) - 1]; if (t) this.select(t); }
    else if (e.code === 'KeyR') this.rotate();
    else if (e.code === 'KeyX') this.select('remove');
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
  setPointer(e) { this.mouseX = e.clientX; this.mouseY = e.clientY; this.updateTile(); }

  // ----- pointer events --------------------------------------------------------
  onDown(e) {
    if (this.ui.overlayOpen) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { // second finger: pinch-zoom, abort any gesture or build drag
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(20, dist(a.x, a.y, b.x, b.y)), zoom0: this.renderer.cam.zoom };
      this.cancelGesture(); this.endDrag();
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.pointerType === 'touch') { e.preventDefault(); this.touchDown(e); return; }
    this.setPointer(e);
    if (e.button === 0) {
      this.dragButton = 0; this.dragPointer = e.pointerId;
      if (this.selected === 'remove') this.removeAt(this.tileX, this.tileY);
      else if (this.selected) { this.placeAt(this.tileX, this.tileY); this.dragLast = [this.tileX, this.tileY]; }
    } else if (e.button === 2) {
      if (this.selected) { this.selected = null; this.ui.refreshToolbar(); }
      else { this.dragButton = 2; this.dragPointer = e.pointerId; this.removeAt(this.tileX, this.tileY); }
    }
  }
  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      this.setZoom(this.pinch.zoom0 * dist(a.x, a.y, b.x, b.y) / this.pinch.d0);
      return;
    }
    if (e.pointerType === 'touch') { this.touchMove(e); return; }
    this.setPointer(e);
    if (this.dragPointer !== null && e.pointerId !== this.dragPointer) return;
    if (this.dragButton === 0) {
      if (this.selected === 'remove') this.removeAt(this.tileX, this.tileY);
      else if (this.selected) this.dragTo(this.tileX, this.tileY);
    } else if (this.dragButton === 2) this.removeAt(this.tileX, this.tileY);
  }
  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (e.pointerType === 'touch') this.touchUp(e);
    if (e.pointerId === this.dragPointer) this.endDrag();
  }
  endDrag() { this.dragButton = -1; this.dragPointer = null; this.dragLast = null; this.dragPlaced.clear(); }

  // ----- touch gestures --------------------------------------------------------
  touchDown(e) {
    this.cancelGesture();
    const g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, kind: 'tap', timer: null };
    this.gesture = g;
    if (this.selected) { // long press: start line placement / area removal
      g.timer = setTimeout(() => {
        if (this.gesture !== g || g.kind !== 'tap') return;
        g.kind = 'line';
        this.setPointerXY(g.lastX, g.lastY);
        if (navigator.vibrate) navigator.vibrate(15);
        if (this.selected === 'remove') this.removeAt(this.tileX, this.tileY);
        else { this.placeAt(this.tileX, this.tileY); this.dragLast = [this.tileX, this.tileY]; }
      }, 320);
    }
  }
  touchMove(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.lastX, dy = e.clientY - g.lastY;
    g.lastX = e.clientX; g.lastY = e.clientY;
    if (g.kind === 'tap') {
      if (dist(g.x0, g.y0, e.clientX, e.clientY) < 12) return; // still a tap (finger jitter)
      g.kind = 'pan'; clearTimeout(g.timer);
    }
    if (g.kind === 'pan') {
      const cam = this.renderer.cam, m = this.getGame().map;
      cam.x = clamp(cam.x - dx / cam.zoom, 0, m.w * TILE); cam.y = clamp(cam.y - dy / cam.zoom, 0, m.h * TILE);
    } else if (g.kind === 'line') {
      this.setPointerXY(e.clientX, e.clientY);
      if (this.selected === 'remove') this.removeAt(this.tileX, this.tileY);
      else if (this.selected) this.dragTo(this.tileX, this.tileY);
    }
  }
  touchUp(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    this.gesture = null;
    if (g.kind === 'line') { this.endDrag(); return; }
    if (g.kind !== 'tap') return;
    this.setPointerXY(g.x0, g.y0);
    this.tap();
  }
  cancelGesture() { if (this.gesture) { clearTimeout(this.gesture.timer); this.gesture = null; } }
  setPointerXY(x, y) { this.mouseX = x; this.mouseY = y; this.updateTile(); }
  // A clean tap: place / remove when a tool is selected, otherwise send the ship to the tapped tile.
  tap() {
    const game = this.getGame();
    if (this.selected === 'remove') { this.removeAt(this.tileX, this.tileY); return; }
    if (this.selected) {
      const check = game.canPlace(this.selected, this.tileX, this.tileY, this.rot);
      if (check.ok) { this.placeAt(this.tileX, this.tileY); return; }
      if (check.reason === 'too far from your ship') this.moveTarget = [this.tileX + 0.5, this.tileY + 0.5]; // fly over, then tap again
      this.ui.flash(check.reason);
      return;
    }
    if (game.map.buildingAt(this.tileX, this.tileY)) return; // tapping a block just shows its status in the info bar
    if (game.map.inBounds(this.tileX, this.tileY)) this.moveTarget = [this.tileX + 0.5, this.tileY + 0.5];
  }

  // ----- building helpers ---------------------------------------------------------
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
