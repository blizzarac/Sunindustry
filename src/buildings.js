'use strict';
// ---------------------------------------------------------------------------
// Buildings. Item transport is a push model: a block calls `tryGive(item, source)`
// on a neighbour, which returns true if it accepted the item.
// ---------------------------------------------------------------------------
class Building {
  constructor(game, type, x, y, rot) {
    this.game = game; this.type = type; this.def = BLOCKS[type];
    this.x = x; this.y = y; this.rot = rot || 0; this.size = this.def.size;
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.team = TEAM.PLAYER; this.dead = false;
    this.rr = 0; // round-robin cursor for offloading
  }
  get cx() { return this.x + this.size / 2; }
  get cy() { return this.y + this.size / 2; }
  occupies(tx, ty) { return tx >= this.x && ty >= this.y && tx < this.x + this.size && ty < this.y + this.size; }
  forEachTile(fn) { for (let dy = 0; dy < this.size; dy++) for (let dx = 0; dx < this.size; dx++) fn(this.x + dx, this.y + dy); }
  tiles() { const t = []; this.forEachTile((x, y) => t.push([x, y])); return t; }
  neighbors() {
    const out = [], seen = new Set(), m = this.game.map;
    const check = (tx, ty) => { const b = m.buildingAt(tx, ty); if (b && b !== this && !seen.has(b)) { seen.add(b); out.push(b); } };
    for (let i = 0; i < this.size; i++) {
      check(this.x + i, this.y - 1); check(this.x + i, this.y + this.size);
      check(this.x - 1, this.y + i); check(this.x + this.size, this.y + i);
    }
    return out;
  }
  // Try to hand an item to any neighbour, rotating the starting neighbour so output is spread evenly.
  offload(item, exclude) {
    const ns = this.neighbors();
    if (!ns.length) return false;
    for (let k = 0; k < ns.length; k++) {
      const b = ns[(this.rr + k) % ns.length];
      if (b === exclude || b.team !== this.team) continue;
      if (b.tryGive(item, this)) { this.rr = (this.rr + k + 1) % ns.length; return true; }
    }
    return false;
  }
  tryGive() { return false; }
  update() {}
  damage(n) { if (this.dead) return; this.hp -= n; if (this.hp <= 0) this.game.destroyBuilding(this); }
  status() { return ''; }
}

class Core extends Building {
  constructor(...a) { super(...a); this.inv = { ...START_ITEMS }; }
  tryGive(item) { this.inv[item] = (this.inv[item] || 0) + 1; return true; }
  has(cost) { return Object.entries(cost).every(([k, v]) => (this.inv[k] || 0) >= v); }
  pay(cost) { for (const [k, v] of Object.entries(cost)) this.inv[k] -= v; }
  refund(cost) { for (const [k, v] of Object.entries(cost)) this.inv[k] = (this.inv[k] || 0) + v; }
  status() { return ITEM_LIST.map((k) => `${ITEMS[k].name} ${this.inv[k] | 0}`).join(' · '); }
}

class Wall extends Building {}

class Conveyor extends Building {
  constructor(...a) { super(...a); this.items = []; } // index 0 = closest to the output end
  frontTile() { const d = DIRS[this.rot]; return [this.x + d[0], this.y + d[1]]; }
  tryGive(item, source) {
    if (source) { const [fx, fy] = this.frontTile(); if (source.occupies(fx, fy)) return false; } // never accept head-on
    if (this.items.length >= CONVEYOR_CAP) return false;
    const last = this.items[this.items.length - 1];
    if (last && last.pos < CONVEYOR_SPACING) return false;
    this.items.push({ item, pos: 0 });
    return true;
  }
  update(dt) {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const limit = i === 0 ? 1 : items[i - 1].pos - CONVEYOR_SPACING;
      it.pos = Math.min(it.pos + CONVEYOR_SPEED * dt, Math.max(it.pos, limit));
    }
    const head = items[0];
    if (head && head.pos >= 1) {
      const [fx, fy] = this.frontTile();
      const next = this.game.map.buildingAt(fx, fy);
      if (next && next.team === this.team && next.tryGive(head.item, this)) items.shift();
    }
  }
  status() { return `${this.items.length} item(s) on belt`; }
}

class Router extends Building {
  constructor(...a) { super(...a); this.buffer = null; this.source = null; }
  tryGive(item, source) { if (this.buffer) return false; this.buffer = item; this.source = source; return true; }
  update() { if (this.buffer && this.offload(this.buffer, this.source)) { this.buffer = null; this.source = null; } }
  status() { return this.buffer ? `holding ${ITEMS[this.buffer].name}` : 'empty'; }
}

class Drill extends Building {
  constructor(...a) {
    super(...a);
    this.ore = this.game.map.oreAt(this.x, this.y);
    this.item = ORE_ITEM[this.ore];
    this.time = ORE_DRILL_TIME[this.ore];
    this.progress = 0; this.buffer = 0; this.spin = 0;
  }
  update(dt) {
    if (this.buffer < 5) {
      this.progress += dt; this.spin += dt * 4;
      if (this.progress >= this.time) { this.progress -= this.time; this.buffer++; }
    }
    if (this.buffer > 0 && this.offload(this.item)) this.buffer--;
  }
  status() { return `mining ${ITEMS[this.item].name} · ${this.buffer} buffered${this.buffer >= 5 ? ' (output blocked!)' : ''}`; }
}

class Smelter extends Building {
  constructor(...a) { super(...a); this.inv = { copper: 0, lead: 0 }; this.out = 0; this.progress = 0; this.craftTime = 1.6; this.active = false; }
  tryGive(item) { if (!(item in this.inv) || this.inv[item] >= 10) return false; this.inv[item]++; return true; }
  update(dt) {
    this.active = this.out < 5 && this.inv.copper >= 2 && this.inv.lead >= 1;
    if (this.active) {
      this.progress += dt;
      if (this.progress >= this.craftTime) { this.progress = 0; this.inv.copper -= 2; this.inv.lead -= 1; this.out++; }
    }
    if (this.out > 0 && this.offload('alloy')) this.out--;
  }
  status() { return `copper ${this.inv.copper}/10 · lead ${this.inv.lead}/10 · alloy ready ${this.out}${this.active ? ' · smelting' : ''}`; }
}

class Turret extends Building {
  constructor(...a) { super(...a); this.ammo = 0; this.reload = 0; this.angle = -Math.PI / 2; this.target = null; this.recoil = 0; }
  tryGive(item) {
    const per = this.def.ammo[item];
    if (!per || this.ammo + per > this.def.ammoCap) return false;
    this.ammo += per; return true;
  }
  update(dt) {
    this.reload -= dt; this.recoil = Math.max(0, this.recoil - dt * 4);
    const d = this.def;
    this.target = this.game.nearestEnemy(this.cx, this.cy, d.range);
    if (!this.target) return;
    const t = this.target;
    const travel = dist(this.cx, this.cy, t.x, t.y) / d.bulletSpeed; // simple target leading
    const ax = t.x + t.vx * travel, ay = t.y + t.vy * travel;
    this.angle = Math.atan2(ay - this.cy, ax - this.cx);
    if (this.reload <= 0 && this.ammo > 0) {
      this.reload = d.reload; this.ammo--; this.recoil = 1;
      const ox = this.cx + Math.cos(this.angle) * 0.45, oy = this.cy + Math.sin(this.angle) * 0.45;
      const life = d.splash ? dist(ox, oy, ax, ay) / d.bulletSpeed : (d.range + 1) / d.bulletSpeed;
      this.game.addBullet({
        x: ox, y: oy, vx: Math.cos(this.angle) * d.bulletSpeed, vy: Math.sin(this.angle) * d.bulletSpeed,
        team: TEAM.PLAYER, dmg: d.dmg, life, splash: d.splash || 0, color: d.splash ? '#9fe3f5' : '#ffe9a6', size: d.splash ? 4 : 2.5,
      });
    }
  }
  status() { return `ammo ${this.ammo}/${this.def.ammoCap}${this.ammo === 0 ? ' — NO AMMO' : ''}`; }
}

const BLOCK_CLASSES = { core: Core, wall: Wall, conveyor: Conveyor, router: Router, drill: Drill, smelter: Smelter, duo: Turret, hail: Turret };
