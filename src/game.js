'use strict';
class Game {
  constructor(seed) {
    this.seed = seed;
    this.map = new GameMap(MAP_W, MAP_H, seed);
    this.buildings = new Set();
    this.enemies = []; this.bullets = []; this.effects = []; this.spawnQueue = [];
    this.time = 0; this.wave = 0; this.waveTimer = WAVE_FIRST; this.spawnTimer = 0;
    this.over = false; this.paused = false;
    this.stats = { kills: 0, built: 0, lost: 0 };
    this.flowDirty = true; this.flowCooldown = 0;
    this.core = this.place('core', this.map.cx - 1, this.map.cy - 1, 0, true);
    this.player = new Player(this, this.core.cx, this.core.cy + 2.5);
    this.recomputeFlow();
  }

  // ----- building placement -------------------------------------------------
  // Placement rules. Existing blocks that fit entirely inside the new footprint are replaced (refunded),
  // like building over a belt in Mindustry. Placing a conveyor on a conveyor only rotates it.
  canPlace(type, x, y, rot = 0) {
    const def = BLOCKS[type];
    if (!def) return { ok: false, reason: 'unknown block' };
    const replaced = new Set();
    for (let dy = 0; dy < def.size; dy++) for (let dx = 0; dx < def.size; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!this.map.inBounds(tx, ty) || this.map.terrainAt(tx, ty) === T_WALL) return { ok: false, reason: 'blocked by rock' };
      const b = this.map.buildingAt(tx, ty);
      if (!b) continue;
      const fits = b.type !== 'core' && b.x >= x && b.y >= y && b.x + b.size <= x + def.size && b.y + b.size <= y + def.size;
      if (!fits) return { ok: false, reason: 'occupied' };
      replaced.add(b);
    }
    const same = replaced.size === 1 ? [...replaced][0] : null;
    if (same && same.type === type && same.x === x && same.y === y) {
      if (def.rotates && same.rot !== rot) return { ok: true, rotateOnly: same, replaced: [] };
      return { ok: false, reason: 'already built' };
    }
    if (def.needsOre && !this.map.oreAt(x, y)) return { ok: false, reason: 'needs ore under it' };
    if (dist(x + def.size / 2, y + def.size / 2, this.player.x, this.player.y) > BUILD_RANGE) return { ok: false, reason: 'too far from your ship' };
    const refund = {};
    for (const b of replaced) for (const [k, v] of Object.entries(b.def.cost)) refund[k] = (refund[k] || 0) + v;
    for (const [k, v] of Object.entries(def.cost)) if ((this.core.inv[k] || 0) + (refund[k] || 0) < v) return { ok: false, reason: `need ${v} ${ITEMS[k].name.toLowerCase()}` };
    return { ok: true, replaced: [...replaced] };
  }
  place(type, x, y, rot, free) {
    if (!free) {
      const c = this.canPlace(type, x, y, rot);
      if (!c.ok) return null;
      if (c.rotateOnly) { c.rotateOnly.rot = rot; return c.rotateOnly; } // belt keeps its items
      for (const b of c.replaced) { this.core.refund(b.def.cost); this.detach(b); }
    }
    const b = new BLOCK_CLASSES[type](this, type, x, y, rot);
    if (!free) { this.core.pay(b.def.cost); this.stats.built++; }
    this.map.setBuilding(b); this.buildings.add(b); this.flowDirty = true;
    return b;
  }
  removeBuilding(b) { // player-initiated deconstruction, full refund
    if (b.type === 'core' || b.dead) return false;
    if (dist(b.cx, b.cy, this.player.x, this.player.y) > BUILD_RANGE) return false;
    this.core.refund(b.def.cost);
    this.detach(b);
    return true;
  }
  destroyBuilding(b) {
    if (b.dead) return;
    this.addEffect(b.cx, b.cy, '#ffb36b', 0.6 * b.size, 0.5);
    this.stats.lost++;
    if (b.type === 'core') { this.detach(b); this.over = true; return; }
    this.detach(b);
  }
  detach(b) { b.dead = true; this.map.clearBuilding(b); this.buildings.delete(b); this.flowDirty = true; }
  recomputeFlow() { this.map.computeFlow(this.core.tiles()); this.flowDirty = false; this.flowCooldown = 0.5; }

  // ----- queries ------------------------------------------------------------
  nearestEnemy(x, y, range) {
    let best = null, bd = range;
    for (const e of this.enemies) { if (e.dead) continue; const d = dist(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  // Nearest player building (edge distance) or the player ship.
  nearestPlayerThing(x, y, range) {
    let best = null, bd = range;
    for (const b of this.buildings) {
      const d = dist(x, y, b.cx, b.cy) - b.size * 0.5;
      if (d < bd) { bd = d; best = b; }
    }
    const p = this.player;
    if (!p.dead) { const d = dist(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  addBullet(o) { o.game = this; this.bullets.push(new Bullet(o)); }
  addEffect(x, y, color, r, life) { this.effects.push({ x, y, color, r, life, maxLife: life }); }
  onEnemyKilled(e) { this.stats.kills++; this.addEffect(e.x, e.y, e.def.color, e.def.radius * 2.2, 0.4); }

  // ----- waves --------------------------------------------------------------
  nextWave() {
    this.wave++;
    const w = this.wave;
    const hpScale = 1 + (w - 1) * 0.12;
    const list = [];
    for (let i = 0; i < 2 + Math.floor(w * 1.4); i++) list.push('dagger');
    if (w >= 4) for (let i = 0; i < Math.floor((w - 2) / 1.5); i++) list.push('flare');
    if (w >= 7) for (let i = 0; i < Math.floor((w - 5) / 2); i++) list.push('mace');
    list.sort(() => Math.random() - 0.5);
    list.forEach((kind, i) => this.spawnQueue.push({ kind, spawn: this.map.spawns[i % this.map.spawns.length], hpScale }));
    this.waveTimer = WAVE_INTERVAL;
  }
  spawnOne({ kind, spawn, hpScale }) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
    this.enemies.push(new Enemy(this, kind, spawn.x + 0.5 + Math.cos(a) * r, spawn.y + 0.5 + Math.sin(a) * r, hpScale));
  }

  // ----- main update --------------------------------------------------------
  update(dt, input) {
    if (this.over || this.paused) return;
    this.time += dt;
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) this.nextWave();
    this.spawnTimer -= dt;
    if (this.spawnQueue.length && this.spawnTimer <= 0) { this.spawnOne(this.spawnQueue.shift()); this.spawnTimer = 0.35; }

    this.flowCooldown -= dt;
    if (this.flowDirty && this.flowCooldown <= 0) this.recomputeFlow();

    for (const b of this.buildings) b.update(dt);
    this.player.update(dt, input);
    for (const e of this.enemies) e.update(dt);
    for (const b of this.bullets) b.update(dt);
    for (const f of this.effects) f.life -= dt;

    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.bullets.some((b) => b.dead)) this.bullets = this.bullets.filter((b) => !b.dead);
    if (this.effects.some((f) => f.life <= 0)) this.effects = this.effects.filter((f) => f.life > 0);
  }
}
