/* ============================================================
   GLIMMERBONK — engine
   A Megabonk-style 2D auto-shooter roguelite.
   Pure canvas + vanilla JS. No build step.
   ============================================================ */
'use strict';

/* ----------------------------- helpers ----------------------------- */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const now = () => performance.now();

/* ----------------------------- save data ----------------------------- */
const SAVE_KEY = 'glimmerbonk_save_v1';
const Save = {
  data: null,
  defaults() {
    return {
      glimmer: 0,
      totalGlimmer: 0,
      totalKills: 0,
      unlocked: ['bronte', 'pip', 'volt'],
      achievements: {},
      shop: {},          // id -> level
      bestTime: 0,
      bestLevel: 0,
      lastChar: 'bronte',
      muted: false,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    return this.data;
  },
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) {} },
  shopLevel(id) { return this.data.shop[id] || 0; },
};

/* ----------------------------- audio (tiny synth) ----------------------------- */
const Audio2 = {
  ctx: null,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } },
  blip(freq = 440, dur = 0.06, type = 'square', vol = 0.05) {
    if (Save.data.muted || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  },
  shoot() { this.blip(660, 0.04, 'square', 0.025); },
  hit() { this.blip(180, 0.05, 'sawtooth', 0.03); },
  level() { this.blip(880, 0.12, 'triangle', 0.06); setTimeout(() => this.blip(1180, 0.12, 'triangle', 0.06), 90); },
  hurt() { this.blip(120, 0.18, 'sawtooth', 0.06); },
  pickup() { this.blip(1040, 0.03, 'sine', 0.02); },
  boss() { this.blip(80, 0.5, 'sawtooth', 0.08); },
};

/* ----------------------------- core state ----------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, zoom = 1;

const Game = {
  state: 'menu',     // menu | playing | levelup | gameover | paused
  t: 0,              // run time (seconds)
  dt: 0,
  char: null,
  player: null,
  enemies: [], bullets: [], ebullets: [], gems: [], coins: [], particles: [], floaters: [],
  spawnTimer: 0,
  nextBoss: CONFIG.bossEvery,
  biomeIndex: 0,
  nextBiome: CONFIG.biomeEvery,
  cam: { x: 0, y: 0, shake: 0 },
  killCount: 0,
  glimmerRun: 0,
  paused: false,
  pendingPerks: null,
  bossActive: null,
  noHit: true,
  runId: 0,
};

/* input vector from keyboard + touch joystick */
const Input = { keys: {}, joy: { x: 0, y: 0, active: false } };
addEventListener('keydown', e => {
  Input.keys[e.key.toLowerCase()] = true;
  if (e.key === 'Escape') togglePause();
  if (e.key === 'Shift') triggerDash();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
});
addEventListener('keyup', e => { Input.keys[e.key.toLowerCase()] = false; });

function moveVector() {
  let x = 0, y = 0;
  const k = Input.keys;
  if (k['w'] || k['arrowup']) y -= 1;
  if (k['s'] || k['arrowdown']) y += 1;
  if (k['a'] || k['arrowleft']) x -= 1;
  if (k['d'] || k['arrowright']) x += 1;
  if (Input.joy.active) { x += Input.joy.x; y += Input.joy.y; }
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y };
}

/* ----------------------------- resize / DPR ----------------------------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // keep visible world area roughly constant across devices
  const minDim = Math.min(W, H);
  zoom = clamp(minDim / 760, 0.62, 1.5);
}
addEventListener('resize', resize);

/* ----------------------------- player factory ----------------------------- */
function freshStats() {
  return {
    damage: 1, fireRateMult: 1, projectileSpeedMult: 1, projectileCount: 0,
    pierce: 0, area: 1, moveSpeedMult: 1, maxHpBonus: 0, regen: 0,
    magnet: 1, critChance: 0, critMult: 1.5, xpMult: 1, glimmerMult: 1,
  };
}

function makePlayer(charDef) {
  const s = freshStats();
  // merge character intrinsic stats
  Object.assign(s, charDef.stats || {});
  // apply meta-shop permanent upgrades
  let baseHp = charDef.maxHp;
  let armor = charDef.armor || 0;
  let revives = 0;
  for (const item of SHOP) {
    const lvl = Save.shopLevel(item.id);
    if (!lvl) continue;
    const total = item.val * lvl;
    if (item.key === 'maxHpBonus') baseHp += total;
    else if (item.key === 'armor') armor += total;
    else if (item.key === 'revives') revives += total;
    else if (s[item.key] !== undefined) s[item.key] += total;
  }
  const p = {
    x: 0, y: 0, vx: 0, vy: 0,
    radius: 16,
    maxHp: baseHp, hp: baseHp,
    armor,
    revives,
    speed: 230 * charDef.speed,
    stats: s,
    weapons: [],
    level: 1, xp: 0, xpNext: 6,
    invuln: 0,
    color: charDef.color, accent: charDef.accent,
    facing: 0,
    hurtFlash: 0,
    dashCd: 0, dashT: 0,
  };
  addWeapon(p, charDef.weapon);
  return p;
}

function addWeapon(p, key) {
  if (p.weapons.some(w => w.key === key)) return;
  const def = WEAPONS[key];
  p.weapons.push({ key, def, cd: 0, angle: 0 });
}

/* ----------------------------- start / reset run ----------------------------- */
function startRun(charId) {
  const c = CHARACTERS.find(c => c.id === charId);
  Game.char = c;
  Save.data.lastChar = charId; Save.save();
  Game.player = makePlayer(c);
  Game.enemies.length = 0; Game.bullets.length = 0; Game.ebullets.length = 0;
  Game.gems.length = 0; Game.coins.length = 0; Game.particles.length = 0; Game.floaters.length = 0;
  Game.t = 0; Game.spawnTimer = 0; Game.nextBoss = CONFIG.bossEvery;
  Game.biomeIndex = 0; Game.nextBiome = CONFIG.biomeEvery;
  Game.cam.x = 0; Game.cam.y = 0; Game.cam.shake = 0;
  Game.killCount = 0; Game.glimmerRun = 0; Game.bossActive = null; Game.noHit = true;
  Game.runId++;
  Game.state = 'playing'; Game.paused = false;
  Audio2.init();
  hideAllScreens();
  document.body.classList.add('in-game');
  updateHUD();
}

/* ----------------------------- spawning ----------------------------- */
function spawnRadius() { return Math.hypot(W, H) / 2 / zoom + 80; }

function spawnEnemy(typeKey, overridePos) {
  const def = ENEMIES[typeKey];
  if (!def) return;
  let x, y;
  if (overridePos) { x = overridePos.x; y = overridePos.y; }
  else {
    const a = rand(0, TAU), r = spawnRadius();
    x = Game.player.x + Math.cos(a) * r;
    y = Game.player.y + Math.sin(a) * r;
  }
  const diffHp = 1 + Game.t * 0.012 + Math.floor(Game.t / 60) * 0.25;
  const diffDmg = 1 + Game.t * 0.006;
  Game.enemies.push({
    type: typeKey, def,
    x, y, vx: 0, vy: 0,
    hp: def.hp * diffHp, maxHp: def.hp * diffHp,
    radius: def.radius,
    speed: def.speed,
    dmg: def.dmg * diffDmg,
    armor: def.armor || 0,
    color: def.color,
    xp: def.xp, glimmer: def.glimmer,
    boss: false,
    hitFlash: 0, wob: rand(0, TAU),
    shootCd: def.ranged ? rand(0.5, def.shootEvery) : 0,
    burn: 0, burnT: 0, slow: 1,
  });
}

function spawnBoss() {
  const idx = Math.min(Math.floor(Game.t / CONFIG.bossEvery) - 1, BOSSES.length - 1);
  const def = BOSSES[Math.max(0, idx)];
  const cycle = Math.floor((Math.floor(Game.t / CONFIG.bossEvery) - 1) / BOSSES.length);
  const scale = 1 + cycle * 0.8 + Game.t * 0.004;
  const a = rand(0, TAU), r = spawnRadius();
  const b = {
    type: 'boss_' + def.id, def,
    x: Game.player.x + Math.cos(a) * r, y: Game.player.y + Math.sin(a) * r,
    vx: 0, vy: 0,
    hp: def.hp * scale, maxHp: def.hp * scale,
    radius: def.radius, speed: def.speed,
    dmg: def.dmg * (1 + Game.t * 0.003),
    armor: 4, color: def.color,
    xp: def.xp, glimmer: def.glimmer,
    boss: true, name: def.name, ability: def.ability,
    hitFlash: 0, wob: 0, abilityCd: 3, shootCd: 2, slow: 1, burn: 0, burnT: 0,
  };
  Game.enemies.push(b);
  Game.bossActive = b;
  Game.cam.shake = 18;
  Audio2.boss();
  toast('⚠ ' + def.name + ' appears!');
}

function currentBiome() { return BIOMES[Math.min(Game.biomeIndex, BIOMES.length - 1)]; }

function tierToType(tier) {
  const pool = Object.keys(ENEMIES).filter(k => ENEMIES[k].tier === tier);
  return pick(pool.length ? pool : Object.keys(ENEMIES));
}

function updateSpawning(dt) {
  // biome shift
  if (Game.t >= Game.nextBiome && Game.biomeIndex < BIOMES.length - 1) {
    Game.biomeIndex++; Game.nextBiome += CONFIG.biomeEvery;
    toast('Entering ' + currentBiome().name);
  }
  // boss
  if (Game.t >= Game.nextBoss) { Game.nextBoss += CONFIG.bossEvery; spawnBoss(); }

  // regular spawns
  const interval = Math.max(0.16, CONFIG.baseSpawnInterval - Game.t * 0.004) * (Game.bossActive ? 1.6 : 1);
  Game.spawnTimer -= dt;
  if (Game.spawnTimer <= 0 && Game.enemies.length < 340) {
    Game.spawnTimer = interval;
    const biome = currentBiome();
    const batch = 1 + Math.floor(Game.t / 45);
    for (let i = 0; i < batch; i++) {
      spawnEnemy(tierToType(pick(biome.tier)));
    }
    // occasional cluster
    if (Math.random() < 0.12) {
      const a = rand(0, TAU), r = spawnRadius();
      const cx = Game.player.x + Math.cos(a) * r, cy = Game.player.y + Math.sin(a) * r;
      for (let i = 0; i < 5; i++) spawnEnemy(tierToType(1), { x: cx + rand(-40, 40), y: cy + rand(-40, 40) });
    }
  }
}

/* ----------------------------- combat: firing ----------------------------- */
function nearestEnemy(x, y, maxR) {
  let best = null, bd = maxR ? maxR * maxR : Infinity;
  for (const e of Game.enemies) {
    const d = dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function fireWeapon(p, w, dt) {
  const s = p.stats, def = w.def;
  if (def.behavior === 'orbit') {
    w.angle += def.orbitSpeed * dt;
    return; // orbit handled in collision pass
  }
  if (def.behavior === 'aura') {
    w.cd -= dt;
    if (w.cd <= 0) {
      w.cd = def.cooldown / s.fireRateMult;
      const r = def.radius * s.area;
      for (const e of Game.enemies) {
        if (dist2(p.x, p.y, e.x, e.y) < (r + e.radius) ** 2) damageEnemy(e, def.dmg * s.damage, p, def.color, false);
      }
      spawnRing(p.x, p.y, r, def.color, 0.18);
    }
    return;
  }
  w.cd -= dt;
  if (w.cd > 0) return;
  const target = nearestEnemy(p.x, p.y, (def.range || 600));
  if (!target && def.behavior !== 'nova') return;
  w.cd = def.cooldown / s.fireRateMult;
  Audio2.shoot();

  if (def.behavior === 'nova') {
    const n = def.count + s.projectileCount * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      spawnBullet(p, p.x, p.y, a, def, s);
    }
    spawnRing(p.x, p.y, 40 * s.area, def.color, 0.15);
  } else if (def.behavior === 'spread') {
    const n = def.count + s.projectileCount;
    const baseA = Math.atan2(target.y - p.y, target.x - p.x);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * def.spread;
      spawnBullet(p, p.x, p.y, baseA + off, def, s);
    }
  } else if (def.behavior === 'chain') {
    chainLightning(p, target, def, s);
  } else { // projectile
    const n = 1 + s.projectileCount;
    const baseA = Math.atan2(target.y - p.y, target.x - p.x);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.14;
      spawnBullet(p, p.x, p.y, baseA + off, def, s);
    }
  }
}

function spawnBullet(p, x, y, angle, def, s) {
  const spd = (def.speed || 500) * s.projectileSpeedMult;
  Game.bullets.push({
    x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
    dmg: def.dmg * s.damage, radius: (def.size || 6) * Math.sqrt(s.area),
    pierce: (def.pierce || 0) + s.pierce, hits: new Set(),
    life: (def.range || 600) / spd + 0.3, color: def.color,
    crit: def.crit || 0, burn: def.burn || 0,
  });
}

function chainLightning(p, first, def, s) {
  let target = first, from = { x: p.x, y: p.y };
  const hitSet = new Set();
  const jumps = def.jumps + Math.floor(s.projectileCount / 2);
  for (let j = 0; j <= jumps && target; j++) {
    damageEnemy(target, def.dmg * s.damage, p, def.color, Math.random() < s.critChance);
    spawnLightning(from.x, from.y, target.x, target.y, def.color);
    hitSet.add(target);
    from = { x: target.x, y: target.y };
    // next nearest not yet hit
    let best = null, bd = (def.range) ** 2;
    for (const e of Game.enemies) {
      if (hitSet.has(e)) continue;
      const d = dist2(from.x, from.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    target = best;
  }
}

/* ----------------------------- damage / death ----------------------------- */
function damageEnemy(e, amount, p, color, forceCrit) {
  const s = p.stats;
  let dmg = amount;
  let crit = forceCrit || Math.random() < s.critChance;
  if (crit) dmg *= s.critMult;
  dmg = Math.max(1, dmg - (e.armor || 0));
  e.hp -= dmg;
  e.hitFlash = 0.08;
  floater(e.x, e.y - e.radius, Math.round(dmg), crit ? '#ffe24a' : '#fff', crit);
  if (e.hp <= 0) killEnemy(e, p);
}

function killEnemy(e, p) {
  const i = Game.enemies.indexOf(e);
  if (i < 0) return;
  Game.enemies.splice(i, 1);
  Game.killCount++; Save.data.totalKills++;
  Audio2.hit();
  spawnBurst(e.x, e.y, e.color, e.boss ? 40 : 8);
  // drops
  Game.gems.push({ x: e.x, y: e.y, value: e.xp, vx: rand(-40, 40), vy: rand(-40, 40), t: 0 });
  if (Math.random() < (e.boss ? 1 : 0.55)) {
    const cnt = e.boss ? 18 : 1;
    for (let k = 0; k < cnt; k++)
      Game.coins.push({ x: e.x + rand(-20, 20), y: e.y + rand(-20, 20), value: Math.max(1, Math.round(e.glimmer / cnt)), vx: rand(-60, 60), vy: rand(-60, 60), t: 0 });
  }
  // rare health drop
  if (Math.random() < 0.03) Game.coins.push({ x: e.x, y: e.y, value: 0, heal: 20, vx: 0, vy: 0, t: 0 });

  if (e.boss) {
    Game.bossActive = null;
    Game.cam.shake = 24;
    toast(e.name + ' slain! +' + e.glimmer + ' Glimmer');
    unlockAch('boss1');
  }
  // ach
  if (Save.data.totalKills >= 10) unlockAch('firstblood');
  if (Save.data.totalKills >= 1000) unlockAch('slayer1000');
}

function spawnEnemyBullet(e, tx, ty, spd, color) {
  const a = Math.atan2(ty - e.y, tx - e.x);
  Game.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, radius: 8, dmg: e.dmg * 0.7, life: 6, color: color || '#ff5a6a' });
}

/* ----------------------------- player hurt ----------------------------- */
function hurtPlayer(amount) {
  const p = Game.player;
  if (p.invuln > 0) return;
  let dmg = Math.max(1, amount - p.armor);
  p.hp -= dmg;
  p.invuln = 0.5;
  p.hurtFlash = 0.25;
  Game.cam.shake = Math.min(14, 6 + dmg * 0.3);
  Game.noHit = false;
  Audio2.hurt();
  if (p.hp <= 0) {
    if (p.revives > 0) {
      p.revives--; p.hp = p.maxHp; p.invuln = 2.5;
      spawnRing(p.x, p.y, 160, '#ff7a3c', 0.6);
      toast('🔥 Phoenix Charm revives you!');
    } else {
      gameOver();
    }
  }
  updateHUD();
}

/* ----------------------------- xp / level ----------------------------- */
function gainXP(amount) {
  const p = Game.player;
  p.xp += amount * p.stats.xpMult;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.floor(p.xpNext * 1.32 + 3);
    p.hp = Math.min(p.maxHp, p.hp + 4);
    Audio2.level();
    if (p.level >= 12) unlockAch('lvl12');
    offerLevelUp();
  }
  updateHUD();
}

function offerLevelUp() {
  // build pool of eligible perks (respecting per-perk max via counting)
  const p = Game.player;
  if (!p._perkCounts) p._perkCounts = {};
  const eligible = PERKS.filter(pk => {
    const c = p._perkCounts[pk.id] || 0;
    if (c >= (pk.max || 99)) return false;
    if (pk.weapon && p.weapons.some(w => w.key === pk.weapon)) return false;
    return true;
  });
  const choices = [];
  const bag = eligible.slice();
  while (choices.length < 3 && bag.length) {
    choices.push(bag.splice((Math.random() * bag.length) | 0, 1)[0]);
  }
  Game.pendingPerks = (Game.pendingPerks || []).concat([choices]);
  Game.state = 'levelup';
  Game.paused = true;
  showLevelUp();
}

function choosePerk(perk) {
  const p = Game.player;
  p._perkCounts[perk.id] = (p._perkCounts[perk.id] || 0) + 1;
  if (perk.weapon) addWeapon(p, perk.weapon);
  else if (perk.apply) perk.apply(p.stats, p);
  // recompute maxHp display already handled in apply for hp perk
  Audio2.pickup();
  Game.pendingPerks.shift();
  if (Game.pendingPerks.length) {
    showLevelUp();
  } else {
    Game.pendingPerks = null;
    Game.state = 'playing'; Game.paused = false;
    hideScreen('levelup');
  }
  updateHUD();
}

/* ----------------------------- update loop ----------------------------- */
function update(dt) {
  if (Game.state !== 'playing') return;
  Game.t += dt;
  const p = Game.player;

  // achievements time-based
  if (Game.t >= 300) unlockAch('survive5');
  if (Game.t >= 180 && Game.noHit) unlockAch('untouchable');

  // movement
  const mv = moveVector();
  if (p.dashCd > 0) p.dashCd -= dt;
  let dashMul = 1;
  if (p.dashT > 0) { p.dashT -= dt; dashMul = 3.2; p.invuln = Math.max(p.invuln, 0.05);
    if (Math.random() < 0.6) spawnBurst(p.x, p.y, p.color, 1); }
  const accel = p.speed * p.stats.moveSpeedMult * dashMul;
  p.vx = lerp(p.vx, mv.x * accel, 0.35);
  p.vy = lerp(p.vy, mv.y * accel, 0.35);
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (mv.x || mv.y) p.facing = Math.atan2(mv.y, mv.x);

  if (p.invuln > 0) p.invuln -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;
  if (p.stats.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);

  // camera follow + shake
  Game.cam.x = lerp(Game.cam.x, p.x, 0.12);
  Game.cam.y = lerp(Game.cam.y, p.y, 0.12);
  if (Game.cam.shake > 0) Game.cam.shake = Math.max(0, Game.cam.shake - dt * 40);

  updateSpawning(dt);

  // weapons
  for (const w of p.weapons) fireWeapon(p, w, dt);

  // orbit weapons collision (bonk hammers)
  for (const w of p.weapons) {
    if (w.def.behavior !== 'orbit') continue;
    const cnt = w.def.count + p.stats.projectileCount;
    const R = w.def.radius * p.stats.area;
    const hitR = w.def.size * Math.sqrt(p.stats.area);
    for (let i = 0; i < cnt; i++) {
      const a = w.angle + (i / cnt) * TAU;
      const hx = p.x + Math.cos(a) * R, hy = p.y + Math.sin(a) * R;
      for (const e of Game.enemies) {
        if (dist2(hx, hy, e.x, e.y) < (hitR + e.radius) ** 2) {
          if (!e._orbCd || e._orbCd <= 0) {
            damageEnemy(e, w.def.dmg * p.stats.damage, p, w.def.color, false);
            e._orbCd = 0.25;
            // knockback
            const kd = Math.atan2(e.y - hy, e.x - hx);
            e.x += Math.cos(kd) * 10; e.y += Math.sin(kd) * 10;
          }
        }
      }
    }
  }

  // enemies
  for (let i = Game.enemies.length - 1; i >= 0; i--) {
    const e = Game.enemies[i];
    if (e._orbCd > 0) e._orbCd -= dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.burnT > 0) { e.burnT -= dt; e.hp -= e.burn * dt; if (e.hp <= 0) { killEnemy(e, p); continue; } }
    e.wob += dt * 6;
    let ang = Math.atan2(p.y - e.y, p.x - e.x);
    let sp = e.speed * (e.slow || 1);
    if (e.def.wobble) ang += Math.sin(e.wob) * 0.5;
    e.x += Math.cos(ang) * sp * dt;
    e.y += Math.sin(ang) * sp * dt;

    // ranged enemy shooting
    if (e.def.ranged) {
      e.shootCd -= dt;
      if (e.shootCd <= 0 && dist2(e.x, e.y, p.x, p.y) < 520 * 520) {
        e.shootCd = e.def.shootEvery;
        spawnEnemyBullet(e, p.x, p.y, e.def.projSpeed, '#c08bff');
      }
    }
    // boss abilities
    if (e.boss) updateBoss(e, dt, p);

    // contact damage
    const rr = (e.radius + p.radius);
    if (dist2(e.x, e.y, p.x, p.y) < rr * rr) hurtPlayer(e.dmg * dt * 6);

    // simple separation so they don't fully stack
    if ((i & 3) === (Game.frame & 3)) {
      for (let j = 0; j < Game.enemies.length; j += 7) {
        const o = Game.enemies[j];
        if (o === e) continue;
        const d2 = dist2(e.x, e.y, o.x, o.y);
        const md = (e.radius + o.radius) * 0.8;
        if (d2 < md * md && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (md - d) * 0.5;
          const nx = (e.x - o.x) / d, ny = (e.y - o.y) / d;
          e.x += nx * push; e.y += ny * push;
        }
      }
    }
  }

  // player bullets
  for (let i = Game.bullets.length - 1; i >= 0; i--) {
    const b = Game.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) {
      for (const e of Game.enemies) {
        if (b.hits.has(e)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.radius + e.radius) ** 2) {
          damageEnemy(e, b.dmg, Game.player, b.color, b.crit && Math.random() < 0.5);
          if (b.burn) { e.burn = b.burn; e.burnT = 2; }
          b.hits.add(e);
          spawnBurst(b.x, b.y, b.color, 3);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
      }
    }
    if (dead) Game.bullets.splice(i, 1);
  }

  // enemy bullets
  for (let i = Game.ebullets.length - 1; i >= 0; i--) {
    const b = Game.ebullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { Game.ebullets.splice(i, 1); continue; }
    if (dist2(b.x, b.y, p.x, p.y) < (b.radius + p.radius) ** 2) {
      hurtPlayer(b.dmg); Game.ebullets.splice(i, 1);
    }
  }

  // pickups: gems & coins magnet + collect
  const magR = 104 * p.stats.magnet;
  collectables(Game.gems, dt, magR, g => { gainXP(g.value); Audio2.pickup(); });
  collectables(Game.coins, dt, magR, c => {
    if (c.heal) { p.hp = Math.min(p.maxHp, p.hp + c.heal); }
    else {
      const amt = Math.max(1, Math.round(c.value * p.stats.glimmerMult));
      Game.glimmerRun += amt;
    }
    Audio2.pickup();
  });

  // particles & floaters
  for (let i = Game.particles.length - 1; i >= 0; i--) {
    const pa = Game.particles[i];
    pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.9; pa.vy *= 0.9; pa.life -= dt;
    if (pa.life <= 0) Game.particles.splice(i, 1);
  }
  for (let i = Game.floaters.length - 1; i >= 0; i--) {
    const f = Game.floaters[i]; f.y -= 26 * dt; f.life -= dt;
    if (f.life <= 0) Game.floaters.splice(i, 1);
  }

  Game.frame = (Game.frame || 0) + 1;
  if (Game.frame % 12 === 0) updateHUD();
}

function triggerDash() {
  const p = Game.player;
  if (Game.state !== 'playing' || !p || p.dashCd > 0) return;
  p.dashCd = 2.8; p.dashT = 0.16; p.invuln = Math.max(p.invuln, 0.25);
  spawnRing(p.x, p.y, 40, p.color, 0.2);
  Audio2.blip(520, 0.06, 'sine', 0.03);
}

function collectables(arr, dt, magR, onGet) {
  const p = Game.player;
  for (let i = arr.length - 1; i >= 0; i--) {
    const it = arr[i];
    it.t += dt;
    const d2 = dist2(it.x, it.y, p.x, p.y);
    if (d2 < magR * magR) {
      const d = Math.sqrt(d2) || 1;
      const pull = lerp(60, 520, 1 - d / magR);
      it.x += (p.x - it.x) / d * pull * dt;
      it.y += (p.y - it.y) / d * pull * dt;
    } else {
      it.x += it.vx * dt; it.y += it.vy * dt; it.vx *= 0.9; it.vy *= 0.9;
    }
    if (d2 < (p.radius + 12) ** 2) { onGet(it); arr.splice(i, 1); }
  }
}

/* ----------------------------- boss AI ----------------------------- */
function updateBoss(e, dt, p) {
  e.abilityCd -= dt;
  if (e.abilityCd > 0) return;
  const ab = e.ability;
  if (ab === 'splitspawn' || ab === 'all') {
    e.abilityCd = 4;
    for (let k = 0; k < 4; k++) spawnEnemy('slime', { x: e.x + rand(-40, 40), y: e.y + rand(-40, 40) });
  }
  if (ab === 'barrage' || ab === 'all') {
    e.abilityCd = 3;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      Game.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, radius: 9, dmg: e.dmg * 0.6, life: 5, color: '#ffd24a' });
    }
  }
  if (ab === 'slam' || ab === 'all') {
    e.abilityCd = 3.5;
    if (dist2(e.x, e.y, p.x, p.y) < 220 * 220) { hurtPlayer(e.dmg * 0.8); Game.cam.shake = 16; spawnRing(e.x, e.y, 200, e.color, 0.3); }
  }
  if (ab === 'spiral' || ab === 'all') {
    e.abilityCd = 0.25;
    e._spin = (e._spin || 0) + 0.6;
    for (let k = 0; k < 3; k++) {
      const a = e._spin + k * (TAU / 3);
      Game.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, radius: 8, dmg: e.dmg * 0.5, life: 5, color: '#c08bff' });
    }
  }
}

/* ----------------------------- particles ----------------------------- */
function spawnBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, 220);
    Game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), color, r: rand(2, 4), kind: 'dot' });
  }
}
function spawnRing(x, y, r, color, life) { Game.particles.push({ x, y, vx: 0, vy: 0, life, color, r, kind: 'ring', max: life }); }
function spawnLightning(x1, y1, x2, y2, color) { Game.particles.push({ x: x1, y: y1, x2, y2, life: 0.12, color, kind: 'bolt' }); }
function floater(x, y, text, color, big) { Game.floaters.push({ x, y, text, color, life: 0.6, big }); }

/* ----------------------------- render ----------------------------- */
function render() {
  const biome = currentBiome();
  ctx.fillStyle = biome.bg;
  ctx.fillRect(0, 0, W, H);
  if (Game.state === 'menu') return;

  const shake = Game.cam.shake;
  const ox = shake ? rand(-shake, shake) : 0;
  const oy = shake ? rand(-shake, shake) : 0;
  ctx.save();
  ctx.translate(W / 2 + ox, H / 2 + oy);
  ctx.scale(zoom, zoom);
  ctx.translate(-Game.cam.x, -Game.cam.y);

  drawGrid(biome);

  // gems
  for (const g of Game.gems) {
    ctx.fillStyle = '#56d8ff';
    ctx.shadowColor = '#56d8ff'; ctx.shadowBlur = 8;
    diamond(g.x, g.y, 5);
  }
  ctx.shadowBlur = 0;
  // coins / glimmer
  for (const c of Game.coins) {
    if (c.heal) { ctx.fillStyle = '#ff5a7a'; ctx.shadowColor = '#ff5a7a'; ctx.shadowBlur = 8; cross(c.x, c.y, 6); }
    else { ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 8; diamond(c.x, c.y, 5); }
  }
  ctx.shadowBlur = 0;

  // enemies
  for (const e of Game.enemies) drawCreature(e);

  // enemy bullets
  for (const b of Game.ebullets) {
    ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 8;
    circle(b.x, b.y, b.radius);
  }
  ctx.shadowBlur = 0;

  // player bullets
  for (const b of Game.bullets) {
    ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 10;
    circle(b.x, b.y, b.radius);
  }
  ctx.shadowBlur = 0;

  // player + orbit weapons
  drawPlayer(Game.player);

  // particles
  for (const pa of Game.particles) drawParticle(pa);

  // floaters
  ctx.textAlign = 'center';
  for (const f of Game.floaters) {
    ctx.globalAlpha = clamp(f.life / 0.6, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = (f.big ? 'bold 18px' : '13px') + ' system-ui, sans-serif';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  if (Game.bossActive) drawBossBar();
}

function drawGrid(biome) {
  const grid = 64;
  const x0 = Game.cam.x - W / 2 / zoom - grid, x1 = Game.cam.x + W / 2 / zoom + grid;
  const y0 = Game.cam.y - H / 2 / zoom - grid, y1 = Game.cam.y + H / 2 / zoom + grid;
  ctx.strokeStyle = biome.grid; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = Math.floor(x0 / grid) * grid; x < x1; x += grid) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / grid) * grid; y < y1; y += grid) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}

function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function diamond(x, y, r) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); }
function cross(x, y, r) { ctx.fillRect(x - r, y - r / 2.5, r * 2, r * 0.8); ctx.fillRect(x - r / 2.5, y - r, r * 0.8, r * 2); }

function drawParticle(pa) {
  if (pa.kind === 'dot') {
    ctx.globalAlpha = clamp(pa.life * 2.2, 0, 1);
    ctx.fillStyle = pa.color; circle(pa.x, pa.y, pa.r);
  } else if (pa.kind === 'ring') {
    const k = 1 - pa.life / pa.max;
    ctx.globalAlpha = clamp(pa.life / pa.max, 0, 1) * 0.8;
    ctx.strokeStyle = pa.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.r * (0.4 + k * 0.8), 0, TAU); ctx.stroke();
  } else if (pa.kind === 'bolt') {
    ctx.globalAlpha = clamp(pa.life / 0.12, 0, 1);
    ctx.strokeStyle = pa.color; ctx.lineWidth = 2.5; ctx.shadowColor = pa.color; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
    const seg = 4, dx = (pa.x2 - pa.x) / seg, dy = (pa.y2 - pa.y) / seg;
    for (let i = 1; i < seg; i++) ctx.lineTo(pa.x + dx * i + rand(-6, 6), pa.y + dy * i + rand(-6, 6));
    ctx.lineTo(pa.x2, pa.y2); ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

/* ---- creature rendering (stylized neon vector art) ---- */
function drawCreature(e) {
  const x = e.x, y = e.y, r = e.radius, c = e.color;
  const flash = e.hitFlash > 0;
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, r * 0.75, r * 0.8, r * 0.32, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  const body = flash ? '#ffffff' : c;
  ctx.fillStyle = body; ctx.shadowColor = c; ctx.shadowBlur = e.boss ? 22 : 8;
  const shape = e.def.shape;
  const bob = Math.sin(e.wob) * (e.boss ? 1.5 : 2);

  if (shape === 'blob' || shape === 'boss_slime') {
    ctx.beginPath(); ctx.ellipse(0, bob, r, r * 0.85, 0, 0, TAU); ctx.fill();
  } else if (shape === 'bat') {
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-r * 1.4, -r * 0.6 + bob); ctx.lineTo(-r * 0.5, r * 0.2);
    ctx.lineTo(0, -r * 0.2); ctx.lineTo(r * 0.5, r * 0.2); ctx.lineTo(r * 1.4, -r * 0.6 + bob);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
  } else if (shape === 'spider') {
    ctx.strokeStyle = body; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const a = 0.4 + i * 0.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.4, Math.sin(a) * r); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(-a) * r * 1.4, Math.sin(-a) * r); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.fill();
  } else if (shape === 'rat') {
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.3, r * 0.4, 0, TAU); ctx.fill();
  } else if (shape === 'wraith' || shape === 'boss_queen') {
    ctx.beginPath();
    ctx.moveTo(-r, r + bob);
    ctx.quadraticCurveTo(-r, -r, 0, -r);
    ctx.quadraticCurveTo(r, -r, r, r + bob);
    for (let i = 0; i <= 4; i++) { const xx = r - (i * 2 * r / 4); ctx.lineTo(xx, (i % 2 ? r * 0.6 : r) + bob); }
    ctx.closePath(); ctx.fill();
  } else if (shape === 'golem' || shape === 'boss_golem' || shape === 'brute' || shape === 'boss_warden') {
    roundRect(-r, -r, r * 2, r * 2, r * 0.3); ctx.fill();
    ctx.fillStyle = e.accent || '#000'; ctx.globalAlpha = 0.3;
    roundRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.2); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = body;
  } else if (shape === 'goblin' || shape === 'orc') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    // ears
    ctx.beginPath(); ctx.moveTo(-r, -r * 0.2); ctx.lineTo(-r * 1.5, -r * 0.6); ctx.lineTo(-r * 0.7, -r * 0.6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r, -r * 0.2); ctx.lineTo(r * 1.5, -r * 0.6); ctx.lineTo(r * 0.7, -r * 0.6); ctx.closePath(); ctx.fill();
  } else if (shape === 'skeleton' || shape === 'shaman') {
    ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 0.85, 0, TAU); ctx.fill();
    ctx.fillRect(-r * 0.5, r * 0.2, r, r * 0.8);
  } else if (shape === 'boss_dragon') {
    ctx.beginPath(); ctx.ellipse(0, bob, r, r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.5); ctx.lineTo(-r * 1.6, -r * 1.2 + bob); ctx.lineTo(-r * 0.2, -r * 0.1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.5); ctx.lineTo(r * 1.6, -r * 1.2 + bob); ctx.lineTo(r * 0.2, -r * 0.1); ctx.closePath(); ctx.fill();
  } else {
    circle(0, bob, r);
  }
  ctx.shadowBlur = 0;
  // eyes
  ctx.fillStyle = '#fff';
  const ey = e.boss ? -r * 0.15 : -r * 0.1, ex = r * 0.32, es = e.boss ? r * 0.18 : r * 0.16;
  ctx.beginPath(); ctx.arc(-ex, ey, es, 0, TAU); ctx.arc(ex, ey, es, 0, TAU); ctx.fill();
  ctx.fillStyle = e.boss ? '#ff3344' : '#1a1a1a';
  ctx.beginPath(); ctx.arc(-ex, ey, es * 0.5, 0, TAU); ctx.arc(ex, ey, es * 0.5, 0, TAU); ctx.fill();

  // hp bar for tough/boss enemies
  if (!e.boss && e.maxHp > 40 && e.hp < e.maxHp) {
    ctx.fillStyle = '#000a'; ctx.fillRect(-r, -r - 8, r * 2, 4);
    ctx.fillStyle = '#ff5a6a'; ctx.fillRect(-r, -r - 8, r * 2 * (e.hp / e.maxHp), 4);
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayer(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // shadow
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, p.radius * 0.8, p.radius * 0.8, p.radius * 0.3, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // body
  const flash = p.hurtFlash > 0;
  ctx.fillStyle = flash ? '#fff' : p.color;
  ctx.shadowColor = p.color; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, p.radius, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  // accent ring
  ctx.strokeStyle = p.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, p.radius * 0.65, 0, TAU); ctx.stroke();
  // eyes look toward facing
  const fx = Math.cos(p.facing) * 4, fy = Math.sin(p.facing) * 4;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-5 + fx, -3 + fy, 4, 0, TAU); ctx.arc(5 + fx, -3 + fy, 4, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(-5 + fx + fx * 0.3, -3 + fy, 2, 0, TAU); ctx.arc(5 + fx + fx * 0.3, -3 + fy, 2, 0, TAU); ctx.fill();
  // invuln shield
  if (p.invuln > 0) {
    ctx.globalAlpha = 0.4 + Math.sin(now() / 60) * 0.2;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.radius + 6, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // orbit weapons (drawn in world space around player)
  for (const w of p.weapons) {
    if (w.def.behavior !== 'orbit') continue;
    const cnt = w.def.count + p.stats.projectileCount;
    const R = w.def.radius * p.stats.area;
    const hitR = w.def.size * Math.sqrt(p.stats.area);
    for (let i = 0; i < cnt; i++) {
      const a = w.angle + (i / cnt) * TAU;
      const hx = p.x + Math.cos(a) * R, hy = p.y + Math.sin(a) * R;
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(a);
      ctx.fillStyle = w.def.color; ctx.shadowColor = w.def.color; ctx.shadowBlur = 12;
      roundRect(-hitR * 0.4, -hitR, hitR * 0.8, hitR * 1.6, 3); ctx.fill();
      roundRect(-hitR * 0.5, -hitR, hitR, hitR * 0.7, 3); ctx.fill();
      ctx.restore();
    }
  }
  ctx.shadowBlur = 0;
  // aura visual
  for (const w of p.weapons) {
    if (w.def.behavior !== 'aura') continue;
    ctx.globalAlpha = 0.12 + Math.sin(now() / 200) * 0.05;
    ctx.fillStyle = w.def.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, w.def.radius * p.stats.area, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawBossBar() {
  const b = Game.bossActive;
  const w = Math.min(W * 0.7, 560), x = (W - w) / 2, y = 64;
  ctx.fillStyle = '#000a'; ctx.fillRect(x - 2, y - 2, w + 4, 18);
  ctx.fillStyle = '#3a0a0a'; ctx.fillRect(x, y, w, 14);
  ctx.fillStyle = '#ff3b4e'; ctx.fillRect(x, y, w * clamp(b.hp / b.maxHp, 0, 1), 14);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('☠ ' + b.name, W / 2, y - 6);
}

/* ----------------------------- main loop ----------------------------- */
let lastT = now();
function frame() {
  const t = now();
  let dt = (t - lastT) / 1000;
  lastT = t;
  dt = Math.min(dt, 0.05);
  if (!Game.paused && Game.state === 'playing') update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ----------------------------- game over ----------------------------- */
function gameOver() {
  Game.state = 'gameover';
  // bank glimmer
  Save.data.glimmer += Game.glimmerRun;
  Save.data.totalGlimmer += Game.glimmerRun;
  if (Game.t > Save.data.bestTime) Save.data.bestTime = Game.t;
  if (Game.player.level > Save.data.bestLevel) Save.data.bestLevel = Game.player.level;
  if (Save.data.totalGlimmer >= 1500) unlockAch('glimmer1500');
  Save.save();
  showGameOver();
}

/* ----------------------------- achievements ----------------------------- */
function unlockAch(id) {
  if (Save.data.achievements[id]) return;
  Save.data.achievements[id] = true;
  Save.save();
  const a = ACHIEVEMENTS.find(a => a.id === id);
  if (a) toast('🏆 ' + a.name + ' unlocked!');
  // character unlocks tied to achievements
  for (const c of CHARACTERS) {
    if (c.unlock && c.unlock.ach === id && !Save.data.unlocked.includes(c.id)) {
      Save.data.unlocked.push(c.id); Save.save();
      setTimeout(() => toast('★ New character: ' + c.name + '!'), 1200);
    }
  }
}

/* ----------------------------- expose for UI ----------------------------- */
window.GB = { Game, Save, startRun, choosePerk, togglePause, CHARACTERS, SHOP, PERKS, ACHIEVEMENTS, ENEMIES, BOSSES };

/* ----------------------------- boot ----------------------------- */
function boot() {
  Save.load();
  resize();
  buildUI();         // from ui.js
  requestAnimationFrame(frame);
  // dev/demo autostart for screenshots: index.html?demo[=charId]
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('demo')) setTimeout(() => startRun(q.get('demo') || 'bronte'), 60);
  } catch (e) {}
}
boot();
