'use strict';
// DOM HUD: resources, wave info, toolbar, overlays.
class UI {
  constructor(getGame) {
    this.getGame = getGame; this.input = null; this.overlayOpen = false; this.onRestart = null;
    this.el = {
      resources: document.getElementById('resources'), waveText: document.getElementById('wave-text'), waveSub: document.getElementById('wave-sub'),
      coreHp: document.getElementById('core-hp'), stats: document.getElementById('stats'), toolbar: document.getElementById('toolbar'),
      info: document.getElementById('block-info'), overlay: document.getElementById('overlay'), overlayContent: document.getElementById('overlay-content'),
      skip: document.getElementById('skip-wave'),
    };
    this.el.skip.addEventListener('click', () => { const g = this.getGame(); if (!g.over) g.nextWave(); });
    document.getElementById('btn-help').addEventListener('click', () => this.showHelp());
    document.getElementById('btn-pause').addEventListener('click', () => { const g = this.getGame(); if (!g.over) g.paused = !g.paused; });
    document.getElementById('btn-full').addEventListener('click', () => {
      const d = document.documentElement;
      try { if (document.fullscreenElement) document.exitFullscreen(); else (d.requestFullscreen || d.webkitRequestFullscreen).call(d); } catch (e) { /* not supported (iOS Safari) */ }
    });
    this.el.overlay.addEventListener('click', () => this.dismissOverlay());
    this.buildToolbar();
  }
  costHtml(cost) {
    return Object.entries(cost).map(([k, v]) => `<span style="color:${ITEMS[k].color}">${v} ${ITEMS[k].name.toLowerCase()}</span>`).join(' ') || '<span>free</span>';
  }
  buildToolbar() {
    this.el.toolbar.innerHTML = '';
    BUILDABLE.forEach((type, i) => {
      const d = BLOCKS[type];
      const el = document.createElement('div');
      el.className = 'tool'; el.dataset.type = type;
      el.innerHTML = `<div class="key">${i + 1}</div><div class="name">${d.name}</div><div class="cost">${this.costHtml(d.cost)}</div>`;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.select(type); });
      el.addEventListener('mouseenter', () => { this.hoverType = type; });
      el.addEventListener('mouseleave', () => { this.hoverType = null; });
      this.el.toolbar.appendChild(el);
    });
    const util = (type, key, name, sub, onTap) => {
      const el = document.createElement('div');
      el.className = 'tool util'; el.dataset.type = type;
      el.innerHTML = `<div class="key">${key}</div><div class="name">${name}</div><div class="cost">${sub}</div>`;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
      this.el.toolbar.appendChild(el);
    };
    util('rotate', 'R', '↻ Rotate', 'conveyors', () => this.input.rotate());
    util('remove', 'X', '✕ Remove', 'refunds', () => this.input.select('remove'));
  }
  refreshToolbar() {
    const g = this.getGame();
    for (const el of this.el.toolbar.children) {
      el.classList.toggle('selected', el.dataset.type === this.input.selected);
      const def = BLOCKS[el.dataset.type];
      el.classList.toggle('poor', !!def && !g.core.has(def.cost));
    }
  }
  update() {
    const g = this.getGame(), inp = this.input;
    this.el.resources.innerHTML = ITEM_LIST.map((k) => `<div class="res"><span class="dot" style="background:${ITEMS[k].color}"></span>${ITEMS[k].name}<span class="n">${g.core.inv[k] | 0}</span></div>`).join('');
    const alive = g.enemies.length + g.spawnQueue.length;
    this.el.waveText.textContent = g.over ? 'CORE DESTROYED' : `Wave ${g.wave + 1} in ${Math.ceil(g.waveTimer)}s${g.paused ? ' · PAUSED' : ''}`;
    this.el.waveSub.textContent = alive ? `${alive} enemies alive` : g.wave ? `wave ${g.wave} cleared` : 'build up your defenses';
    this.el.coreHp.style.width = `${Math.max(0, (g.core.hp / g.core.maxHp) * 100)}%`;
    this.el.stats.textContent = `kills ${g.stats.kills} · built ${g.stats.built} · lost ${g.stats.lost} · ${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`;
    this.refreshToolbar();

    const type = this.hoverType || inp.selected;
    if (type === 'remove') {
      this.el.info.textContent = 'Remove: tap or drag over blocks to deconstruct them (full refund).';
    } else if (type) {
      const d = BLOCKS[type];
      this.el.info.textContent = `${d.name}: ${d.desc}${d.rotates ? ' Press R to rotate.' : ''}${d.range ? ` Range ${d.range} tiles.` : ''}`;
    } else {
      const b = g.map.buildingAt(inp.tileX, inp.tileY);
      this.el.info.textContent = b ? `${b.def.name} · ${Math.ceil(b.hp)}/${b.maxHp} hp · ${b.status()}`
        : inp.touch ? 'Pick a block below, then tap or drag on the map. Joystick moves your ship.'
        : 'Pick a block (1–7) and click on the map. Right-click removes and refunds. WASD moves your ship.';
    }
    if (g.over && !this.overlayOpen) this.showGameOver();
  }
  showOverlay(html) { this.el.overlayContent.innerHTML = html; this.el.overlay.classList.remove('hidden'); this.overlayOpen = true; this.getGame().paused = true; }
  dismissOverlay() {
    if (!this.overlayOpen) return;
    this.el.overlay.classList.add('hidden'); this.overlayOpen = false;
    const g = this.getGame();
    if (g.over) { this.onRestart && this.onRestart(); return; }
    g.paused = false;
  }
  showHelp() {
    this.showOverlay(`
      <h1>A-Industry — gameplay POC</h1>
      <p>Mine ore, move it to your core with conveyors, spend it on turrets, survive the waves.</p>
      <h2>Goal</h2>
      <ul>
        <li>Enemies walk in from the <b style="color:#ff7070">red spawn markers</b> and shoot whatever is closest. Keep the <b style="color:#ffd37f">core</b> alive.</li>
        <li><b>Drills</b> on ore → <b>conveyors</b> → core. Turrets need ammo: run a belt of copper into them.</li>
        <li><b>Smelter</b> turns 2 copper + 1 lead into alloy. Alloy unlocks the <b>Hail</b> artillery.</li>
      </ul>
      <h2>Controls</h2>
      ${this.input && this.input.touch ? `<ul>
        <li><b>Joystick</b> (bottom left) flies your ship. It auto-shoots. You can only build near it.</li>
        <li>Pick a block in the bar, then <b>tap</b> the map to build or <b>drag</b> to paint a line. Belts turn with your finger.</li>
        <li><b>↻ Rotate</b> turns the next conveyor · <b>✕ Remove</b> then tap blocks to refund them · tap the selected block again to deselect.</li>
        <li><b>Pinch</b> to zoom · <b>?</b> help · <b>II</b> pause · <b>⛶</b> fullscreen.</li>
      </ul>` : `<ul>
        <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly your ship (it auto-shoots). You can only build near it.</li>
        <li><kbd>1</kbd>–<kbd>7</kbd> pick a block · <kbd>R</kbd> rotate · left-click / drag to build · right-click or <kbd>X</kbd> tool to remove (full refund) · <kbd>Q</kbd> deselect</li>
        <li><kbd>N</kbd> call the next wave early · <kbd>P</kbd> pause · <kbd>H</kbd> this help · mouse wheel zoom</li>
      </ul>`}
      <div class="cta">${this.input && this.input.touch ? 'Tap' : 'Click or press any key'} to play.</div>`);
  }
  showGameOver() {
    const g = this.getGame();
    this.showOverlay(`
      <h1>Core destroyed</h1>
      <p>You survived <b>${g.wave}</b> wave(s) in ${Math.floor(g.time / 60)}m ${Math.floor(g.time % 60)}s, killed <b>${g.stats.kills}</b> enemies, built <b>${g.stats.built}</b> blocks and lost <b>${g.stats.lost}</b>.</p>
      <div class="cta">Click or press any key to start a new map.</div>`);
  }
}
