'use strict';
// Camera is in world pixels; entities are in tiles, so every draw multiplies by TILE.
class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.groundCache = null;
  }
  resize() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }
  screenToWorld(sx, sy) {
    const { cam, canvas } = this;
    return [(sx - canvas.width / 2) / cam.zoom + cam.x, (sy - canvas.height / 2) / cam.zoom + cam.y];
  }

  // Terrain never changes after generation, so render it once into an offscreen canvas.
  buildGroundCache(map) {
    const c = document.createElement('canvas');
    c.width = map.w * TILE; c.height = map.h * TILE;
    const g = c.getContext('2d');
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.terrainAt(x, y), h = hash2(x, y);
      if (t === T_WALL) {
        g.fillStyle = `hsl(215, 10%, ${13 + h * 5}%)`; g.fillRect(x * TILE, y * TILE, TILE, TILE);
        g.fillStyle = `hsl(215, 9%, ${20 + h * 6}%)`; g.fillRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6);
        continue;
      }
      g.fillStyle = t === T_SAND ? `hsl(38, 18%, ${33 + h * 6}%)` : `hsl(205, 9%, ${27 + h * 6}%)`;
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      const ore = map.oreAt(x, y);
      if (ore) {
        g.globalAlpha = 0.22; g.fillStyle = ITEMS[ORE_ITEM[ore]].color; g.fillRect(x * TILE, y * TILE, TILE, TILE); g.globalAlpha = 1;
        g.fillStyle = ITEMS[ORE_ITEM[ore]].color;
        for (let k = 0; k < 4; k++) {
          const px = x * TILE + 6 + hash2(x * 4 + k, y) * (TILE - 12), py = y * TILE + 6 + hash2(x, y * 4 + k) * (TILE - 12);
          g.beginPath(); g.arc(px, py, 2.6 + hash2(x + k, y - k) * 1.6, 0, Math.PI * 2); g.fill();
        }
      }
    }
    for (const s of map.spawns) {
      g.strokeStyle = 'rgba(255,80,80,0.8)'; g.lineWidth = 3;
      g.beginPath(); g.arc((s.x + 0.5) * TILE, (s.y + 0.5) * TILE, TILE * 0.8, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,80,80,0.25)'; g.fill();
    }
    this.groundCache = c;
  }

  render(game, input, ui) {
    const { ctx, cam, canvas } = this;
    const W = canvas.width, H = canvas.height;
    if (!this.groundCache || this.groundCache._map !== game.map) { this.buildGroundCache(game.map); this.groundCache._map = game.map; }

    // Camera follows the player.
    const p = game.player;
    cam.x = lerp(cam.x, p.x * TILE, 0.12); cam.y = lerp(cam.y, p.y * TILE, 0.12);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1015'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, W / 2 - cam.x * cam.zoom, H / 2 - cam.y * cam.zoom);
    ctx.imageSmoothingEnabled = false;

    const x0 = Math.max(0, Math.floor((cam.x - W / 2 / cam.zoom) / TILE)), y0 = Math.max(0, Math.floor((cam.y - H / 2 / cam.zoom) / TILE));
    const x1 = Math.min(game.map.w, Math.ceil((cam.x + W / 2 / cam.zoom) / TILE) + 1), y1 = Math.min(game.map.h, Math.ceil((cam.y + H / 2 / cam.zoom) / TILE) + 1);
    const sx = x0 * TILE, sy = y0 * TILE, sw = (x1 - x0) * TILE, sh = (y1 - y0) * TILE;
    if (sw > 0 && sh > 0) ctx.drawImage(this.groundCache, sx, sy, sw, sh, sx, sy, sw, sh);

    // Buildings (only those overlapping the view).
    for (const b of game.buildings) {
      if (b.x + b.size < x0 || b.x > x1 || b.y + b.size < y0 || b.y > y1) continue;
      this.drawBuilding(b, game.time);
    }
    for (const e of game.enemies) this.drawEnemy(e);
    this.drawPlayer(game);
    for (const b of game.bullets) {
      ctx.strokeStyle = b.color; ctx.lineWidth = b.size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x * TILE, b.y * TILE); ctx.lineTo((b.x - b.vx * 0.03) * TILE, (b.y - b.vy * 0.03) * TILE); ctx.stroke();
    }
    for (const f of game.effects) {
      const t = f.life / f.maxLife;
      ctx.globalAlpha = t; ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, f.r * TILE * (1.3 - t * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.drawGhost(game, input);
    this.drawHover(game, input, ui);
  }

  drawBuilding(b, time) {
    const ctx = this.ctx, px = b.x * TILE, py = b.y * TILE, s = b.size * TILE, cx = px + s / 2, cy = py + s / 2;
    ctx.fillStyle = '#1a1f27'; ctx.fillRect(px, py, s, s);
    switch (b.type) {
      case 'core':
        ctx.fillStyle = '#3b3220'; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = b.def.color; ctx.fillRect(px + 10, py + 10, s - 20, s - 20);
        ctx.fillStyle = '#3b3220'; ctx.fillRect(cx - 14, cy - 14, 28, 28);
        ctx.fillStyle = b.def.color; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
        break;
      case 'wall':
        ctx.fillStyle = b.def.color; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px + 8, py + 8, s - 16, s - 16);
        break;
      case 'conveyor': this.drawConveyor(b, time); break;
      case 'router':
        ctx.fillStyle = b.def.color; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = '#2a2e26'; ctx.fillRect(px + 13, py + 5, 6, s - 10); ctx.fillRect(px + 5, py + 13, s - 10, 6);
        if (b.buffer) { ctx.fillStyle = ITEMS[b.buffer].color; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'drill':
        ctx.fillStyle = b.def.color; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = '#4b4438'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.spin);
        ctx.fillStyle = ITEMS[b.item].color;
        for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ctx.fillRect(-2, -9, 4, 9); }
        ctx.restore();
        break;
      case 'smelter':
        ctx.fillStyle = b.def.color; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = b.active ? `hsl(${30 + Math.sin(time * 10) * 10}, 90%, ${55 + Math.sin(time * 12) * 8}%)` : '#3a2a22';
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
        break;
      case 'duo': case 'hail': {
        ctx.fillStyle = b.type === 'hail' ? '#2e4652' : '#3c3f45'; ctx.fillRect(px + 2, py + 2, s - 4, s - 4);
        ctx.fillStyle = b.def.color; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.angle);
        ctx.fillStyle = '#23262b';
        const len = b.type === 'hail' ? 15 : 13, wdt = b.type === 'hail' ? 8 : 5;
        ctx.fillRect(2 - b.recoil * 3, -wdt / 2, len, wdt);
        ctx.restore();
        // ammo pips
        ctx.fillStyle = b.ammo > 0 ? '#ffd37f' : '#ff5252';
        ctx.fillRect(px + 3, py + s - 5, (s - 6) * (b.ammo / b.def.ammoCap || (b.ammo ? 0.05 : 0)), 2);
        if (b.ammo === 0) { ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 1.5; ctx.strokeRect(px + 1, py + 1, s - 2, s - 2); }
        break;
      }
    }
    if (b.hp < b.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px, py + s - 3, s, 3);
      ctx.fillStyle = b.hp / b.maxHp > 0.4 ? '#7bd88f' : '#ff6b6b'; ctx.fillRect(px, py + s - 3, s * (b.hp / b.maxHp), 3);
    }
  }
  drawConveyor(b, time) {
    const ctx = this.ctx, px = b.x * TILE, py = b.y * TILE, cx = px + TILE / 2, cy = py + TILE / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.rot * Math.PI / 2);
    ctx.fillStyle = '#3a3f47'; ctx.fillRect(-TILE / 2 + 1, -TILE / 2 + 4, TILE - 2, TILE - 8);
    ctx.fillStyle = '#5a6068';
    const off = (time * CONVEYOR_SPEED * TILE) % 12;
    for (let k = -2; k <= 2; k++) {
      const x = k * 12 + off - 6;
      if (x < -TILE / 2 || x > TILE / 2 - 6) continue;
      ctx.beginPath(); ctx.moveTo(x, -8); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.lineTo(x + 2, 0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const d = DIRS[b.rot];
    for (const it of b.items) {
      ctx.fillStyle = ITEMS[it.item].color;
      ctx.beginPath(); ctx.arc(cx + d[0] * (it.pos - 0.5) * TILE, cy + d[1] * (it.pos - 0.5) * TILE, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  drawEnemy(e) {
    const ctx = this.ctx, x = e.x * TILE, y = e.y * TILE, r = e.def.radius * TILE;
    ctx.save(); ctx.translate(x, y); ctx.rotate(e.angle);
    ctx.fillStyle = e.def.color;
    if (e.def.flying) {
      ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r, r * 1.3); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r, -r * 1.3); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(-r, -r * 0.9, r * 2, r * 1.8);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-r * 0.5, -r * 0.4, r * 1.6, r * 0.8);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, -2, r * 1.5, 4);
    }
    ctx.restore();
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - r, y - r - 6, r * 2, 3);
      ctx.fillStyle = '#ff6b6b'; ctx.fillRect(x - r, y - r - 6, r * 2 * (e.hp / e.maxHp), 3);
    }
  }
  drawPlayer(game) {
    const p = game.player, ctx = this.ctx;
    if (p.dead) return;
    const x = p.x * TILE, y = p.y * TILE;
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.angle);
    ctx.fillStyle = '#8fe1ff';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, 10); ctx.lineTo(-6, 0); ctx.lineTo(-10, -10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b3d4c'; ctx.beginPath(); ctx.arc(1, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (p.hp < p.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 14, y - 20, 28, 3);
      ctx.fillStyle = '#8fe1ff'; ctx.fillRect(x - 14, y - 20, 28 * (p.hp / p.maxHp), 3);
    }
  }
  drawGhost(game, input) {
    const ctx = this.ctx, type = input.selected;
    if (!type) return;
    if (type === 'remove') {
      const b = game.map.buildingAt(input.tileX, input.tileY);
      if (b && b.type !== 'core') { ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 3; ctx.strokeRect(b.x * TILE + 2, b.y * TILE + 2, b.size * TILE - 4, b.size * TILE - 4); }
      return;
    }
    const p = game.player;
    // Build range ring.
    ctx.strokeStyle = 'rgba(143,225,255,0.25)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(p.x * TILE, p.y * TILE, BUILD_RANGE * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const def = BLOCKS[type], tx = input.tileX, ty = input.tileY;
    const check = game.canPlace(type, tx, ty);
    const px = tx * TILE, py = ty * TILE, s = def.size * TILE;
    ctx.globalAlpha = 0.55; ctx.fillStyle = check.ok ? def.color : '#ff5252'; ctx.fillRect(px + 2, py + 2, s - 4, s - 4); ctx.globalAlpha = 1;
    ctx.strokeStyle = check.ok ? '#8fff9f' : '#ff5252'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
    if (def.rotates) {
      const d = DIRS[input.rot]; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(px + s / 2 - d[0] * 8, py + s / 2 - d[1] * 8); ctx.lineTo(px + s / 2 + d[0] * 10, py + s / 2 + d[1] * 10); ctx.stroke();
    }
    if (def.range) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, def.range * TILE, 0, Math.PI * 2); ctx.stroke();
    }
    if (!check.ok) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#ff8080'; ctx.textAlign = 'left';
      ctx.fillText(check.reason, input.mouseX + 14, input.mouseY - 10);
    }
  }
  drawHover(game, input) {
    if (input.selected) return;
    const b = game.map.buildingAt(input.tileX, input.tileY);
    if (!b) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x * TILE + 1, b.y * TILE + 1, b.size * TILE - 2, b.size * TILE - 2);
    if (b.def.range) { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(b.cx * TILE, b.cy * TILE, b.def.range * TILE, 0, Math.PI * 2); ctx.stroke(); }
  }
}
