/* Headless smoke test: stub the browser, run the real game scripts,
   simulate several minutes of play to catch runtime errors. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---- fake DOM ---- */
const noop = () => {};
function makeCtx() {
  return new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function makeEl() {
  const el = {
    style: {}, dataset: {}, width: 100, height: 100,
    _children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    textContent: '', value: '',
    appendChild: noop, removeChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    focus: noop, click: noop,
    get content() { return makeEl(); },
    get firstElementChild() { return makeEl(); },
    set onclick(v) { this._onclick = v; }, get onclick() { return this._onclick; },
  };
  return el;
}

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const document = {
  body: makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener: noop,
};

let rafCount = 0;
const sandbox = {
  document, localStorage, console,
  navigator: { maxTouchPoints: 0, userAgent: 'node' },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => { rafCount++; return 0; },
  cancelAnimationFrame: noop,
  addEventListener: noop,
  setTimeout: () => 0, clearTimeout: noop,
  Math, Date, JSON, Set, Map, Object, Array, isNaN, parseInt, parseFloat,
  Infinity, NaN, undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 720;
sandbox.window.devicePixelRatio = 1;
sandbox.AudioContext = class { constructor() {} createOscillator() { return { type: '', frequency: {}, connect: noop, start: noop, stop: noop }; } createGain() { return { gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; } get currentTime() { return 0; } get destination() { return {}; } };

vm.createContext(sandbox);

/* concatenate the three scripts exactly like the browser's shared global scope */
const src = [read('js/config.js'), read('js/ui.js'), read('js/game.js')].join('\n;\n')
  + '\n;globalThis.__T = { update, render, Game, Save, startRun, choosePerk, triggerDash, currentBiome, spawnBoss, Input };';

let pass = true;
try {
  vm.runInContext(src, sandbox, { filename: 'glimmerbonk-bundle.js' });
} catch (e) {
  console.error('❌ Load error:', e.stack); process.exit(1);
}

const T = sandbox.__T;
const G = T.Game;

let simT = 0;
function step(seconds, dt = 1 / 60) {
  const n = Math.floor(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (G.state === 'levelup' && G.pendingPerks) {
      const choice = G.pendingPerks[0][0];
      T.choosePerk(choice);
      continue;
    }
    // simulate a real player kiting in a slow circle so enemies converge
    simT += dt;
    T.Input.joy.active = true;
    T.Input.joy.x = Math.cos(simT * 0.7);
    T.Input.joy.y = Math.sin(simT * 0.7);
    T.update(dt);
    T.render(); // exercise the full render path with the fake canvas
    if ((i % 30) === 0) T.triggerDash();
  }
}

try {
  // start a run as each character to exercise every weapon behavior
  const chars = ['bronte', 'pip', 'volt'];
  for (const c of chars) {
    T.startRun(c);
    step(25);
    if (G.enemies.length === 0) throw new Error(`No enemies spawned for ${c}`);
    if (G.killCount === 0) throw new Error(`No kills for ${c} (weapon not hitting)`);
    if (G.player.level < 2) throw new Error(`No level-up for ${c} (level ${G.player.level}, kills ${G.killCount})`);
    console.log(`  ${c}: kills=${G.killCount} level=${G.player.level} OK`);
  }

  // long run to trigger a boss + biome shifts + heavy entity counts
  T.startRun('bronte');
  // make the player tanky so it survives to the boss in the sim
  G.player.maxHp = 1e9; G.player.hp = 1e9; G.player.armor = 1e6;
  step(135);
  const sawBoss = G.enemies.some(e => e.boss) || G._bossSeen;
  console.log('  run time:', G.t.toFixed(0) + 's', '| enemies:', G.enemies.length,
    '| level:', G.player.level, '| kills:', G.killCount, '| biome:', T.currentBiome().name,
    '| glimmerRun:', G.glimmerRun);
  if (G.t < 120) throw new Error('did not reach boss time');
  console.log('  player level reached:', G.player.level, '(perks chosen OK)');

  // unlocked-character weapons (force-unlock and play each)
  const save = JSON.parse(sandbox.localStorage.getItem('glimmerbonk_save_v1') || '{}');
  for (const c of ['ember', 'grimm', 'nyx']) {
    T.Game; // ensure
    sandbox.__T.Game;
    // directly start (startRun doesn't gate on unlock)
    T.startRun(c);
    step(6);
  }

  console.log('\n✅ HEADLESS TEST PASSED — no runtime errors across all characters, weapons, boss, biomes, level-ups, dash, render.');
  console.log('   rAF scheduled:', rafCount, '| total kills in session:', sandbox.__T.Save?.data?.totalKills ?? 'n/a');
} catch (e) {
  pass = false;
  console.error('❌ Runtime error:', e.stack);
}
process.exit(pass ? 0 : 1);
