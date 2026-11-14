import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
//  THE MONSTER — 3D horror (maps: yard / forest / city)
// ============================================================

const TILE = 4;
const COLS = 14, ROWS = 14;
const GW = COLS * 2 + 1, GH = ROWS * 2 + 1;
const FUSE_COUNT = 6;

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
const objectiveEl = document.getElementById('objective');
const fusesEl = document.getElementById('fuses');
const msgEl = document.getElementById('msg');
const promptEl = document.getElementById('prompt');
const batteryFill = document.getElementById('battery-fill');
const staminaFill = document.getElementById('stamina-fill');
const vignette = document.getElementById('vignette');
const damageFlash = document.getElementById('damage-flash');
const menuOverlay = document.getElementById('menu-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const deathOverlay = document.getElementById('death-overlay');
const deathStats = document.getElementById('death-stats');
const winOverlay = document.getElementById('win-overlay');
const winStats = document.getElementById('win-stats');
const rotateOverlay = document.getElementById('rotate-overlay');
const jumpscareEl = document.getElementById('jumpscare');
const joyBase = document.getElementById('joy-base');
const joyKnob = document.getElementById('joy-knob');

// ---------- Game state ----------
const S = {
  map: 'yard',
  started: false, playing: false, dead: false, won: false,
  time: 0, startTime: 0,
  battery: 100, flashlight: true,
  stamina: 100, staminaDelay: 0,
  fuses: 0, exitOpen: false,
  deathTimer: -1, shake: 0, pausedByRotate: false,
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(IS_TOUCH ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2));
if (IS_TOUCH) document.body.classList.add('touch');
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 120);
camera.rotation.order = 'YXZ';

const ambient = new THREE.AmbientLight(0x33404d, 0.2);
scene.add(ambient);

const playerLight = new THREE.PointLight(0x556677, 2.2, 9, 1.6);
scene.add(playerLight);

const flashlight = new THREE.SpotLight(0xfff2d0, 90, 40, 0.46, 0.45, 1.5);
scene.add(flashlight);
scene.add(flashlight.target);

// ---------- Maps ----------
const MAPS = {
  yard: {
    name: 'Двор',
    wallColor: 0x4a4642, wallH: 3.0, ground: 0x2b2a28,
    fog: 0x060608, fogD: 0.065, ambient: [0x33404d, 0.22],
  },
  forest: {
    name: 'Лес',
    wallColor: 0x3a2a1a, wallH: 5.5, ground: 0x1a2214,
    fog: 0x040704, fogD: 0.095, ambient: [0x223322, 0.18],
  },
  city: {
    name: 'Заражённый город',
    wallColor: 0x37342f, wallH: 5.0, ground: 0x232325,
    fog: 0x060d05, fogD: 0.075, ambient: [0x2a3325, 0.2],
  },
  village: {
    name: 'Село Сулоаоу',
    wallColor: 0x6b5138, wallH: 3.2, ground: 0x3d5230,
    fog: 0x8f9789, fogD: 0.045, ambient: [0x99a8b0, 0.55],
  },
};

const spawnTile = [1, 1];
const exitTile = [GW - 2, GH - 2];

const grid = new Uint8Array(GW * GH);
const idx = (i, j) => j * GW + i;
const isWall = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? true : grid[idx(i, j)] === 1;
let floors = [];
let flickerLights = [];
let worldGroup = null;
let doorGroup = null;
let items = [];
let builtMap = null;

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
  const q = [idx(spawnTile[0], spawnTile[1])];
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

function generateGrid(map) {
  grid.fill(1);
  if (map === 'yard') {
    generateMaze();
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      if (grid[idx(i, j)] === 1 && ((i % 2 === 0) !== (j % 2 === 0)) && Math.random() < 0.42) grid[idx(i, j)] = 0;
    }
  } else if (map === 'forest') {
    grid.fill(0);
    for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
      const nearSpawn = Math.abs(i - spawnTile[0]) < 3 && Math.abs(j - spawnTile[1]) < 3;
      const nearExit = Math.abs(i - exitTile[0]) < 3 && Math.abs(j - exitTile[1]) < 3;
      if (!nearSpawn && !nearExit && Math.random() < 0.34) grid[idx(i, j)] = 1;
    }
  } else if (map === 'city') {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1) { grid[idx(i, j)] = 1; continue; }
      grid[idx(i, j)] = (i % 6 === 3 || j % 6 === 3) ? 0 : (Math.random() < 0.82 ? 1 : 0);
    }
    carveToStreet(spawnTile[0], spawnTile[1]);
    carveToStreet(exitTile[0], exitTile[1]);
  } else if (map === 'village') {
    grid.fill(0);
    const houses = 9 + randInt(4);
    for (let h = 0; h < houses; h++) {
      const w = 3 + randInt(3), d = 3 + randInt(3);
      const hi = 2 + randInt(GW - w - 4), hj = 2 + randInt(GH - d - 4);
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) {
        const edge = a === 0 || b === 0 || a === w - 1 || b === d - 1;
        if (edge || Math.random() < 0.5) grid[idx(hi + a, hj + b)] = 1;
      }
    }
    for (let f = 0; f < 10; f++) {
      const fi = 2 + randInt(GW - 8), fj = 2 + randInt(GH - 8);
      const horiz = Math.random() < 0.5;
      const len = 4 + randInt(4);
      for (let a = 0; a < len; a++) {
        const i = horiz ? fi + a : fi, j = horiz ? fj : fj + a;
        if (i > 0 && j > 0 && i < GW - 1 && j < GH - 1) grid[idx(i, j)] = 1;
      }
    }
    for (const [ti, tj] of [spawnTile, exitTile]) {
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const i = ti + a, j = tj + b;
        if (i > 0 && j > 0 && i < GW - 1 && j < GH - 1) grid[idx(i, j)] = 0;
      }
    }
  }

  let reach = bfsReach();
  if (!reach[idx(exitTile[0], exitTile[1])]) {
    let i = exitTile[0], j = exitTile[1];
    while (i !== spawnTile[0]) { grid[idx(i, j)] = 0; i += i < spawnTile[0] ? 1 : -1; }
    while (j !== spawnTile[1]) { grid[idx(i, j)] = 0; j += j < spawnTile[1] ? 1 : -1; }
    reach = bfsReach();
  }
  floors = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (!isWall(i, j) && reach[idx(i, j)]) floors.push([i, j]);
  }
}

function losTiles(i0, j0, i1, j1) {
  let x = i0, y = j0;
  const dx = Math.abs(i1 - i0), dy = Math.abs(j1 - j0);
  const sx = i0 < i1 ? 1 : -1, sy = j0 < j1 ? 1 : -1;
  let err = dx - dy;
  while (!(x === i1 && y === j1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === i1 && y === j1) break;
    if (isWall(x, y)) return false;
  }
  return true;
}

function bfsPath(si, sj, ti, tj) {
  if (isWall(si, sj) || isWall(ti, tj)) return null;
  const prev = new Int32Array(GW * GH).fill(-1);
  const q = [idx(si, sj)];
  prev[idx(si, sj)] = idx(si, sj);
  const target = idx(ti, tj);
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === target) break;
    const ci = cur % GW, cj = (cur - ci) / GW;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (isWall(ni, nj)) continue;
      const n = idx(ni, nj);
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      q.push(n);
    }
  }
  if (prev[target] === -1) return null;
  const path = [];
  let cur = target;
  while (cur !== idx(si, sj)) { path.push(cur); cur = prev[cur]; }
  path.reverse();
  return path.map(p => tileCenter(p % GW, Math.floor(p / GW)));
}

// ---------- World building ----------
function disposeWorld() {
  if (!worldGroup) return;
  worldGroup.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  scene.remove(worldGroup);
  worldGroup = null;
}

function buildWalls(cfg, map) {
  const wallTiles = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (grid[idx(i, j)] === 1) wallTiles.push([i, j]);

  if (map === 'forest') {
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.45, cfg.wallH, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(1.7, 3.4, 8);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x14261a, roughness: 1 });
    for (const [i, j] of wallTiles) {
      const c = tileCenter(i, j);
      const ox = rand(-1.0, 1.0), oz = rand(-1.0, 1.0);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(c.x + ox, cfg.wallH / 2, c.z + oz);
      const s = rand(0.8, 1.35);
      trunk.scale.set(s, s, s);
      worldGroup.add(trunk);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(c.x + ox, cfg.wallH + 1.1 * s, c.z + oz);
      leaf.scale.set(s, s, s);
      worldGroup.add(leaf);
    }
    return;
  }

  const wallGeo = new THREE.BoxGeometry(TILE, cfg.wallH, TILE);
  const wallMat = new THREE.MeshStandardMaterial({ color: cfg.wallColor, roughness: 0.95, metalness: 0.02 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallTiles.length);
  const m = new THREE.Matrix4();
  wallTiles.forEach(([i, j], n) => {
    m.setPosition((i + 0.5) * TILE, cfg.wallH / 2, (j + 0.5) * TILE);
    walls.setMatrixAt(n, m);
  });
  worldGroup.add(walls);
}

function addYardProps() {
  const spots = floors.filter(([i, j]) => Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 8);
  spots.sort(() => Math.random() - 0.5);
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.8 });
  const headGeo = new THREE.BoxGeometry(0.5, 0.16, 0.28);
  for (let k = 0; k < 6 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(c.x, 1.5, c.z);
    const head = new THREE.Mesh(headGeo, poleMat);
    head.position.set(c.x, 3.02, c.z);
    const light = new THREE.PointLight(0xffb060, 9, 13, 1.8);
    light.position.set(c.x, 2.85, c.z);
    worldGroup.add(pole, head, light);
    flickerLights.push({ light, base: 9 });
  }
  const boxGeo = new THREE.BoxGeometry(1.1, 1.0, 0.8);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x24301f, roughness: 0.9 });
  for (let k = 6; k < 12 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(c.x + rand(-1, 1), 0.5, c.z + rand(-1, 1));
    box.rotation.y = rand(0, Math.PI);
    worldGroup.add(box);
  }
}

function addCityProps() {
  const spots = floors.filter(([i, j]) => Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 8);
  spots.sort(() => Math.random() - 0.5);
  const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1e3320, emissive: 0x2fbf2f, emissiveIntensity: 0.55, roughness: 0.6 });
  for (let k = 0; k < 8 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(c.x + rand(-1.1, 1.1), 0.48, c.z + rand(-1.1, 1.1));
    const light = new THREE.PointLight(0x44ff44, 2.6, 6, 1.8);
    light.position.copy(b.position).setY(1.2);
    worldGroup.add(b, light);
    flickerLights.push({ light, base: 2.6 });
  }
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.75, 4.2);
  const topGeo = new THREE.BoxGeometry(1.7, 0.55, 2.2);
  const carColors = [0x3a1a1a, 0x1a2436, 0x2c2c2c, 0x33301a];
  for (let k = 8; k < 14 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: carColors[k % carColors.length], roughness: 0.5, metalness: 0.35 }));
    body.position.y = 0.45;
    const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.3, metalness: 0.5 }));
    top.position.set(0, 1.0, -0.2);
    g.add(body, top);
    g.position.set(c.x, 0, c.z);
    g.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
    worldGroup.add(g);
  }
}

function addVillageProps() {
  const spots = floors.filter(([i, j]) => Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 6);
  spots.sort(() => Math.random() - 0.5);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.6, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1 });
  const leafGeo = new THREE.ConeGeometry(1.6, 3.2, 8);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d4a22, roughness: 1 });
  for (let k = 0; k < 8 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const ox = rand(-1, 1), oz = rand(-1, 1);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(c.x + ox, 1.3, c.z + oz);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(c.x + ox, 3.8, c.z + oz);
    worldGroup.add(trunk, leaf);
  }
  const hayGeo = new THREE.BoxGeometry(1.1, 1.0, 1.1);
  const hayMat = new THREE.MeshStandardMaterial({ color: 0xb8963a, roughness: 1 });
  for (let k = 8; k < 14 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const hay = new THREE.Mesh(hayGeo, hayMat);
    hay.position.set(c.x + rand(-1, 1), 0.5, c.z + rand(-1, 1));
    hay.rotation.y = rand(0, Math.PI);
    worldGroup.add(hay);
  }
  if (spots.length > 14) {
    const c = tileCenter(spots[14][0], spots[14][1]);
    const well = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.0, 0.9, 10),
      new THREE.MeshStandardMaterial({ color: 0x7a7a76, roughness: 0.9 })
    );
    well.position.set(c.x, 0.45, c.z);
    worldGroup.add(well);
  }
}

function buildDoor() {
  doorGroup = new THREE.Group();
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.7, MAPS[S.map].wallH * 0.8, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85 })
  );
  door.position.y = MAPS[S.map].wallH * 0.4;
  doorGroup.add(door);
  const sign = new THREE.PointLight(0xff2020, 4, 10, 1.8);
  sign.position.set(0, MAPS[S.map].wallH - 0.5, 0.5);
  doorGroup.add(sign);
  doorGroup.userData.sign = sign;
  const c = tileCenter(exitTile[0], exitTile[1]);
  doorGroup.position.set(c.x, 0, c.z);
  worldGroup.add(doorGroup);
}

function makeFuse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.36, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a6a1a, emissive: 0xcc9a10, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  body.rotation.z = Math.PI / 2;
  g.add(body);
  g.add(new THREE.PointLight(0xffc840, 3.5, 6, 1.8));
  return g;
}

function makeBattery() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x1f4d1f, emissive: 0x22aa22, emissiveIntensity: 0.9, roughness: 0.5 })
  );
  g.add(body);
  return g;
}

function placeItems() {
  items = [];
  const spots = floors.filter(([i, j]) => {
    if ((i === spawnTile[0] && j === spawnTile[1]) || (i === exitTile[0] && j === exitTile[1])) return false;
    return Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 6;
  }).sort(() => Math.random() - 0.5);
  const chosen = [];
  for (const c of spots) {
    if (chosen.length >= FUSE_COUNT + 4) break;
    if (chosen.every(o => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) > 7)) chosen.push(c);
  }
  while (chosen.length < FUSE_COUNT + 4 && spots.length) chosen.push(spots[randInt(spots.length)]);

  for (let k = 0; k < FUSE_COUNT; k++) {
    const mesh = makeFuse();
    const [i, j] = chosen[k];
    mesh.position.copy(tileCenter(i, j)).setY(0.9);
    worldGroup.add(mesh);
    items.push({ type: 'fuse', mesh, taken: false, baseY: 0.9, phase: rand(0, 6.28) });
  }
  for (let k = 0; k < 4; k++) {
    const mesh = makeBattery();
    const [i, j] = chosen[FUSE_COUNT + k];
    mesh.position.copy(tileCenter(i, j)).setY(0.75);
    mesh.rotation.z = Math.PI / 2;
    worldGroup.add(mesh);
    items.push({ type: 'battery', mesh, taken: false, baseY: 0.75, phase: rand(0, 6.28) });
  }
}

function buildWorld(map) {
  disposeWorld();
  generateGrid(map);
  const cfg = MAPS[map];
  worldGroup = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GW * TILE, GH * TILE),
    new THREE.MeshStandardMaterial({ color: cfg.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(GW * TILE / 2, 0, GH * TILE / 2);
  worldGroup.add(ground);

  buildWalls(cfg, map);
  flickerLights = [];
  if (map === 'yard') addYardProps();
  if (map === 'city') addCityProps();
  if (map === 'village') addVillageProps();
  buildDoor();
  placeItems();
  scene.add(worldGroup);

  scene.fog = new THREE.FogExp2(cfg.fog, cfg.fogD);
  scene.background = new THREE.Color(cfg.fog);
  ambient.color.setHex(cfg.ambient[0]);
  ambient.intensity = cfg.ambient[1];

  monster.visible = map !== 'village';
  goose.visible = map === 'village';
  monsterSpawn();
  player.pos.copy(tileCenter(spawnTile[0], spawnTile[1]));
  player.pos.y = EYE_HEIGHT;
  player.yaw = Math.PI * 0.75;
  player.pitch = 0;
  builtMap = map;
}

// ---------- Monster ----------
const monster = new THREE.Group();
{
  const skin = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.5, 8), skin);
  torso.position.y = 1.35;
  monster.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), skin);
  head.position.y = 2.35;
  head.scale.y = 1.3;
  monster.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), new THREE.MeshStandardMaterial({ color: 0xb8b0a4, roughness: 0.9 }));
  face.position.set(0, 2.38, 0.14);
  face.scale.set(1, 1.25, 0.7);
  monster.add(face);
  const armGeo = new THREE.CylinderGeometry(0.09, 0.07, 1.5, 6);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.5, 1.4, 0);
  armL.rotation.z = 0.25;
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.5, 1.4, 0);
  armR.rotation.z = -0.25;
  monster.add(armL, armR);
  const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 1.1, 6);
  const legL = new THREE.Mesh(legGeo, skin);
  legL.position.set(-0.18, 0.55, 0);
  const legR = new THREE.Mesh(legGeo, skin);
  legR.position.set(0.18, 0.55, 0);
  monster.add(legL, legR);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.11, 2.42, 0.3);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.11, 2.42, 0.3);
  monster.add(eyeL, eyeR);
  const eyeGlow = new THREE.PointLight(0xff2020, 1.6, 7, 1.8);
  eyeGlow.position.set(0, 2.4, 0.3);
  monster.add(eyeGlow);
}
scene.add(monster);

const goose = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.8 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8801a, roughness: 0.6 });
  const black = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), white);
  body.scale.set(1, 0.8, 1.4);
  body.position.y = 0.75;
  goose.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), white);
  tail.rotation.x = -Math.PI / 2.3;
  tail.position.set(0, 0.85, -0.75);
  goose.add(tail);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.95, 8), white);
  neck.position.set(0, 1.32, 0.42);
  neck.rotation.x = 0.3;
  goose.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), white);
  head.position.set(0, 1.8, 0.56);
  goose.add(head);
  const beakU = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 8), orange);
  beakU.rotation.x = Math.PI / 2;
  beakU.position.set(0, 1.78, 0.8);
  goose.add(beakU);
  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  eyeL.position.set(-0.11, 1.86, 0.64);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeR.position.set(0.11, 1.86, 0.64);
  goose.add(eyeL, eyeR);
  const wingGeo = new THREE.BoxGeometry(0.1, 0.42, 0.8);
  const wingL = new THREE.Mesh(wingGeo, white);
  wingL.position.set(-0.48, 0.85, 0);
  const wingR = new THREE.Mesh(wingGeo, white);
  wingR.position.set(0.48, 0.85, 0);
  goose.add(wingL, wingR);
  const footGeo = new THREE.BoxGeometry(0.18, 0.06, 0.35);
  const footL = new THREE.Mesh(footGeo, orange);
  footL.position.set(-0.16, 0.05, 0.05);
  const footR = new THREE.Mesh(footGeo, orange);
  footR.position.set(0.16, 0.05, 0.05);
  goose.add(footL, footR);
  goose.userData.wings = [wingL, wingR];
  goose.scale.setScalar(1.5);
}
goose.visible = false;
scene.add(goose);

const enemyMesh = () => (S.map === 'village' ? goose : monster);

const M = {
  pos: new THREE.Vector3(), state: 'roam', path: null, pathIndex: 0,
  repathTimer: 0, chaseTimer: 0, farTimer: 0, lastKnown: null, walkPhase: 0,
};

function monsterSpawn() {
  let far = floors.filter(([i, j]) => tileCenter(i, j).distanceTo(tileCenter(spawnTile[0], spawnTile[1])) > 34);
  if (!far.length) {
    far = [...floors].sort((a, b) =>
      tileCenter(b[0], b[1]).distanceTo(tileCenter(spawnTile[0], spawnTile[1])) -
      tileCenter(a[0], a[1]).distanceTo(tileCenter(spawnTile[0], spawnTile[1])));
  }
  const pick = far[randInt(Math.min(far.length, 10))] || far[0] || spawnTile;
  M.pos.copy(tileCenter(pick[0], pick[1]));
  M.state = 'roam';
  M.path = null;
  M.lastKnown = null;
  enemyMesh().position.copy(M.pos);
}

function monsterSpeed() {
  const bonus = S.map === 'village' ? 0.4 : 0;
  if (M.state === 'chase') return 4.4 + S.fuses * 0.3 + bonus;
  if (M.state === 'hunt') return 3.2 + S.fuses * 0.15 + bonus;
  return 2.1;
}

function setMonsterPath(ti, tj, interval) {
  const mi = Math.floor(M.pos.x / TILE), mj = Math.floor(M.pos.z / TILE);
  const p = bfsPath(mi, mj, ti, tj);
  if (p && p.length) { M.path = p; M.pathIndex = 0; }
  M.repathTimer = interval;
}

function updateMonster(dt) {
  const pt = [Math.floor(player.pos.x / TILE), Math.floor(player.pos.z / TILE)];
  const mt = [Math.floor(M.pos.x / TILE), Math.floor(M.pos.z / TILE)];
  const dist = Math.hypot(M.pos.x - player.pos.x, M.pos.z - player.pos.z);

  let detect = 9 + S.fuses * 2;
  if (S.flashlight && S.battery > 0) detect += 7;
  const sees = dist < detect && losTiles(mt[0], mt[1], pt[0], pt[1]);

  if (sees) {
    if (M.state !== 'chase') {
      if (S.map === 'village') { playHonk(1); setTimeout(() => playHonk(0.85), 260); }
      else playGrowl();
    }
    M.state = 'chase';
    M.chaseTimer = 4;
    M.lastKnown = [pt[0], pt[1]];
  } else if (M.state === 'chase') {
    M.chaseTimer -= dt;
    if (M.chaseTimer <= 0) M.state = 'hunt';
  }

  M.repathTimer -= dt;
  if (M.repathTimer <= 0) {
    if (M.state === 'chase' || M.state === 'hunt') {
      const goal = M.state === 'chase' ? pt : (M.lastKnown || pt);
      setMonsterPath(goal[0], goal[1], M.state === 'chase' ? 0.5 : 1.2);
    } else {
      if (!M.path || M.pathIndex >= M.path.length) {
        const t = floors[randInt(floors.length)];
        setMonsterPath(t[0], t[1], 1.5);
      } else M.repathTimer = 1.5;
    }
  }

  if (M.path && M.pathIndex < M.path.length) {
    const node = M.path[M.pathIndex];
    const dir = node.clone().sub(M.pos); dir.y = 0;
    const d = dir.length();
    if (d < 0.35) M.pathIndex++;
    else {
      dir.normalize();
      M.pos.addScaledVector(dir, monsterSpeed() * dt);
      enemyMesh().rotation.y = Math.atan2(dir.x, dir.z);
      M.walkPhase += dt * monsterSpeed() * 2.2;
    }
  }

  if (M.state === 'roam' && dist > 26) {
    M.farTimer += dt;
    if (M.farTimer > 11) {
      M.farTimer = 0;
      const spots = floors.filter(([i, j]) => {
        const c = tileCenter(i, j);
        const dd = c.distanceTo(player.pos);
        return dd > 12 && dd < 22 && !losTiles(i, j, pt[0], pt[1]);
      });
      if (spots.length) {
        const s = spots[randInt(spots.length)];
        M.pos.copy(tileCenter(s[0], s[1]));
        M.path = null;
      }
    }
  } else M.farTimer = 0;

  const em = enemyMesh();
  em.position.copy(M.pos);
  if (S.map === 'village') {
    em.position.y = Math.abs(Math.sin(M.walkPhase * 1.4)) * 0.14;
    em.rotation.z = Math.sin(M.walkPhase * 1.4) * 0.08;
    const flap = M.state === 'chase' ? Math.sin(S.time * 22) * 0.75 : Math.sin(S.time * 4) * 0.08;
    goose.userData.wings[0].rotation.z = 0.15 + flap;
    goose.userData.wings[1].rotation.z = -0.15 - flap;
  } else {
    em.position.y = Math.abs(Math.sin(M.walkPhase)) * 0.12;
  }

  if (dist < 1.1 && S.deathTimer < 0) {
    S.deathTimer = 0;
    jumpscareEl.classList.toggle('goose', S.map === 'village');
    jumpscareEl.classList.add('on');
    if (S.map === 'village') { playHonk(1.3); setTimeout(() => playHonk(1.15), 200); setTimeout(() => playHonk(0.95), 420); }
    else playScream();
  }
}

// ---------- Player ----------
const player = {
  pos: new THREE.Vector3((spawnTile[0] + 0.5) * TILE, EYE_HEIGHT, (spawnTile[1] + 0.5) * TILE),
  yaw: Math.PI * 0.75, pitch: 0,
  bobT: 0, stepT: 0, moving: false,
};

// ---------- Touch controls ----------
const touchInput = { moveId: null, lookId: null, moveX: 0, moveZ: 0, sprint: false, lookLast: { x: 0, y: 0 } };
const JOY_R = 46;
let joyCenter = { x: 0, y: 0 };

canvas.addEventListener('touchstart', (e) => {
  if (!S.playing) return;
  for (const t of e.changedTouches) {
    if (t.target.closest && t.target.closest('.tbtn')) continue;
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

document.getElementById('btn-flash').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (S.playing) toggleFlashlight();
}, { passive: false });

document.getElementById('btn-sprint').addEventListener('touchstart', (e) => {
  e.preventDefault();
  touchInput.sprint = !touchInput.sprint;
  e.currentTarget.classList.toggle('active', touchInput.sprint);
}, { passive: false });

function pauseGame() {
  S.playing = false;
  pauseOverlay.classList.remove('hidden');
}
document.getElementById('btn-pause').addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (S.playing) pauseGame();
}, { passive: false });

function checkOrientation() {
  if (!IS_TOUCH) return;
  const portrait = window.innerHeight > window.innerWidth;
  if (portrait) {
    rotateOverlay.classList.remove('hidden');
    if (S.playing) { S.pausedByRotate = true; S.playing = false; }
  } else {
    rotateOverlay.classList.add('hidden');
    if (S.pausedByRotate && S.started && !S.dead && !S.won) {
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
  if (e.code === 'KeyF' && S.playing) toggleFlashlight();
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousemove', (e) => {
  if (!S.playing) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});

function collides(x, z) {
  const r = PLAYER_RADIUS;
  for (const dx of [-r, r]) for (const dz of [-r, r]) {
    if (isWall(Math.floor((x + dx) / TILE), Math.floor((z + dz) / TILE))) return true;
  }
  return false;
}

function updatePlayer(dt) {
  const joyActive = touchInput.moveId !== null;
  const fwd = joyActive ? -touchInput.moveZ : ((keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0));
  const strafe = joyActive ? touchInput.moveX : ((keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0));
  const wantSprint = ((keys['ShiftLeft'] || keys['ShiftRight']) || touchInput.sprint) && S.stamina > 1 && (Math.abs(fwd) > 0.01 || Math.abs(strafe) > 0.01);
  const speed = wantSprint ? PLAYER_SPRINT : PLAYER_WALK;

  if (wantSprint) { S.stamina = Math.max(0, S.stamina - 24 * dt); S.staminaDelay = 1; }
  else {
    S.staminaDelay -= dt;
    if (S.staminaDelay <= 0) S.stamina = Math.min(100, S.stamina + 13 * dt);
  }

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

  camera.position.set(
    player.pos.x,
    EYE_HEIGHT + (player.moving ? Math.sin(player.bobT) * 0.05 : 0),
    player.pos.z
  );
  if (S.shake > 0) {
    camera.position.x += rand(-1, 1) * S.shake * 0.05;
    camera.position.y += rand(-1, 1) * S.shake * 0.05;
  }
  camera.rotation.set(player.pitch, player.yaw, 0);

  if (S.flashlight && S.battery > 0) {
    S.battery = Math.max(0, S.battery - dt * (100 / 80));
    if (S.battery <= 0) { S.flashlight = false; showMsg('Батарейка села...'); }
  }

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  flashlight.position.copy(camera.position).addScaledVector(dir, 0.3);
  flashlight.target.position.copy(camera.position).addScaledVector(dir, 10);
  playerLight.position.copy(camera.position);

  const near = M.pos.distanceTo(player.pos);
  const flickerChance = near < 12 ? 0.09 : 0.012;
  flashlight.intensity = 90;
  if (S.flashlight && S.battery > 0 && Math.random() < flickerChance * dt * 60) {
    flashlight.intensity *= rand(0.15, 0.6);
  }
  flashlight.visible = S.flashlight && S.battery > 0;
  playerLight.intensity = S.flashlight && S.battery > 0 ? 1.2 : 2.2;
}

function toggleFlashlight() {
  if (!S.flashlight && S.battery <= 0) { showMsg('Батарейка разряжена'); return; }
  S.flashlight = !S.flashlight;
  playClick();
}

// ---------- Items / exit ----------
function updateItems() {
  let nearItem = null, nearDist = 9;
  for (const it of items) {
    if (it.taken) continue;
    it.mesh.rotation.y += 0.02;
    it.mesh.position.y = it.baseY + Math.sin(S.time * 2.2 + it.phase) * 0.09;
    const dx = it.mesh.position.x - player.pos.x;
    const dz = it.mesh.position.z - player.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 3.5 * 3.5 && d2 < nearDist) {
      nearDist = d2;
      nearItem = it;
    }
    if (d2 < 1.7 * 1.7) {
      it.taken = true;
      it.mesh.visible = false;
      playPickup();
      if (it.type === 'fuse') {
        S.fuses++;
        fusesEl.textContent = `🔋 ${S.fuses} / ${FUSE_COUNT}`;
        if (S.fuses >= FUSE_COUNT) {
          S.exitOpen = true;
          doorGroup.userData.sign.color.setHex(0x20ff40);
          objectiveEl.textContent = 'Дверь открыта — БЕГИ К ВЫХОДУ!';
          showMsg('Все предохранители собраны. Выход разблокирован!');
          playDoorOpen();
        } else {
          showMsg(`Предохранитель ${S.fuses}/${FUSE_COUNT}. Оно стало злее...`);
          objectiveEl.textContent = S.fuses >= FUSE_COUNT - 2
            ? 'ОНО БЛИЗКО. Не оглядывайся. Найди выход!'
            : 'Найди 6 предохранителей и открой дверь';
        }
      } else {
        S.battery = Math.min(100, S.battery + 55);
        showMsg('Батарейка +55%');
      }
    }
  }

  if (nearItem && !S.won) {
    promptEl.textContent = nearItem.type === 'fuse' ? '🔋 ПРЕДОХРАНИТЕЛЬ — ПОДОЙДИ БЛИЖЕ' : '🔋 БАТАРЕЙКА — ПОДОЙДИ БЛИЖЕ';
    promptEl.style.opacity = nearDist < 1.7 * 1.7 ? 0 : 1;
  } else {
    promptEl.style.opacity = 0;
  }

  const dc = doorGroup.position;
  const dExit = Math.hypot(dc.x - player.pos.x, dc.z - player.pos.z);
  if (S.exitOpen && dExit < 1.6 && !S.won) {
    S.won = true;
    S.playing = false;
    const secs = Math.round(S.time);
    winStats.textContent = `Время: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · Предохранители: ${S.fuses}/${FUSE_COUNT}`;
    document.exitPointerLock();
    winOverlay.classList.remove('hidden');
    hud.classList.add('hidden');
  }
}

// ---------- HUD / FX ----------
let msgTimer = 0;
function showMsg(text) {
  msgEl.textContent = text;
  msgEl.style.opacity = 1;
  msgTimer = 3;
}

function updateFX(dt) {
  const dist = Math.hypot(M.pos.x - player.pos.x, M.pos.z - player.pos.z);
  const prox = clamp(1 - dist / 11, 0, 1);
  vignette.style.opacity = prox.toFixed(2);
  S.shake = prox * prox * (M.state === 'chase' ? 1.4 : 0.5);

  for (const L of flickerLights) {
    L.light.intensity = Math.random() < 0.05 ? L.base * rand(0.1, 0.6) : L.base;
  }

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.style.opacity = 0; }

  batteryFill.style.width = S.battery + '%';
  batteryFill.style.background = S.battery < 25 ? '#c62828' : '#e0b53a';
  staminaFill.style.width = S.stamina + '%';

  const beatRate = dist < 14 ? clamp(1.4 - dist / 14, 0.35, 1.2) : 0;
  updateHeartbeat(beatRate);
}

// ---------- Audio ----------
let AC = null, master = null, noiseBuf = null;
let heartTimer = 0;

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

  const g = AC.createGain();
  g.gain.value = 0.035;
  const filt = AC.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 220;
  const o1 = AC.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.value = 52;
  const o2 = AC.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = 52.7;
  o1.connect(filt); o2.connect(filt);
  filt.connect(g); g.connect(master);
  o1.start(); o2.start();
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
  g.gain.setValueAtTime(0.16, AC.currentTime);
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

function playPickup() {
  if (!AC) return;
  const o = AC.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(660, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(1320, AC.currentTime + 0.14);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.12, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.25);
  o.connect(g); g.connect(master);
  o.start(); o.stop(AC.currentTime + 0.26);
}

function playDoorOpen() {
  if (!AC) return;
  const o = AC.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(320, AC.currentTime + 0.8);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.25, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 1.0);
  o.connect(g); g.connect(master);
  o.start(); o.stop(AC.currentTime + 1.1);
}

function playGrowl() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(75, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 1.1);
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 400;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t); o.stop(t + 1.4);

  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const nf = AC.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 150;
  const ng = AC.createGain();
  ng.gain.setValueAtTime(0.001, t);
  ng.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  src.connect(nf); nf.connect(ng); ng.connect(master);
  src.start(t); src.stop(t + 1.4);
}

function playScream() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(850, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 1.1);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 1.25);

  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 900;
  const ng = AC.createGain();
  ng.gain.setValueAtTime(0.35, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
  src.connect(f); f.connect(ng); ng.connect(master);
  src.start(t); src.stop(t + 1.1);
}

function playHonk(pitch = 1) {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(430 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(290 * pitch, t + 0.22);
  const f = AC.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 850;
  f.Q.value = 2;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.28);
}

function playChew() {
  if (!AC) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rand(0.45, 0.75);
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(750, t);
  f.frequency.exponentialRampToValueAtTime(110, t + 0.18);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.32, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.25);

  const o = AC.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(72, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.15);
  const og = AC.createGain();
  og.gain.setValueAtTime(0.26, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(og); og.connect(master);
  o.start(t); o.stop(t + 0.2);
}

function updateHeartbeat(rate) {
  if (!AC || rate <= 0) { heartTimer = 0; return; }
  heartTimer -= 1 / 60;
  if (heartTimer <= 0) {
    heartTimer = rate;
    const t = AC.currentTime;
    for (const [off, vol] of [[0, 0.22], [0.14, 0.14]]) {
      const o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(58, t + off);
      o.frequency.exponentialRampToValueAtTime(32, t + off + 0.12);
      const g = AC.createGain();
      g.gain.setValueAtTime(0.001, t + off);
      g.gain.exponentialRampToValueAtTime(vol, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.16);
      o.connect(g); g.connect(master);
      o.start(t + off); o.stop(t + off + 0.2);
    }
  }
}

// ---------- Flow ----------
function startGame() {
  initAudio();
  if (AC && AC.state === 'suspended') AC.resume();
  if (builtMap !== S.map) buildWorld(S.map);

  S.fuses = 0;
  S.battery = 100;
  S.flashlight = true;
  S.stamina = 100;
  S.exitOpen = false;
  S.time = 0;
  S.deathTimer = -1;
  S.dead = false;
  S.won = false;
  touchInput.sprint = false;
  document.getElementById('btn-sprint').classList.remove('active');
  fusesEl.textContent = `🔋 0 / ${FUSE_COUNT}`;
  objectiveEl.textContent = 'Найди 6 предохранителей и открой дверь';
  doorGroup.userData.sign.color.setHex(0xff2020);
  for (const it of items) { it.taken = false; it.mesh.visible = true; }

  menuOverlay.classList.add('hidden');
  deathOverlay.classList.add('hidden');
  winOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  S.started = true;

  if (IS_TOUCH) {
    S.playing = true;
    S.startTime = performance.now();
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
document.getElementById('retry-btn').addEventListener('click', () => location.reload());
document.getElementById('again-btn').addEventListener('click', () => location.reload());
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
  if (S.dead) return;
  if (locked) {
    S.playing = true;
    pauseOverlay.classList.add('hidden');
    if (!S.startTime) S.startTime = performance.now();
  } else if (S.started && !S.won && S.deathTimer < 0) {
    S.playing = false;
    pauseOverlay.classList.remove('hidden');
  }
});

function startEating() {
  jumpscareEl.classList.remove('on');
  S.chewT = 0;
  playChew();
}

function updateEating(dt) {
  const t = S.deathTimer - 0.85;
  const fall = clamp(t / 0.5, 0, 1);

  const dir = M.pos.clone().sub(player.pos); dir.y = 0;
  if (dir.length() > 1.05) M.pos.addScaledVector(dir.normalize(), 2.5 * dt);
  const em = enemyMesh();
  em.position.set(M.pos.x, Math.sin(t * 13) * 0.1, M.pos.z);
  em.rotation.y = Math.atan2(player.pos.x - M.pos.x, player.pos.z - M.pos.z);
  em.rotation.x = 0.45 + Math.sin(t * 13) * 0.28;

  camera.position.set(
    player.pos.x + rand(-1, 1) * 0.06,
    EYE_HEIGHT - fall * 1.2 + rand(-1, 1) * 0.05,
    player.pos.z + rand(-1, 1) * 0.06
  );
  camera.lookAt(M.pos.x, 1.6, M.pos.z);
  camera.rotation.z += 0.55 * fall;

  damageFlash.style.opacity = clamp(t / 2.2, 0, 0.85).toFixed(2);

  S.chewT -= dt;
  if (S.chewT <= 0) {
    S.chewT = rand(0.32, 0.55);
    if (S.map === 'village') playHonk(rand(0.8, 1.3));
    else playChew();
  }
  updateHeartbeat(0.32);
}

function die() {
  S.dead = true;
  S.playing = false;
  jumpscareEl.classList.remove('on');
  S.shake = 0;
  const secs = Math.round(S.time);
  setTimeout(() => {
    document.exitPointerLock();
    deathOverlay.querySelector('h1').textContent = S.map === 'village' ? 'ГУСЬ ТЕБЯ ЗАКЛЕВАЛ' : 'ОН СЪЕЛ ТЕБЯ';
    deathStats.textContent = `Карта: ${MAPS[S.map].name} · Предохранители: ${S.fuses}/${FUSE_COUNT} · Время: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    deathOverlay.classList.remove('hidden');
    hud.classList.add('hidden');
    damageFlash.style.opacity = 0;
  }, 300);
}

// ---------- Main loop ----------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  if (S.started) {
    if (S.playing) S.time += dt;

    if (S.deathTimer >= 0 && !S.dead) {
      S.deathTimer += dt;
      if (S.deathTimer < 0.85) {
        const dir = M.pos.clone().sub(camera.position); dir.y = 0;
        if (dir.length() > 0.4) M.pos.addScaledVector(dir.normalize(), 9 * dt);
        enemyMesh().position.copy(M.pos);
        camera.rotation.set(0, Math.atan2(dir.x, dir.z) + Math.PI, 0);
        if (S.deathTimer >= 0.84) startEating();
      } else {
        updateEating(dt);
        if (S.deathTimer > 3.5) die();
      }
    } else if (S.playing) {
      updatePlayer(dt);
      updateMonster(dt);
      updateItems();
      updateFX(dt);
    } else {
      camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      flashlight.position.copy(camera.position);
      flashlight.target.position.copy(camera.position).addScaledVector(
        new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation), 10);
      playerLight.position.copy(camera.position);
    }
  }

  renderer.render(scene, camera);
}

buildWorld('yard');

camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
camera.rotation.set(0, player.yaw, 0);
flashlight.position.copy(camera.position);
flashlight.target.position.set(player.pos.x, EYE_HEIGHT, player.pos.z - 10);
playerLight.position.copy(camera.position);
flashlight.visible = false;

setTimeout(checkOrientation, 0);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 120));

requestAnimationFrame(loop);
window.__gameBooted = true;
