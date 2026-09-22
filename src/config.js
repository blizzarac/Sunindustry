'use strict';
// ---------------------------------------------------------------------------
// Tunables. Everything gameplay-related that we may want to tweak lives here.
// Distances are in tiles, times in seconds, speeds in tiles/second.
// ---------------------------------------------------------------------------
const TILE = 32;            // pixels per tile at zoom 1
const MAP_W = 80;
const MAP_H = 60;

const WAVE_FIRST = 75;      // seconds of peace before wave 1
const WAVE_INTERVAL = 50;   // seconds between waves
const BUILD_RANGE = 11;     // player can only build this close to their ship

const CONVEYOR_SPEED = 2.4;   // tiles per second
const CONVEYOR_SPACING = 0.3; // min distance between items on a belt
const CONVEYOR_CAP = 3;       // items per belt tile

const ITEMS = {
  copper: { name: 'Copper', color: '#d9a066' },
  lead:   { name: 'Lead',   color: '#9a8fc4' },
  alloy:  { name: 'Alloy',  color: '#6fd3c9' },
};
const ITEM_LIST = Object.keys(ITEMS);
const ORE_ITEM = [null, 'copper', 'lead'];   // ore id -> item
const ORE_DRILL_TIME = [0, 1.3, 1.9];        // seconds per item

const START_ITEMS = { copper: 320, lead: 80, alloy: 0 };

const TEAM = { PLAYER: 1, ENEMY: 2 };

// Block definitions. `cls` is resolved in buildings.js.
const BLOCKS = {
  core: {
    name: 'Core', size: 3, hp: 2500, cost: {}, color: '#ffd37f',
    desc: 'Stores every item. If it dies, the game is over.',
  },
  conveyor: {
    name: 'Conveyor', size: 1, hp: 45, cost: { copper: 1 }, rotates: true, color: '#7d8590',
    desc: 'Moves items forward and pushes them into whatever it points at. Drag to draw a line.',
  },
  router: {
    name: 'Router', size: 1, hp: 60, cost: { copper: 3 }, color: '#9a9f86',
    desc: 'Splits incoming items to every adjacent block (except where they came from).',
  },
  drill: {
    name: 'Drill', size: 1, hp: 120, cost: { copper: 12 }, needsOre: true, color: '#b5a27d',
    desc: 'Place on ore. Mines and pushes items into adjacent conveyors, the core or other blocks.',
  },
  smelter: {
    name: 'Smelter', size: 1, hp: 150, cost: { copper: 30, lead: 25 }, color: '#b06a4f',
    desc: '2 copper + 1 lead -> 1 alloy. Alloy is needed for the Hail turret.',
  },
  wall: {
    name: 'Wall', size: 1, hp: 420, cost: { copper: 6 }, color: '#b78b6a',
    desc: 'Cheap block of hit points. Enemies shoot whatever is closest.',
  },
  duo: {
    name: 'Duo', size: 1, hp: 110, cost: { copper: 35 }, color: '#c9c9c9',
    range: 5.5, reload: 0.28, dmg: 9, bulletSpeed: 14, ammo: { copper: 5 }, ammoCap: 40,
    desc: 'Basic turret. Feed it copper as ammo (1 copper = 5 shots).',
  },
  hail: {
    name: 'Hail', size: 1, hp: 160, cost: { copper: 40, alloy: 15 }, color: '#7fbfd6',
    range: 9.5, reload: 1.3, dmg: 34, splash: 1.3, bulletSpeed: 7, ammo: { alloy: 3 }, ammoCap: 24,
    desc: 'Artillery. Long range, splash damage. Uses alloy as ammo (1 alloy = 3 shells).',
  },
};
const BUILDABLE = ['conveyor', 'router', 'drill', 'smelter', 'wall', 'duo', 'hail'];

const ENEMIES = {
  dagger: { name: 'Dagger', hp: 70,  speed: 1.7, range: 2.8, dmg: 9,  reload: 0.9, radius: 0.32, flying: false, color: '#e06c6c', bulletSpeed: 9 },
  flare:  { name: 'Flare',  hp: 38,  speed: 4.4, range: 2.4, dmg: 4,  reload: 0.45, radius: 0.22, flying: true,  color: '#f0a35c', bulletSpeed: 11 },
  mace:   { name: 'Mace',   hp: 360, speed: 1.15, range: 2.3, dmg: 20, reload: 1.1, radius: 0.44, flying: false, color: '#c94f7c', bulletSpeed: 8 },
};

const PLAYER_DEF = { hp: 260, speed: 7.5, range: 6.5, reload: 0.2, dmg: 9, bulletSpeed: 16, respawn: 4 };
