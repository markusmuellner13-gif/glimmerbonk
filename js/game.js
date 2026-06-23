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
      shop: {},          // legacy global upgrades (migrated to shopChar)
      shopChar: {},      // charId -> { itemId: level }  (per-character upgrades)
      wkills: {},        // weaponKey -> total kills with that weapon
      slimeFireKills: 0, // slimes killed with fireballs
      bossKills: 0,
      bestTime: 0,
      bestLevel: 0,
      lastChar: 'bronte',
      muted: false,
      musicOff: false,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    this.migrate();
    return this.data;
  },
  // one-time: fold old global shop purchases into every owned character so
  // nobody loses progress when upgrades became per-character.
  migrate() {
    const d = this.data;
    if (!d.shopChar) d.shopChar = {};
    if (!d.wkills) d.wkills = {};
    if (d.slimeFireKills == null) d.slimeFireKills = 0;
    if (d.bossKills == null) d.bossKills = 0;
    const legacy = d.shop && Object.keys(d.shop).length;
    if (legacy) {
      for (const cid of d.unlocked) {
        const bucket = d.shopChar[cid] || (d.shopChar[cid] = {});
        for (const k in d.shop) bucket[k] = Math.max(bucket[k] || 0, d.shop[k] || 0);
      }
      d.shop = {}; // clear legacy so we don't re-grant
      this.save();
    }
  },
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) {} },
  // per-character upgrade level
  shopLevel(id, charId) {
    charId = charId || this.data.lastChar;
    return (this.data.shopChar[charId] || {})[id] || 0;
  },
  buyShop(id, charId) {
    const bucket = this.data.shopChar[charId] || (this.data.shopChar[charId] = {});
    bucket[id] = (bucket[id] || 0) + 1;
  },
};

/* ----------------------------- audio (procedural SFX synth) ----------------------------- */
const Audio2 = {
  ctx: null, master: null, noiseBuf: null, _lastImpact: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      // short white-noise buffer for whooshes/hats/explosions
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {}
  },
  // basic oscillator voice (optional pitch slide)
  tone(freq, dur, type = 'square', vol = 0.05, slideTo, when = 0) {
    if (Save.data.muted || !this.ctx) return;
    try {
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  // filtered noise burst (whoosh / hat / explosion)
  noise(dur, vol = 0.05, filterType = 'highpass', freq = 1800, when = 0) {
    if (Save.data.muted || !this.ctx || !this.noiseBuf) return;
    try {
      const t = this.ctx.currentTime + when;
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t); s.stop(t + dur + 0.02);
    } catch (e) {}
  },
  blip(freq = 440, dur = 0.06, type = 'square', vol = 0.05) { this.tone(freq, dur, type, vol); },

  // ---- weapon firing sounds (chosen by weapon def) ----
  fire(def) {
    const k = def.proj || def.behavior;
    switch (k) {
      case 'arrow':    this.tone(880, 0.08, 'sawtooth', 0.03, 320); this.noise(0.05, 0.02, 'highpass', 3000); break;
      case 'fireball': this.noise(0.22, 0.05, 'lowpass', 700); this.tone(180, 0.22, 'sawtooth', 0.035, 90); break;
      case 'bone':     this.tone(420, 0.05, 'square', 0.03, 260); this.tone(300, 0.04, 'square', 0.02, 200, 0.03); break;
      case 'dagger':   this.noise(0.07, 0.035, 'highpass', 4200); break;
      case 'star':     this.tone(1320, 0.12, 'triangle', 0.03, 1980); this.tone(1760, 0.1, 'sine', 0.02, undefined, 0.05); break;
      case 'chain':    this.tone(1400, 0.05, 'sawtooth', 0.03, 600); this.noise(0.08, 0.03, 'highpass', 5000); break;
      case 'nova':     this.noise(0.2, 0.05, 'lowpass', 600); this.tone(120, 0.25, 'sawtooth', 0.04, 60); break;
      default:         this.tone(660, 0.04, 'square', 0.025, 440);
    }
  },
  // soft, rate-limited impact tick when a projectile lands
  impact(kind) {
    if (!this.ctx) return;
    const now2 = this.ctx.currentTime;
    if (now2 - this._lastImpact < 0.035) return; this._lastImpact = now2;
    if (kind === 'fireball' || kind === 'nova') this.noise(0.12, 0.03, 'lowpass', 900);
    else this.tone(220, 0.04, 'square', 0.02, 130);
  },
  hit() { this.tone(180, 0.05, 'sawtooth', 0.03, 90); this.noise(0.06, 0.02, 'lowpass', 1200); },   // enemy death
  level() { [0, 90, 180].forEach((ms, i) => setTimeout(() => this.tone(660 + i * 220, 0.16, 'triangle', 0.06), ms)); },
  hurt() { this.tone(150, 0.2, 'sawtooth', 0.06, 60); this.noise(0.12, 0.04, 'lowpass', 800); },
  pickup() { this.tone(1040, 0.03, 'sine', 0.02); },
  coin() { this.tone(880, 0.04, 'triangle', 0.025, undefined); this.tone(1320, 0.05, 'triangle', 0.02, undefined, 0.03); },
  boss() { this.tone(70, 0.6, 'sawtooth', 0.09, 50); this.noise(0.5, 0.05, 'lowpass', 400); },
  bossHit() { this.tone(90, 0.18, 'square', 0.05, 50); },
  ui() { this.tone(520, 0.05, 'triangle', 0.03, 720); },
};

/* ----------------------------- procedural background music -----------------------------
   100% generated in-code (no samples, no copyright). An A-minor groove with
   bass, arpeggio, pad, melody + kick. Transposes per biome, intensifies for bosses. */
const Music = {
  master: null, playing: false, timer: null, step: 0, nextTime: 0, bpm: 102,
  biome: 0, boss: false,
  // A natural-minor palette (Hz)
  bass: [110.00, 87.31, 130.81, 98.00],                     // Am  F  C  G  (roots)
  chord: [[220.00, 261.63, 329.63], [174.61, 220.00, 261.63], [261.63, 329.63, 392.00], [196.00, 246.94, 293.66]],
  mel: [440.00, 523.25, 587.33, 659.25, 783.99],            // A C D E G pentatonic
  transpose: [0, 2, -3, -5, 4, 7],                          // semitone shift per biome

  start() {
    Audio2.init();
    if (!Audio2.ctx || this.playing || Save.data.musicOff) return;
    this.master = Audio2.ctx.createGain();
    this.master.gain.value = Save.data.muted ? 0 : 0.5;
    this.master.connect(Audio2.ctx.destination);
    this.playing = true; this.step = 0;
    this.nextTime = Audio2.ctx.currentTime + 0.1;
    this.schedule();
  },
  stop() {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.master) { try { this.master.disconnect(); } catch (e) {} this.master = null; }
  },
  setBiome(i) { this.biome = i; },
  setBoss(b) { this.boss = b; this.bpm = b ? 128 : 102; },
  setMuted(m) { if (this.master) this.master.gain.value = m ? 0 : 0.5; },

  voice(freq, dur, type, vol, time, slideTo) {
    try {
      const c = Audio2.ctx;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, time);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, time + dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vol, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(this.master);
      o.start(time); o.stop(time + dur + 0.03);
    } catch (e) {}
  },
  kick(time) {
    try {
      const c = Audio2.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, time); o.frequency.exponentialRampToValueAtTime(48, time + 0.12);
      g.gain.setValueAtTime(0.12, time); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
      o.connect(g); g.connect(this.master); o.start(time); o.stop(time + 0.16);
    } catch (e) {}
  },

  playStep(s, time) {
    const tf = Math.pow(2, (this.transpose[this.biome] || 0) / 12);
    const ci = Math.floor(s / 8) % 4;
    const beat = s % 8;
    // bass on the 1 and the 5 (downbeats)
    if (beat === 0 || beat === 4) { this.voice(this.bass[ci] * tf, 0.42, 'triangle', this.boss ? 0.16 : 0.12, time); this.kick(time); }
    // arpeggio on 8th notes
    if (s % 2 === 0) this.voice(this.chord[ci][(s / 2) % 3] * tf, 0.18, 'square', 0.035, time);
    // soft hat on offbeats
    if (s % 2 === 1) { try { const c = Audio2.ctx; const src = c.createBufferSource(); src.buffer = Audio2.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = c.createGain(); g.gain.setValueAtTime(0.018, time); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05); src.connect(f); f.connect(g); g.connect(this.master); src.start(time); src.stop(time + 0.06); } catch (e) {} }
    // pad swell on chord change
    if (beat === 0) { for (const n of this.chord[ci]) this.voice(n * tf * 0.5, 8 * this.stepDur(), 'sine', 0.02, time); }
    // melody flourish
    if (!this.boss && (beat === 2 || beat === 6) && Math.random() < 0.55)
      this.voice(this.mel[(Math.random() * this.mel.length) | 0] * tf, 0.22, 'triangle', 0.04, time);
    if (this.boss && beat % 2 === 0) this.voice(this.bass[ci] * tf * 0.5, 0.14, 'sawtooth', 0.05, time); // boss pulse
  },
  stepDur() { return 60 / this.bpm / 4; },           // 16th notes
  schedule() {
    if (!this.playing || !Audio2.ctx) return;
    while (this.nextTime < Audio2.ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur();
      this.step = (this.step + 1) % 32;
    }
    this.timer = setTimeout(() => this.schedule(), 30);
  },
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
addEventListener('orientationchange', () => { resize(); setTimeout(resize, 250); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

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
    const lvl = Save.shopLevel(item.id, charDef.id);
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
  Music.setBoss(false); Music.setBiome(0); Music.start();
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
  Music.setBoss(true);
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
    Music.setBiome(Game.biomeIndex);
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
        if (dist2(p.x, p.y, e.x, e.y) < (r + e.radius) ** 2) damageEnemy(e, def.dmg * s.damage, p, def.color, false, w.key);
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
  Audio2.fire(def);

  if (def.behavior === 'nova') {
    const n = def.count + s.projectileCount * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      spawnBullet(p, p.x, p.y, a, def, s, w.key);
    }
    spawnRing(p.x, p.y, 40 * s.area, def.color, 0.15);
  } else if (def.behavior === 'spread') {
    const n = def.count + s.projectileCount;
    const baseA = Math.atan2(target.y - p.y, target.x - p.x);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * def.spread;
      spawnBullet(p, p.x, p.y, baseA + off, def, s, w.key);
    }
    muzzle(p, baseA, def.color);
  } else if (def.behavior === 'chain') {
    chainLightning(p, target, def, s, w.key);
  } else { // projectile
    const n = 1 + s.projectileCount;
    const baseA = Math.atan2(target.y - p.y, target.x - p.x);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.14;
      spawnBullet(p, p.x, p.y, baseA + off, def, s, w.key);
    }
    muzzle(p, baseA, def.color);
  }
}

function spawnBullet(p, x, y, angle, def, s, wkey) {
  const spd = (def.speed || 500) * s.projectileSpeedMult;
  Game.bullets.push({
    x, y, px: x, py: y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
    dmg: def.dmg * s.damage, radius: (def.size || 6) * Math.sqrt(s.area),
    pierce: (def.pierce || 0) + s.pierce, hits: new Set(),
    life: (def.range || 600) / spd + 0.3, color: def.color,
    crit: def.crit || 0, burn: def.burn || 0, slow: def.slow || 0, wkey,
    kind: def.proj || 'bullet', angle, spin: rand(0, TAU), spinV: rand(-8, 8),
  });
}

// muzzle flash + sparks when a weapon fires
function muzzle(p, ang, color) {
  const mx = p.x + Math.cos(ang) * (p.radius + 6), my = p.y + Math.sin(ang) * (p.radius + 6);
  Game.particles.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.12, max: 0.12, color, r: 10, kind: 'flash' });
  for (let i = 0; i < 3; i++) {
    const a = ang + rand(-0.5, 0.5), sp = rand(80, 200);
    Game.particles.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.1, 0.25), color, r: rand(1.5, 3), kind: 'dot' });
  }
}

function chainLightning(p, first, def, s, wkey) {
  let target = first, from = { x: p.x, y: p.y };
  const hitSet = new Set();
  const jumps = def.jumps + Math.floor(s.projectileCount / 2);
  for (let j = 0; j <= jumps && target; j++) {
    damageEnemy(target, def.dmg * s.damage, p, def.color, Math.random() < s.critChance, wkey);
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
function damageEnemy(e, amount, p, color, forceCrit, wkey) {
  const s = p.stats;
  let dmg = amount;
  let crit = forceCrit || Math.random() < s.critChance;
  if (crit) dmg *= s.critMult;
  dmg = Math.max(1, dmg - (e.armor || 0));
  e.hp -= dmg;
  e.hitFlash = 0.08;
  if (wkey) e._wkey = wkey; // remember the last weapon to hit (for kill credit)
  floater(e.x, e.y - e.radius, Math.round(dmg), crit ? '#ffe24a' : '#fff', crit);
  if (e.hp <= 0) killEnemy(e, p, wkey);
}

function killEnemy(e, p, wkey) {
  const i = Game.enemies.indexOf(e);
  if (i < 0) return;
  Game.enemies.splice(i, 1);
  Game.killCount++; Save.data.totalKills++;
  // weapon-kill tracking -> character unlocks
  wkey = wkey || e._wkey;
  if (wkey) {
    Save.data.wkills[wkey] = (Save.data.wkills[wkey] || 0) + 1;
    if (wkey === 'firenova' && e.type === 'slime') Save.data.slimeFireKills++;
    checkWeaponAchievements();
  }
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
    Music.setBoss(false);
    Save.data.bossKills++;
    toast(e.name + ' slain! +' + e.glimmer + ' Glimmer');
    unlockAch('boss1');
  }
  // ach
  if (Save.data.totalKills >= 10) unlockAch('firstblood');
  if (Save.data.totalKills >= 1000) unlockAch('slayer1000');
}

// weapon-mastery achievements (unlock new characters)
function checkWeaponAchievements() {
  const w = Save.data.wkills;
  if (Save.data.slimeFireKills >= 100) unlockAch('pyromaniac');
  if ((w.chain || 0) >= 350) unlockAch('thunderlord');
  if ((w.hammer || 0) >= 350) unlockAch('crushblow');
  if ((w.arrow || 0) >= 500) unlockAch('volley');
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

  // aim toward nearest enemy (for hero's held weapon)
  const aimT = nearestEnemy(p.x, p.y, 1000);
  p.aimAngle = aimT ? Math.atan2(aimT.y - p.y, aimT.x - p.x) : (p.aimAngle ?? p.facing);

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
            damageEnemy(e, w.def.dmg * p.stats.damage, p, w.def.color, false, w.key);
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
    if (e.burnT > 0) { e.burnT -= dt; e.hp -= e.burn * dt; if (e.hp <= 0) { killEnemy(e, p, e._wkey); continue; } }
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 1; }
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
    b.px = b.x; b.py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; b.spin += b.spinV * dt;
    // glowing trail motes for fancy projectiles
    if ((b.kind === 'fireball' || b.kind === 'star') && (Game.frame & 1) === 0)
      Game.particles.push({ x: b.x, y: b.y, vx: rand(-12, 12), vy: rand(-12, 12), life: rand(0.18, 0.34), color: b.color, r: b.radius * 0.4, kind: 'dot' });
    let dead = b.life <= 0;
    if (!dead) {
      for (const e of Game.enemies) {
        if (b.hits.has(e)) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.radius + e.radius) ** 2) {
          damageEnemy(e, b.dmg, Game.player, b.color, b.crit && Math.random() < 0.5, b.wkey);
          if (b.burn) { e.burn = b.burn; e.burnT = 2; }
          if (b.slow && !e.boss) { e.slow = b.slow; e.slowT = 2.2; }
          b.hits.add(e);
          bulletImpact(b);
          Audio2.impact(b.kind);
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
  const magR = 122 * p.stats.magnet;
  collectables(Game.gems, dt, magR, g => { gainXP(g.value); Audio2.pickup(); });
  collectables(Game.coins, dt, magR, c => {
    if (c.heal) { p.hp = Math.min(p.maxHp, p.hp + c.heal); Audio2.tone(740, 0.12, 'sine', 0.05, 980); }
    else {
      const amt = Math.max(1, Math.round(c.value * p.stats.glimmerMult));
      Game.glimmerRun += amt; Audio2.coin();
    }
  });

  // ambient atmosphere
  spawnAmbient(dt);

  // particles & floaters
  for (let i = Game.particles.length - 1; i >= 0; i--) {
    const pa = Game.particles[i];
    if (pa.kind === 'amb') {
      pa.ph += dt * 2.2;
      pa.x += (pa.vx + Math.sin(pa.ph) * pa.sway * 0.35) * dt;
      pa.y += pa.vy * dt; pa.life -= dt;
    } else {
      pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vx *= 0.9; pa.vy *= 0.9; pa.life -= dt;
    }
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

/* projectile-specific impact flair */
function bulletImpact(b) {
  if (b.kind === 'fireball' || b.kind === 'nova') {
    spawnRing(b.x, b.y, b.radius * 2.2, '#ffd24a', 0.18);
    for (let i = 0; i < 6; i++) { const a = rand(0, TAU), s = rand(60, 200); Game.particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.45), color: i % 2 ? '#ff6a2c' : '#ffd24a', r: rand(2, 4), kind: 'dot' }); }
  } else if (b.kind === 'star') {
    for (let i = 0; i < 5; i++) { const a = rand(0, TAU); Game.particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, life: 0.3, color: '#fff', r: 2, kind: 'dot' }); }
    spawnRing(b.x, b.y, b.radius * 1.6, b.color, 0.16);
  } else {
    spawnBurst(b.x, b.y, b.color, 3);
  }
}

/* ---- atmospheric ambient particles per biome (drifting leaves/snow/embers/motes) ---- */
const AMBIENT = [
  { kinds: ['#7CFF6B', '#cfe87a'], vy: 22, sway: 18, rate: 0.5, r: [2, 3.5] },   // meadow: pollen/leaves
  { kinds: ['#9a7bd6', '#6a5aaa'], vy: -8, sway: 10, rate: 0.4, r: [1.5, 2.6] }, // catacombs: wisps
  { kinds: ['#ff6a2c', '#ffd24a'], vy: -34, sway: 14, rate: 0.7, r: [1.5, 3] },  // ashen: rising embers
  { kinds: ['#ffffff', '#cdeaf7'], vy: 40, sway: 22, rate: 0.9, r: [1.8, 3.2] }, // tundra: snow
  { kinds: ['#a06bff', '#6a3fb0'], vy: -16, sway: 16, rate: 0.6, r: [1.5, 3] },  // voidlands: motes
  { kinds: ['#ffd24a', '#fff2b0'], vy: -10, sway: 12, rate: 0.7, r: [1.5, 3] },  // glimmercore: sparkles
];
function spawnAmbient(dt) {
  const cfg = AMBIENT[Math.min(Game.biomeIndex, AMBIENT.length - 1)];
  Game._ambAcc = (Game._ambAcc || 0) + dt;
  const per = cfg.rate * 0.06;                 // spawn pacing
  while (Game._ambAcc > per) {
    Game._ambAcc -= per;
    const halfW = W / 2 / zoom + 60, halfH = H / 2 / zoom + 60;
    const x = Game.cam.x + rand(-halfW, halfW);
    const y = Game.cam.y + (cfg.vy >= 0 ? -halfH : halfH) + rand(-30, 30);
    Game.particles.push({
      x, y, vx: rand(-cfg.sway, cfg.sway) * 0.4, vy: cfg.vy, life: rand(3.5, 6),
      color: pick(cfg.kinds), r: rand(cfg.r[0], cfg.r[1]), kind: 'amb', sway: cfg.sway, ph: rand(0, TAU),
    });
  }
}

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

  drawGround(biome);
  drawDecor(biome);

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

  // player bullets (shaped projectiles with trails)
  for (const b of Game.bullets) drawBullet(b);
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

/* deterministic hash → 0..1 for stable, infinite-world decoration */
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function viewBounds(margin) {
  return {
    x0: Game.cam.x - W / 2 / zoom - margin, x1: Game.cam.x + W / 2 / zoom + margin,
    y0: Game.cam.y - H / 2 / zoom - margin, y1: Game.cam.y + H / 2 / zoom + margin,
  };
}

/* tiled, textured floor with checker shading + faint grid + winding path */
function drawGround(biome) {
  const grid = 64;
  const b = viewBounds(grid);
  for (let gy = Math.floor(b.y0 / grid); gy * grid < b.y1; gy++) {
    for (let gx = Math.floor(b.x0 / grid); gx * grid < b.x1; gx++) {
      const h = hash2(gx, gy);
      // base checker
      ctx.fillStyle = ((gx + gy) & 1) ? biome.tile : biome.bg;
      ctx.fillRect(gx * grid, gy * grid, grid + 1, grid + 1);
      // scattered lighter floor patches for texture
      if (h > 0.82) {
        ctx.globalAlpha = 0.5; ctx.fillStyle = biome.grid2;
        ctx.beginPath(); ctx.arc(gx * grid + grid * 0.5, gy * grid + grid * 0.5, grid * (0.2 + h * 0.25), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  // grid lines
  ctx.strokeStyle = biome.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (let x = Math.floor(b.x0 / grid) * grid; x < b.x1; x += grid) { ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); }
  for (let y = Math.floor(b.y0 / grid) * grid; y < b.y1; y += grid) { ctx.moveTo(b.x0, y); ctx.lineTo(b.x1, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // a meandering path/road for structure
  ctx.strokeStyle = biome.path; ctx.lineWidth = 46; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const step = 120, sx = Math.floor(b.x0 / step) * step;
  let started = false;
  for (let x = sx; x < b.x1 + step; x += step) {
    const y = Math.sin(x * 0.006) * 220 + Math.cos(x * 0.0013) * 360;
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
}

/* scenery props placed on a coarse grid, themed by biome, stable per cell */
function drawDecor(biome) {
  const cell = 132;
  const b = viewBounds(cell * 1.5);
  for (let cy = Math.floor(b.y0 / cell); cy * cell < b.y1; cy++) {
    for (let cx = Math.floor(b.x0 / cell); cx * cell < b.x1; cx++) {
      if (hash2(cx * 3 + 1, cy * 7 + 5) > biome.decorDensity) continue;
      const px = cx * cell + (hash2(cx + 11, cy) - 0.5) * cell * 0.8;
      const py = cy * cell + (hash2(cx, cy + 17) - 0.5) * cell * 0.8;
      const type = biome.decor[(hash2(cx + 3, cy + 9) * biome.decor.length) | 0];
      const sc = 0.75 + hash2(cx + 5, cy + 2) * 0.7;
      drawProp(type, px, py, sc, biome);
    }
  }
}

function drawProp(type, x, y, sc, biome) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
  // ground shadow for every prop
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, 4, 13, 5, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  const ac = biome.accent;
  if (type === 'tree') {
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(-3, -6, 6, 18);
    ctx.fillStyle = '#2f6b3a'; ctx.shadowColor = '#2f6b3a'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0, -16, 15, 0, TAU); ctx.arc(-9, -8, 10, 0, TAU); ctx.arc(9, -8, 10, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#3f8a4a';
    ctx.beginPath(); ctx.arc(-3, -20, 8, 0, TAU); ctx.fill();
  } else if (type === 'pine') {
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(-2.5, 2, 5, 10);
    ctx.fillStyle = '#2c6a55'; ctx.shadowColor = '#2c6a55'; ctx.shadowBlur = 6;
    for (let k = 0; k < 3; k++) { const yy = -k * 9; ctx.beginPath(); ctx.moveTo(0, -26 + yy); ctx.lineTo(-12 + k * 2, 2 + yy); ctx.lineTo(12 - k * 2, 2 + yy); ctx.closePath(); ctx.fill(); }
    ctx.shadowBlur = 0;
  } else if (type === 'deadtree') {
    ctx.strokeStyle = '#5a3a28'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -16);
    ctx.moveTo(0, -6); ctx.lineTo(-10, -16); ctx.moveTo(0, -2); ctx.lineTo(11, -10);
    ctx.moveTo(0, -16); ctx.lineTo(-6, -26); ctx.moveTo(0, -16); ctx.lineTo(7, -24);
    ctx.stroke(); ctx.lineCap = 'butt';
  } else if (type === 'bush') {
    ctx.fillStyle = '#2f6b3a'; ctx.shadowColor = '#2f6b3a'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(-6, 0, 8, 0, TAU); ctx.arc(6, 0, 8, 0, TAU); ctx.arc(0, -5, 9, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  } else if (type === 'flower') {
    ctx.fillStyle = '#2f6b3a'; ctx.fillRect(-1, -2, 2, 8);
    ctx.fillStyle = ac; ctx.shadowColor = ac; ctx.shadowBlur = 8;
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * 4, -4 + Math.sin(a) * 4, 3, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, -4, 2.5, 0, TAU); ctx.fill();
  } else if (type === 'rock') {
    ctx.fillStyle = '#6a6a72';
    ctx.beginPath(); ctx.moveTo(-11, 6); ctx.lineTo(-7, -7); ctx.lineTo(4, -9); ctx.lineTo(12, 2); ctx.lineTo(7, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#85858f'; ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(4, -9); ctx.lineTo(2, -2); ctx.lineTo(-5, -1); ctx.closePath(); ctx.fill();
  } else if (type === 'goldrock' || type === 'orevein') {
    ctx.fillStyle = '#5a4a2a';
    ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-8, -8); ctx.lineTo(6, -10); ctx.lineTo(13, 3); ctx.lineTo(7, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 10;
    for (let k = 0; k < 4; k++) { const hh = hash2(x + k, y); ctx.beginPath(); ctx.arc(-6 + k * 4, -2 + (hh - 0.5) * 8, 1.8, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0;
  } else if (type === 'crystal') {
    ctx.fillStyle = ac; ctx.shadowColor = ac; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(7, -4); ctx.lineTo(3, 8); ctx.lineTo(-4, 6); ctx.lineTo(-7, -6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff66'; ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(2, -4); ctx.lineTo(-2, -2); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  } else if (type === 'icerock') {
    ctx.fillStyle = '#7fb8d6'; ctx.shadowColor = '#7fb8d6'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(-4, -10); ctx.lineTo(6, -8); ctx.lineTo(11, 4); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#cdeaf7'; ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(6, -8); ctx.lineTo(1, -2); ctx.closePath(); ctx.fill();
  } else if (type === 'snowmound') {
    ctx.fillStyle = '#e8f4fb'; ctx.beginPath(); ctx.ellipse(0, 2, 14, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#cfe6f2'; ctx.beginPath(); ctx.ellipse(4, 4, 8, 4, 0, 0, TAU); ctx.fill();
  } else if (type === 'lavarock') {
    ctx.fillStyle = '#3a2420'; ctx.beginPath(); ctx.moveTo(-11, 6); ctx.lineTo(-6, -8); ctx.lineTo(7, -9); ctx.lineTo(12, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff6a2c'; ctx.shadowColor = '#ff6a2c'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(2, -4); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
  } else if (type === 'gravestone') {
    ctx.fillStyle = '#8a8a96'; roundRect(-9, -16, 18, 24, 8); ctx.fill();
    ctx.strokeStyle = '#5a5a66'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -2); ctx.moveTo(-4, -6); ctx.lineTo(4, -6); ctx.stroke();
  } else if (type === 'cross') {
    ctx.fillStyle = '#8a8a96'; ctx.fillRect(-2.5, -18, 5, 26); ctx.fillRect(-9, -12, 18, 5);
  } else if (type === 'pillar') {
    ctx.fillStyle = '#54506a'; ctx.fillRect(-8, -22, 16, 30);
    ctx.fillStyle = '#6a6488'; ctx.fillRect(-10, -24, 20, 5); ctx.fillRect(-10, 4, 20, 5);
  } else if (type === 'bone') {
    ctx.strokeStyle = '#d8d2c0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(8, -4); ctx.stroke();
    ctx.fillStyle = '#d8d2c0'; ctx.beginPath(); ctx.arc(-8, 4, 3, 0, TAU); ctx.arc(8, -4, 3, 0, TAU); ctx.fill(); ctx.lineCap = 'butt';
  } else if (type === 'void') {
    ctx.fillStyle = '#0a0612'; ctx.shadowColor = ac; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, -4, 11, 0, TAU); ctx.fill();
    ctx.strokeStyle = ac; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -4, 11, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0;
  } else { // fallback rock
    ctx.fillStyle = '#6a6a72'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/* shaped player projectiles with motion trails */
function drawBullet(b) {
  const ang = Math.atan2(b.vy, b.vx);
  // trail
  ctx.strokeStyle = b.color; ctx.globalAlpha = 0.35; ctx.lineWidth = b.radius * 0.9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.shadowColor = b.color; ctx.shadowBlur = 10;
  const r = b.radius;
  if (b.kind === 'arrow') {
    ctx.rotate(ang); ctx.fillStyle = b.color;
    ctx.fillRect(-r, -1.2, r * 1.6, 2.4);
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r * 0.3, -r * 0.7); ctx.lineTo(r * 0.3, r * 0.7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffffaa'; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.5, r * 0.5); ctx.closePath(); ctx.fill();
  } else if (b.kind === 'fireball') {
    const fl = 0.8 + Math.sin(now() / 40 + b.spin) * 0.2;
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, 0, r * fl, 0, TAU); ctx.fill();
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(0, 0, r * 0.66 * fl, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff7d0'; ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.2, r * 0.3, 0, TAU); ctx.fill();
  } else if (b.kind === 'star') {
    ctx.rotate(b.spin); ctx.fillStyle = b.color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.45 : r; const a = i / 8 * TAU; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  } else if (b.kind === 'bone') {
    ctx.rotate(ang); ctx.strokeStyle = b.color; ctx.lineWidth = r * 0.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.lineTo(r * 0.7, 0); ctx.stroke();
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(-r * 0.7, 0, r * 0.35, 0, TAU); ctx.arc(r * 0.7, 0, r * 0.35, 0, TAU); ctx.fill(); ctx.lineCap = 'butt';
  } else if (b.kind === 'dagger') {
    ctx.rotate(ang); ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.4, -r * 0.5); ctx.lineTo(-r, 0); ctx.lineTo(-r * 0.4, r * 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffffcc'; ctx.fillRect(-r, -1, r * 0.4, 2);
  } else if (b.kind === 'rock') {
    ctx.rotate(b.spin); ctx.fillStyle = b.color;
    ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
  } else { // bullet
    ctx.rotate(ang); ctx.fillStyle = '#fff7d0';
    roundRect(-r, -r * 0.6, r * 2, r * 1.2, r * 0.6); ctx.fill();
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.6, 0, TAU); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function diamond(x, y, r) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); }
function cross(x, y, r) { ctx.fillRect(x - r, y - r / 2.5, r * 2, r * 0.8); ctx.fillRect(x - r / 2.5, y - r, r * 0.8, r * 2); }

function drawParticle(pa) {
  if (pa.kind === 'dot') {
    ctx.globalAlpha = clamp(pa.life * 2.2, 0, 1);
    ctx.fillStyle = pa.color; circle(pa.x, pa.y, pa.r);
  } else if (pa.kind === 'amb') {
    // fade in over first 0.5s, out over last 1s
    const a = Math.min(1, (6 - pa.life) * 2, pa.life) * 0.55;
    ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = pa.color;
    circle(pa.x, pa.y, pa.r);
  } else if (pa.kind === 'flash') {
    const k = clamp(pa.life / pa.max, 0, 1);
    ctx.globalAlpha = k; ctx.fillStyle = '#fff'; ctx.shadowColor = pa.color; ctx.shadowBlur = 16;
    circle(pa.x, pa.y, pa.r * (1.3 - k * 0.6));
    ctx.fillStyle = pa.color; circle(pa.x, pa.y, pa.r * 0.6 * (1.3 - k * 0.6));
    ctx.shadowBlur = 0;
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

function roundRect(x, y, w, h, r, g = ctx) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---- detailed hero sprites (shared by gameplay + character select) ---- */
function drawHeroSprite(g, id, color, accent, aim, t, flash, moving) {
  const R = 15;
  const skin = '#f1c9a0';
  const bob = moving ? Math.abs(Math.sin(t * 9)) * 1.6 : Math.sin(t * 2.5) * 0.5;
  const step = moving ? Math.sin(t * 9) * 2.4 : 0;
  const body = flash ? '#ffffff' : color;
  const dark = flash ? '#ffffff' : accent;
  const idle = !moving;
  const breathe = idle ? Math.sin(t * 2.6) * 0.045 : 0;        // gentle chest rise/fall
  const sway = Math.sin(t * 2.2) * (idle ? 0.07 : 0.025);       // weapon bob
  const blink = (t % 3.4) > 3.28;                               // quick blink ~every 3.4s
  g.save();
  g.translate(0, -bob);
  g.scale(1 - breathe * 0.35, 1 + breathe * 0.6);              // breathing squash/stretch

  function held(fn) { g.save(); g.rotate(aim + sway); g.translate(R * 0.7, R * 0.25); fn(); g.restore(); }
  function face(hx, hy, hr, eyeCol) {
    if (blink) {
      g.strokeStyle = eyeCol || '#1a1320'; g.lineWidth = hr * 0.12; g.lineCap = 'round';
      g.beginPath(); g.moveTo(hx - hr * 0.48, hy); g.lineTo(hx - hr * 0.2, hy); g.moveTo(hx + hr * 0.2, hy); g.lineTo(hx + hr * 0.48, hy); g.stroke(); g.lineCap = 'butt';
      return;
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(hx - hr * 0.34, hy, hr * 0.26, 0, TAU); g.arc(hx + hr * 0.34, hy, hr * 0.26, 0, TAU); g.fill();
    g.fillStyle = eyeCol || '#1a1320';
    const lx = Math.cos(aim) * hr * 0.13, ly = Math.sin(aim) * hr * 0.13;
    g.beginPath(); g.arc(hx - hr * 0.34 + lx, hy + ly, hr * 0.14, 0, TAU); g.arc(hx + hr * 0.34 + lx, hy + ly, hr * 0.14, 0, TAU); g.fill();
  }
  const glowOn = () => { g.shadowColor = color; g.shadowBlur = 9; };
  const glowOff = () => { g.shadowBlur = 0; };

  if (id === 'bronte') {                 // hulking armored brawler
    g.fillStyle = dark; g.fillRect(-R * 0.55, R * 0.45 + step, R * 0.42, R * 0.6); g.fillRect(R * 0.13, R * 0.45 - step, R * 0.42, R * 0.6);
    glowOn(); g.fillStyle = body; roundRect(-R * 0.98, -R * 0.35, R * 1.96, R * 1.05, R * 0.4, g); g.fill(); glowOff();
    g.fillStyle = dark; g.fillRect(-R * 0.98, R * 0.3, R * 1.96, R * 0.22);
    g.fillStyle = dark; g.beginPath(); g.arc(-R * 0.98, -R * 0.2, R * 0.5, 0, TAU); g.arc(R * 0.98, -R * 0.2, R * 0.5, 0, TAU); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(-R * 1.08, R * 0.35, R * 0.42, 0, TAU); g.arc(R * 1.08, R * 0.35, R * 0.42, 0, TAU); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.72, R * 0.58, 0, TAU); g.fill();
    g.fillStyle = body; g.fillRect(-R * 0.6, -R * 1.02, R * 1.2, R * 0.3);
    g.beginPath(); g.moveTo(R * 0.5, -R * 0.92); g.lineTo(R * 0.98, -R * 0.78); g.lineTo(R * 0.5, -R * 0.72); g.fill();
    face(0, -R * 0.68, R * 0.58);
    g.strokeStyle = '#3a1f00'; g.lineWidth = 2; g.beginPath();
    g.moveTo(-R * 0.42, -R * 0.92); g.lineTo(-R * 0.1, -R * 0.82); g.moveTo(R * 0.42, -R * 0.92); g.lineTo(R * 0.1, -R * 0.82); g.stroke();
  } else if (id === 'pip') {              // slim hooded archer
    g.fillStyle = dark; g.fillRect(-R * 0.45, R * 0.45 + step, R * 0.32, R * 0.62); g.fillRect(R * 0.13, R * 0.45 - step, R * 0.32, R * 0.62);
    glowOn(); g.fillStyle = body; roundRect(-R * 0.6, -R * 0.3, R * 1.2, R * 1.0, R * 0.42, g); g.fill(); glowOff();
    g.fillStyle = '#5a3a22'; g.fillRect(R * 0.28, -R * 0.55, R * 0.24, R * 0.82);
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(R * 0.4, -R * 0.55); g.lineTo(R * 0.4, -R * 0.95); g.moveTo(R * 0.5, -R * 0.5); g.lineTo(R * 0.5, -R * 0.9); g.stroke();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.6, R * 0.48, 0, TAU); g.fill();
    g.fillStyle = body; g.beginPath(); g.moveTo(-R * 0.52, -R * 0.5); g.quadraticCurveTo(0, -R * 1.75, R * 0.52, -R * 0.5); g.quadraticCurveTo(0, -R * 0.92, -R * 0.52, -R * 0.5); g.fill();
    face(0, -R * 0.56, R * 0.48);
    held(() => {
      g.strokeStyle = dark; g.lineWidth = 2.6; g.beginPath(); g.arc(0, 0, R * 0.72, -1.15, 1.15); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(R * 0.3, -R * 0.66); g.lineTo(R * 0.3, R * 0.66); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(R * 0.3, -1, R * 0.5, 2);
    });
  } else if (id === 'volt') {             // wizard with staff
    glowOn(); g.fillStyle = body; g.beginPath(); g.moveTo(0, -R * 0.4); g.lineTo(-R * 0.88, R * 1.0); g.lineTo(R * 0.88, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = dark; g.fillRect(-R * 0.72, R * 0.84, R * 1.44, R * 0.2);
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.5, R * 0.46, 0, TAU); g.fill();
    g.fillStyle = body; g.beginPath(); g.moveTo(-R * 0.62, -R * 0.5); g.lineTo(0, -R * 1.9); g.lineTo(R * 0.62, -R * 0.5); g.closePath(); g.fill();
    g.fillStyle = dark; g.fillRect(-R * 0.68, -R * 0.6, R * 1.36, R * 0.18);
    g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(0, -R * 1.12, R * 0.13, 0, TAU); g.fill();
    face(0, -R * 0.48, R * 0.46);
    held(() => {
      g.strokeStyle = '#7a5a36'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-R * 0.3, R * 0.5); g.lineTo(R * 0.5, -R * 0.5); g.stroke(); g.lineCap = 'butt';
      g.fillStyle = body; g.shadowColor = color; g.shadowBlur = 13; g.beginPath(); g.arc(R * 0.55, -R * 0.58, R * 0.3, 0, TAU); g.fill(); g.shadowBlur = 0;
    });
  } else if (id === 'ember') {            // fire mage with flame hair
    glowOn(); g.fillStyle = body; g.beginPath(); g.moveTo(0, -R * 0.4); g.lineTo(-R * 0.86, R * 1.0); g.lineTo(R * 0.86, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = dark; g.fillRect(-R * 0.7, R * 0.84, R * 1.4, R * 0.2);
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.55, R * 0.46, 0, TAU); g.fill();
    for (let k = -1; k <= 1; k++) {
      const fl = 0.7 + Math.sin(t * 8 + k) * 0.3;
      g.fillStyle = k === 0 ? '#ffd24a' : '#ff6a2c'; g.shadowColor = '#ff6a2c'; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(k * R * 0.32 - R * 0.18, -R * 0.8); g.lineTo(k * R * 0.32, -R * (1.3 + fl * 0.5)); g.lineTo(k * R * 0.32 + R * 0.18, -R * 0.8); g.closePath(); g.fill();
    }
    g.shadowBlur = 0;
    face(0, -R * 0.52, R * 0.46, '#7a1500');
    held(() => { g.fillStyle = '#ffd24a'; g.shadowColor = '#ff6a2c'; g.shadowBlur = 14; g.beginPath(); g.arc(R * 0.45, -R * 0.4, R * 0.26, 0, TAU); g.fill(); g.fillStyle = '#ff5a3c'; g.beginPath(); g.arc(R * 0.45, -R * 0.4, R * 0.15, 0, TAU); g.fill(); g.shadowBlur = 0; });
  } else if (id === 'grimm') {            // hooded necromancer, skull face
    g.fillStyle = '#24221b'; g.fillRect(-R * 0.5, R * 0.45 + step, R * 0.36, R * 0.6); g.fillRect(R * 0.14, R * 0.45 - step, R * 0.36, R * 0.6);
    glowOn(); g.fillStyle = '#2a2620'; g.beginPath(); g.moveTo(0, -R * 0.5); g.lineTo(-R * 0.9, R * 1.0); g.lineTo(R * 0.9, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = body; g.beginPath(); g.arc(0, -R * 0.55, R * 0.5, 0, TAU); g.fill();            // skull
    g.fillStyle = '#1a1a14'; g.beginPath(); g.arc(-R * 0.2, -R * 0.58, R * 0.16, 0, TAU); g.arc(R * 0.2, -R * 0.58, R * 0.16, 0, TAU); g.fill();
    g.fillStyle = body; g.beginPath(); g.moveTo(-R * 0.55, -R * 0.5); g.quadraticCurveTo(0, -R * 1.5, R * 0.55, -R * 0.5); g.lineTo(R * 0.4, -R * 0.5); g.quadraticCurveTo(0, -R * 1.15, -R * 0.4, -R * 0.5); g.closePath(); g.fillStyle = '#3a352c'; g.fill();
    g.fillStyle = '#9affb0'; g.shadowColor = '#9affb0'; g.shadowBlur = 8; g.beginPath(); g.arc(-R * 0.2, -R * 0.58, R * 0.07, 0, TAU); g.arc(R * 0.2, -R * 0.58, R * 0.07, 0, TAU); g.fill(); g.shadowBlur = 0;
    held(() => { g.strokeStyle = '#d8d2c0'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-R * 0.2, R * 0.4); g.lineTo(R * 0.5, -R * 0.5); g.stroke(); g.fillStyle = '#9affb0'; g.shadowColor = '#9affb0'; g.shadowBlur = 10; g.beginPath(); g.arc(R * 0.55, -R * 0.55, R * 0.16, 0, TAU); g.fill(); g.shadowBlur = 0; g.lineCap = 'butt'; });
  } else if (id === 'nyx') {              // hooded assassin, twin daggers
    g.fillStyle = dark; g.fillRect(-R * 0.42, R * 0.45 + step, R * 0.3, R * 0.6); g.fillRect(R * 0.12, R * 0.45 - step, R * 0.3, R * 0.6);
    glowOn(); g.fillStyle = body; roundRect(-R * 0.58, -R * 0.3, R * 1.16, R * 1.0, R * 0.4, g); g.fill(); glowOff();
    g.fillStyle = body; g.beginPath(); g.moveTo(-R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 1.7, R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 0.7, -R * 0.55, -R * 0.35); g.fill();
    g.fillStyle = '#1a1320'; g.beginPath(); g.arc(0, -R * 0.5, R * 0.4, 0.1, Math.PI - 0.1); g.fill();   // shadowed face
    g.fillStyle = '#bfffff'; g.fillStyle = '#aef7ff'; g.shadowColor = '#aef7ff'; g.shadowBlur = 6;
    g.fillRect(-R * 0.26, -R * 0.56, R * 0.16, R * 0.07); g.fillRect(R * 0.1, -R * 0.56, R * 0.16, R * 0.07); g.shadowBlur = 0;
    const dagger = () => { g.fillStyle = '#cfcfe0'; g.beginPath(); g.moveTo(R * 0.7, 0); g.lineTo(-R * 0.1, -R * 0.18); g.lineTo(-R * 0.2, 0); g.lineTo(-R * 0.1, R * 0.18); g.closePath(); g.fill(); g.fillStyle = dark; g.fillRect(-R * 0.28, -R * 0.1, R * 0.12, R * 0.2); };
    held(() => { g.translate(0, -R * 0.35); dagger(); });
    held(() => { g.translate(0, R * 0.35); dagger(); });
  } else if (id === 'vesper') {           // radiant light-priestess, halo aura
    const pulse = 0.85 + Math.sin(t * 3) * 0.15;
    g.fillStyle = body; g.globalAlpha = 0.16 * pulse; g.beginPath(); g.arc(0, -R * 0.2, R * 1.5, 0, TAU); g.fill(); g.globalAlpha = 1;
    g.fillStyle = dark; g.fillRect(-R * 0.45, R * 0.45 + step, R * 0.32, R * 0.6); g.fillRect(R * 0.13, R * 0.45 - step, R * 0.32, R * 0.6);
    glowOn(); g.fillStyle = body; g.beginPath(); g.moveTo(0, -R * 0.4); g.lineTo(-R * 0.8, R * 1.0); g.lineTo(R * 0.8, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.55, R * 0.46, 0, TAU); g.fill();
    // halo ring above the head
    g.strokeStyle = '#fff7c0'; g.lineWidth = 2.4; g.shadowColor = body; g.shadowBlur = 12;
    g.beginPath(); g.ellipse(0, -R * 1.12, R * 0.5, R * 0.18, 0, 0, TAU); g.stroke(); g.shadowBlur = 0;
    face(0, -R * 0.52, R * 0.46, '#6b4d00');
    held(() => { g.fillStyle = '#fff7c0'; g.shadowColor = body; g.shadowBlur = 14; g.beginPath(); g.arc(R * 0.45, -R * 0.4, R * 0.24 * pulse, 0, TAU); g.fill(); g.shadowBlur = 0; });
  } else if (id === 'astra') {            // starseer, cloak with star motes
    g.fillStyle = dark; g.fillRect(-R * 0.42, R * 0.45 + step, R * 0.3, R * 0.6); g.fillRect(R * 0.12, R * 0.45 - step, R * 0.3, R * 0.6);
    glowOn(); g.fillStyle = body; g.beginPath(); g.moveTo(0, -R * 0.45); g.lineTo(-R * 0.86, R * 1.0); g.lineTo(R * 0.86, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = dark; g.beginPath(); g.moveTo(-R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 1.7, R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 0.7, -R * 0.55, -R * 0.35); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.5, R * 0.42, 0, TAU); g.fill();
    // little stars twinkling on the cloak
    for (let k = 0; k < 3; k++) { const tw = 0.4 + (Math.sin(t * 4 + k * 2) * 0.5 + 0.5) * 0.6; g.fillStyle = '#fff'; g.globalAlpha = tw; g.fillStyle = '#cfe0ff';
      g.beginPath(); g.arc((k - 1) * R * 0.4, R * 0.35 + k * 2, R * 0.07, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    face(0, -R * 0.48, R * 0.42, '#1b2255');
    held(() => { g.fillStyle = '#fff'; g.shadowColor = body; g.shadowBlur = 12; g.rotate(t * 2);
      g.beginPath(); for (let i = 0; i < 8; i++) { const rr = i % 2 ? R * 0.12 : R * 0.3; const a = i / 8 * TAU; g.lineTo(Math.cos(a) * rr + R * 0.45, Math.sin(a) * rr - R * 0.4); } g.closePath(); g.fill(); g.shadowBlur = 0; });
  } else if (id === 'glace') {            // frost knight, icy crystal pauldrons
    g.fillStyle = dark; g.fillRect(-R * 0.5, R * 0.45 + step, R * 0.36, R * 0.6); g.fillRect(R * 0.14, R * 0.45 - step, R * 0.36, R * 0.6);
    glowOn(); g.fillStyle = body; roundRect(-R * 0.92, -R * 0.32, R * 1.84, R * 1.02, R * 0.38, g); g.fill(); glowOff();
    g.fillStyle = '#eafcff'; g.beginPath(); g.moveTo(-R * 0.92, -R * 0.4); g.lineTo(-R * 0.6, -R * 0.95); g.lineTo(-R * 0.32, -R * 0.4); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(R * 0.32, -R * 0.4); g.lineTo(R * 0.6, -R * 0.95); g.lineTo(R * 0.92, -R * 0.4); g.closePath(); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -R * 0.62, R * 0.46, 0, TAU); g.fill();
    g.fillStyle = '#dff7ff'; g.fillRect(-R * 0.5, -R * 0.95, R * 1.0, R * 0.26);
    face(0, -R * 0.58, R * 0.46, '#0c3a4a');
    held(() => { g.fillStyle = '#eafcff'; g.shadowColor = body; g.shadowBlur = 12; g.rotate(aim * 0 + sway);
      g.beginPath(); g.moveTo(R * 0.8, 0); g.lineTo(R * 0.2, -R * 0.22); g.lineTo(R * 0.0, 0); g.lineTo(R * 0.2, R * 0.22); g.closePath(); g.fill(); g.shadowBlur = 0; });
  } else if (id === 'sythe') {            // plague alchemist, hooded with vials
    g.fillStyle = dark; g.fillRect(-R * 0.45, R * 0.45 + step, R * 0.32, R * 0.6); g.fillRect(R * 0.13, R * 0.45 - step, R * 0.32, R * 0.6);
    glowOn(); g.fillStyle = body; g.beginPath(); g.moveTo(0, -R * 0.45); g.lineTo(-R * 0.82, R * 1.0); g.lineTo(R * 0.82, R * 1.0); g.closePath(); g.fill(); glowOff();
    g.fillStyle = dark; g.beginPath(); g.moveTo(-R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 1.65, R * 0.55, -R * 0.35); g.quadraticCurveTo(0, -R * 0.7, -R * 0.55, -R * 0.35); g.fill();
    // plague-mask beak
    g.fillStyle = '#caf0a0'; g.beginPath(); g.arc(0, -R * 0.5, R * 0.4, 0.15, Math.PI - 0.15); g.fill();
    g.fillStyle = dark; g.beginPath(); g.moveTo(-R * 0.1, -R * 0.42); g.lineTo(R * 0.55 * Math.cos(aim), -R * 0.42 + R * 0.4 * Math.sin(aim)); g.lineTo(R * 0.1, -R * 0.3); g.closePath(); g.fill();
    g.fillStyle = '#9cff5a'; g.shadowColor = body; g.shadowBlur = 8; g.fillRect(-R * 0.28, -R * 0.58, R * 0.16, R * 0.08); g.fillRect(R * 0.12, -R * 0.58, R * 0.16, R * 0.08); g.shadowBlur = 0;
    held(() => { g.fillStyle = '#9cff5a'; g.shadowColor = body; g.shadowBlur = 12; g.beginPath(); g.arc(R * 0.45, -R * 0.38, R * 0.2, 0, TAU); g.fill(); g.shadowBlur = 0;
      g.fillStyle = '#dfffcf'; g.beginPath(); g.arc(R * 0.38, -R * 0.46, R * 0.07, 0, TAU); g.fill(); });
  } else {                                // generic fallback
    glowOn(); g.fillStyle = body; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); glowOff();
    face(0, -R * 0.1, R);
  }
  g.restore();
  g.shadowBlur = 0;
}

function drawPlayer(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // shadow
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(0, p.radius * 0.9, p.radius * 0.85, p.radius * 0.32, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // detailed hero sprite
  const aim = p.aimAngle ?? p.facing;
  drawHeroSprite(ctx, Game.char.id, p.color, p.accent, aim, now() / 1000, p.hurtFlash > 0, Math.hypot(p.vx, p.vy) > 30);
  // invuln shield
  if (p.invuln > 0) {
    ctx.globalAlpha = 0.4 + Math.sin(now() / 60) * 0.2;
    ctx.strokeStyle = '#bfefff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.radius + 8, 0, TAU); ctx.stroke();
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
  // keep the canvas locked to the viewport — covers mobile rotation / browser
  // chrome show-hide where the 'resize' event can fire before things settle
  if (window.innerWidth !== W || window.innerHeight !== H) resize();
  if (!Game.paused && Game.state === 'playing') update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ----------------------------- game over ----------------------------- */
function gameOver() {
  Game.state = 'gameover';
  Music.stop();
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
    if (q.get('screen') === 'charselect') renderCharSelect();
    if (q.has('demo') || q.has('warp')) {
      startRun(q.get('demo') || 'bronte');
      // warp: fast-forward N simulated frames so a screenshot shows live action
      const n = q.has('warp') ? Math.max(1, +q.get('warp') || 600) : 0;
      Input.joy.active = true;
      for (let i = 0; i < n; i++) {
        if (Game.state === 'levelup' && Game.pendingPerks) { choosePerk(Game.pendingPerks[0][0]); continue; }
        Input.joy.x = Math.cos(i * 0.05); Input.joy.y = Math.sin(i * 0.05);
        if (q.has('god')) Game.player.hp = Game.player.maxHp;   // keep alive for deep-biome screenshots
        update(1 / 60);
      }
      Input.joy.active = false; Input.joy.x = 0; Input.joy.y = 0;
      render();
    }
  } catch (e) {}
}
boot();
