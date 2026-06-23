/* ============================================================
   GLIMMERBONK — UI layer
   Screens, HUD, level-up cards, shop, mobile controls.
   Loaded BEFORE game.js (defines globals game.js calls).
   ============================================================ */
'use strict';

let UI = {};

function $(sel) { return document.querySelector(sel); }
function elFromHTML(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/* ----------------------------- screens ----------------------------- */
function hideAllScreens() { document.querySelectorAll('.screen').forEach(s => s.classList.remove('show')); }
function hideScreen(id) { const s = document.getElementById('scr-' + id); if (s) s.classList.remove('show'); }
function showScreen(id) {
  hideAllScreens();
  const s = document.getElementById('scr-' + id);
  if (s) s.classList.add('show');
}

/* ----------------------------- toast ----------------------------- */
let toastTimer = null;
function toast(msg) {
  const t = UI.toast;
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ----------------------------- HUD ----------------------------- */
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function updateHUD() {
  if (Game.state !== 'playing' && Game.state !== 'levelup') return;
  const p = Game.player; if (!p) return;
  UI.hpFill.style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
  UI.hpText.textContent = Math.max(0, Math.ceil(p.hp)) + ' / ' + Math.ceil(p.maxHp);
  UI.xpFill.style.width = clamp(p.xp / p.xpNext * 100, 0, 100) + '%';
  UI.lvl.textContent = 'LVL ' + p.level;
  UI.timer.textContent = fmtTime(Game.t);
  UI.glimmer.textContent = '💎 ' + Game.glimmerRun;
  UI.kills.textContent = '☠ ' + Game.killCount;
  UI.dashBtn && UI.dashBtn.classList.toggle('ready', p.dashCd <= 0);
}

/* ----------------------------- pause ----------------------------- */
function togglePause() {
  if (Game.state === 'playing') { Game.state = 'paused'; Game.paused = true; showScreen('pause'); }
  else if (Game.state === 'paused') { Game.state = 'playing'; Game.paused = false; hideScreen('pause'); }
}

/* ----------------------------- level-up ----------------------------- */
function showLevelUp() {
  const choices = Game.pendingPerks[0];
  const wrap = UI.perkCards;
  wrap.innerHTML = '';
  for (const perk of choices) {
    const count = (Game.player._perkCounts && Game.player._perkCounts[perk.id]) || 0;
    const card = elFromHTML(`
      <button class="perk-card ${perk.weapon ? 'perk-new' : ''}">
        <div class="perk-icon">${perk.icon}</div>
        <div class="perk-name">${perk.name}</div>
        <div class="perk-desc">${perk.desc}</div>
        ${count ? `<div class="perk-lvl">Lv.${count + 1}</div>` : ''}
      </button>`);
    card.addEventListener('click', () => choosePerk(perk));
    wrap.appendChild(card);
  }
  showScreen('levelup');
}

/* ----------------------------- game over ----------------------------- */
function showGameOver() {
  document.body.classList.remove('in-game');
  UI.goStats.innerHTML = `
    <div class="go-row"><span>Time survived</span><b>${fmtTime(Game.t)}</b></div>
    <div class="go-row"><span>Level reached</span><b>${Game.player.level}</b></div>
    <div class="go-row"><span>Enemies slain</span><b>${Game.killCount}</b></div>
    <div class="go-row glimmer"><span>Glimmer earned</span><b>💎 ${Game.glimmerRun}</b></div>
    <div class="go-row small"><span>Best time</span><b>${fmtTime(Save.data.bestTime)}</b></div>`;
  UI.goTitle.textContent = Game.bossActive ? 'YOU FELL...' : 'YOU FELL';
  showScreen('gameover');
}

/* ----------------------------- menu / character select ----------------------------- */
function renderMenu() {
  Music.stop();
  UI.menuStats.innerHTML =
    `<span>💎 ${Save.data.glimmer}</span><span>☠ ${Save.data.totalKills}</span><span>⏱ ${fmtTime(Save.data.bestTime)}</span>`;
  showScreen('menu');
  document.body.classList.remove('in-game');
}

function renderCharSelect() {
  const wrap = UI.charGrid;
  wrap.innerHTML = '';
  for (const c of CHARACTERS) {
    const unlocked = Save.data.unlocked.includes(c.id);
    const card = elFromHTML(`
      <div class="char-card ${unlocked ? '' : 'locked'}" style="--cc:${c.color}">
        <div class="char-portrait"><canvas width="96" height="96"></canvas></div>
        <div class="char-name">${c.name}</div>
        <div class="char-title">${c.title}</div>
        <div class="char-desc">${unlocked ? c.desc : '🔒 ' + (c.unlock ? c.unlock.hint : 'Locked')}</div>
        <div class="char-stats">
          <span>❤ ${c.maxHp}</span><span>👟 ${c.speed.toFixed(2)}x</span><span>🛡 ${c.armor || 0}</span>
          <span>⚔ ${WEAPONS[c.weapon].name}</span>
        </div>
        ${unlocked ? '<button class="btn play-btn">PLAY</button>' : '<div class="locked-tag">LOCKED</div>'}
      </div>`);
    drawPortrait(card.querySelector('canvas'), c);
    if (unlocked) card.querySelector('.play-btn').addEventListener('click', () => { Audio2.init(); startRun(c.id); });
    wrap.appendChild(card);
  }
  showScreen('charselect');
}

function drawPortrait(cv, c) {
  const x = cv.getContext('2d');
  x.clearRect(0, 0, 96, 96);
  // soft glow backdrop
  x.fillStyle = c.color; x.globalAlpha = 0.10;
  x.beginPath(); x.arc(48, 50, 40, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  // ground shadow
  x.globalAlpha = 0.25; x.fillStyle = '#000';
  x.beginPath(); x.ellipse(48, 78, 22, 7, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
  x.save(); x.translate(48, 54); x.scale(1.85, 1.85);
  // aim up-right so held weapons read nicely
  drawHeroSprite(x, c.id, c.color, c.accent, -0.5, 0, false, false);
  x.restore();
}

/* ----------------------------- shop ----------------------------- */
function shopCost(item) {
  const lvl = Save.shopLevel(item.id);
  return Math.round(item.base * Math.pow(item.growth, lvl));
}
function renderShop() {
  UI.shopGlimmer.textContent = '💎 ' + Save.data.glimmer;
  const wrap = UI.shopGrid;
  wrap.innerHTML = '';
  for (const item of SHOP) {
    const lvl = Save.shopLevel(item.id);
    const maxed = lvl >= item.max;
    const cost = shopCost(item);
    const afford = Save.data.glimmer >= cost && !maxed;
    const card = elFromHTML(`
      <div class="shop-card ${maxed ? 'maxed' : ''}">
        <div class="shop-icon">${item.icon}</div>
        <div class="shop-info">
          <div class="shop-name">${item.name} <span class="shop-lvl">${lvl}/${item.max}</span></div>
          <div class="shop-desc">${item.desc}</div>
          <div class="shop-pips">${pips(lvl, item.max)}</div>
        </div>
        <button class="btn buy-btn ${afford ? '' : 'disabled'}">
          ${maxed ? 'MAX' : '💎 ' + cost}
        </button>
      </div>`);
    const btn = card.querySelector('.buy-btn');
    if (!maxed) btn.addEventListener('click', () => {
      const c = shopCost(item);
      if (Save.data.glimmer >= c) {
        Save.data.glimmer -= c;
        Save.data.shop[item.id] = (Save.data.shop[item.id] || 0) + 1;
        Save.save(); Audio2.init(); Audio2.pickup();
        renderShop();
      } else toast('Not enough Glimmer');
    });
    wrap.appendChild(card);
  }
  showScreen('shop');
}
function pips(n, max) { let s = ''; for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`; return s; }

/* ----------------------------- achievements ----------------------------- */
function renderAch() {
  const wrap = UI.achGrid;
  wrap.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const done = Save.data.achievements[a.id];
    wrap.appendChild(elFromHTML(`
      <div class="ach-card ${done ? 'done' : ''}">
        <div class="ach-ic">${done ? '🏆' : '🔒'}</div>
        <div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div>
      </div>`));
  }
  showScreen('ach');
}

/* ----------------------------- mobile controls ----------------------------- */
function isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }

function setupTouch() {
  if (!isTouch()) return;
  document.body.classList.add('touch');
  const base = UI.joyBase, thumb = UI.joyThumb, zone = UI.joyZone;
  let joyId = null, cx = 0, cy = 0;
  const R = 56;

  function startJoy(t) {
    joyId = t.identifier; cx = t.clientX; cy = t.clientY;
    base.style.left = cx + 'px'; base.style.top = cy + 'px';
    thumb.style.left = cx + 'px'; thumb.style.top = cy + 'px';
    base.classList.add('show'); thumb.classList.add('show');
    Input.joy.active = true; Input.joy.x = 0; Input.joy.y = 0;
  }
  function moveJoy(t) {
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    thumb.style.left = (cx + dx) + 'px'; thumb.style.top = (cy + dy) + 'px';
    Input.joy.x = dx / R; Input.joy.y = dy / R;
  }
  function endJoy() {
    joyId = null; Input.joy.active = false; Input.joy.x = 0; Input.joy.y = 0;
    base.classList.remove('show'); thumb.classList.remove('show');
  }

  zone.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) { if (joyId === null) { startJoy(t); break; } }
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === joyId) moveJoy(t);
  }, { passive: false });
  zone.addEventListener('touchend', e => {
    for (const t of e.changedTouches) if (t.identifier === joyId) endJoy();
  });
  zone.addEventListener('touchcancel', endJoy);

  UI.dashBtn.addEventListener('touchstart', e => { e.preventDefault(); triggerDash(); }, { passive: false });
}

/* ----------------------------- build everything ----------------------------- */
function buildUI() {
  const root = document.getElementById('ui');
  root.innerHTML = `
  <!-- HUD -->
  <div id="hud">
    <div class="xpbar"><div id="xpfill"></div></div>
    <div class="hud-row">
      <div class="hud-left">
        <div class="hpbar"><div id="hpfill"></div><span id="hptext"></span></div>
      </div>
      <div class="hud-center"><div id="lvl">LVL 1</div><div id="timer">0:00</div></div>
      <div class="hud-right"><span id="glimmer">💎 0</span><span id="kills">☠ 0</span></div>
    </div>
    <button id="pauseBtn" aria-label="Pause">⏸</button>
  </div>

  <!-- mobile -->
  <div id="joyzone"></div>
  <div id="joybase"></div>
  <div id="joythumb"></div>
  <button id="dashBtn">DASH</button>

  <div id="toast"></div>

  <!-- MENU -->
  <div class="screen show" id="scr-menu">
    <div class="logo"><h1>GLIMMER<span>BONK</span></h1><p class="tag">Survive the swarm. Bank the Glimmer.</p></div>
    <div id="menuStats" class="menu-stats"></div>
    <div class="menu-btns">
      <button class="btn big" id="btnPlay">▶ PLAY</button>
      <button class="btn" id="btnShop">🛒 Shop</button>
      <button class="btn" id="btnAch">🏆 Achievements</button>
      <div class="toggle-row">
        <button class="btn ghost" id="btnMute">🔊 Sound</button>
        <button class="btn ghost" id="btnMusic">🎵 Music</button>
      </div>
    </div>
    <p class="hint">WASD / Arrows to move • Shift to dash • Esc to pause • Weapons auto-fire</p>
  </div>

  <!-- CHARACTER SELECT -->
  <div class="screen" id="scr-charselect">
    <div class="screen-head"><button class="btn back" data-back="menu">‹ Back</button><h2>Choose your Bonker</h2><span></span></div>
    <div id="charGrid" class="char-grid"></div>
  </div>

  <!-- SHOP -->
  <div class="screen" id="scr-shop">
    <div class="screen-head"><button class="btn back" data-back="menu">‹ Back</button><h2>Glimmer Forge</h2><span id="shopGlimmer">💎 0</span></div>
    <p class="sub">Permanent upgrades — they carry into every run.</p>
    <div id="shopGrid" class="shop-grid"></div>
  </div>

  <!-- ACHIEVEMENTS -->
  <div class="screen" id="scr-ach">
    <div class="screen-head"><button class="btn back" data-back="menu">‹ Back</button><h2>Achievements</h2><span></span></div>
    <div id="achGrid" class="ach-grid"></div>
  </div>

  <!-- LEVEL UP -->
  <div class="screen overlay" id="scr-levelup">
    <h2 class="lvlup-title">LEVEL UP!</h2>
    <p class="sub">Choose an upgrade</p>
    <div id="perkCards" class="perk-cards"></div>
  </div>

  <!-- PAUSE -->
  <div class="screen overlay" id="scr-pause">
    <h2>PAUSED</h2>
    <div class="menu-btns">
      <button class="btn big" id="btnResume">▶ Resume</button>
      <button class="btn ghost" id="btnQuit">✖ Quit to Menu</button>
    </div>
  </div>

  <!-- GAME OVER -->
  <div class="screen overlay" id="scr-gameover">
    <h2 class="go-title" id="goTitle">YOU FELL</h2>
    <div id="goStats" class="go-stats"></div>
    <div class="menu-btns">
      <button class="btn big" id="btnRetry">↻ Play Again</button>
      <button class="btn" id="btnGoShop">🛒 Shop</button>
      <button class="btn ghost" id="btnGoMenu">⌂ Menu</button>
    </div>
  </div>`;

  // cache refs
  UI = {
    hpFill: $('#hpfill'), hpText: $('#hptext'), xpFill: $('#xpfill'),
    lvl: $('#lvl'), timer: $('#timer'), glimmer: $('#glimmer'), kills: $('#kills'),
    toast: $('#toast'), perkCards: $('#perkCards'), goStats: $('#goStats'), goTitle: $('#goTitle'),
    menuStats: $('#menuStats'), charGrid: $('#charGrid'), shopGrid: $('#shopGrid'),
    shopGlimmer: $('#shopGlimmer'), achGrid: $('#achGrid'),
    joyZone: $('#joyzone'), joyBase: $('#joybase'), joyThumb: $('#joythumb'), dashBtn: $('#dashBtn'),
  };

  // wire buttons
  const click = () => { Audio2.init(); Audio2.ui(); };
  $('#btnPlay').onclick = () => { click(); renderCharSelect(); };
  $('#btnShop').onclick = () => { click(); renderShop(); };
  $('#btnAch').onclick = () => { click(); renderAch(); };
  $('#btnMute').onclick = () => { Save.data.muted = !Save.data.muted; Save.save(); Music.setMuted(Save.data.muted); $('#btnMute').textContent = Save.data.muted ? '🔇 Muted' : '🔊 Sound'; };
  $('#btnMute').textContent = Save.data.muted ? '🔇 Muted' : '🔊 Sound';
  $('#btnMusic').onclick = () => {
    Save.data.musicOff = !Save.data.musicOff; Save.save();
    if (Save.data.musicOff) Music.stop();
    else if (['playing', 'paused', 'levelup'].includes(Game.state)) { Audio2.init(); Music.start(); }
    $('#btnMusic').textContent = Save.data.musicOff ? '🎵 Music Off' : '🎵 Music On';
  };
  $('#btnMusic').textContent = Save.data.musicOff ? '🎵 Music Off' : '🎵 Music On';
  $('#pauseBtn').onclick = togglePause;
  $('#btnResume').onclick = togglePause;
  $('#btnQuit').onclick = quitToMenu;
  $('#btnRetry').onclick = () => startRun(Game.char.id);
  $('#btnGoShop').onclick = renderShop;
  $('#btnGoMenu').onclick = renderMenu;
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
    if (b.dataset.back === 'menu') renderMenu();
  });

  setupTouch();
  renderMenu();
}

function quitToMenu() {
  // bank glimmer earned so far
  Save.data.glimmer += Game.glimmerRun;
  Save.data.totalGlimmer += Game.glimmerRun;
  Save.save();
  Game.state = 'menu'; Game.paused = true;
  Game.glimmerRun = 0;
  renderMenu();
}
