'use strict';
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // rotation 0..3 = right, down, left, up

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) { // deterministic 0..1 for tile decoration
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const smoothstep = (t) => t * t * (3 - 2 * t);

// Value noise with bilinear interpolation on a random lattice.
function makeValueNoise(rand, w, h, period) {
  const gw = Math.ceil(w / period) + 2, gh = Math.ceil(h / period) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const fx = x / period, fy = y / period;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smoothstep(fx - x0), ty = smoothstep(fy - y0);
    const v = (i, j) => g[j * gw + i];
    return lerp(lerp(v(x0, y0), v(x0 + 1, y0), tx), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), tx), ty);
  };
}
function makeFbm(rand, w, h, periods, weights) {
  const layers = periods.map((p) => makeValueNoise(rand, w, h, p));
  const sum = weights.reduce((a, b) => a + b, 0);
  return (x, y) => layers.reduce((acc, n, i) => acc + n(x, y) * weights[i], 0) / sum;
}

// Minimal binary heap on [priority, value] pairs.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) {
    const a = this.a; a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
