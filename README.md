# 💎 GLIMMERBONK

A neon **2D auto-shooter roguelite** for web & mobile — inspired by *Megabonk* / *Vampire Survivors*.
You move, your weapons fire themselves, you dodge the swarm, collect XP to level up, and bank **Glimmer** to grow stronger forever.

**Play:** open the deployed URL. On phones, tap the share/menu button → **Add to Home Screen** to install it as a full-screen app (PWA). Works offline after first load.

---

## 🎮 How to play

| | Desktop | Mobile |
|---|---|---|
| Move | `WASD` / Arrow keys | Left-side virtual joystick |
| Dash (brief speed + i-frames) | `Shift` | `DASH` button (bottom-right) |
| Pause | `Esc` | ⏸ top-right |
| Attack | Automatic — weapons target the nearest foe | Automatic |

- Kill enemies → they drop **XP gems** (blue) and **Glimmer** (gold).
- Fill the XP bar → **Level Up** → choose 1 of 3 upgrades.
- Survive escalating waves; a **boss** appears every 2 minutes and the biome shifts every 90s.
- Die or quit → your Glimmer is banked. Spend it in the **Glimmer Forge** for permanent upgrades.

## 🧙 Characters
3 to start, 12 more unlocked via achievements (each plays differently):

- **Brontë Bonkfist** — tanky brawler with orbiting hammers.
- **Pip Quickfletch** — fast, fragile archer.
- **Volt Sparkwise** — balanced chain-lightning mage.
- **Ember Vex** *(reach level 12 in a run)* — fire-nova mage.
- **Grimm Hollow** *(defeat any boss)* — bone-spray necromancer.
- **Nyx Shade** *(bank 1500 total Glimmer)* — crit assassin.
- **Vesper / Astra / Glace / Sythe** — unlocked by weapon-mastery feats.
- **Thorne Quakebrand** *(survive 10 min in a run)* — earthshaker.
- **Silas Longshot** *(5000 total kills)* — piercing sniper.
- **Cass Boomer** *(defeat 10 bosses)* — point-blank gunner.
- **Zephyr Galewind** *(bank 6000 total Glimmer)* — whirling wind-dancer.
- **Veil Mistwalker** *(reach 5 min without taking a hit)* — phantom glass-cannon.

The **Achievements** screen shows live progress bars toward every unlock, and earning one pops a celebration screen at the end of the run.

## 👾 Enemies
Tiered swarm — slimes/bats/rats → goblins/skeletons/spiders → orcs/wraiths/golems → brutes/shamans/voidshades, plus 5 escalating **bosses** (The Slime King, The Gravewarden, Stone Colossus, The Void Queen, and the endless Glimmerwyrm) that keep scaling after the loop.

## 🛠️ Tech
- Pure HTML5 Canvas + vanilla JS — **no framework, no build step**.
- Installable **PWA** (manifest + service worker, offline cache).
- Responsive: the view scales to any screen; touch controls appear only on touch devices.
- Saves progress to `localStorage`.

## 🚀 Develop locally
```bash
npm run icons   # (re)generate the PWA icons
npm run dev     # serve at http://localhost:5173
```

## 🧪 Tests
```bash
npm test            # fast headless logic test — runs the real game with a
                    # stubbed DOM + seeded RNG for several simulated minutes
                    # across every character/weapon/boss. ~1s, no browser.

npm run test:visual # visual smoke test — opens every screen (menu, char
                    # select, shop, achievements, level-up, game over, unlock
                    # celebration, pause) in real headless Chromium, in both
                    # portrait & landscape. Asserts each screen is visible and
                    # error-free, and writes a screenshot of each to
                    # test/screenshots/ (gitignored) to eyeball layout.
```
`test:visual` needs Playwright's browser once per machine:
```bash
npm install                       # pulls in Playwright (devDependency)
npx playwright install chromium   # downloads the headless browser (~110 MB)
```
The visual test is **not** pixel-diffing — it catches blank/broken/erroring
screens, not sub-pixel shifts, so it won't false-fail on intentional UI tweaks.

## 📦 Deploy
Hosted on **Vercel** as a static site. Every push to `main` auto-deploys.

---
Made with 🔨 and Glimmer.
