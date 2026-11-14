import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
//  THE SANDBOX GAME — maps: yard / forest / city / village
// ============================================================

const TILE = 4;
const COLS = 14, ROWS = 14;
let GW = COLS * 2 + 1, GH = ROWS * 2 + 1;

const PLAYER_WALK = 4.2;
const PLAYER_SPRINT = 7.0;
const PLAYER_RADIUS = 0.55;
const EYE_HEIGHT = 1.7;

const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (n) => Math.floor(Math.random() * n);

// ---------- DOM ----------
const canvas = document.getElementById('game-canvas');
const hud = document.getElementById('hud');
const mapnameEl = document.getElementById('mapname');
const hintEl = document.getElementById('hint');
const msgEl = document.getElementById('msg');
const selnameEl = document.getElementById('selname');
const menuOverlay = document.getElementById('menu-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const rotateOverlay = document.getElementById('rotate-overlay');
const joyBase = document.getElementById('joy-base');
const joyKnob = document.getElementById('joy-knob');
const promptEl = document.getElementById('prompt');
const btnCar = document.getElementById('btn-car');
const flashEl = document.getElementById('flash');

// ---------- Game state ----------
const S = {
  map: 'yard',
  started: false, playing: false,
  sel: 0, night: false,
  shakeT: 0, pausedByRotate: false,
  driving: null,
};

// ---------- Renderer / scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e1) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'default' });
  } catch (e2) {
    if (window.__showBootError) window.__showBootError('Не удалось запустить графику (WebGL). Открой игру в обычном Chrome или Safari (не во встроенном браузере мессенджера). На ПК включи аппаратное ускорение: Настройки → Система, и перезапусти браузер. Система: ' + (navigator.userAgent || '?'));
    throw e2;
  }
}
renderer.setPixelRatio(IS_TOUCH ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2));
if (IS_TOUCH) document.body.classList.add('touch');
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 150);
camera.rotation.order = 'YXZ';

const ambient = new THREE.AmbientLight(0xb0bcc4, 0.8);
scene.add(ambient);

const playerLight = new THREE.PointLight(0x556677, 1.6, 9, 1.6);
scene.add(playerLight);

const flashlight = new THREE.SpotLight(0xfff2d0, 90, 40, 0.46, 0.45, 1.5);
flashlight.visible = false;
scene.add(flashlight);
scene.add(flashlight.target);

// ---------- Procedural textures ----------
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeGroundTexture(map) {
  const cfgs = {
    yard: ['#37352f', ['#3f3d36', '#2e2c28']],
    forest: ['#24331d', ['#2c3e23', '#1c2917']],
    city: ['#26262a', ['#2d2d32', '#1f1f23']],
    village: ['#3d5230', ['#48603a', '#33452a']],
    world: ['#3d5230', ['#48603a', '#33452a']],
  };
  const [base, vars] = cfgs[map] || cfgs.yard;
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < 900; k++) {
      ctx.globalAlpha = rand(0.2, 0.6);
      ctx.fillStyle = vars[randInt(vars.length)];
      const r = rand(1, 3.5);
      ctx.fillRect(rand(0, s), rand(0, s), r, r);
    }
    ctx.globalAlpha = 1;
  });
}

function makeWallTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#3a3733';
    ctx.fillRect(0, 0, s, s);
    const bw = 32, bh = 16;
    for (let row = 0; row < s / bh; row++) {
      const off = (row % 2) * (bw / 2);
      for (let col = -1; col < s / bw + 1; col++) {
        const sh = 58 + randInt(18);
        ctx.fillStyle = `rgb(${sh},${sh - 4},${sh - 8})`;
        ctx.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
  });
}

function makeFacadeTexture(b) {
  const base = ['#3c4046', '#453d35', '#38383c'][b];
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = Math.random() < 0.35 ? '#e8c47a' : '#141a20';
      ctx.fillRect(10 + c * 30, 8 + r * 30, 18, 20);
    }
  });
}

// ---------- Maps ----------
const MAPS = {
  yard: {
    name: 'Двор', wallColor: 0x4a4642, wallH: 3.0, ground: 0x2b2a28,
    fog: 0x060608, fogD: 0.065, dayFog: 0x9aa0a6, ambient: [0x33404d, 0.22],
  },
  forest: {
    name: 'Лес', wallColor: 0x3a2a1a, wallH: 5.5, ground: 0x1a2214,
    fog: 0x040704, fogD: 0.095, dayFog: 0x7f8f7a, ambient: [0x223322, 0.18],
  },
  city: {
    name: 'Город', wallColor: 0x37342f, wallH: 5.0, ground: 0x232325,
    fog: 0x060d05, fogD: 0.075, dayFog: 0x8f9a88, ambient: [0x2a3325, 0.2],
  },
  village: {
    name: 'Село Сулоаоу', wallColor: 0x6b5138, wallH: 3.2, ground: 0x3d5230,
    fog: 0x0a0d08, fogD: 0.055, dayFog: 0xa8b0a0, ambient: [0x3a4030, 0.3],
  },
  world: {
    name: 'Открытый мир', wallColor: 0x4a4642, wallH: 3.0, ground: 0x3d5230,
    fog: 0x0a0d08, fogD: 0.032, dayFog: 0xa8b0a0, ambient: [0x3a4030, 0.3],
  },
};

const spawnTile = [1, 1];

let grid = new Uint8Array(GW * GH);
let activeSpawn = spawnTile;
const idx = (i, j) => j * GW + i;
const isWall = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? true : grid[idx(i, j)] !== 0;
let floors = [];
let worldGroup = null;
let spawnedGroup = null;
let objects = [];
let builtMap = null;
const houseRects = [];
const windowMats = [];

const tileCenter = (i, j) => new THREE.Vector3((i + 0.5) * TILE, 0, (j + 0.5) * TILE);

function generateMaze() {
  const visited = new Uint8Array(COLS * ROWS);
  const stack = [[0, 0]];
  visited[0] = 1;
  grid[idx(1, 1)] = 0;
  while (stack.length) {
    const [ci, cj] = stack[stack.length - 1];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    let moved = false;
    for (const [di, dj] of dirs) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS || visited[nj * COLS + ni]) continue;
      visited[nj * COLS + ni] = 1;
      grid[idx(ci * 2 + 1 + di, cj * 2 + 1 + dj)] = 0;
      grid[idx(ni * 2 + 1, nj * 2 + 1)] = 0;
      stack.push([ni, nj]);
      moved = true;
      break;
    }
    if (!moved) stack.pop();
  }
}

function carveToStreet(i, j) {
  const dir = (i % 6) > 3 ? -1 : 1;
  let ci = i;
  grid[idx(ci, j)] = 0;
  while (ci % 6 !== 3 && ci > 0 && ci < GW - 1) {
    ci += dir;
    grid[idx(ci, j)] = 0;
  }
}

function bfsReach() {
  const reach = new Uint8Array(GW * GH);
  const q = [idx(activeSpawn[0], activeSpawn[1])];
  reach[q[0]] = 1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const ci = cur % GW, cj = (cur - ci) / GW;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (isWall(ni, nj)) continue;
      const n = idx(ni, nj);
      if (reach[n]) continue;
      reach[n] = 1;
      q.push(n);
    }
  }
  return reach;
}

function zoneOf(i, j, map) {
  if (map !== 'world') return map;
  return i <= 30 ? (j <= 30 ? 'yard' : 'city') : (j <= 30 ? 'forest' : 'village');
}

function placeHouse(hi, hj, w, d) {
  if (hi < 2 || hj < 2 || hi + w >= GW - 2 || hj + d >= GH - 2) return;
  let clear = true;
  for (let a = -1; a <= w && clear; a++) for (let b = -1; b <= d; b++) {
    if (grid[idx(hi + a, hj + b)] !== 0) { clear = false; break; }
  }
  if (!clear) return;
  for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) {
    const edge = a === 0 || b === 0 || a === w - 1 || b === d - 1;
    grid[idx(hi + a, hj + b)] = edge ? 2 : 0;
  }
  const door = Math.floor(w / 2);
  grid[idx(hi + door, hj + d - 1)] = 0;
  houseRects.push({ hi, hj, w, d, door });
}

function generateGrid(map) {
  const stdW = COLS * 2 + 1;
  if (GW !== stdW || GH !== stdW || grid.length !== stdW * stdW) {
    GW = stdW;
    GH = stdW;
    grid = new Uint8Array(GW * GH);
  }
  activeSpawn = map === 'world' ? [30, 30] : spawnTile;
  grid.fill(1);
  houseRects.length = 0;
  if (map === 'yard') {
    generateMaze();
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      if (grid[idx(i, j)] === 1 && ((i % 2 === 0) !== (j % 2 === 0)) && Math.random() < 0.42) grid[idx(i, j)] = 0;
    }
  } else if (map === 'forest') {
    grid.fill(0);
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      const nearSpawn = Math.abs(i - spawnTile[0]) < 3 && Math.abs(j - spawnTile[1]) < 3;
      if (!nearSpawn && Math.random() < 0.34) grid[idx(i, j)] = 1;
    }
  } else if (map === 'city') {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1) { grid[idx(i, j)] = 1; continue; }
      grid[idx(i, j)] = (i % 6 === 3 || j % 6 === 3) ? 0 : (Math.random() < 0.82 ? 1 : 0);
    }
    carveToStreet(spawnTile[0], spawnTile[1]);
  } else if (map === 'village') {
    grid.fill(0);
    const houses = 8 + randInt(4);
    for (let h = 0; h < houses; h++) {
      const w = 3 + randInt(3), d = 3 + randInt(3);
      const hi = 2 + randInt(GW - w - 4), hj = 2 + randInt(GH - d - 4);
      let clear = true;
      for (let a = -1; a <= w && clear; a++) for (let b = -1; b <= d; b++) {
        if (grid[idx(hi + a, hj + b)] !== 0) { clear = false; break; }
      }
      if (!clear) continue;
      if (hi < 4 && hj < 4) continue;
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) {
        const edge = a === 0 || b === 0 || a === w - 1 || b === d - 1;
        grid[idx(hi + a, hj + b)] = edge ? 2 : 0;
      }
      const door = Math.floor(w / 2);
      grid[idx(hi + door, hj + d - 1)] = 0;
      houseRects.push({ hi, hj, w, d, door });
    }
    for (let f = 0; f < 10; f++) {
      const fi = 2 + randInt(GW - 8), fj = 2 + randInt(GH - 8);
      const horiz = Math.random() < 0.5;
      const len = 4 + randInt(4);
      for (let a = 0; a < len; a++) {
        const i = horiz ? fi + a : fi, j = horiz ? fj : fj + a;
        if (i > 0 && j > 0 && i < GW - 1 && j < GH - 1 && grid[idx(i, j)] === 0) grid[idx(i, j)] = 3;
      }
    }
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const i = spawnTile[0] + a, j = spawnTile[1] + b;
      if (i > 0 && j > 0 && i < GW - 1 && j < GH - 1) grid[idx(i, j)] = 0;
    }
  } else if (map === 'world') {
    GW = GH = 61;
    grid = new Uint8Array(GW * GH);
    grid.fill(1);
    for (let k = 1; k < GH - 1; k++) { grid[idx(30, k)] = 0; grid[idx(31, k)] = 0; }
    for (let k = 1; k < GW - 1; k++) { grid[idx(k, 30)] = 0; grid[idx(k, 31)] = 0; }

    generateMaze();
    for (let j = 1; j < 30; j++) for (let i = 1; i < 30; i++) {
      if (grid[idx(i, j)] === 1 && ((i % 2 === 0) !== (j % 2 === 0)) && Math.random() < 0.42) grid[idx(i, j)] = 0;
    }

    for (let j = 1; j < 30; j++) for (let i = 32; i < 60; i++) {
      const nearSpawn = Math.abs(i - 30) < 4 && Math.abs(j - 30) < 4;
      if (!nearSpawn && Math.random() < 0.34) grid[idx(i, j)] = 1;
    }

    for (let j = 32; j < 60; j++) for (let i = 1; i < 30; i++) {
      grid[idx(i, j)] = ((i % 6) === 3 || (j % 6) === 3) ? 0 : (Math.random() < 0.82 ? 1 : 0);
    }

    for (let j = 32; j < 60; j++) for (let i = 32; i < 60; i++) grid[idx(i, j)] = 0;
    const houses = 10 + randInt(4);
    for (let h = 0; h < houses; h++) {
      placeHouse(33 + randInt(24), 33 + randInt(24), 3 + randInt(3), 3 + randInt(3));
    }
    for (let f = 0; f < 12; f++) {
      const fi = 33 + randInt(22), fj = 33 + randInt(22);
      const horiz = Math.random() < 0.5;
      const len = 4 + randInt(4);
      for (let a = 0; a < len; a++) {
        const i = horiz ? fi + a : fi, j = horiz ? fj : fj + a;
        if (i < GW - 1 && j < GH - 1 && grid[idx(i, j)] === 0) grid[idx(i, j)] = 3;
      }
    }

    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      grid[idx(30 + a, 30 + b)] = 0;
    }
  }

  const reach = bfsReach();
  floors = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (!isWall(i, j) && reach[idx(i, j)]) floors.push([i, j]);
  }
}

// ---------- World building ----------
function disposeWorld() {
  if (!worldGroup) return;
  worldGroup.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mt of mats) {
        if (mt.map) mt.map.dispose();
        mt.dispose();
      }
    }
  });
  scene.remove(worldGroup);
  worldGroup = null;
}

function applyAtmosphere() {
  const cfg = MAPS[S.map];
  if (S.night) {
    scene.fog.color.setHex(cfg.fog);
    scene.fog.density = cfg.fogD;
    scene.background.setHex(cfg.fog);
    ambient.color.setHex(cfg.ambient[0]);
    ambient.intensity = cfg.ambient[1];
  } else {
    scene.fog.color.setHex(cfg.dayFog);
    scene.fog.density = cfg.fogD * 0.55;
    scene.background.setHex(cfg.dayFog);
    ambient.color.setHex(0xb0bcc4);
    ambient.intensity = 0.85;
  }
  const glow = S.night ? 1.0 : 0.12;
  for (const m of windowMats) m.emissiveIntensity = glow;
}

function buildWalls(cfg, map) {
  const zoneTiles = { yard: [], forest: [], city: [], village: [] };
  const fenceTiles = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const v = grid[idx(i, j)];
    if (v === 1) zoneTiles[zoneOf(i, j, map)].push([i, j]);
    else if (v === 3) fenceTiles.push([i, j]);
  }
  if (zoneTiles.forest.length) buildForestTrees(zoneTiles.forest);
  if (zoneTiles.yard.length) buildYardWalls(zoneTiles.yard);
  if (zoneTiles.city.length) buildCityBuildings(zoneTiles.city);
  if (fenceTiles.length) buildFences(fenceTiles);
}

function buildForestTrees(wallTiles) {
  const cfg = MAPS.forest;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.45, cfg.wallH, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
  const leafGeo = new THREE.ConeGeometry(1.7, 2.6, 8);
  const leaf2Geo = new THREE.ConeGeometry(1.25, 2.2, 8);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1b3a1e, roughness: 1 });
  const leaf2Mat = new THREE.MeshStandardMaterial({ color: 0x234a24, roughness: 1 });
  const n = wallTiles.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n);
  const leaves2 = new THREE.InstancedMesh(leaf2Geo, leaf2Mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  wallTiles.forEach(([i, j], k) => {
    const c = tileCenter(i, j);
    const ox = rand(-1.0, 1.0), oz = rand(-1.0, 1.0);
    const s = rand(0.8, 1.35);
    e.set(0, rand(0, Math.PI * 2), 0);
    q.setFromEuler(e);
    sc.set(s, s, s);
    p.set(c.x + ox, (cfg.wallH / 2) * s, c.z + oz);
    m.compose(p, q, sc); trunks.setMatrixAt(k, m);
    p.set(c.x + ox, cfg.wallH * s + 0.9 * s, c.z + oz);
    m.compose(p, q, sc); leaves.setMatrixAt(k, m);
    p.set(c.x + ox, cfg.wallH * s + 2.1 * s, c.z + oz);
    m.compose(p, q, sc); leaves2.setMatrixAt(k, m);
  });
  worldGroup.add(trunks, leaves, leaves2);
}

function buildYardWalls(wallTiles) {
  const cfg = MAPS.yard;
  const wallGeo = new THREE.BoxGeometry(TILE, cfg.wallH, TILE);
  const wallMat = new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: 0.95 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallTiles.length);
  const m = new THREE.Matrix4();
  wallTiles.forEach(([i, j], n2) => {
    m.setPosition((i + 0.5) * TILE, cfg.wallH / 2, (j + 0.5) * TILE);
    walls.setMatrixAt(n2, m);
  });
  worldGroup.add(walls);
}

function buildCityBuildings(wallTiles) {
  const buckets = [[], [], []];
  wallTiles.forEach(t => buckets[randInt(3)].push(t));
  const heights = [5, 8.5, 12.5];
  const m = new THREE.Matrix4();
  buckets.forEach((tiles, b) => {
    if (!tiles.length) return;
    const h = heights[b];
    const facTex = makeFacadeTexture(b);
    facTex.repeat.set(2, Math.max(2, Math.round(h / 2.4)));
    const facMat = new THREE.MeshStandardMaterial({ map: facTex, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 1 });
    const geo = new THREE.BoxGeometry(TILE, h, TILE);
    const mesh = new THREE.InstancedMesh(geo, [facMat, facMat, roofMat, roofMat, facMat, facMat], tiles.length);
    tiles.forEach(([i, j], n2) => {
      m.setPosition((i + 0.5) * TILE, h / 2, (j + 0.5) * TILE);
      mesh.setMatrixAt(n2, m);
    });
    worldGroup.add(mesh);
  });
}

function buildFences(tiles) {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1 });
  const postGeo = new THREE.BoxGeometry(0.14, 1.15, 0.14);
  const railGeo = new THREE.BoxGeometry(TILE + 0.14, 0.1, 0.06);
  const solid = (i, j) => i >= 0 && j >= 0 && i < GW && j < GH && grid[idx(i, j)] !== 0;
  for (const [i, j] of tiles) {
    const c = tileCenter(i, j);
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(c.x, 0.58, c.z);
    worldGroup.add(post);
    if (solid(i + 1, j)) {
      for (const y of [0.45, 0.9]) {
        const rail = new THREE.Mesh(railGeo, woodMat);
        rail.position.set(c.x + TILE / 2, y, c.z);
        worldGroup.add(rail);
      }
    }
    if (solid(i, j + 1)) {
      for (const y of [0.45, 0.9]) {
        const rail = new THREE.Mesh(railGeo, woodMat);
        rail.position.set(c.x, y, c.z + TILE / 2);
        rail.rotation.y = Math.PI / 2;
        worldGroup.add(rail);
      }
    }
  }
}

function addYardProps(zone) {
  const spots = floors.filter(([i, j]) =>
    zoneOf(i, j, zone) === zone && Math.abs(i - activeSpawn[0]) + Math.abs(j - activeSpawn[1]) > 8
  );
  spots.sort(() => Math.random() - 0.5);
  for (let k = 0; k < 6 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const lamp = buildLamp();
    lamp.position.set(c.x, 0, c.z);
    lamp.rotation.y = rand(0, Math.PI * 2);
    worldGroup.add(lamp);
  }
  for (let k = 6; k < 12 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const box = buildBox();
    box.position.set(c.x + rand(-1, 1), 0, c.z + rand(-1, 1));
    box.rotation.y = rand(0, Math.PI);
    worldGroup.add(box);
  }
}

function addCityProps(zone) {
  const spots = floors.filter(([i, j]) =>
    zoneOf(i, j, zone) === zone && Math.abs(i - activeSpawn[0]) + Math.abs(j - activeSpawn[1]) > 8
  );
  spots.sort(() => Math.random() - 0.5);
  const toxicMat = new THREE.MeshStandardMaterial({ color: 0x1e3320, emissive: 0x2fbf2f, emissiveIntensity: 0.4, roughness: 0.6 });
  for (let k = 0; k < 8 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10), toxicMat);
    b.position.set(c.x + rand(-1.1, 1.1), 0.48, c.z + rand(-1.1, 1.1));
    worldGroup.add(b);
  }
  for (let k = 8; k < 14 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const car = buildCar();
    car.position.set(c.x, 0, c.z);
    car.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
    worldGroup.add(car);
    objects.push({ mesh: car, vel: new THREE.Vector3(), tnt: false, type: 'car', id: 'car' });
  }
}

function addVillageProps(zone) {
  const inHouse = (i, j) => houseRects.some(r => i >= r.hi && i < r.hi + r.w && j >= r.hj && j < r.hj + r.d);
  const spots = floors.filter(([i, j]) =>
    zoneOf(i, j, zone) === zone && Math.abs(i - activeSpawn[0]) + Math.abs(j - activeSpawn[1]) > 6 && !inHouse(i, j)
  );
  spots.sort(() => Math.random() - 0.5);
  for (let k = 0; k < 8 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const tree = buildTree();
    tree.position.set(c.x + rand(-1, 1), 0, c.z + rand(-1, 1));
    worldGroup.add(tree);
  }
  for (let k = 8; k < 14 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const hay = buildHay();
    hay.position.set(c.x + rand(-1, 1), 0, c.z + rand(-1, 1));
    hay.rotation.y = rand(0, Math.PI);
    worldGroup.add(hay);
  }
  if (spots.length > 14) {
    const c = tileCenter(spots[14][0], spots[14][1]);
    const well = buildWell();
    well.position.set(c.x, 0, c.z);
    worldGroup.add(well);
  }
}

const HOUSE_WALLS = [0xcfc3a8, 0xb8c0a8, 0xc9a88a, 0xb0a494, 0xd8cdb4];
const ROOF_COLS = [0x6b3a2e, 0x4a4a52, 0x5a4632, 0x3e4a3e];

function addHouseFurniture(g, r) {
  const W = r.w * TILE, D = r.d * TILE;
  const woodM = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.85 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
  const clothM = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 1 });
  const rugCols = [0x8a4a3a, 0x3a6a4a, 0x4a5a8a];
  const rug = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.03, 1.6), new THREE.MeshStandardMaterial({ color: rugCols[randInt(3)], roughness: 1 }));
  rug.position.set(0.2, 0.135, 0.6);
  g.add(rug);
  const table = new THREE.Group();
  const ttop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.9), woodM);
  ttop.position.y = 0.78;
  table.add(ttop);
  for (const [lx, lz] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.78, 0.09), darkM);
    leg.position.set(lx, 0.39, lz);
    table.add(leg);
  }
  table.position.set(0.2, 0.12, 0.7);
  g.add(table);
  const stoolG = new THREE.CylinderGeometry(0.24, 0.2, 0.5, 10);
  const st1 = new THREE.Mesh(stoolG, darkM);
  st1.position.set(-1.3, 0.37, 1.1);
  const st2 = new THREE.Mesh(stoolG, darkM);
  st2.position.set(1.5, 0.37, 0.7);
  g.add(st1, st2);
  const bed = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 2.15), darkM);
  frame.position.y = 0.18;
  const matt = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.18, 2.0), clothM);
  matt.position.y = 0.44;
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.14, 0.42), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 1 }));
  pillow.position.set(0, 0.56, -0.72);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.07, 0.06, 1.2), new THREE.MeshStandardMaterial({ color: 0x7a3a3a, roughness: 1 }));
  blanket.position.set(0, 0.55, 0.35);
  bed.add(frame, matt, pillow, blanket);
  bed.position.set(-1.3, 0.12, -0.9);
  g.add(bed);
  const night = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.45), woodM);
  night.position.set(0.3, 0.37, -1.55);
  g.add(night);
  const shelf = new THREE.Group();
  for (const sy of [0.5, 1.0, 1.5]) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.35), woodM);
    sh.position.y = sy;
    shelf.add(sh);
  }
  for (const sx of [-0.78, 0.78]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.6, 0.35), darkM);
    side.position.set(sx, 1.0, 0);
    shelf.add(side);
  }
  shelf.rotation.y = Math.PI / 2;
  shelf.position.set(W / 2 - 4.25, 0.12, -0.3);
  g.add(shelf);
}

function buildVillageHouses() {
  const winGeo = new THREE.BoxGeometry(0.95, 1.05, 0.1);
  const frameGeo = new THREE.BoxGeometry(1.15, 1.25, 0.08);
  for (const r of houseRects) {
    const W = r.w * TILE, D = r.d * TILE;
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: HOUSE_WALLS[randInt(HOUSE_WALLS.length)], roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: ROOF_COLS[randInt(ROOF_COLS.length)], roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2833, emissive: 0xffc866, emissiveIntensity: 0.12, roughness: 0.3 });
    windowMats.push(glassMat);

    const H = 3.0;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.2, 0.12, D - 0.2),
      new THREE.MeshStandardMaterial({ color: 0x6a4e2c, roughness: 1 })
    );
    floor.position.y = 0.06;
    const found = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 1 })
    );
    found.position.y = 0.15;
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), ceilMat);
    ceil.position.y = H + 0.1;
    g.add(floor, found, ceil);

    const wallSeg = (x0, x1, z0, z1) => {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry((x1 - x0) * TILE, H, (z1 - z0) * TILE),
        wallMat
      );
      seg.position.set(((x0 + x1) / 2 - r.w / 2) * TILE, H / 2, ((z0 + z1) / 2 - r.d / 2) * TILE);
      g.add(seg);
    };
    wallSeg(0, r.w, 0, 1);
    wallSeg(0, r.door, r.d - 1, r.d);
    wallSeg(r.door + 1, r.w, r.d - 1, r.d);
    wallSeg(0, 1, 1, r.d - 1);
    wallSeg(r.w - 1, r.w, 1, r.d - 1);

    const ridgeZ = D >= W;
    const span = (ridgeZ ? W : D) / 2 + 0.45;
    const ridgeLen = (ridgeZ ? D : W) + 0.7;
    const rise = Math.min(2.3, span * 0.85);
    const slopeLen = Math.hypot(span, rise);
    const ang = Math.atan2(rise, span);
    for (const s of [-1, 1]) {
      const slope = ridgeZ
        ? new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.16, ridgeLen), roofMat)
        : new THREE.Mesh(new THREE.BoxGeometry(ridgeLen, 0.16, slopeLen), roofMat);
      if (ridgeZ) {
        slope.position.set(s * span / 2, H + rise / 2 + 0.15, 0);
        slope.rotation.z = -s * ang;
      } else {
        slope.position.set(0, H + rise / 2 + 0.15, s * span / 2);
        slope.rotation.x = s * ang;
      }
      g.add(slope);
    }

    const shape = new THREE.Shape();
    shape.moveTo(-((ridgeZ ? W : D) / 2), 0);
    shape.lineTo((ridgeZ ? W : D) / 2, 0);
    shape.lineTo(0, rise);
    const gabGeo = new THREE.ShapeGeometry(shape);
    for (const s of [1, -1]) {
      const gab = new THREE.Mesh(gabGeo, wallMat);
      if (ridgeZ) gab.position.set(0, H + 0.15, s * D / 2);
      else { gab.rotation.y = Math.PI / 2; gab.position.set(s * W / 2, H + 0.15, 0); }
      if (s === -1) gab.rotation.y += Math.PI;
      g.add(gab);
    }

    const brickMat = new THREE.MeshStandardMaterial({ color: 0x6a4a3a, roughness: 1 });
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.5), brickMat);
    if (ridgeZ) chim.position.set(rand(-0.6, 0.6), H + rise * 0.75 + 0.5, rand(-D / 4, D / 4));
    else chim.position.set(rand(-W / 4, W / 4), H + rise * 0.75 + 0.5, rand(-0.6, 0.6));
    g.add(chim);

    const doorX = (r.door + 0.5 - r.w / 2) * TILE;
    for (const px of [doorX - TILE / 2, doorX + TILE / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.4), trimMat);
      post.position.set(px, H / 2, D / 2 - 0.1);
      g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.45, 0.4), trimMat);
    lintel.position.set(doorX, H - 0.22, D / 2 - 0.1);
    g.add(lintel);

    const addWin = (x, z, ry) => {
      const frame = new THREE.Mesh(frameGeo, trimMat);
      frame.position.set(x, 1.75, z);
      frame.rotation.y = ry;
      const win = new THREE.Mesh(winGeo, glassMat);
      win.position.set(x, 1.75, z);
      win.rotation.y = ry;
      win.translateZ(0.03);
      g.add(frame, win);
    };
    if (r.door > 0) addWin(((0 + r.door) / 2 - r.w / 2) * TILE, D / 2 + 0.06, 0);
    if (r.door < r.w - 1) addWin(((r.door + 1 + r.w) / 2 - r.w / 2) * TILE, D / 2 + 0.06, 0);
    addWin(W / 2 + 0.06, 0, Math.PI / 2);
    if (r.d >= 5) {
      addWin(W / 2 + 0.06, (D / 2 - TILE) * 0.55, Math.PI / 2);
      addWin(W / 2 + 0.06, -(D / 2 - TILE) * 0.55, Math.PI / 2);
    }
    addWin(-W / 2 - 0.06, 0, Math.PI / 2);
    addWin(-W / 4, -D / 2 - 0.06, 0);
    if (W > 7) addWin(W / 4, -D / 2 - 0.06, 0);

    addHouseFurniture(g, r);
    g.position.set((r.hi + r.w / 2) * TILE, 0, (r.hj + r.d / 2) * TILE);
    worldGroup.add(g);
  }
}

function buildWorld(map) {
  disposeWorld();
  generateGrid(map);
  const cfg = MAPS[map];
  worldGroup = new THREE.Group();
  objects = [];
  if (S.driving) { S.driving = null; stopEngine(); }

  windowMats.length = 0;
  const groundTex = makeGroundTexture(map);
  groundTex.repeat.set(GW / 2, GH / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GW * TILE, GH * TILE),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(GW * TILE / 2, 0, GH * TILE / 2);
  worldGroup.add(ground);

  buildWalls(cfg, map);
  if (map === 'village' || map === 'world') buildVillageHouses();
  if (map === 'yard' || map === 'world') addYardProps(map);
  if (map === 'city' || map === 'world') addCityProps(map);
  if (map === 'village' || map === 'world') addVillageProps(map);

  spawnedGroup = new THREE.Group();
  worldGroup.add(spawnedGroup);
  lampLights = 0;

  scene.add(worldGroup);
  scene.fog = new THREE.FogExp2(cfg.fog, cfg.fogD);
  scene.background = new THREE.Color(cfg.fog);
  applyAtmosphere();

  player.pos.copy(tileCenter(activeSpawn[0], activeSpawn[1]));
  player.pos.y = EYE_HEIGHT;
  player.yaw = Math.PI * 0.75;
  player.pitch = 0;
  builtMap = map;

  for (const n of [...npcs]) removeNPC(n);
  crimes = 0;
  const civCount = map === 'world' ? 16 : 8;
  for (let k = 0; k < civCount; k++) spawnCiv();
}

// ---------- Player ----------
const _sitV = new THREE.Vector3();
const player = {
  pos: new THREE.Vector3((spawnTile[0] + 0.5) * TILE, EYE_HEIGHT, (spawnTile[1] + 0.5) * TILE),
  yaw: Math.PI * 0.75, pitch: 0,
  bobT: 0, stepT: 0, moving: false,
  vy: 0, onGround: true,
};

const carState = { heading: 0, prevFwd: 0, fwd: 0 };

// ---------- NPCs ----------
let npcs = [];
let crimes = 0, crimeTimer = 0, copSpawnT = 0, arrestCd = 0, smiteCd = 0, sirenT = 0, panicT = 0;
const panicPos = new THREE.Vector3();

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
let engineOsc = null, engineGain = null;

// ---------- Touch controls ----------
const touchInput = { moveId: null, lookId: null, moveX: 0, moveZ: 0, lookLast: { x: 0, y: 0 } };
const JOY_R = 46;
let joyCenter = { x: 0, y: 0 };

canvas.addEventListener('touchstart', (e) => {
  if (!S.playing) return;
  for (const t of e.changedTouches) {
    if (t.target.closest && t.target.closest('.tbtn, .slot')) continue;
    e.preventDefault();
    const r = joyBase.getBoundingClientRect();
    joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (touchInput.moveId === null && Math.hypot(t.clientX - joyCenter.x, t.clientY - joyCenter.y) < 120) {
      touchInput.moveId = t.identifier;
    } else if (touchInput.lookId === null) {
      touchInput.lookId = t.identifier;
      touchInput.lookLast = { x: t.clientX, y: t.clientY };
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchInput.moveId) {
      e.preventDefault();
      const dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
      const d = Math.hypot(dx, dy);
      const m = Math.min(d, JOY_R);
      const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : 0;
      joyKnob.style.transform = `translate(${nx * m}px, ${ny * m}px)`;
      touchInput.moveX = nx * (m / JOY_R);
      touchInput.moveZ = ny * (m / JOY_R);
    } else if (t.identifier === touchInput.lookId) {
      e.preventDefault();
      player.yaw -= (t.clientX - touchInput.lookLast.x) * 0.0055;
      player.pitch = clamp(player.pitch - (t.clientY - touchInput.lookLast.y) * 0.0055, -1.45, 1.45);
      touchInput.lookLast = { x: t.clientX, y: t.clientY };
    }
  }
}, { passive: false });

function handleTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchInput.moveId) {
      touchInput.moveId = null;
      touchInput.moveX = 0;
      touchInput.moveZ = 0;
      joyKnob.style.transform = 'translate(0, 0)';
    } else if (t.identifier === touchInput.lookId) {
      touchInput.lookId = null;
    }
  }
}
canvas.addEventListener('touchend', handleTouchEnd);
canvas.addEventListener('touchcancel', handleTouchEnd);

function pauseGame() {
  S.playing = false;
  pauseOverlay.classList.remove('hidden');
}
document.getElementById('btn-pause').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (S.playing) pauseGame();
}, { passive: false });

document.getElementById('btn-spawn').addEventListener('touchstart', (e) => {
  if (S.sitting) { e.preventDefault(); e.stopPropagation(); standUp(); return; }
  e.preventDefault();
  if (S.playing) spawnSelected();
}, { passive: false });

document.getElementById('btn-del').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (S.playing) deleteNearest();
}, { passive: false });

document.getElementById('btn-day').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (S.playing) toggleDayNight();
}, { passive: false });

btnCar.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!S.playing) return;
  if (S.driving) exitCar();
  else { const c = nearestCar(); if (c) enterCar(c); }
}, { passive: false });

function checkOrientation() {
  if (!IS_TOUCH) return;
  const portrait = window.innerHeight > window.innerWidth;
  if (portrait) {
    rotateOverlay.classList.remove('hidden');
    if (S.playing) { S.pausedByRotate = true; S.playing = false; }
  } else {
    rotateOverlay.classList.add('hidden');
    if (S.pausedByRotate && S.started) {
      S.playing = true;
      S.pausedByRotate = false;
      pauseOverlay.classList.add('hidden');
    }
  }
}

// ---------- Keyboard / mouse ----------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (S.sitting) {
    if (e.code === 'KeyC') sleepNow();
    if (e.code === 'Space') standUp();
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    return;
  }
  if (e.code === 'KeyB' && S.started && !S.driving) { if (S.bagOpen) closeBag(); else openBag(); return; }
  if (!S.playing) return;
  if (e.code === 'KeyF') toggleFlashlight();
  if (e.code === 'KeyT') toggleDayNight();
  if (e.code === 'KeyX') deleteAimed();
  if (e.code === 'KeyE') { if (S.driving) exitCar(); else { const c = nearestCar(); if (c) enterCar(c); } }
  if (e.code === 'KeyV' || e.code === 'KeyC') {
    const o = findAimed();
    if (o && o.tv) { if (e.code === 'KeyV') setTvLink(o); else watchTv(o); }
    else if (o && o.seat && e.code === 'KeyC') sitOn(o);
    else if (o && o.console && e.code === 'KeyC') {
      const tv = nearestTvTo(o);
      if (tv) watchTv(tv);
      else showMsg('⚠️ Поставь приставку рядом с телевизором (до 5 м)');
    }
  }
  const digit = e.code.match(/^Digit([1-9])$/);
  if (digit) selectSlot(Math.min(parseInt(digit[1], 10) - 1, CATALOG.length - 1));
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousemove', (e) => {
  if (!S.playing) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});

canvas.addEventListener('mousedown', (e) => {
  if (!S.playing || S.driving || S.tvObj || S.sitting) return;
  if (e.button === 0) spawnSelected();
  if (e.button === 2) deleteAimed();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('wheel', (e) => {
  if (!S.playing) return;
  selectSlot((S.sel + (e.deltaY > 0 ? 1 : CATALOG.length - 1)) % CATALOG.length);
});

function collides(x, z) {
  const r = PLAYER_RADIUS;
  for (const dx of [-r, r]) for (const dz of [-r, r]) {
    if (isWall(Math.floor((x + dx) / TILE), Math.floor((z + dz) / TILE))) return true;
  }
  return false;
}

function forwardFlat() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  return dir.normalize();
}

function updatePlayer(dt) {
  if (S.sitting) {
    const s = S.sitting;
    if (!s.mesh.parent) {
      S.sitting = null;
      player.pos.y = EYE_HEIGHT;
      player.onGround = true;
    } else {
      _sitV.set(0, 1.15, -0.05);
      s.mesh.localToWorld(_sitV);
      player.pos.copy(_sitV);
      player.yaw = s.mesh.rotation.y + Math.PI;
      player.onGround = true;
      player.vy = 0;
      camera.position.set(_sitV.x, _sitV.y, _sitV.z);
      return;
    }
  }
  const joyActive = touchInput.moveId !== null;
  const fwd = joyActive ? -touchInput.moveZ : ((keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0));
  const strafe = joyActive ? touchInput.moveX : ((keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0));
  const wantSprint = (keys['ShiftLeft'] || keys['ShiftRight'] || (joyActive && Math.hypot(touchInput.moveX, touchInput.moveZ) > 0.95))
    && (Math.abs(fwd) > 0.01 || Math.abs(strafe) > 0.01);
  const speed = wantSprint ? PLAYER_SPRINT : PLAYER_WALK;

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  let vx = (-sin * fwd + cos * strafe);
  let vz = (-cos * fwd - sin * strafe);
  const len = Math.hypot(vx, vz);
  player.moving = len > 0;
  if (len > 0) {
    const mag = Math.min(len, 1);
    vx = vx / len * speed * mag * dt;
    vz = vz / len * speed * mag * dt;
    const nx = player.pos.x + vx;
    if (!collides(nx, player.pos.z)) player.pos.x = nx;
    const nz = player.pos.z + vz;
    if (!collides(player.pos.x, nz)) player.pos.z = nz;
  }

  if (player.moving) {
    player.bobT += dt * (wantSprint ? 13 : 9);
    player.stepT -= dt * (wantSprint ? 1.7 : 1);
    if (player.stepT <= 0) { player.stepT = 0.55; playFootstep(); }
  }

  if (keys['Space'] && player.onGround) {
    player.vy = 5.4;
    player.onGround = false;
    playPoof();
  }
  if (!player.onGround) {
    player.vy -= 18 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= EYE_HEIGHT) {
      player.pos.y = EYE_HEIGHT;
      player.vy = 0;
      player.onGround = true;
      playFootstep();
    }
  }

  camera.position.set(
    player.pos.x,
    player.pos.y + (player.moving ? Math.sin(player.bobT) * 0.05 : 0),
    player.pos.z
  );
  if (S.shakeT > 0) {
    S.shakeT -= dt;
    const k = S.shakeT * 0.22;
    camera.position.x += rand(-1, 1) * k;
    camera.position.y += rand(-1, 1) * k;
  }
  camera.rotation.set(player.pitch, player.yaw, 0);

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  flashlight.position.copy(camera.position).addScaledVector(dir, 0.3);
  flashlight.target.position.copy(camera.position).addScaledVector(dir, 10);
  playerLight.position.copy(camera.position);
}

function toggleFlashlight() {
  flashlight.visible = !flashlight.visible;
  playClick();
}

function toggleDayNight() {
  S.night = !S.night;
  applyAtmosphere();
  playClick();
  showMsg(S.night ? 'Ночь 🌙' : 'День ☀️');
}

// ---------- Object catalog ----------
let lampLights = 0;

function buildBox() {
  const g = new THREE.Group();
  const tex = canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#75592e';
    for (let p = 0; p < 4; p++) ctx.fillRect(0, p * 16, s, 2);
    ctx.strokeStyle = '#5c451f';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(4, 4); ctx.lineTo(s - 4, s - 4);
    ctx.moveTo(s - 4, 4); ctx.lineTo(4, s - 4);
    ctx.stroke();
  });
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
  );
  m.position.y = 0.5;
  g.add(m);
  return g;
}

function buildBarrel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.32, 1.0, 14),
    new THREE.MeshStandardMaterial({ color: 0x38505c, roughness: 0.55, metalness: 0.45 })
  );
  body.position.y = 0.5;
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x242e34, roughness: 0.6, metalness: 0.5 });
  for (const y of [0.22, 0.5, 0.78]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 14), ribMat);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = y;
    g.add(rib);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), ribMat);
  lid.position.y = 1.0;
  g.add(body, lid);
  return g;
}

function buildCar() {
  const g = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const color = [0x8a2020, 0x204a8a, 0x2c2c2c, 0x8a7a20, 0x3a6a3a][randInt(5)];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e141c, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), bodyMat);
  body.position.y = 0.62;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glassMat);
  cabin.position.set(0, 1.15, -0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 2.2), bodyMat);
  roof.position.set(0, 1.45, -0.25);
  bodyGroup.add(body, cabin, roof);
  g.add(bodyGroup);
  g.userData.bodyGroup = bodyGroup;
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8e, roughness: 0.4, metalness: 0.7 });
  for (const [wx, wz] of [[-0.98, 1.35], [0.98, 1.35], [-0.98, -1.35], [0.98, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.34, wz);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.34, wz);
    g.add(w, hub);
  }
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.7 });
  for (const lx of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), lightMat);
    hl.position.set(lx, 0.7, 2.12);
    g.add(hl);
  }
  return g;
}

function buildTree() {
  const g = new THREE.Group();
  const h = rand(2.4, 3.2);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.3, h, 7),
    new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1 })
  );
  trunk.position.y = h / 2;
  g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: [0x2d5a22, 0x3a6a26, 0x27502a][randInt(3)], roughness: 1 });
  for (let k = 0; k < 3; k++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.8, 1.25), 0), leafMat);
    blob.position.set(rand(-0.35, 0.35), h + rand(0.1, 0.9), rand(-0.35, 0.35));
    blob.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    g.add(blob);
  }
  return g;
}

function buildLamp() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.8, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.25, 8), mat);
  base.position.y = 0.12;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3, 8), mat);
  pole.position.y = 1.6;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), mat);
  arm.position.set(0.22, 3.12, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), mat);
  head.position.set(0.42, 3.05, 0);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.06, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffc866, emissiveIntensity: 0.9 })
  );
  glass.position.set(0.42, 2.96, 0);
  g.add(base, pole, arm, head, glass);
  if (lampLights < 12) {
    const light = new THREE.PointLight(0xffb060, 9, 13, 1.8);
    light.position.set(0.42, 2.8, 0);
    g.add(light);
    lampLights++;
  }
  return g;
}

function buildHay() {
  const g = new THREE.Group();
  const tex = canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#b8963a';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.5;
    for (let k = 0; k < 160; k++) {
      ctx.strokeStyle = Math.random() < 0.5 ? '#9a7c2c' : '#cfae52';
      const x = rand(0, s), y = rand(0, s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(-4, 4), y + rand(-6, 2));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })
  );
  dome.scale.y = 1.15;
  g.add(dome);
  return g;
}

function buildWell() {
  const g = new THREE.Group();
  const stoneTex = canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#7a7a76';
    ctx.fillRect(0, 0, s, s);
    for (let k = 0; k < 26; k++) {
      ctx.fillStyle = ['#6a6a66', '#8a8a84', '#5e5e5a'][randInt(3)];
      ctx.fillRect(rand(0, s - 12), rand(0, s - 8), rand(8, 14), rand(5, 8));
    }
  });
  const stone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 0.9, 12),
    new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1 })
  );
  stone.position.y = 0.45;
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 12),
    new THREE.MeshStandardMaterial({ color: 0x1c3448, roughness: 0.2, metalness: 0.4 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.78;
  g.add(stone, water);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4e2c, roughness: 1 });
  for (const px of [-0.75, 0.75]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), woodMat);
    post.position.set(px, 1.55, 0);
    g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), woodMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 2.1;
  g.add(bar);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 1 });
  for (const s of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 1.5), roofMat);
    slope.position.set(s * 0.42, 2.55, 0);
    slope.rotation.z = -s * 0.6;
    g.add(slope);
  }
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4),
    new THREE.MeshStandardMaterial({ color: 0xc8b088 })
  );
  rope.position.y = 1.85;
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.2, 8), woodMat);
  bucket.position.y = 1.5;
  g.add(rope, bucket);
  return g;
}

function buildTnt() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a1a1a, emissive: 0xaa2010, emissiveIntensity: 0.3, roughness: 0.5 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.8 });
  const stickGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.0, 10);
  const bandGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.09, 10);
  for (const [ox, oz] of [[0, 0.19], [-0.165, -0.095], [0.165, -0.095]]) {
    const stick = new THREE.Mesh(stickGeo, mat);
    stick.position.set(ox, 0.5, oz);
    g.add(stick);
    for (const y of [0.3, 0.7]) {
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(ox, y, oz);
      g.add(band);
    }
  }
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.3, 5),
    new THREE.MeshStandardMaterial({ color: 0xd8c090 })
  );
  fuse.position.set(0, 1.12, 0);
  fuse.rotation.z = 0.2;
  g.add(fuse);
  return g;
}

function buildBombMed() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a1a1a, emissive: 0xaa2010, emissiveIntensity: 0.25, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.25, 14), mat);
  body.position.y = 0.62;
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.8 });
  for (const y of [0.25, 0.62, 1.0]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.1, 14), bandMat);
    band.position.y = y;
    g.add(band);
  }
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.35, 5),
    new THREE.MeshStandardMaterial({ color: 0xd8c090 })
  );
  fuse.position.y = 1.4;
  g.add(body, fuse);
  return g;
}

function buildBombBig() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.6 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), mat);
  sphere.position.y = 0.72;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 10), mat);
  cap.position.y = 1.35;
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5),
    new THREE.MeshStandardMaterial({ color: 0xd8c090 })
  );
  fuse.position.y = 1.62;
  fuse.rotation.z = 0.25;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.035, 6, 18),
    new THREE.MeshStandardMaterial({ color: 0x8a2020, roughness: 0.5 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.72;
  g.add(sphere, cap, fuse, ring);
  return g;
}

function buildBombNuke() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a5a38, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.15, 14), mat);
  body.position.y = 0.58;
  const warnMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0x5aff30, emissiveIntensity: 0.7, roughness: 0.5 });
  for (const y of [0.35, 0.82]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 0.09, 14), warnMat);
    band.position.y = y;
    g.add(band);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 14), mat);
  nose.position.y = 1.35;
  const finGeo = new THREE.BoxGeometry(0.06, 0.3, 0.35);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(finGeo, mat);
    const a = k * Math.PI / 2;
    fin.position.set(Math.sin(a) * 0.48, 0.2, Math.cos(a) * 0.48);
    fin.rotation.y = a;
    g.add(fin);
  }
  const light = new THREE.PointLight(0x5aff30, 3, 5, 2);
  light.position.y = 1.2;
  g.add(body, nose, light);
  return g;
}

function tvScreenMesh(w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }));
  m.rotation.y = Math.PI;
  return m;
}

function buildTvCrt() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 0.7), wood);
  body.position.y = 0.75;
  const screen = tvScreenMesh(0.82, 0.6);
  screen.position.set(0, 0.78, -0.36);
  const knobG = new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12);
  knobG.rotateX(Math.PI / 2);
  const knobM = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  const knob1 = new THREE.Mesh(knobG, knobM); knob1.position.set(0.42, 0.9, -0.36);
  const knob2 = new THREE.Mesh(knobG, knobM); knob2.position.set(0.42, 0.72, -0.36);
  const antM = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.6 });
  const a1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), antM);
  a1.position.set(-0.2, 1.55, 0); a1.rotation.z = 0.5;
  const a2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), antM);
  a2.position.set(0.2, 1.55, 0); a2.rotation.z = -0.5;
  const legG = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  const l1 = new THREE.Mesh(legG, wood); l1.position.set(-0.42, 0.16, -0.22);
  const l2 = new THREE.Mesh(legG, wood); l2.position.set(0.42, 0.16, -0.22);
  const l3 = new THREE.Mesh(legG, wood); l3.position.set(-0.42, 0.16, 0.22);
  const l4 = new THREE.Mesh(legG, wood); l4.position.set(0.42, 0.16, 0.22);
  g.add(body, screen, knob1, knob2, a1, a2, l1, l2, l3, l4);
  g.userData.screen = screen; g.userData.screenW = 0.82; g.userData.screenH = 0.6;
  return g;
}

function buildTvFlat() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 0.07), dark);
  panel.position.y = 1.15;
  const screen = tvScreenMesh(1.45, 0.8);
  screen.position.set(0, 1.16, -0.045);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.14), dark);
  neck.position.y = 0.5;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.4), dark);
  base.position.y = 0.33;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), new THREE.MeshBasicMaterial({ color: 0x30ff60 }));
  led.position.set(0.7, 0.72, -0.04);
  g.add(panel, screen, neck, base, led);
  g.userData.screen = screen; g.userData.screenW = 1.45; g.userData.screenH = 0.8;
  return g;
}

function buildTvBig() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.5 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, 0.1), dark);
  frame.position.y = 1.7;
  const screen = tvScreenMesh(2.6, 1.45);
  screen.position.set(0, 1.72, -0.06);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.5 }));
  pole.position.y = 0.45;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7 }));
  foot.position.y = 0.04;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6 }));
  bar.position.set(0, 0.78, -0.05);
  g.add(frame, screen, pole, foot, bar);
  g.userData.screen = screen; g.userData.screenW = 2.6; g.userData.screenH = 1.45;
  return g;
}

function buildTvRetro() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a30, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.55), wood);
  body.position.y = 0.65;
  const screen = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }));
  screen.rotation.y = Math.PI;
  screen.position.set(-0.15, 0.68, -0.28);
  const dialG = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14);
  dialG.rotateX(Math.PI / 2);
  const dialM = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.5 });
  const d1 = new THREE.Mesh(dialG, dialM); d1.position.set(0.3, 0.82, -0.28);
  const d2 = new THREE.Mesh(dialG, dialM); d2.position.set(0.3, 0.62, -0.28);
  const legG = new THREE.CylinderGeometry(0.03, 0.045, 0.28, 8);
  const legM = new THREE.MeshStandardMaterial({ color: 0x54401f, roughness: 0.8 });
  const w1 = new THREE.Mesh(legG, legM); w1.position.set(-0.38, 0.14, -0.18);
  const w2 = new THREE.Mesh(legG, legM); w2.position.set(0.38, 0.14, -0.18);
  const w3 = new THREE.Mesh(legG, legM); w3.position.set(-0.38, 0.14, 0.18);
  const w4 = new THREE.Mesh(legG, legM); w4.position.set(0.38, 0.14, 0.18);
  g.add(body, screen, d1, d2, w1, w2, w3, w4);
  g.userData.screen = screen; g.userData.screenW = 0.52; g.userData.screenH = 0.52;
  return g;
}

function buildConsole() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.65), bodyMat);
  body.position.y = 0.09;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.65), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4 }));
  top.position.y = 0.2;
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.6 }));
  cart.position.set(-0.15, 0.29, 0.05);
  cart.rotation.x = -0.25;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  led.position.set(0.35, 0.24, -0.2);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6 });
  const padG = new THREE.BoxGeometry(0.24, 0.05, 0.13);
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.7 });
  const cableG = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6);
  const p1 = new THREE.Mesh(padG, padMat);
  p1.position.set(-0.75, 0.025, 0.55);
  p1.rotation.y = 0.4;
  const c1 = new THREE.Mesh(cableG, cableMat);
  c1.position.set(-0.5, 0.03, 0.32);
  c1.rotation.z = Math.PI / 2;
  c1.rotation.y = 0.45;
  const p2 = new THREE.Mesh(padG, padMat);
  p2.position.set(0.75, 0.025, 0.55);
  p2.rotation.y = -0.4;
  const c2 = new THREE.Mesh(cableG, cableMat);
  c2.position.set(0.5, 0.03, 0.32);
  c2.rotation.z = Math.PI / 2;
  c2.rotation.y = -0.45;
  g.add(body, top, cart, led, p1, c1, p2, c2);
  g.userData.console = true;
  return g;
}

function buildConnector() {
  const g = new THREE.Group();
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.7 });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.65, 0.03, 0),
    new THREE.Vector3(-0.3, 0.03, 0.18),
    new THREE.Vector3(0, 0.4, 0.22),
    new THREE.Vector3(0.3, 0.03, 0.18),
    new THREE.Vector3(0.65, 0.03, 0),
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 6), cableMat);
  const plugMat = new THREE.MeshStandardMaterial({ color: 0x35393f, roughness: 0.4, metalness: 0.5 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xb8b09a, roughness: 0.3, metalness: 0.8 });
  const plugG = new THREE.BoxGeometry(0.12, 0.07, 0.09);
  const tipG = new THREE.CylinderGeometry(0.016, 0.016, 0.08, 8);
  const plug1 = new THREE.Mesh(plugG, plugMat);
  plug1.position.set(-0.72, 0.045, 0);
  const tip1 = new THREE.Mesh(tipG, tipMat);
  tip1.rotation.z = Math.PI / 2;
  tip1.position.set(-0.81, 0.045, 0);
  const plug2 = new THREE.Mesh(plugG, plugMat);
  plug2.position.set(0.72, 0.045, 0);
  const tip2 = new THREE.Mesh(tipG, tipMat);
  tip2.rotation.z = Math.PI / 2;
  tip2.position.set(0.81, 0.045, 0);
  g.add(tube, plug1, tip1, plug2, tip2);
  return g;
}

function buildSofa() {
  const g = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x9a4a3a, roughness: 1 });
  const fabricDark = new THREE.MeshStandardMaterial({ color: 0x7a382c, roughness: 1 });
  const legM = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.85), fabric);
  base.position.y = 0.3;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.25), fabricDark);
  back.position.set(0, 0.75, 0.3);
  const armG = new THREE.BoxGeometry(0.26, 0.6, 0.85);
  const arm1 = new THREE.Mesh(armG, fabricDark);
  arm1.position.set(-0.95, 0.55, 0);
  const arm2 = new THREE.Mesh(armG, fabricDark);
  arm2.position.set(0.95, 0.55, 0);
  const cushG = new THREE.BoxGeometry(0.78, 0.16, 0.68);
  const cu1 = new THREE.Mesh(cushG, fabric);
  cu1.position.set(-0.42, 0.55, -0.02);
  const cu2 = new THREE.Mesh(cushG, fabric);
  cu2.position.set(0.42, 0.55, -0.02);
  const legG = new THREE.CylinderGeometry(0.04, 0.03, 0.14, 8);
  for (const [lx, lz] of [[-0.82, -0.32], [0.82, -0.32], [-0.82, 0.32], [0.82, 0.32]]) {
    const leg = new THREE.Mesh(legG, legM);
    leg.position.set(lx, 0.07, lz);
    g.add(leg);
  }
  g.add(base, back, arm1, arm2, cu1, cu2);
  g.userData.seat = true;
  return g;
}

const CATALOG = [
  { id: 'box', name: 'ЯЩИК', icon: '📦', build: buildBox },
  { id: 'barrel', name: 'БОЧКА', icon: '🛢️', build: buildBarrel },
  { id: 'car', name: 'МАШИНА', icon: '🚗', build: buildCar, drive: true },
  { id: 'tree', name: 'ДЕРЕВО', icon: '🌳', build: buildTree },
  { id: 'lamp', name: 'ФОНАРЬ', icon: '🏮', build: buildLamp },
  { id: 'hay', name: 'СТОГ', icon: '🌾', build: buildHay },
  { id: 'well', name: 'КОЛОДЕЦ', icon: '⛲', build: buildWell },
  { id: 'tnt', name: 'МАЛАЯ', icon: '💥', build: buildTnt, tnt: true },
  { id: 'bomb-med', name: 'СРЕДНЯЯ', icon: '🧨', build: buildBombMed, tnt: true },
  { id: 'bomb-big', name: 'БОМБА', icon: '💣', build: buildBombBig, tnt: true },
  { id: 'nuke', name: 'ЯДЕРКА', icon: '☢️', build: buildBombNuke, tnt: true },
  { id: 'tv-crt', name: 'ТВ ЛАМПОВЫЙ', icon: '📺', build: buildTvCrt, tv: true },
  { id: 'tv-flat', name: 'ТВ ПЛОСКИЙ', icon: '📺', build: buildTvFlat, tv: true },
  { id: 'tv-big', name: 'ТВ КИНОТЕАТР', icon: '📺', build: buildTvBig, tv: true },
  { id: 'tv-retro', name: 'ТВ РЕТРО', icon: '📺', build: buildTvRetro, tv: true },
  { id: 'console', name: 'ПРИСТАВКА', icon: '🎮', build: buildConsole, console: true },
  { id: 'connector', name: 'КОННЕКТОР', icon: '🔌', build: buildConnector },
  { id: 'sofa', name: 'ДИВАН', icon: '🛋️', build: buildSofa, seat: true },
];

const BOMBS = {
  tnt: { radius: 8, impulse: 13, shake: 0.6, flash: 80, flashDist: 28, crime: 1 },
  'bomb-med': { radius: 14, impulse: 19, shake: 0.8, flash: 150, flashDist: 40, crime: 1 },
  'bomb-big': { radius: 22, impulse: 26, shake: 1.0, flash: 260, flashDist: 60, crime: 2 },
  nuke: { radius: 45, impulse: 34, shake: 1.3, flash: 520, flashDist: 130, crime: 3, nuke: true },
};

function selectSlot(i) {
  S.sel = i;
  const def = CATALOG[i];
  if (def) selnameEl.textContent = `${def.icon} ${def.name}`;
}

function spawnSelected() {
  if (S.driving) return;
  const def = CATALOG[S.sel];
  const mesh = def.build();
  const dir = forwardFlat();
  mesh.position.set(player.pos.x + dir.x * 3, 0, player.pos.z + dir.z * 3);
  mesh.rotation.y = player.yaw + Math.PI;
  spawnedGroup.add(mesh);
  objects.push({ mesh, vel: new THREE.Vector3(), tnt: !!def.tnt, type: def.drive ? 'car' : 'prop', id: def.id, spec: BOMBS[def.id] || null, tv: !!def.tv, seat: !!def.seat, url: null });
  playPop();
}

function removeObject(obj) {
  if (S.tvObj === obj) stopTvScreen();
  const i = objects.indexOf(obj);
  if (i === -1) return;
  objects.splice(i, 1);
  if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
  obj.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mt of mats) {
        if (mt.map) mt.map.dispose();
        mt.dispose();
      }
    }
  });
}

const raycaster = new THREE.Raycaster();
const NDC_CENTER = new THREE.Vector2(0, 0);

function findAimed() {
  raycaster.setFromCamera(NDC_CENTER, camera);
  const hits = raycaster.intersectObjects(spawnedGroup.children, true);
  if (!hits.length) return null;
  let n = hits[0].object;
  while (n && n.parent !== spawnedGroup) n = n.parent;
  return objects.find(o => o.mesh === n) || null;
}

function deleteAimed() {
  if (!objects.length) return;
  const obj = findAimed();
  if (!obj || obj === S.driving) return;
  if (obj.tnt) explode(obj);
  else { removeObject(obj); playPoof(); }
}

function deleteNearest() {
  if (!objects.length) return;
  const dir = forwardFlat();
  const tx = player.pos.x + dir.x * 2.2, tz = player.pos.z + dir.z * 2.2;
  let best = null, bestD = 2.8;
  for (const o of objects) {
    const d = Math.hypot(o.mesh.position.x - tx, o.mesh.position.z - tz);
    if (d < bestD) { bestD = d; best = o; }
  }
  if (!best || best === S.driving) return;
  if (best.tnt) explode(best);
  else { removeObject(best); playPoof(); }
}

function explode(obj) {
  const p = obj.mesh.position.clone();
  const spec = obj.spec || BOMBS.tnt;
  removeObject(obj);
  playBoom();
  if (spec.nuke) { playThunder(); flashScreen(); }
  S.shakeT = spec.shake;
  for (let k = 0; k < spec.crime; k++) commitCrime();
  panicPos.copy(p);
  panicT = 3;
  for (const n of [...npcs]) {
    if (n.type === 'god' || n.downT > 0) continue;
    if (Math.hypot(n.mesh.position.x - p.x, n.mesh.position.z - p.z) < spec.radius * 0.8) knockNPC(n, 4);
  }
  const flash = new THREE.PointLight(0xffa040, spec.flash, spec.flashDist, 1.5);
  flash.position.copy(p).setY(1.5);
  worldGroup.add(flash);
  setTimeout(() => { if (worldGroup) worldGroup.remove(flash); }, spec.nuke ? 400 : 160);
  for (const o of [...objects]) {
    const d = o.mesh.position.distanceTo(p);
    if (d < spec.radius) {
      const dir = o.mesh.position.clone().sub(p).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1));
      dir.normalize();
      const power = 1 - d / spec.radius;
      o.vel.addScaledVector(dir, spec.impulse * power);
      o.vel.y += spec.impulse * 0.55 * power;
      if (o.type === 'car') {
        o.av = rand(-3, 3);
        ensureSoft(o);
        if (o.soft) for (const c of o.soft.corners) {
          c.vel.add(_sv.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).multiplyScalar(9 * power));
        }
      }
    }
  }
}

function updatePhysics(dt) {
  for (const o of objects) {
    if (S.driving === o) continue;
    if (o.type === 'car') updateSoftBody(o, dt);
    if (o.av && o.mesh.position.y > 0.05) o.mesh.rotation.y += o.av * dt;
    if (o.vel.lengthSq() < 0.0001) continue;
    o.vel.y -= 18 * dt;
    o.mesh.position.addScaledVector(o.vel, dt);
    if (o.mesh.position.y < 0) {
      o.mesh.position.y = 0;
      o.vel.y *= -0.35;
      o.vel.x *= 0.7;
      o.vel.z *= 0.7;
      if (o.vel.lengthSq() < 0.05) { o.vel.set(0, 0, 0); o.av = 0; }
    }
  }
}

// ---------- Driving ----------
function nearestCar() {
  let best = null, bestD = 3.6;
  for (const o of objects) {
    if (o.type !== 'car') continue;
    const d = Math.hypot(o.mesh.position.x - player.pos.x, o.mesh.position.z - player.pos.z);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function carCollides(x, z, h) {
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  for (const a of [-2.0, 0, 2.0]) for (const b of [-0.85, 0.85]) {
    if (collides(x + fx * a + rx * b, z + fz * a + rz * b)) return true;
  }
  return false;
}

function enterCar(obj) {
  S.driving = obj;
  carState.heading = obj.mesh.rotation.y;
  carState.prevFwd = 0;
  startEngine();
  showMsg('🚗 WASD / джойстик — езда · E — выйти');
  playClick();
}

function exitCar() {
  const obj = S.driving;
  if (!obj) return;
  const h = carState.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  const cands = [
    [obj.mesh.position.x + rx * 2.3, obj.mesh.position.z + rz * 2.3],
    [obj.mesh.position.x - rx * 2.3, obj.mesh.position.z - rz * 2.3],
    [obj.mesh.position.x - fx * 3.6, obj.mesh.position.z - fz * 3.6],
  ];
  for (const [x, z] of cands) {
    if (!collides(x, z)) { player.pos.set(x, EYE_HEIGHT, z); break; }
    player.pos.set(obj.mesh.position.x, EYE_HEIGHT, obj.mesh.position.z);
  }
  S.driving = null;
  stopEngine();
  player.vy = 0;
  player.onGround = true;
  playClick();
}

function updateCar(dt) {
  const obj = S.driving;
  if (!obj) return;
  const grounded = obj.mesh.position.y <= 0.02 && obj.vel.y <= 0.01;
  const joy = touchInput.moveId !== null;
  const throttle = grounded ? (joy ? -touchInput.moveZ : ((keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0))) : 0;
  const steer = grounded ? (joy ? touchInput.moveX : ((keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0))) : 0;

  const fx = Math.sin(carState.heading), fz = Math.cos(carState.heading);
  const rx = Math.cos(carState.heading), rz = -Math.sin(carState.heading);
  let fwdSpeed = obj.vel.x * fx + obj.vel.z * fz;
  let latSpeed = obj.vel.x * rx + obj.vel.z * rz;

  if (grounded) {
    fwdSpeed += throttle * 10 * dt;
    fwdSpeed *= (1 - (throttle !== 0 ? 0.4 : 2.2) * dt);
    latSpeed *= (1 - 6 * dt);
    carState.heading += steer * dt * 2.1 * clamp(Math.abs(fwdSpeed) / 6, 0, 1) * (fwdSpeed < 0 ? -1 : 1);
  }
  fwdSpeed = clamp(fwdSpeed, -7, 17);
  obj.vel.x = fx * fwdSpeed + rx * latSpeed;
  obj.vel.z = fz * fwdSpeed + rz * latSpeed;

  obj.vel.y -= 18 * dt;
  obj.mesh.position.addScaledVector(obj.vel, dt);
  if (obj.mesh.position.y < 0) {
    obj.mesh.position.y = 0;
    if (obj.vel.y < -6) { S.shakeT = 0.3; playBoom(); }
    obj.vel.y = Math.abs(obj.vel.y) > 1.5 ? obj.vel.y * -0.3 : 0;
    obj.vel.x *= 0.82;
    obj.vel.z *= 0.82;
  }

  if (carCollides(obj.mesh.position.x, obj.mesh.position.z, carState.heading)) {
    obj.mesh.position.addScaledVector(obj.vel, -dt);
    if (Math.abs(fwdSpeed) > 7) { S.shakeT = 0.3; playBoom(); }
    const bounce = -fwdSpeed * 0.3;
    obj.vel.x = fx * bounce + rx * latSpeed * 0.4;
    obj.vel.z = fz * bounce + rz * latSpeed * 0.4;
    ensureSoft(obj);
    if (obj.soft) {
      const imp = Math.min(Math.abs(fwdSpeed), 15);
      for (const c of obj.soft.corners) {
        if (c.rest.z > 0) {
          c.vel.z -= imp * rand(0.9, 1.4);
          c.vel.x += rand(-1, 1) * imp * 0.25;
          c.vel.y += rand(-1, 1) * imp * 0.15;
        }
      }
    }
  }

  const body = obj.mesh.userData.bodyGroup;
  if (body) {
    const accel = (fwdSpeed - carState.prevFwd) / Math.max(dt, 0.001);
    carState.prevFwd = fwdSpeed;
    const targetPitch = clamp(-accel * 0.006, -0.09, 0.09);
    const targetRoll = clamp(-steer * fwdSpeed * 0.012, -0.12, 0.12);
    const k = Math.min(1, 8 * dt);
    body.rotation.x += (targetPitch - body.rotation.x) * k;
    body.rotation.z += (targetRoll - body.rotation.z) * k;
  }

  obj.mesh.rotation.y = carState.heading;
  carState.fwd = fwdSpeed;
  updateSoftBody(obj, dt);
  player.pos.set(obj.mesh.position.x, EYE_HEIGHT, obj.mesh.position.z);

  if (Math.abs(fwdSpeed) > 3) {
    for (const n of [...npcs]) {
      if (n.type === 'god' || n.downT > 0) continue;
      const d = Math.hypot(n.mesh.position.x - obj.mesh.position.x, n.mesh.position.z - obj.mesh.position.z);
      if (d < 1.8) {
        knockNPC(n, n.type === 'cop' ? 3 : 4);
        commitCrime();
        playEek();
        S.shakeT = Math.max(S.shakeT, 0.2);
      }
    }
  }
  if (engineOsc && engineGain) {
    const sp = Math.abs(fwdSpeed);
    engineOsc.frequency.value = 55 + sp * 9;
    engineGain.gain.value = Math.min(0.09, 0.025 + sp * 0.004);
  }
}

function startEngine() {
  if (!AC || engineOsc) return;
  engineOsc = AC.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 60;
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 340;
  engineGain = AC.createGain();
  engineGain.gain.value = 0.0001;
  engineOsc.connect(f);
  f.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
}

function stopEngine() {
  if (!engineOsc) return;
  const o = engineOsc;
  engineGain.gain.setTargetAtTime(0, AC.currentTime, 0.06);
  setTimeout(() => { try { o.stop(); } catch (e) {} }, 350);
  engineOsc = null;
  engineGain = null;
}

// ---------- Save / Load (XML) ----------
const SAVE_KEY = 'sandbox-save-v1';

function worldToXML() {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<sandbox map="' + S.map + '"';
  xml += ' night="' + (S.night ? 1 : 0) + '"';
  xml += ' px="' + player.pos.x.toFixed(2) + '" pz="' + player.pos.z.toFixed(2) + '" yaw="' + player.yaw.toFixed(3) + '">\n';
  for (const o of objects) {
    if (!o.id) continue;
    xml += '  <object type="' + o.id + '"';
    xml += ' x="' + o.mesh.position.x.toFixed(2) + '"';
    xml += ' y="' + o.mesh.position.y.toFixed(2) + '"';
    xml += ' z="' + o.mesh.position.z.toFixed(2) + '"';
    xml += ' ry="' + o.mesh.rotation.y.toFixed(3) + '"';
    if (o.url) xml += ' url="' + o.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
    xml += '/>\n';
  }
  xml += '</sandbox>';
  return xml;
}

function loadFromXML(text) {
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'text/xml'); }
  catch (e) { return false; }
  if (doc.querySelector('parsererror')) return false;
  const root = doc.querySelector('sandbox');
  if (!root || !MAPS[root.getAttribute('map')]) return false;

  S.map = root.getAttribute('map');
  buildWorld(S.map);
  S.night = root.getAttribute('night') === '1';
  applyAtmosphere();

  const px = parseFloat(root.getAttribute('px'));
  const pz = parseFloat(root.getAttribute('pz'));
  const yaw = parseFloat(root.getAttribute('yaw'));
  if (!Number.isNaN(px) && !Number.isNaN(pz) && !collides(px, pz)) {
    player.pos.set(px, EYE_HEIGHT, pz);
  }
  if (!Number.isNaN(yaw)) player.yaw = yaw;

  for (const el of doc.querySelectorAll('object')) {
    const def = CATALOG.find(d => d.id === el.getAttribute('type'));
    if (!def) continue;
    const x = parseFloat(el.getAttribute('x'));
    const y = parseFloat(el.getAttribute('y')) || 0;
    const z = parseFloat(el.getAttribute('z'));
    if ([x, z].some(Number.isNaN)) continue;
    const mesh = def.build();
    mesh.position.set(x, y, z);
    mesh.rotation.y = parseFloat(el.getAttribute('ry')) || 0;
    spawnedGroup.add(mesh);
    const rawUrl = el.getAttribute('url');
    objects.push({ mesh, vel: new THREE.Vector3(), tnt: !!def.tnt, type: def.drive ? 'car' : 'prop', id: def.id, spec: BOMBS[def.id] || null, tv: !!def.tv, seat: !!def.seat, url: rawUrl && parseVideo(rawUrl) ? rawUrl : null });
  }

  document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('selected', c.dataset.map === S.map));
  if (S.started) mapnameEl.textContent = MAPS[S.map].name.toUpperCase();
  return true;
}

function saveLocal(silent) {
  try {
    localStorage.setItem(SAVE_KEY, worldToXML());
    if (!silent) { showMsg('💾 Карта сохранена'); playClick(); }
  } catch (e) {
    if (!silent) showMsg('⚠️ Ошибка сохранения');
  }
}

function loadLocal() {
  const xml = localStorage.getItem(SAVE_KEY);
  if (!xml) { showMsg('Нет сохранений'); return; }
  if (loadFromXML(xml)) { showMsg('📂 Карта загружена'); playClick(); }
  else showMsg('⚠️ Сохранение повреждено');
}

function exportXML() {
  const blob = new Blob([worldToXML()], { type: 'text/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sandbox-map.xml';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showMsg('⬇️ sandbox-map.xml скачан');
  playClick();
}

function importXML() {
  document.getElementById('xml-file').click();
}

window.addEventListener('pagehide', () => { try { saveLocal(true); } catch (e) {} });
setInterval(() => { if (S.started) saveLocal(true); }, 20000);

// ---------- SoftBody (car shell) ----------
const SOFT_K = 90, SOFT_D = 4.5;
const _sd = new THREE.Vector3(), _sr = new THREE.Vector3(), _sv = new THREE.Vector3();

function ensureSoft(o) {
  if (o.soft || o.type !== 'car') return;
  const bg = o.mesh.userData.bodyGroup;
  if (!bg) return;
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const rest = new THREE.Vector3(sx, 0.8 + sy * 0.75, sz * 2.15);
    corners.push({ rest, pos: rest.clone(), vel: new THREE.Vector3() });
  }
  o.soft = { corners, active: false };
  o.deformMeshes = [];
  bg.traverse(m => {
    if (m.isMesh) {
      m.userData.base = m.geometry.attributes.position.array.slice();
      o.deformMeshes.push(m);
    }
  });
}

function updateSoftBody(o, dt) {
  ensureSoft(o);
  if (!o.soft) return;
  const s = o.soft;
  const sub = Math.min(dt, 0.05) / 3;
  for (let it = 0; it < 3; it++) {
    for (const c of s.corners) {
      c.vel.y -= 5 * sub;
      c.vel.multiplyScalar(1 - 0.4 * sub);
    }
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const a = s.corners[i], b = s.corners[j];
      _sd.subVectors(b.pos, a.pos);
      const dist = _sd.length() || 0.0001;
      const rest = a.rest.distanceTo(b.rest);
      const f = (dist - rest) * SOFT_K * sub / dist;
      a.vel.addScaledVector(_sd, f * 0.5);
      b.vel.addScaledVector(_sd, -f * 0.5);
      const rel = _sr.subVectors(b.vel, a.vel).dot(_sd) / (dist * dist);
      const dmp = rel * SOFT_D * sub;
      a.vel.addScaledVector(_sd, dmp * 0.5);
      b.vel.addScaledVector(_sd, -dmp * 0.5);
    }
    const floor = -o.mesh.position.y + 0.03;
    for (const c of s.corners) {
      c.pos.addScaledVector(c.vel, sub);
      if (c.pos.y < floor) {
        c.pos.y = floor;
        if (c.vel.y < 0) c.vel.y *= -0.35;
        c.vel.x *= 0.92;
        c.vel.z *= 0.92;
      }
    }
  }
  let maxVel = 0, maxOff = 0;
  for (const c of s.corners) {
    maxVel = Math.max(maxVel, c.vel.length());
    maxOff = Math.max(maxOff, c.pos.distanceTo(c.rest));
  }
  if (maxVel < 0.06 && maxOff < 0.02) {
    for (const c of s.corners) { c.pos.copy(c.rest); c.vel.set(0, 0, 0); }
    if (s.active) { softDeform(o); s.active = false; }
  } else {
    s.active = true;
    softDeform(o);
  }
}

const _sm = new THREE.Matrix4(), _smi = new THREE.Matrix4(), _svp = new THREE.Vector3();

function softDeform(o) {
  const bg = o.mesh.userData.bodyGroup;
  if (!bg) return;
  bg.updateMatrix();
  const HX = 1.0, HY = 0.75, CY = 0.8, HZ = 2.15;
  const d = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    const c = o.soft.corners[i];
    d[i * 3] = c.pos.x - c.rest.x;
    d[i * 3 + 1] = c.pos.y - c.rest.y;
    d[i * 3 + 2] = c.pos.z - c.rest.z;
  }
  for (const mesh of o.deformMeshes) {
    _sm.multiplyMatrices(bg.matrix, mesh.matrix);
    _smi.copy(_sm).invert();
    const pos = mesh.geometry.attributes.position;
    const base = mesh.userData.base;
    for (let i = 0; i < pos.count; i++) {
      _svp.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]).applyMatrix4(_sm);
      const tx = clamp(_svp.x / HX * 0.5 + 0.5, 0, 1);
      const ty = clamp((_svp.y - CY) / HY * 0.5 + 0.5, 0, 1);
      const tz = clamp(_svp.z / HZ * 0.5 + 0.5, 0, 1);
      const wx = [1 - tx, tx], wy = [1 - ty, ty], wz = [1 - tz, tz];
      let dx = 0, dy = 0, dz = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c2 = 0; c2 < 2; c2++) {
        const ci = a * 4 + b * 2 + c2;
        const w = wx[a] * wy[b] * wz[c2];
        dx += d[ci * 3] * w;
        dy += d[ci * 3 + 1] * w;
        dz += d[ci * 3 + 2] * w;
      }
      _svp.x += dx; _svp.y += dy; _svp.z += dz;
      _svp.applyMatrix4(_smi);
      pos.setXYZ(i, _svp.x, _svp.y, _svp.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
}

// ---------- NPC models ----------
function buildHumanoid(opts) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: opts.shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: opts.pants, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.8 });
  const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  legGeo.translate(0, -0.25, 0);
  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(-0.11, 0.5, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(0.11, 0.5, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), shirtMat);
  torso.position.y = 0.78;
  const armGeo = new THREE.BoxGeometry(0.12, 0.46, 0.12);
  armGeo.translate(0, -0.2, 0);
  const armL = new THREE.Mesh(armGeo, shirtMat);
  armL.position.set(-0.28, 1.0, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat);
  armR.position.set(0.28, 1.0, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.24), skinMat);
  head.position.y = 1.2;
  g.add(legL, legR, torso, armL, armR, head);
  if (opts.cap) {
    const capMat = new THREE.MeshStandardMaterial({ color: opts.cap, roughness: 0.9 });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.32), capMat);
    cap.position.set(0, 1.37, 0.02);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.14), capMat);
    visor.position.set(0, 1.33, 0.2);
    g.add(cap, visor);
  }
  g.userData.limbs = { legL, legR, armL, armR };
  return g;
}

function buildGod() {
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, emissive: 0xffe9a0, emissiveIntensity: 0.45, roughness: 0.6 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffc830, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.6 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 10), robeMat);
  robe.position.y = 0.75;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.26), robeMat);
  torso.position.y = 1.7;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.28, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffd890, emissiveIntensity: 0.5 })
  );
  head.position.y = 2.1;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), goldMat);
  halo.position.y = 2.42;
  halo.rotation.x = Math.PI / 2;
  const wingGeo = new THREE.BoxGeometry(0.06, 0.9, 0.3);
  const wingL = new THREE.Mesh(wingGeo, robeMat);
  wingL.position.set(-0.3, 1.75, -0.12);
  const wingR = new THREE.Mesh(wingGeo, robeMat);
  wingR.position.set(0.3, 1.75, -0.12);
  const light = new THREE.PointLight(0xffe0a0, 14, 16, 1.6);
  light.position.y = 1.8;
  g.add(robe, torso, head, halo, wingL, wingR, light);
  g.userData.limbs = { halo, wingL, wingR };
  return g;
}

function removeNPC(n) {
  const i = npcs.indexOf(n);
  if (i === -1) return;
  npcs.splice(i, 1);
  scene.remove(n.mesh);
  n.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function randomSpawnPoint(minDist) {
  for (let tries = 0; tries < 40; tries++) {
    const t = floors[randInt(floors.length)];
    const c = tileCenter(t[0], t[1]);
    if (Math.hypot(c.x - player.pos.x, c.z - player.pos.z) > minDist) return c;
  }
  return null;
}

function spawnCiv() {
  const c = randomSpawnPoint(7);
  if (!c) return;
  const mesh = buildHumanoid({
    shirt: [0x8a3a3a, 0x3a6a8a, 0x6a8a3a, 0x8a7a3a, 0x7a4a8a][randInt(5)],
    pants: [0x2c2c34, 0x3a3a2c, 0x25303a][randInt(3)],
  });
  mesh.position.set(c.x, 0, c.z);
  mesh.rotation.y = rand(0, Math.PI * 2);
  scene.add(mesh);
  npcs.push({ mesh, type: 'civ', state: 'wander', dir: mesh.rotation.y, t: rand(1, 4), animT: rand(0, 6), downT: 0 });
}

function spawnCop() {
  const c = randomSpawnPoint(9);
  if (!c) return;
  const mesh = buildHumanoid({ shirt: 0x1c2c5a, pants: 0x14203c, cap: 0x101830 });
  mesh.position.set(c.x, 0, c.z);
  scene.add(mesh);
  npcs.push({ mesh, type: 'cop', dir: 0, t: 0, animT: 0, downT: 0 });
  showMsg('🚨 Полиция выехала на вызов!');
}

function spawnGod() {
  const c = randomSpawnPoint(10);
  if (!c) return;
  const mesh = buildGod();
  mesh.position.set(c.x, 0.35, c.z);
  scene.add(mesh);
  npcs.push({ mesh, type: 'god' });
  playThunder();
  showMsg('⚡ БОЖЬЯ КАРА СПУСТИЛАСЬ С НЕБЕС');
}

// ---------- NPC AI ----------
function npcWalk(n, dt, speed) {
  const step = speed * dt;
  const nx = n.mesh.position.x + Math.sin(n.dir) * step;
  const nz = n.mesh.position.z + Math.cos(n.dir) * step;
  if (!collides(nx, nz)) {
    n.mesh.position.x = nx;
    n.mesh.position.z = nz;
  } else {
    n.dir += rand(1.2, 2.2) * (Math.random() < 0.5 ? 1 : -1);
  }
  n.animT += dt * (4 + speed * 1.6);
  const sw = Math.sin(n.animT) * 0.65;
  const l = n.mesh.userData.limbs;
  l.legL.rotation.x = sw;
  l.legR.rotation.x = -sw;
  l.armL.rotation.x = -sw * 0.8;
  l.armR.rotation.x = sw * 0.8;
  n.mesh.rotation.y = n.dir;
}

function knockNPC(n, dur) {
  n.downT = dur;
  n.mesh.rotation.x = -Math.PI / 2;
  n.mesh.position.y = 0.3;
}

function reviveNPC(n) {
  n.downT = 0;
  n.mesh.rotation.x = 0;
  n.mesh.position.y = 0;
}

function fleeFrom(n, x, z) {
  n.state = 'flee';
  n.t = 4;
  n.dir = Math.atan2(n.mesh.position.x - x, n.mesh.position.z - z);
  playEek();
}

function updateCiv(n, dt) {
  if (n.downT > 0) {
    n.downT -= dt;
    if (n.downT <= 0) reviveNPC(n);
    return;
  }
  n.t -= dt;
  if (n.state === 'flee') {
    npcWalk(n, dt, 5.0);
    if (n.t <= 0) { n.state = 'wander'; n.t = rand(2, 5); }
    return;
  }
  if (panicT > 0 && Math.hypot(n.mesh.position.x - panicPos.x, n.mesh.position.z - panicPos.z) < 14) {
    fleeFrom(n, panicPos.x, panicPos.z);
    return;
  }
  if (S.driving && Math.abs(carState.fwd) > 4) {
    const d = Math.hypot(n.mesh.position.x - S.driving.mesh.position.x, n.mesh.position.z - S.driving.mesh.position.z);
    if (d < 5) { fleeFrom(n, S.driving.mesh.position.x, S.driving.mesh.position.z); return; }
  }
  if (n.t <= 0) { n.dir = rand(0, Math.PI * 2); n.t = rand(2, 5); }
  npcWalk(n, dt, 1.5);
}

function arrest() {
  arrestCd = 6;
  if (S.driving) exitCar();
  player.pos.copy(tileCenter(activeSpawn[0], activeSpawn[1]));
  player.pos.y = EYE_HEIGHT;
  player.vy = 0;
  player.onGround = true;
  showMsg('🚨 ТЕБЯ ЗАДЕРЖАЛИ!');
  playWhistle();
  crimes = 0;
  for (const n of [...npcs]) if (n.type === 'cop') removeNPC(n);
}

function updateCop(n, dt) {
  if (n.downT > 0) {
    n.downT -= dt;
    if (n.downT <= 0) reviveNPC(n);
    return;
  }
  const dx = player.pos.x - n.mesh.position.x;
  const dz = player.pos.z - n.mesh.position.z;
  const d = Math.hypot(dx, dz);
  n.dir = lerpAngle(n.dir, Math.atan2(dx, dz), Math.min(1, 6 * dt));
  const step = 5.6 * dt;
  for (const off of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
    const a = n.dir + off;
    const nx = n.mesh.position.x + Math.sin(a) * step;
    const nz = n.mesh.position.z + Math.cos(a) * step;
    if (!collides(nx, nz)) {
      n.mesh.position.x = nx;
      n.mesh.position.z = nz;
      n.mesh.rotation.y = a;
      break;
    }
  }
  n.animT += dt * 10;
  const sw = Math.sin(n.animT) * 0.7;
  const l = n.mesh.userData.limbs;
  l.legL.rotation.x = sw;
  l.legR.rotation.x = -sw;
  l.armL.rotation.x = -sw * 0.9;
  l.armR.rotation.x = sw * 0.9;
  if (d < 1.5 && arrestCd <= 0 && (!S.driving || Math.abs(carState.fwd) < 2.5)) arrest();
}

function smite(n) {
  smiteCd = 8;
  if (S.driving) exitCar();
  playThunder();
  flashScreen();
  S.shakeT = 0.8;
  player.vy = 15;
  player.onGround = false;
  for (const o of objects) {
    const d = Math.hypot(o.mesh.position.x - player.pos.x, o.mesh.position.z - player.pos.z);
    if (d < 6) {
      o.vel.y += 9;
      o.vel.x += rand(-4, 4);
      o.vel.z += rand(-4, 4);
    }
  }
  showMsg('⚡ БОЖЬЯ КАРА! НЕ ГРЕШИ!');
  removeNPC(n);
  crimes = 0;
}

function updateGod(n, dt) {
  const dx = player.pos.x - n.mesh.position.x;
  const dz = player.pos.z - n.mesh.position.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.01) {
    n.mesh.position.x += dx / d * 3.4 * dt;
    n.mesh.position.z += dz / d * 3.4 * dt;
  }
  n.mesh.position.y = 0.35 + Math.sin(performance.now() * 0.002) * 0.15;
  n.mesh.rotation.y = Math.atan2(dx, dz);
  const now = performance.now();
  const l = n.mesh.userData.limbs;
  l.halo.rotation.z += dt * 2;
  l.wingL.rotation.z = 0.5 + Math.sin(now * 0.006) * 0.25;
  l.wingR.rotation.z = -0.5 - Math.sin(now * 0.006) * 0.25;
  if (d < 1.7 && smiteCd <= 0) smite(n);
}

function updateNPCs(dt) {
  arrestCd = Math.max(0, arrestCd - dt);
  smiteCd = Math.max(0, smiteCd - dt);
  if (panicT > 0) panicT -= dt;
  if (sirenT > 0) sirenT -= dt;

  if (crimes > 0) {
    crimeTimer -= dt;
    if (crimeTimer <= 0) { crimes--; crimeTimer = 30; }
  }
  const copCount = npcs.filter(n => n.type === 'cop').length;
  if (crimes <= 0 && copCount > 0) {
    for (const n of [...npcs]) if (n.type === 'cop') removeNPC(n);
  } else if (crimes > 0 && copCount < 2) {
    copSpawnT -= dt;
    if (copSpawnT <= 0) { spawnCop(); copSpawnT = 3; }
  }
  if (crimes >= 4 && !npcs.some(n => n.type === 'god') && smiteCd <= 0) spawnGod();

  for (const n of [...npcs]) {
    if (n.type === 'god') updateGod(n, dt);
    else if (n.type === 'cop') updateCop(n, dt);
    else updateCiv(n, dt);
  }
  if (copCount > 0 && sirenT <= 0) { playSiren(); sirenT = 1.6; }
}

function commitCrime() {
  crimes = Math.min(6, crimes + 1);
  crimeTimer = 30;
}

function flashScreen() {
  flashEl.style.transition = 'none';
  flashEl.style.opacity = 0.9;
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.6s';
    flashEl.style.opacity = 0;
  });
}

// ---------- HUD ----------
let msgTimer = 0;
function showMsg(text) {
  msgEl.textContent = text;
  msgEl.style.opacity = 1;
  msgTimer = 2;
}

function updateFX(dt) {
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.style.opacity = 0; }
}

// ---------- Audio ----------
let AC = null, master = null, noiseBuf = null;

function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain();
  master.gain.value = 0.7;
  master.connect(AC.destination);

  const len = AC.sampleRate * 2;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function playFootstep() {
  if (!AC) return;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rand(0.9, 1.1);
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 320;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.14, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.12);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(); src.stop(AC.currentTime + 0.14);
}

function playClick() {
  if (!AC) return;
  const o = AC.createOscillator();
  o.type = 'square';
  o.frequency.value = 1400;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.06, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.05);
  o.connect(g); g.connect(master);
  o.start(); o.stop(AC.currentTime + 0.06);
}

function playPop() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(300, t);
  o.frequency.exponentialRampToValueAtTime(720, t + 0.1);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.18);
}

function playPoof() {
  if (!AC) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1200;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.14);
}

function playEek() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(rand(800, 1000), t);
  o.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.16);
}

function playSiren() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(660, t);
  o.frequency.linearRampToValueAtTime(880, t + 0.3);
  o.frequency.linearRampToValueAtTime(660, t + 0.6);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.045, t);
  g.gain.setValueAtTime(0.045, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.65);
}

function playWhistle() {
  if (!AC) return;
  const t = AC.currentTime;
  for (const off of [0, 0.18]) {
    const o = AC.createOscillator();
    o.type = 'square';
    o.frequency.value = 1250;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.06, t + off);
    g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.14);
    o.connect(g); g.connect(master);
    o.start(t + off); o.stop(t + off + 0.15);
  }
}

function playThunder() {
  if (!AC) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(50, t + 1.1);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 1.35);
  const o = AC.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(55, t);
  o.frequency.exponentialRampToValueAtTime(24, t + 1.0);
  const g2 = AC.createGain();
  g2.gain.setValueAtTime(0.4, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  o.connect(g2); g2.connect(master);
  o.start(t); o.stop(t + 1.25);
}

function playBoom() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.85);

  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2500, t);
  f.frequency.exponentialRampToValueAtTime(90, t + 0.55);
  const ng = AC.createGain();
  ng.gain.setValueAtTime(0.45, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  src.connect(f); f.connect(ng); ng.connect(master);
  src.start(t); src.stop(t + 0.75);
}

// ---------- Flow ----------
function startGame() {
  initAudio();
  if (AC && AC.state === 'suspended') AC.resume();
  if (builtMap !== S.map) buildWorld(S.map);

  menuOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  mapnameEl.textContent = MAPS[S.map].name.toUpperCase();
  hintEl.textContent = IS_TOUCH
    ? '➕ поставить · 🗑️ удалить · 🚗 машина · 🎒 рюкзак · 📺 ТВ'
    : 'ЛКМ — поставить · ПКМ/X — удалить · E — машина · B — рюкзак · V/C — ТВ · T — день/ночь';
  S.started = true;

  if (IS_TOUCH) {
    S.playing = true;
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return;
  }
  S.playing = false;
  canvas.requestPointerLock();
}

document.querySelectorAll('.map-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    S.map = card.dataset.map;
    buildWorld(S.map);
  });
});

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('save-btn').addEventListener('click', (e) => { e.stopPropagation(); saveLocal(); });
document.getElementById('load-btn').addEventListener('click', (e) => { e.stopPropagation(); loadLocal(); });
document.getElementById('export-btn').addEventListener('click', (e) => { e.stopPropagation(); exportXML(); });
document.getElementById('import-btn').addEventListener('click', (e) => { e.stopPropagation(); importXML(); });

document.getElementById('xml-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (loadFromXML(String(reader.result))) { showMsg('⬆️ Карта открыта'); playClick(); }
    else showMsg('⚠️ Не XML-файл карты');
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ---------- TVs: video on screen ----------
const btnTvWatch = document.getElementById('btn-tv-watch');
const btnTvLink = document.getElementById('btn-tv-link');

const tvOffBtn = document.createElement('button');
tvOffBtn.textContent = '✕ ВЫКЛЮЧИТЬ ТВ (C)';
tvOffBtn.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:30;display:none;background:#1a1208;color:#ffcf5a;border:2px solid #d89628;padding:8px 18px;font:bold 13px \'Courier New\',monospace;letter-spacing:0.1em;cursor:pointer;border-radius:6px;';
tvOffBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  stopTvScreen();
  if (!IS_TOUCH && S.started) canvas.requestPointerLock();
});
document.body.appendChild(tvOffBtn);

const cssWrap = document.createElement('div');
cssWrap.style.cssText = 'position:fixed;left:0;top:0;overflow:hidden;pointer-events:none;z-index:5;display:none;';
const cssInner = document.createElement('div');
cssInner.style.cssText = 'transform-style:preserve-3d;width:100%;height:100%;';
cssWrap.appendChild(cssInner);
const tvIframe = document.createElement('iframe');
tvIframe.style.cssText = 'position:absolute;border:0;pointer-events:auto;left:0;top:0;';
tvIframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
tvIframe.setAttribute('allowfullscreen', '');
cssInner.appendChild(tvIframe);
document.body.appendChild(cssWrap);

const _cssM = new THREE.Matrix4();
const _cssS = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
const _tvV1 = new THREE.Vector3();
const _tvV2 = new THREE.Vector3();
const _tvV3 = new THREE.Vector3();
let tvVideo = null;
let tvTexture = null;

function cssEps(v) { return Math.abs(v) < 1e-10 ? 0 : v; }
function cssCameraMatrix(m) {
  const e = m.elements;
  return 'matrix3d(' + cssEps(e[0]) + ',' + cssEps(-e[1]) + ',' + cssEps(e[2]) + ',' + cssEps(e[3]) + ','
    + cssEps(e[4]) + ',' + cssEps(-e[5]) + ',' + cssEps(e[6]) + ',' + cssEps(e[7]) + ','
    + cssEps(e[8]) + ',' + cssEps(-e[9]) + ',' + cssEps(e[10]) + ',' + cssEps(e[11]) + ','
    + cssEps(e[12]) + ',' + cssEps(-e[13]) + ',' + cssEps(e[14]) + ',' + cssEps(e[15]) + ')';
}
function cssObjectMatrix(m) {
  const e = m.elements;
  return 'translate(-50%,-50%) matrix3d(' + cssEps(e[0]) + ',' + cssEps(e[1]) + ',' + cssEps(e[2]) + ',' + cssEps(e[3]) + ','
    + cssEps(-e[4]) + ',' + cssEps(-e[5]) + ',' + cssEps(-e[6]) + ',' + cssEps(-e[7]) + ','
    + cssEps(e[8]) + ',' + cssEps(e[9]) + ',' + cssEps(e[10]) + ',' + cssEps(e[11]) + ','
    + cssEps(e[12]) + ',' + cssEps(e[13]) + ',' + cssEps(e[14]) + ',' + cssEps(e[15]) + ')';
}

function parseVideo(u) {
  if (!u) return null;
  const m = u.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { kind: 'yt', id: m[1] };
  if (/^https?:\/\//i.test(u)) return { kind: 'file', src: u };
  return null;
}

function ensureTvVideo() {
  if (tvVideo) return tvVideo;
  tvVideo = document.createElement('video');
  tvVideo.crossOrigin = 'anonymous';
  tvVideo.loop = true;
  tvVideo.playsInline = true;
  tvVideo.setAttribute('playsinline', '');
  tvVideo.addEventListener('error', () => {
    if (S.tvObj) showMsg('⚠️ Не удалось загрузить видео с этой ссылки (нет доступа/CORS)');
    stopTvScreen();
  });
  return tvVideo;
}

function stopTvScreen() {
  S.gameOn = false;
  if (S.tvObj) {
    const scr = S.tvObj.mesh.userData.screen;
    if (scr) {
      scr.material.map = null;
      scr.material.color.set(0x0b0d12);
      scr.material.needsUpdate = true;
    }
  }
  S.tvObj = null;
  if (tvVideo) tvVideo.pause();
  if (tvTexture) { tvTexture.dispose(); tvTexture = null; }
  tvIframe.src = 'about:blank';
}

function nearestTvTo(o) {
  let best = null, bd = 5;
  for (const t of objects) {
    if (!t.tv) continue;
    const d = t.mesh.position.distanceTo(o.mesh.position);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function nearestConsoleTo(tv) {
  let best = null, bd = 5;
  for (const c of objects) {
    if (c.id !== 'console') continue;
    const d = c.mesh.position.distanceTo(tv.mesh.position);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

const gameCanvas = document.createElement('canvas');
gameCanvas.width = 256;
gameCanvas.height = 192;
const gameCtx = gameCanvas.getContext('2d');
let gameTexture = null;
const gameSt = { bx: 128, by: 96, vx: 130, vy: 85, p1: 96, p2: 96, s1: 0, s2: 0 };

function resetBall() {
  gameSt.bx = 128;
  gameSt.by = 96;
  gameSt.vx = (Math.random() < 0.5 ? -1 : 1) * 130;
  gameSt.vy = (Math.random() - 0.5) * 160;
}

function startGameMode(tvObj) {
  const wasSame = S.tvObj === tvObj && S.gameOn;
  stopTvScreen();
  if (wasSame) { showMsg('🎮 Приставка выключена'); return; }
  S.tvObj = tvObj;
  S.gameOn = true;
  const scr = tvObj.mesh.userData.screen;
  if (!gameTexture) {
    gameTexture = new THREE.CanvasTexture(gameCanvas);
    gameTexture.colorSpace = THREE.SRGBColorSpace;
  }
  if (scr) {
    scr.material.map = gameTexture;
    scr.material.color.set(0xffffff);
    scr.material.needsUpdate = true;
  }
  showMsg('🎮 Понг на экране! C — выключить');
}

function updateTvGame(dt) {
  const st = gameSt, W = 256, H = 192;
  st.bx += st.vx * dt;
  st.by += st.vy * dt;
  if (st.by < 6) { st.by = 6; st.vy = Math.abs(st.vy); }
  if (st.by > H - 6) { st.by = H - 6; st.vy = -Math.abs(st.vy); }
  if (st.bx < 16 && Math.abs(st.by - st.p1) < 22 && st.vx < 0) st.vx = Math.min(Math.abs(st.vx) * 1.06, 280);
  if (st.bx > W - 16 && Math.abs(st.by - st.p2) < 22 && st.vx > 0) st.vx = -Math.min(Math.abs(st.vx) * 1.06, 280);
  if (st.bx < 0) { st.s2++; resetBall(); }
  if (st.bx > W) { st.s1++; resetBall(); }
  st.p1 = clamp(st.p1 + clamp(st.by - st.p1, -95 * dt, 95 * dt), 22, H - 22);
  st.p2 = clamp(st.p2 + clamp(st.by - st.p2, -80 * dt, 80 * dt), 22, H - 22);
  const c = gameCtx;
  c.fillStyle = '#0a120c';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#2c5a38';
  c.setLineDash([6, 8]);
  c.beginPath();
  c.moveTo(W / 2, 8);
  c.lineTo(W / 2, H - 8);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#39ff70';
  c.font = 'bold 30px monospace';
  c.textAlign = 'center';
  c.fillText(String(st.s1), W / 2 - 40, 38);
  c.fillText(String(st.s2), W / 2 + 40, 38);
  c.fillRect(10, st.p1 - 20, 5, 40);
  c.fillRect(W - 15, st.p2 - 20, 5, 40);
  c.fillRect(st.bx - 3, st.by - 3, 6, 6);
  gameTexture.needsUpdate = true;
}

function watchTv(o) {
  const p = parseVideo(o.url);
  if (!p) {
    if (nearestConsoleTo(o)) { startGameMode(o); return; }
    setTvLink(o);
    return;
  }
  const wasSame = S.tvObj === o;
  stopTvScreen();
  if (wasSame) { showMsg('📺 ТВ выключен'); return; }
  S.tvObj = o;
  const scr = o.mesh.userData.screen;
  if (p.kind === 'yt') {
    tvIframe.src = 'https://www.youtube.com/embed/' + p.id + '?autoplay=1&playsinline=1&rel=0&modestbranding=1';
    tvIframe.style.width = (o.mesh.userData.screenW * 100) + 'px';
    tvIframe.style.height = (o.mesh.userData.screenH * 100) + 'px';
  } else {
    const v = ensureTvVideo();
    v.src = p.src;
    tvTexture = new THREE.VideoTexture(v);
    tvTexture.colorSpace = THREE.SRGBColorSpace;
    if (scr) {
      scr.material.map = tvTexture;
      scr.material.color.set(0xffffff);
      scr.material.needsUpdate = true;
    }
    v.play().catch(() => showMsg('▶️ Нажми ещё раз, чтобы включить звук'));
  }
  showMsg('📺 Включено! C — выключить');
}

function sitOn(o) {
  S.sitting = o;
  showMsg(IS_TOUCH ? '🛋️ Устроился · 📺 — спать · ➕ — встать' : '🛋️ Устроился · C — спать · Space — встать');
}

function standUp() {
  S.sitting = null;
  player.pos.y = EYE_HEIGHT;
  player.onGround = true;
  showMsg('🛋️ Ты встал');
}

function sleepNow() {
  flashScreen();
  if (S.night) {
    S.night = false;
    applyAtmosphere();
    showMsg('😴 Ты выспался — наступило утро');
  } else {
    showMsg('😴 Ты вздремнул');
  }
}

function setTvLink(o) {
  const u = window.prompt('Ссылка на видео (YouTube или mp4):', o.url || '');
  if (u === null) return;
  const t = u.trim();
  if (S.tvObj === o) stopTvScreen();
  o.url = parseVideo(t) ? t : null;
  showMsg(o.url ? '📺 Видео привязано к ТВ' : '🔗 Ссылка убрана');
}

function updateTvCss() {
  const o = S.tvObj;
  if (!o || !o.mesh.parent || !S.playing || S.driving) {
    cssWrap.style.display = 'none';
    tvOffBtn.style.display = 'none';
    return;
  }
  tvOffBtn.style.display = 'block';
  const scr = o.mesh.userData.screen;
  if (!scr) { cssWrap.style.display = 'none'; return; }
  _tvV1.setFromMatrixPosition(scr.matrixWorld);
  const dist = _tvV1.distanceTo(camera.position);
  _tvV2.set(0, 0, 1).transformDirection(scr.matrixWorld);
  _tvV3.copy(_tvV1).sub(camera.position).normalize();
  if (dist > 28 || _tvV2.dot(_tvV3) < 0.2) {
    cssWrap.style.display = 'none';
    return;
  }
  const w = window.innerWidth, h = window.innerHeight;
  const focal = camera.projectionMatrix.elements[5] * (h / 2);
  cssWrap.style.display = 'block';
  cssWrap.style.width = w + 'px';
  cssWrap.style.height = h + 'px';
  cssInner.style.width = w + 'px';
  cssInner.style.height = h + 'px';
  cssInner.style.transform = 'perspective(' + focal + 'px) ' + cssCameraMatrix(camera.matrixWorldInverse) + 'translate(' + (w / 2) + 'px,' + (h / 2) + 'px)';
  _cssM.copy(scr.matrixWorld).multiply(_cssS);
  tvIframe.style.transform = cssObjectMatrix(_cssM);
}

btnTvWatch.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (S.sitting) { sleepNow(); return; }
  const o = findAimed();
  if (o && o.seat) { sitOn(o); return; }
  if (o && o.tv) watchTv(o);
  else if (o && o.console) {
    const tv = nearestTvTo(o);
    if (tv) watchTv(tv);
    else showMsg('⚠️ Поставь приставку рядом с телевизором (до 5 м)');
  }
}, { passive: false });

btnTvLink.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const o = findAimed();
  if (o && o.tv) setTvLink(o);
}, { passive: false });

// ---------- Backpack (inventory) ----------
const bagOverlay = document.getElementById('bag-overlay');
const bagList = document.getElementById('bag-list');
const btnBag = document.getElementById('btn-bag');

function bagCount(id) {
  let n = 0;
  for (const o of objects) if (o.id === id) n++;
  return n;
}

function renderBag() {
  bagList.innerHTML = '';
  CATALOG.forEach((def, i) => {
    const n = bagCount(def.id);
    const row = document.createElement('div');
    row.className = 'bag-row' + (i === S.sel ? ' bsel' : '');
    row.innerHTML = `<span>${def.icon}</span><span>${def.name}</span><span class="cnt">${n ? '×' + n : ''}</span><span class="add">＋ ПОСТАВИТЬ</span>${n ? '<span class="rm">🗑</span>' : ''}`;
    row.addEventListener('click', () => {
      selectSlot(i);
      closeBag();
    });
    row.querySelector('.add').addEventListener('click', (e) => {
      e.stopPropagation();
      selectSlot(i);
      spawnSelected();
      renderBag();
    });
    const rm = row.querySelector('.rm');
    if (rm) rm.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const o of objects.filter(o => o.id === def.id)) removeObject(o);
      renderBag();
      playPoof();
    });
    bagList.appendChild(row);
  });
}

function openBag() {
  if (!S.started || S.bagOpen || S.driving) return;
  S.bagOpen = true;
  renderBag();
  bagOverlay.classList.remove('hidden');
  if (!IS_TOUCH && document.pointerLockElement === canvas) document.exitPointerLock();
  S.playing = false;
}

function closeBag() {
  if (!S.bagOpen) return;
  S.bagOpen = false;
  bagOverlay.classList.add('hidden');
  if (IS_TOUCH) {
    if (S.started) S.playing = true;
  } else {
    canvas.requestPointerLock();
  }
}

btnBag.addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (S.bagOpen) closeBag(); else openBag();
}, { passive: false });

document.getElementById('bag-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  openBag();
});

document.getElementById('bag-close').addEventListener('click', (e) => {
  e.stopPropagation();
  closeBag();
});

bagOverlay.addEventListener('click', (e) => e.stopPropagation());

pauseOverlay.addEventListener('click', () => {
  if (IS_TOUCH) {
    S.playing = true;
    pauseOverlay.classList.add('hidden');
  } else {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    S.playing = true;
    pauseOverlay.classList.add('hidden');
  } else if (S.started) {
    S.playing = false;
    pauseOverlay.classList.remove('hidden');
  }
});

// ---------- Main loop ----------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  if (S.started) {
    if (S.playing) {
      if (S.driving) {
        updateCar(dt);
        const obj = S.driving;
        const fx = Math.sin(carState.heading), fz = Math.cos(carState.heading);
        const target = new THREE.Vector3(obj.mesh.position.x - fx * 7.5, 3.4, obj.mesh.position.z - fz * 7.5);
        camera.position.lerp(target, 1 - Math.pow(0.001, dt));
        camera.lookAt(obj.mesh.position.x, 1.2, obj.mesh.position.z);
        playerLight.position.copy(camera.position);
        promptEl.textContent = 'E — выйти из машины';
        promptEl.style.opacity = 1;
      } else {
        updatePlayer(dt);
        const near = nearestCar();
        const aim = near ? null : findAimed();
        const tvAim = aim && aim.tv ? aim : null;
        const conAim = aim && aim.console ? aim : null;
        const seatAim = aim && aim.seat ? aim : null;
        if (S.sitting) {
          promptEl.textContent = IS_TOUCH ? '📺 — спать · ➕ — встать' : 'C — спать · Space — встать';
          promptEl.style.opacity = 1;
        } else if (near) {
          promptEl.textContent = IS_TOUCH ? '🚗 — сесть в машину' : 'E — сесть в машину';
          promptEl.style.opacity = 1;
        } else if (seatAim) {
          promptEl.textContent = IS_TOUCH ? '📺 — сесть на диван' : 'C — сесть на диван';
          promptEl.style.opacity = 1;
        } else if (tvAim) {
          promptEl.textContent = tvAim.url
            ? (IS_TOUCH ? '📺 — смотреть · 🔗 — сменить' : 'C — смотреть · V — сменить ссылку')
            : (IS_TOUCH ? '🔗 — вставить ссылку' : 'V — вставить ссылку (YouTube/mp4)');
          promptEl.style.opacity = 1;
        } else if (conAim) {
          const tvForCon = nearestTvTo(conAim);
          promptEl.textContent = tvForCon
            ? (IS_TOUCH ? '📺 — играть на приставке' : 'C — играть на приставке')
            : (IS_TOUCH ? 'Поставь рядом телевизор (до 5 м)' : 'Поставь приставку рядом с ТВ (до 5 м)');
          promptEl.style.opacity = 1;
        } else if (promptEl.style.opacity) {
          promptEl.style.opacity = 0;
        }
        btnCar.classList.toggle('nearest', !!near || !!S.driving);
        btnTvWatch.classList.toggle('nearest', !!tvAim || !!(conAim && nearestTvTo(conAim)) || !!seatAim || !!S.sitting);
        btnTvLink.classList.toggle('nearest', !!tvAim);
      }
      updatePhysics(dt);
      updateNPCs(dt);
      updateFX(dt);
      if (S.gameOn && S.tvObj) updateTvGame(dt);
    } else {
      camera.position.set(player.pos.x, player.pos.y, player.pos.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      flashlight.position.copy(camera.position);
      flashlight.target.position.copy(camera.position).addScaledVector(dir, 10);
      playerLight.position.copy(camera.position);
    }
  }

  renderer.render(scene, camera);
  updateTvCss();
}

buildWorld('yard');
selectSlot(0);

camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
camera.rotation.set(0, player.yaw, 0);
flashlight.position.copy(camera.position);
flashlight.target.position.set(player.pos.x, EYE_HEIGHT, player.pos.z - 10);
playerLight.position.copy(camera.position);

setTimeout(checkOrientation, 0);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 120));

requestAnimationFrame(loop);
window.__gameBooted = true;
