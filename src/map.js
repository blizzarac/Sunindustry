'use strict';
const T_GROUND = 0, T_WALL = 1, T_SAND = 2;
const FLOW_INF = 1e9;

class GameMap {
  constructor(w, h, seed) {
    this.w = w; this.h = h; this.seed = seed;
    this.terrain = new Uint8Array(w * h);
    this.ore = new Uint8Array(w * h);
    this.building = new Array(w * h).fill(null);
    this.flow = new Float32Array(w * h);
    this.cx = Math.floor(w / 2); this.cy = Math.floor(h / 2); // core centre tile
    this.spawns = [];
    this.generate();
  }
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  terrainAt(x, y) { return this.inBounds(x, y) ? this.terrain[this.idx(x, y)] : T_WALL; }
  oreAt(x, y) { return this.inBounds(x, y) ? this.ore[this.idx(x, y)] : 0; }
  buildingAt(x, y) { return this.inBounds(x, y) ? this.building[this.idx(x, y)] : null; }
  isSolid(x, y) { return !this.inBounds(x, y) || this.terrain[this.idx(x, y)] === T_WALL; }
  flowAt(x, y) { return this.inBounds(x, y) ? this.flow[this.idx(x, y)] : FLOW_INF; }

  setBuilding(b) { b.forEachTile((x, y) => { this.building[this.idx(x, y)] = b; }); }
  clearBuilding(b) { b.forEachTile((x, y) => { if (this.building[this.idx(x, y)] === b) this.building[this.idx(x, y)] = null; }); }

  generate() {
    const rand = mulberry32(this.seed);
    const w = this.w, h = this.h;
    const rock = makeFbm(rand, w, h, [14, 7, 3.5], [0.6, 0.3, 0.1]);
    const sand = makeValueNoise(rand, w, h, 9);
    const copper = makeValueNoise(rand, w, h, 7);
    const lead = makeValueNoise(rand, w, h, 8);
    const cx = this.cx, cy = this.cy;

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = this.idx(x, y);
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const nearCore = dist(x, y, cx, cy) < 8;
      let t = T_GROUND;
      if (edge || (rock(x, y) > 0.615 && !nearCore)) t = T_WALL;
      else if (sand(x, y) < 0.42) t = T_SAND;
      this.terrain[i] = t;
      if (t !== T_WALL && dist(x, y, cx, cy) > 2.5) {
        if (copper(x, y) > 0.81) this.ore[i] = 1;
        else if (lead(x, y) > 0.83) this.ore[i] = 2;
      }
    }
    // Guarantee a starter patch of each ore close to the core.
    this.ensureOre(1, cx - 6, cy + 4, 9);
    this.ensureOre(2, cx + 6, cy - 5, 11);
    this.pickSpawns();
  }

  ensureOre(type, px, py, radius) {
    let count = 0;
    for (let y = this.cy - radius; y <= this.cy + radius; y++) for (let x = this.cx - radius; x <= this.cx + radius; x++)
      if (this.oreAt(x, y) === type && dist(x, y, this.cx, this.cy) <= radius) count++;
    if (count >= 10) return;
    for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
      if (!this.inBounds(x, y) || dist(x, y, px, py) > 2.3) continue;
      const i = this.idx(x, y);
      if (this.terrain[i] === T_WALL) this.terrain[i] = T_GROUND;
      this.ore[i] = type;
    }
  }

  // BFS from the core over walkable terrain; spawns are far-away reachable tiles near the map border.
  pickSpawns() {
    const w = this.w, h = this.h;
    const d = new Int32Array(w * h).fill(-1);
    const q = [this.idx(this.cx, this.cy)]; d[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny) || this.terrain[this.idx(nx, ny)] === T_WALL) continue;
        const ni = this.idx(nx, ny);
        if (d[ni] !== -1) continue;
        d[ni] = d[i] + 1; q.push(ni);
      }
    }
    const cands = [];
    for (let i = 0; i < d.length; i++) {
      if (d[i] < 28) continue;
      const x = i % w, y = (i / w) | 0;
      const nearBorder = x <= 6 || y <= 6 || x >= w - 7 || y >= h - 7;
      const tooClose = x < 4 || y < 4 || x > w - 5 || y > h - 5;
      if (nearBorder && !tooClose) cands.push({ x, y, d: d[i] });
    }
    let a, b;
    if (cands.length) {
      a = cands.reduce((m, c) => (c.d > m.d ? c : m));
      b = cands.reduce((m, c) => (dist(c.x, c.y, a.x, a.y) > dist(m.x, m.y, a.x, a.y) ? c : m));
    } else { // very unlikely: fall back to the two most distant reachable tiles
      let best = 0; for (let i = 0; i < d.length; i++) if (d[i] > d[best]) best = i;
      a = { x: best % w, y: (best / w) | 0 }; b = a;
    }
    this.spawns = [a, b].map(({ x, y }) => ({ x, y }));
    for (const s of this.spawns) // small clearing so units don't spawn inside rock
      for (let y = s.y - 2; y <= s.y + 2; y++) for (let x = s.x - 2; x <= s.x + 2; x++)
        if (this.inBounds(x, y) && x > 0 && y > 0 && x < w - 1 && y < h - 1) this.terrain[this.idx(x, y)] = T_GROUND;
  }

  // Dijkstra distance-to-core. Player buildings are walkable but expensive so that
  // enemies prefer open paths yet will happily chew through a wall if the detour is long.
  computeFlow(coreTiles) {
    const w = this.w, flow = this.flow; flow.fill(FLOW_INF);
    const heap = new MinHeap();
    for (const [x, y] of coreTiles) { const i = this.idx(x, y); flow[i] = 0; heap.push(0, i); }
    while (heap.size) {
      const [dcur, i] = heap.pop();
      if (dcur > flow[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (this.terrain[ni] === T_WALL) continue;
        const b = this.building[ni];
        const cost = b && b.type !== 'core' ? 40 : 1;
        const nd = dcur + cost;
        if (nd < flow[ni]) { flow[ni] = nd; heap.push(nd, ni); }
      }
    }
  }
}
