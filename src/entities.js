'use strict';
// All entity coordinates are in tile units (floats). Speeds are tiles/second.

class Player {
  constructor(game, x, y) {
    this.game = game; this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hp = PLAYER_DEF.hp; this.maxHp = PLAYER_DEF.hp;
    this.angle = -Math.PI / 2; this.reload = 0; this.dead = false; this.respawn = 0; this.target = null;
  }
  update(dt, input) {
    const g = this.game;
    if (this.dead) {
      this.respawn -= dt;
      if (this.respawn <= 0) { this.dead = false; this.hp = this.maxHp; this.x = g.core.cx; this.y = g.core.cy + 2.5; }
      return;
    }
    let [mx, my] = input.moveVector();
    if (!mx && !my && input.moveTarget) { // touch: fly to the tapped tile
      const [tx, ty] = input.moveTarget, dx = tx - this.x, dy = ty - this.y, dd = Math.hypot(dx, dy);
      if (dd < 0.15) input.moveTarget = null;
      else { const k = Math.min(1, dd / (PLAYER_DEF.speed * dt)); mx = (dx / dd) * k; my = (dy / dd) * k; }
    }
    this.vx = mx * PLAYER_DEF.speed; this.vy = my * PLAYER_DEF.speed;
    this.x = clamp(this.x + this.vx * dt, 1, g.map.w - 1);
    this.y = clamp(this.y + this.vy * dt, 1, g.map.h - 1);
    if (mx || my) this.angle = Math.atan2(my, mx);

    // Auto-fire at the nearest enemy.
    this.reload -= dt;
    this.target = g.nearestEnemy(this.x, this.y, PLAYER_DEF.range);
    if (this.target) {
      const t = this.target;
      const travel = dist(this.x, this.y, t.x, t.y) / PLAYER_DEF.bulletSpeed;
      const a = Math.atan2(t.y + t.vy * travel - this.y, t.x + t.vx * travel - this.x);
      if (!(mx || my)) this.angle = a;
      if (this.reload <= 0) {
        this.reload = PLAYER_DEF.reload;
        g.addBullet({ x: this.x, y: this.y, vx: Math.cos(a) * PLAYER_DEF.bulletSpeed, vy: Math.sin(a) * PLAYER_DEF.bulletSpeed,
          team: TEAM.PLAYER, dmg: PLAYER_DEF.dmg, life: PLAYER_DEF.range / PLAYER_DEF.bulletSpeed + 0.05, splash: 0, color: '#8fe1ff', size: 2.5 });
      }
    }
  }
  damage(n) {
    if (this.dead) return;
    this.hp -= n;
    if (this.hp <= 0) { this.dead = true; this.respawn = PLAYER_DEF.respawn; this.game.addEffect(this.x, this.y, '#8fe1ff', 1.2, 0.6); }
  }
}

class Enemy {
  constructor(game, kind, x, y, hpScale) {
    this.game = game; this.kind = kind; this.def = ENEMIES[kind];
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.maxHp = Math.round(this.def.hp * hpScale); this.hp = this.maxHp;
    this.angle = 0; this.reload = Math.random() * this.def.reload; this.dead = false;
    this.target = null; this.retarget = Math.random() * 0.3;
  }
  update(dt) {
    const g = this.game, d = this.def;
    this.reload -= dt; this.retarget -= dt;
    if (this.retarget <= 0) { this.retarget = 0.25; this.target = g.nearestPlayerThing(this.x, this.y, d.range); }
    if (this.target && (this.target.dead || dist(this.x, this.y, this.target.cx ?? this.target.x, this.target.cy ?? this.target.y) > d.range + 0.5)) this.target = null;

    if (this.target) {
      const tx = this.target.cx ?? this.target.x, ty = this.target.cy ?? this.target.y;
      this.angle = Math.atan2(ty - this.y, tx - this.x);
      if (this.reload <= 0) {
        this.reload = d.reload;
        g.addBullet({ x: this.x + Math.cos(this.angle) * d.radius, y: this.y + Math.sin(this.angle) * d.radius,
          vx: Math.cos(this.angle) * d.bulletSpeed, vy: Math.sin(this.angle) * d.bulletSpeed,
          team: TEAM.ENEMY, dmg: d.dmg, life: (d.range + 0.6) / d.bulletSpeed, splash: 0, color: '#ff7b7b', size: 2.5 });
      }
    }
    const stopped = this.target && !d.flying; // ground units stop to shoot, but still get pushed apart

    // Movement target: flying units go straight for the core, ground units follow the flow field.
    let tx, ty;
    if (d.flying || g.map.flowAt(this.x | 0, this.y | 0) >= FLOW_INF) { tx = g.core.cx; ty = g.core.cy; }
    else {
      const n = this.bestNeighbor(this.x | 0, this.y | 0);
      if (n) { tx = n[0] + 0.5; ty = n[1] + 0.5; } else { tx = g.core.cx; ty = g.core.cy; }
    }
    const dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy) || 1;
    let vx = stopped ? 0 : (dx / len) * d.speed, vy = stopped ? 0 : (dy / len) * d.speed;
    // Cheap separation so units don't stack into one pixel.
    for (const o of g.enemies) {
      if (o === this || o.def.flying !== d.flying) continue;
      const ox = this.x - o.x, oy = this.y - o.y, od = Math.hypot(ox, oy), min = this.def.radius + o.def.radius;
      if (od > 0 && od < min) { vx += (ox / od) * (min - od) * 6; vy += (oy / od) * (min - od) * 6; }
    }
    if (this.target && d.flying) { vx *= 0.35; vy *= 0.35; }
    const nx = this.x + vx * dt, ny = this.y + vy * dt;
    if (d.flying || !g.map.isSolid(nx | 0, ny | 0) || g.map.isSolid(this.x | 0, this.y | 0)) { this.x = nx; this.y = ny; } // ground units can't enter rock (but can leave it if pushed in)
    else if (!g.map.isSolid(nx | 0, this.y | 0)) this.x = nx;
    else if (!g.map.isSolid(this.x | 0, ny | 0)) this.y = ny;
    this.vx = vx; this.vy = vy;
    if (!this.target) this.angle = Math.atan2(vy, vx);
  }
  bestNeighbor(x, y) {
    const m = this.game.map; let best = null, bd = m.flowAt(x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (dx && dy && (m.isSolid(x + dx, y) || m.isSolid(x, y + dy))) continue; // no corner cutting through rock
      const v = m.flowAt(x + dx, y + dy);
      if (v < bd) { bd = v; best = [x + dx, y + dy]; }
    }
    return best;
  }
  damage(n) {
    if (this.dead) return;
    this.hp -= n;
    if (this.hp <= 0) { this.dead = true; this.game.onEnemyKilled(this); }
  }
}

class Bullet {
  constructor(o) { Object.assign(this, o); this.dead = false; }
  update(dt) {
    const g = this.game;
    this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
    if (!g.map.inBounds(this.x | 0, this.y | 0)) { this.dead = true; return; }
    if (this.team === TEAM.PLAYER) {
      if (!this.splash) { // direct hit on the first enemy we touch
        for (const e of g.enemies) {
          if (e.dead) continue;
          if (dist(this.x, this.y, e.x, e.y) < e.def.radius + 0.12) { e.damage(this.dmg); this.dead = true; g.addEffect(this.x, this.y, this.color, 0.25, 0.15); return; }
        }
      }
      if (this.life <= 0) { if (this.splash) this.explode(); this.dead = true; }
    } else {
      const b = g.map.buildingAt(this.x | 0, this.y | 0);
      if (b && b.team === TEAM.PLAYER) { b.damage(this.dmg); this.dead = true; g.addEffect(this.x, this.y, '#ff9f9f', 0.3, 0.15); return; }
      const p = g.player;
      if (!p.dead && dist(this.x, this.y, p.x, p.y) < 0.4) { p.damage(this.dmg); this.dead = true; return; }
      if (this.life <= 0) this.dead = true;
    }
  }
  explode() {
    const g = this.game;
    g.addEffect(this.x, this.y, '#bff0ff', this.splash, 0.35);
    for (const e of g.enemies) {
      if (e.dead) continue;
      const dd = dist(this.x, this.y, e.x, e.y);
      if (dd < this.splash + e.def.radius) e.damage(this.dmg * (dd < this.splash * 0.5 ? 1 : 0.6));
    }
  }
}
