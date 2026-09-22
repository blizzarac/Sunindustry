'use strict';
// Keyboard, mouse and touch, unified through Pointer Events.
// Building: tap/click places, dragging paints a line, right-click (or the Remove tool) deconstructs.
// Touch extras: a virtual joystick for the ship and pinch-to-zoom.
class Input {
  constructor(canvas, renderer, getGame, ui) {
    this.canvas = canvas; this.renderer = renderer; this.getGame = getGame; this.ui = ui;
    this.keys = new Set();
    this.mouseX = 0; this.mouseY = 0; this.tileX = 0; this.tileY = 0;
    this.selected = null; this.rot = 0;
    this.dragButton = -1; this.dragPointer = null; this.dragLast = null; this.dragPlaced = new Set();
    this.pointers = new Map(); this.pinch = null;
    this.joy = { x: 0, y: 0 }; this.joyPointer = null;
    this.touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.joy.x = this.joy.y = 0; });
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(renderer.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    }, { passive: false });
    this.setupJoystick();
    if (this.touch) document.body.classList.add('touch');
  }
  isDown(code) { return this.keys.has(code); }
  setZoom(z) { this.renderer.cam.zoom = clamp(z, 0.45, 2.2); }
  // Movement vector for the ship: keyboard and joystick combined, length <= 1.
  moveVector() {
    let mx = this.joy.x, my = this.joy.y;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) my -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) my += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) mx -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) mx += 1;
    const len = Math.hypot(mx, my);
    return len > 1 ? [mx / len, my / len] : [mx, my];
  }
  select(type) { this.selected = this.selected === type ? null : type; this.ui.refreshToolbar(); }
  rotate() { this.rot = (this.rot + 1) % 4; }

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

  onDown(e) {
    if (this.ui.overlayOpen) return;
    if (e.pointerType === 'touch') e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { // second finger: switch to pinch-zoom and abort any build drag
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(20, dist(a.x, a.y, b.x, b.y)), zoom0: this.renderer.cam.zoom };
      this.endDrag();
      return;
    }
    if (this.pointers.size > 2) return;
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
    if (e.pointerType !== 'touch' || e.pointerId === this.dragPointer) this.setPointer(e);
    if (this.dragPointer !== null && e.pointerId !== this.dragPointer) return;
    if (this.dragButton === 0) {
      if (this.selected === 'remove') this.removeAt(this.tileX, this.tileY);
      else if (this.selected) this.dragTo(this.tileX, this.tileY);
    } else if (this.dragButton === 2) this.removeAt(this.tileX, this.tileY);
  }
  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (e.pointerId === this.dragPointer) this.endDrag();
  }
  endDrag() { this.dragButton = -1; this.dragPointer = null; this.dragLast = null; this.dragPlaced.clear(); }

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

  // Virtual joystick (DOM element, only shown on touch devices).
  setupJoystick() {
    const el = document.getElementById('joystick'), knob = document.getElementById('joy-knob');
    if (!el) return;
    const R = 44;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      this.joy.x = dx / R; this.joy.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const stop = (e) => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = null; this.joy.x = this.joy.y = 0; knob.style.transform = '';
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.joyPointer = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ } move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyPointer) move(e); });
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
  }
}
