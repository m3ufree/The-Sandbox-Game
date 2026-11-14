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
const promptEl = document.getElementById('prompt');
const btnCar = document.getElementById('btn-car');

// ---------- Game state ----------
const S = {
  map: 'yard',
  started: false, playing: false,
  sel: 0, night: false,
  shakeT: 0, pausedByRotate: false,
  driving: null,
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
};

const spawnTile = [1, 1];

const grid = new Uint8Array(GW * GH);
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
  const wallTiles = [], fenceTiles = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const v = grid[idx(i, j)];
    if (v === 1) wallTiles.push([i, j]);
    else if (v === 3) fenceTiles.push([i, j]);
  }

  if (map === 'forest') {
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
    return;
  }

  if (map === 'yard') {
    const wallGeo = new THREE.BoxGeometry(TILE, cfg.wallH, TILE);
    const wallMat = new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: 0.95 });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallTiles.length);
    const m = new THREE.Matrix4();
    wallTiles.forEach(([i, j], n2) => {
      m.setPosition((i + 0.5) * TILE, cfg.wallH / 2, (j + 0.5) * TILE);
      walls.setMatrixAt(n2, m);
    });
    worldGroup.add(walls);
    return;
  }

  if (map === 'city') {
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
    return;
  }

  if (map === 'village') buildFences(fenceTiles);
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

function addYardProps() {
  const spots = floors.filter(([i, j]) => Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 8);
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

function addCityProps() {
  const spots = floors.filter(([i, j]) => Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 8);
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

function addVillageProps() {
  const inHouse = (i, j) => houseRects.some(r => i >= r.hi && i < r.hi + r.w && j >= r.hj && j < r.hj + r.d);
  const spots = floors.filter(([i, j]) =>
    Math.abs(i - spawnTile[0]) + Math.abs(j - spawnTile[1]) > 6 && !inHouse(i, j)
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
  if (map === 'village') buildVillageHouses();
  if (map === 'yard') addYardProps();
  if (map === 'city') addCityProps();
  if (map === 'village') addVillageProps();

  spawnedGroup = new THREE.Group();
  worldGroup.add(spawnedGroup);
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
  vy: 0, onGround: true,
};

const carState = { heading: 0, prevFwd: 0 };
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
  if (!S.playing) return;
  if (e.code === 'KeyF') toggleFlashlight();
  if (e.code === 'KeyT') toggleDayNight();
  if (e.code === 'KeyX') deleteAimed();
  if (e.code === 'KeyE') { if (S.driving) exitCar(); else { const c = nearestCar(); if (c) enterCar(c); } }
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
  if (!S.playing || S.driving) return;
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

const CATALOG = [
  { id: 'box', name: 'ЯЩИК', icon: '📦', build: buildBox },
  { id: 'barrel', name: 'БОЧКА', icon: '🛢️', build: buildBarrel },
  { id: 'car', name: 'МАШИНА', icon: '🚗', build: buildCar, drive: true },
  { id: 'tree', name: 'ДЕРЕВО', icon: '🌳', build: buildTree },
  { id: 'lamp', name: 'ФОНАРЬ', icon: '🏮', build: buildLamp },
  { id: 'hay', name: 'СТОГ', icon: '🌾', build: buildHay },
  { id: 'well', name: 'КОЛОДЕЦ', icon: '⛲', build: buildWell },
  { id: 'tnt', name: 'ТНТ', icon: '💥', build: buildTnt, tnt: true },
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
  if (S.driving) return;
  const def = CATALOG[S.sel];
  const mesh = def.build();
  const dir = forwardFlat();
  mesh.position.set(player.pos.x + dir.x * 3, 0, player.pos.z + dir.z * 3);
  mesh.rotation.y = player.yaw + Math.PI;
  spawnedGroup.add(mesh);
  objects.push({ mesh, vel: new THREE.Vector3(), tnt: !!def.tnt, type: def.drive ? 'car' : 'prop', id: def.id });
  playPop();
}

function removeObject(obj) {
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
      if (o.type === 'car') o.av = rand(-3, 3);
    }
  }
}

function updatePhysics(dt) {
  for (const o of objects) {
    if (S.driving === o) continue;
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
  player.pos.set(obj.mesh.position.x, EYE_HEIGHT, obj.mesh.position.z);
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
    xml += ' ry="' + o.mesh.rotation.y.toFixed(3) + '"/>\n';
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
    objects.push({ mesh, vel: new THREE.Vector3(), tnt: !!def.tnt, type: def.drive ? 'car' : 'prop', id: def.id });
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
    ? '➕ поставить · 🗑️ удалить · 🚗 машина · 🌓 день/ночь'
    : 'ЛКМ — поставить · ПКМ/X — удалить · E — машина · Space — прыжок · T — день/ночь';
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
        if (near) {
          promptEl.textContent = IS_TOUCH ? '🚗 — сесть в машину' : 'E — сесть в машину';
          promptEl.style.opacity = 1;
        } else if (promptEl.style.opacity) {
          promptEl.style.opacity = 0;
        }
        btnCar.classList.toggle('nearest', !!near || !!S.driving);
      }
      updatePhysics(dt);
      updateFX(dt);
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
