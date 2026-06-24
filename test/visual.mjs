/* Visual smoke test: open every screen in REAL headless Chromium, assert there
   are no console/page errors and that each screen's key element is actually
   visible with non-zero size, then save a screenshot of each to
   test/screenshots/ so you can eyeball layout.

   This does NOT do pixel-diffing — it catches "the screen is broken / blank /
   threw an error", not "this pixel moved 2px". Run: npm run test:visual
   (requires `npm i` first to pull in Playwright + `npx playwright install chromium`). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, 'test', 'screenshots');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* ---- tiny static server on an ephemeral port ---- */
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

fs.mkdirSync(SHOTS, { recursive: true });

/* ---- each screen: how to show it + an element that MUST be visible ---- */
const SCREENS = [
  { name: 'menu',        show: () => renderMenu(),                                              see: '#btnPlay' },
  { name: 'charselect',  show: () => renderCharSelect(),                                        see: '.char-card' },
  { name: 'shop',        show: () => renderShop(),                                              see: '.shop-card' },
  { name: 'achievements',show: () => renderAch(),                                               see: '.ach-card' },
  { name: 'levelup',     show: () => { GB.startRun('bronte'); offerLevelUp(); },                see: '.perk-card' },
  { name: 'gameover',    show: () => { GB.startRun('bronte'); showGameOver(); },                see: '#btnRetry' },
  { name: 'unlock',      show: () => showUnlockCelebration([GB.CHARACTERS.find(c => c.id === 'veil')], () => {}), see: '#btnUnlockCont' },
  { name: 'pause',       show: () => { GB.startRun('bronte'); GB.togglePause(); },              see: '#btnResume' },
];
const VIEWPORTS = [
  { name: 'portrait',  width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];

const failures = [];
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.GB && document.querySelector('#scr-menu'), null, { timeout: 5000 });

  console.log(`\n[${vp.name} ${vp.width}x${vp.height}]`);
  for (const s of SCREENS) {
    errors.length = 0;
    await page.evaluate(s.show);
    await page.waitForTimeout(250); // let pop/float animations settle
    const el = page.locator(s.see).first();
    const visible = await el.isVisible().catch(() => false);
    const box = visible ? await el.boundingBox() : null;
    const ok = visible && box && box.width >= 1 && box.height >= 1 && errors.length === 0;
    await page.screenshot({ path: path.join(SHOTS, `${s.name}-${vp.name}.png`) });
    if (!ok) {
      const why = !visible ? `'${s.see}' not visible`
        : !box || box.width < 1 || box.height < 1 ? `'${s.see}' has zero size`
        : errors.join('; ');
      failures.push(`${vp.name}/${s.name}: ${why}`);
      console.log(`  ✗ ${s.name} — ${why}`);
    } else {
      console.log(`  ✓ ${s.name}`);
    }
  }
  await page.close();
}

await browser.close();
server.close();

console.log(`\nScreenshots written to ${path.relative(ROOT, SHOTS)}/`);
if (failures.length) {
  console.error(`\n❌ VISUAL SMOKE TEST FAILED (${failures.length}):\n  - ` + failures.join('\n  - '));
  process.exit(1);
}
console.log('\n✅ VISUAL SMOKE TEST PASSED — every screen rendered, visible, and error-free in both orientations.');
