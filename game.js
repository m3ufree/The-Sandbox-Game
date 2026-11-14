import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ============================================================
//  THE MONSTER — 3D horror
// ============================================================

const TILE = 4;
const COLS = 14, ROWS = 14;
const GW = COLS * 2 + 1, GH = ROWS * 2 + 1;
const WALL_H = 4.2;
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
const joyBase = document.getElementById('joy-base');
const joyKnob = document.getElementById('joy-knob');

// ---------- Game state ----------
const S = {
  started: false, playing: false, dead: false, won: false,
  time: 0, startTime: 0,
  battery: 100, flashlight: true,
  stamina: 100, staminaDelay: 0,
  fuses: 0, exitOpen: false,
  deathTimer: -1, shake: 0,
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(IS_TOUCH ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2));
if (IS_TOUCH) document.body.classList.add('touch');
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.085);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 120);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
setTimeout(checkOrientation, 0);

// ---------- Maze ----------
const grid = new Uint8Array(GW * GH).fill(1);
const idx = (i, j) => j * GW + i;
const isWall = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? true : grid[idx(i, j)] === 1;

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
  for (let k = 0; k < 26; k++) {
    const i = 1 + randInt(GW - 2), j = 1 + randInt(GH - 2);
    if (grid[idx(i, j)] === 1 && ((i % 2 === 0) !== (j % 2 === 0))) grid[idx(i, j)] = 0;
  }
}
generateMaze();

const floors = [];
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (!isWall(i, j)) floors.push([i, j]);
const tileCenter = (i, j) => new THREE.Vector3((i + 0.5) * TILE, 0, (j + 0.5) * TILE);

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

// ---------- Scene build ----------
const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.95, metalness: 0.02 });
const wallCount = grid.reduce((a, v) => a + v, 0);
const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
{
  const m = new THREE.Matrix4();
  let n = 0;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (grid[idx(i, j)] !== 1) continue;
    m.setPosition((i + 0.5) * TILE, WALL_H / 2, (j + 0.5) * TILE);
    walls.setMatrixAt(n++, m);
  }
}
scene.add(walls);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(GW * TILE, GH * TILE),
  new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(GW * TILE / 2, 0, GH * TILE / 2);
scene.add(floor);

const ceil = new THREE.Mesh(
  new THREE.PlaneGeometry(GW * TILE, GH * TILE),
  new THREE.MeshStandardMaterial({ color: 0x0d0d0c, roughness: 1 })
);
ceil.rotation.x = Math.PI / 2;
ceil.position.set(GW * TILE / 2, WALL_H, GH * TILE / 2);
scene.add(ceil);

scene.add(new THREE.AmbientLight(0x223344, 0.12));

const playerLight = new THREE.PointLight(0x556677, 2.2, 9, 1.6);
scene.add(playerLight);

const flashlight = new THREE.SpotLight(0xfff2d0, 90, 40, 0.46, 0.45, 1.5);
flashlight.visible = true;
scene.add(flashlight);
scene.add(flashlight.target);

// ---------- Items ----------
const itemGroup = new THREE.Group();
scene.add(itemGroup);

function makeFuse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.36, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a6a1a, emissive: 0xcc9a10, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const light = new THREE.PointLight(0xffc840, 3.5, 6, 1.8);
  g.add(light);
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

const spawnTile = [1, 1];
const exitTile = [GW - 2, GH - 2];

function deadEnds() {
  return floors.filter(([i, j]) => {
    if ((i === spawnTile[0] && j === spawnTile[1]) || (i === exitTile[0] && j === exitTile[1])) return false;
    let w = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWall(i + di, j + dj)) w++;
    return w >= 3;
  });
}

const items = [];
{
  const candidates = deadEnds().sort(() => Math.random() - 0.5);
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length >= FUSE_COUNT + 4) break;
    if (chosen.every(o => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) > 8)) chosen.push(c);
  }
  while (chosen.length < FUSE_COUNT + 4) chosen.push(candidates[randInt(candidates.length)]);

  for (let k = 0; k < FUSE_COUNT; k++) {
    const mesh = makeFuse();
    const [i, j] = chosen[k];
    mesh.position.copy(tileCenter(i, j)).setY(0.9);
    itemGroup.add(mesh);
    items.push({ type: 'fuse', mesh, taken: false });
  }
  for (let k = 0; k < 4; k++) {
    const mesh = makeBattery();
    const [i, j] = chosen[FUSE_COUNT + k];
    mesh.position.copy(tileCenter(i, j)).setY(0.75);
    mesh.rotation.z = Math.PI / 2;
    itemGroup.add(mesh);
    items.push({ type: 'battery', mesh, taken: false });
  }
}

// ---------- Exit door ----------
const doorGroup = new THREE.Group();
{
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.7, WALL_H * 0.75, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85 })
  );
  door.position.y = WALL_H * 0.375;
  doorGroup.add(door);
  const sign = new THREE.PointLight(0xff2020, 4, 10, 1.8);
  sign.position.set(0, WALL_H - 0.6, 0.5);
  doorGroup.add(sign);
  doorGroup.userData.sign = sign;
  const c = tileCenter(exitTile[0], exitTile[1]);
  doorGroup.position.set(c.x, 0, c.z);
  scene.add(doorGroup);
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
  eyeL.position.set(-0.11, 2.42, 0.26);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.11, 2.42, 0.26);
  monster.add(eyeL, eyeR);
  const eyeGlow = new THREE.PointLight(0xff2020, 1.6, 7, 1.8);
  eyeGlow.position.set(0, 2.4, 0.3);
  monster.add(eyeGlow);
}
scene.add(monster);

const M = {
  pos: new THREE.Vector3(), state: 'roam', path: null, pathIndex: 0,
  repathTimer: 0, chaseTimer: 0, farTimer: 0, target: null, walkPhase: 0,
};
function monsterSpawn() {
  const far = floors.filter(([i, j]) => {
    const c = tileCenter(i, j);
    return c.distanceTo(tileCenter(spawnTile[0], spawnTile[1])) > 34;
  });
  const pick = far.length ? far[randInt(far.length)] : floors[floors.length - 1];
  M.pos.copy(tileCenter(pick[0], pick[1]));
  monster.position.copy(M.pos);
}
monsterSpawn();

function monsterSpeed() {
  if (M.state === 'chase') return 4.4 + S.fuses * 0.3;
  if (M.state === 'hunt') return 3.2 + S.fuses * 0.15;
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
  const dist = M.pos.distanceTo(player.pos);

  let detect = 9 + S.fuses * 2;
  if (S.flashlight && S.battery > 0) detect += 7;
  const sees = dist < detect && losTiles(mt[0], mt[1], pt[0], pt[1]);

  if (sees) {
    if (M.state !== 'chase') playGrowl();
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
      monster.rotation.y = Math.atan2(dir.x, dir.z);
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

  monster.position.copy(M.pos);
  monster.position.y = Math.abs(Math.sin(M.walkPhase)) * 0.12;

  if (dist < 1.15 && S.deathTimer < 0) {
    S.deathTimer = 0;
    playScream();
  }
}

// ---------- Player ----------
const player = {
  pos: tileCenter(spawnTile[0], spawnTile[1]),
  yaw: Math.PI * 0.75, pitch: 0,
  bobT: 0, stepT: 0, moving: false,
};
player.pos.y = EYE_HEIGHT;

camera.position.set(player.pos.x, EYE_HEIGHT, player.pos.z);
camera.rotation.set(0, player.yaw, 0);
flashlight.position.copy(camera.position);
flashlight.target.position.set(player.pos.x, EYE_HEIGHT, player.pos.z - 10);
playerLight.position.copy(camera.position);

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
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 120));

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
  for (const it of items) {
    if (it.taken) continue;
    it.mesh.rotation.y += 0.02;
    if (it.mesh.position.distanceTo(camera.position) < 1.35) {
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
  const dist = M.pos.distanceTo(player.pos);
  const prox = clamp(1 - dist / 11, 0, 1);
  vignette.style.opacity = prox.toFixed(2);
  S.shake = prox * prox * (M.state === 'chase' ? 1.4 : 0.5);

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.style.opacity = 0; }

  batteryFill.style.width = S.battery + '%';
  batteryFill.style.background = S.battery < 25 ? '#b30000' : '#d8b23a';
  staminaFill.style.width = S.stamina + '%';

  const beatRate = dist < 14 ? clamp(1.4 - dist / 14, 0.35, 1.2) : 0;
  updateHeartbeat(beatRate);
}

// ---------- Audio (WebAudio, no assets) ----------
let AC = null, master = null, droneNodes = null, noiseBuf = null;
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
  droneNodes = { o1, o2, g };
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
  menuOverlay.classList.add('hidden');
  deathOverlay.classList.add('hidden');
  winOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
  S.started = true;
  if (IS_TOUCH) {
    S.playing = true;
    if (!S.startTime) S.startTime = performance.now();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return;
  }
  S.playing = false;
  canvas.requestPointerLock();
}

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

function die() {
  S.dead = true;
  S.playing = false;
  damageFlash.style.opacity = 0.9;
  const secs = Math.round(S.time);
  setTimeout(() => {
    document.exitPointerLock();
    deathStats.textContent = `Предохранители: ${S.fuses}/${FUSE_COUNT} · Время: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    deathOverlay.classList.remove('hidden');
    hud.classList.add('hidden');
    damageFlash.style.opacity = 0;
  }, 900);
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
      const dir = M.pos.clone().sub(camera.position); dir.y = 0;
      if (dir.length() > 0.4) M.pos.addScaledVector(dir.normalize(), 9 * dt);
      monster.position.copy(M.pos);
      const look = Math.atan2(dir.x, dir.z);
      camera.rotation.set(0, look + Math.PI, 0);
      if (S.deathTimer > 0.85) die();
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
requestAnimationFrame(loop);
window.__gameBooted = true;
