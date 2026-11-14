import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
//  THE SANDBOX GAME — maps: yard / forest / city / village
// ============================================================

const TILE = 4;
const COLS = 14, ROWS = 14;
const GW = COLS * 2 + 1, GH = ROWS * 2 + 1;

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
const hotbarEl = document.getElementById('hotbar');
const menuOverlay = document.getElementById('menu-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const rotateOverlay = document.getElementById('rotate-overlay');
const joyBase = document.getElementById('joy-base');
const joyKnob = document.getElementById('joy-knob');

// ---------- Game state ----------
const S = {
  map: 'yard',
  started: false, playing: false,
  sel: 0, night: false,
  shakeT: 0, pausedByRotate: false,
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
};

const spawnTile = [1, 1];

const grid = new Uint8Array(GW * GH);
const idx = (i, j) => j * GW + i;
const isWall = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? true : grid[idx(i, j)] === 1;
let floors = [];
let worldGroup = null;
let spawnedGroup = null;
let objects = [];
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
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const i = spawnTile[0] + a, j = spawnTile[1] + b;
      if (i > 0 && j > 0 && i < GW - 1 && j < GH - 1) grid[idx(i, j)] = 0;
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
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
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
      const s = rand(0.8, 1.35);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(c.x + ox, (cfg.wallH / 2) * s, c.z + oz);
      trunk.scale.set(s, s, s);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(c.x + ox, cfg.wallH * s + 1.1 * s, c.z + oz);
      leaf.scale.set(s, s, s);
      worldGroup.add(trunk, leaf);
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
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1e3320, emissive: 0x2fbf2f, emissiveIntensity: 0.4, roughness: 0.6 });
  for (let k = 0; k < 8 && k < spots.length; k++) {
    const c = tileCenter(spots[k][0], spots[k][1]);
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(c.x + rand(-1.1, 1.1), 0.48, c.z + rand(-1.1, 1.1));
    worldGroup.add(b);
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
  if (map === 'yard') addYardProps();
  if (map === 'city') addCityProps();
  if (map === 'village') addVillageProps();

  spawnedGroup = new THREE.Group();
  worldGroup.add(spawnedGroup);
  objects = [];
  lampLights = 0;

  scene.add(worldGroup);
  scene.fog = new THREE.FogExp2(cfg.fog, cfg.fogD);
  scene.background = new THREE.Color(cfg.fog);
  applyAtmosphere();

  player.pos.copy(tileCenter(spawnTile[0], spawnTile[1]));
  player.pos.y = EYE_HEIGHT;
  player.yaw = Math.PI * 0.75;
  player.pitch = 0;
  builtMap = map;
}

// ---------- Player ----------
const player = {
  pos: new THREE.Vector3((spawnTile[0] + 0.5) * TILE, EYE_HEIGHT, (spawnTile[1] + 0.5) * TILE),
  yaw: Math.PI * 0.75, pitch: 0,
  bobT: 0, stepT: 0, moving: false,
};

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
  if (!S.playing) return;
  if (e.code === 'KeyF') toggleFlashlight();
  if (e.code === 'KeyT') toggleDayNight();
  if (e.code === 'KeyX') deleteAimed();
  const digit = e.code.match(/^Digit([1-8])$/);
  if (digit) selectSlot(parseInt(digit[1], 10) - 1);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousemove', (e) => {
  if (!S.playing) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});

canvas.addEventListener('mousedown', (e) => {
  if (!S.playing) return;
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

  camera.position.set(
    player.pos.x,
    EYE_HEIGHT + (player.moving ? Math.sin(player.bobT) * 0.05 : 0),
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
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 })
  );
  m.position.y = 0.5;
  g.add(m);
  return g;
}

function buildBarrel() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.0, 12),
    new THREE.MeshStandardMaterial({ color: 0x274027, roughness: 0.6, metalness: 0.3 })
  );
  m.position.y = 0.5;
  g.add(m);
  return g;
}

function buildCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.75, 4.2),
    new THREE.MeshStandardMaterial({ color: [0x8a2020, 0x204a8a, 0x2c2c2c, 0x8a7a20][randInt(4)], roughness: 0.4, metalness: 0.5 })
  );
  body.position.y = 0.45;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.3, metalness: 0.5 })
  );
  top.position.set(0, 1.0, -0.2);
  g.add(body, top);
  return g;
}

function buildTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.3, 2.6, 7),
    new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1 })
  );
  trunk.position.y = 1.3;
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 3.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d5a22, roughness: 1 })
  );
  leaf.position.y = 3.8;
  g.add(trunk, leaf);
  return g;
}

function buildLamp() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), mat);
  pole.position.y = 1.5;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), mat);
  head.position.y = 3.02;
  g.add(pole, head);
  if (lampLights < 12) {
    const light = new THREE.PointLight(0xffb060, 9, 13, 1.8);
    light.position.y = 2.85;
    g.add(light);
    lampLights++;
  }
  return g;
}

function buildHay() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.0, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xb8963a, roughness: 1 })
  );
  m.position.y = 0.5;
  m.rotation.y = rand(0, Math.PI);
  g.add(m);
  return g;
}

function buildWell() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.0, 0.9, 10),
    new THREE.MeshStandardMaterial({ color: 0x7a7a76, roughness: 0.9 })
  );
  m.position.y = 0.45;
  g.add(m);
  return g;
}

function buildTnt() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.0, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a1a1a, emissive: 0xaa2010, emissiveIntensity: 0.35, roughness: 0.5 })
  );
  m.position.y = 0.5;
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8c090 })
  );
  fuse.position.y = 1.1;
  g.add(m, fuse);
  return g;
}

const CATALOG = [
  { name: 'ЯЩИК', icon: '📦', build: buildBox },
  { name: 'БОЧКА', icon: '🛢️', build: buildBarrel },
  { name: 'МАШИНА', icon: '🚗', build: buildCar },
  { name: 'ДЕРЕВО', icon: '🌳', build: buildTree },
  { name: 'ФОНАРЬ', icon: '🏮', build: buildLamp },
  { name: 'СТОГ', icon: '🌾', build: buildHay },
  { name: 'КОЛОДЕЦ', icon: '⛲', build: buildWell },
  { name: 'ТНТ', icon: '💥', build: buildTnt, tnt: true },
];

function buildHotbar() {
  hotbarEl.innerHTML = '';
  CATALOG.forEach((def, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === S.sel ? ' sel' : '');
    slot.innerHTML = `${def.icon}<span>${def.name}</span>`;
    slot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      selectSlot(i);
    });
    hotbarEl.appendChild(slot);
  });
}

function selectSlot(i) {
  S.sel = i;
  [...hotbarEl.children].forEach((el, k) => el.classList.toggle('sel', k === i));
}

function spawnSelected() {
  const def = CATALOG[S.sel];
  const mesh = def.build();
  const dir = forwardFlat();
  mesh.position.set(player.pos.x + dir.x * 3, 0, player.pos.z + dir.z * 3);
  mesh.rotation.y = player.yaw + Math.PI;
  spawnedGroup.add(mesh);
  objects.push({ mesh, vel: new THREE.Vector3(), tnt: !!def.tnt });
  playPop();
}

function removeObject(obj) {
  const i = objects.indexOf(obj);
  if (i === -1) return;
  objects.splice(i, 1);
  spawnedGroup.remove(obj.mesh);
  obj.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
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
  if (!obj) return;
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
  if (!best) return;
  if (best.tnt) explode(best);
  else { removeObject(best); playPoof(); }
}

function explode(obj) {
  const p = obj.mesh.position.clone();
  removeObject(obj);
  playBoom();
  S.shakeT = 0.6;
  const flash = new THREE.PointLight(0xffa040, 80, 28, 1.5);
  flash.position.copy(p).setY(1.5);
  worldGroup.add(flash);
  setTimeout(() => { if (worldGroup) worldGroup.remove(flash); }, 160);
  for (const o of [...objects]) {
    const d = o.mesh.position.distanceTo(p);
    if (d < 8) {
      const dir = o.mesh.position.clone().sub(p).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1));
      dir.normalize();
      const power = 1 - d / 8;
      o.vel.addScaledVector(dir, 13 * power);
      o.vel.y += 7 * power;
    }
  }
}

function updatePhysics(dt) {
  for (const o of objects) {
    if (o.vel.lengthSq() < 0.0001) continue;
    o.vel.y -= 18 * dt;
    o.mesh.position.addScaledVector(o.vel, dt);
    if (o.mesh.position.y < 0) {
      o.mesh.position.y = 0;
      o.vel.y *= -0.35;
      o.vel.x *= 0.7;
      o.vel.z *= 0.7;
      if (o.vel.lengthSq() < 0.05) o.vel.set(0, 0, 0);
    }
  }
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
    ? '➕ поставить · 🗑️ удалить · 🌓 день/ночь'
    : 'ЛКМ — поставить · ПКМ/X — удалить · T — день/ночь';
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
      updatePlayer(dt);
      updatePhysics(dt);
      updateFX(dt);
    } else {
      camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      flashlight.position.copy(camera.position);
      flashlight.target.position.copy(camera.position).addScaledVector(dir, 10);
      playerLight.position.copy(camera.position);
    }
  }

  renderer.render(scene, camera);
}

buildHotbar();
buildWorld('yard');

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
