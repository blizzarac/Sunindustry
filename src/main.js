'use strict';
(function boot() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  let game;
  const getGame = () => game;
  const ui = new UI(getGame);
  const input = new Input(canvas, renderer, getGame, ui);
  ui.input = input;

  function newGame(seed) {
    game = new Game(seed ?? (Math.random() * 1e9) | 0);
    renderer.cam.x = game.player.x * TILE; renderer.cam.y = game.player.y * TILE;
    input.selected = null; input.rot = 0;
    ui.refreshToolbar();
  }
  ui.onRestart = () => newGame();

  const params = new URLSearchParams(location.search);
  newGame(params.has('seed') ? +params.get('seed') : undefined);
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  if (!params.has('nohelp')) ui.showHelp();

  let last = performance.now(), acc = 0, hudTimer = 0;
  const STEP = 1 / 60;
  function frame(now) {
    let dt = Math.min(0.1, (now - last) / 1000); last = now;
    acc += dt;
    while (acc >= STEP) { game.update(STEP, input); acc -= STEP; }
    input.updateTile();
    renderer.render(game, input, ui);
    hudTimer += dt;
    if (hudTimer > 0.1) { hudTimer = 0; ui.update(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Exposed for debugging / automated tests.
  window.AIndustry = { get game() { return game; }, input, renderer, ui, newGame };
})();
