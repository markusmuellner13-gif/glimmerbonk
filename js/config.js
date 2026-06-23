/* ============================================================
   GLIMMERBONK — game data & configuration
   All tunable content lives here: characters, weapons, enemies,
   bosses, biomes, perks, shop upgrades, achievements.
   ============================================================ */

const CONFIG = {
  version: "1.0.0",
  bossEvery: 120,        // seconds between boss waves
  biomeEvery: 90,        // seconds between biome shifts
  baseSpawnInterval: 1.25,
  worldFriction: 0.86,
};

/* ---------- WEAPONS ----------
   behavior: 'projectile' | 'spread' | 'orbit' | 'nova' | 'chain' | 'aura'
*/
const WEAPONS = {
  hammer: {
    name: "Bonk Hammers", behavior: "orbit", color: "#ff9d3c",
    cooldown: 0, dmg: 22, count: 2, radius: 78, orbitSpeed: 2.6, size: 22,
    desc: "Heavy hammers orbit you, bonking all they touch.",
  },
  arrow: {
    name: "Quickbow", behavior: "projectile", color: "#7CFF6B", proj: "arrow",
    cooldown: 0.42, dmg: 11, speed: 560, count: 1, pierce: 1, size: 8, range: 620,
    desc: "Fires fast arrows at the nearest foe.",
  },
  chain: {
    name: "Stormcoil", behavior: "chain", color: "#5BE9FF",
    cooldown: 0.9, dmg: 16, jumps: 3, range: 280, size: 6,
    desc: "Lightning leaps between nearby enemies.",
  },
  firenova: {
    name: "Cinderburst", behavior: "nova", color: "#ff5a3c", proj: "fireball",
    cooldown: 1.5, dmg: 20, count: 10, speed: 360, size: 10, range: 420, burn: 6,
    desc: "Explodes a ring of burning fireballs around you.",
  },
  boneshard: {
    name: "Bone Spray", behavior: "spread", color: "#e8e0d0", proj: "bone",
    cooldown: 0.7, dmg: 13, speed: 480, count: 3, spread: 0.32, pierce: 1, size: 7, range: 540,
    desc: "Hurls a fan of splintering bone shards.",
  },
  dagger: {
    name: "Shadow Fangs", behavior: "spread", color: "#c08bff", proj: "dagger",
    cooldown: 0.5, dmg: 9, speed: 640, count: 2, spread: 0.12, pierce: 1, size: 7, range: 560,
    crit: 0.25,
    desc: "Twin daggers with a wicked critical edge.",
  },
  // unlockable extra weapons (added via perks/achievements)
  aura: {
    name: "Glimmer Aura", behavior: "aura", color: "#ffe680",
    cooldown: 0.25, dmg: 6, radius: 96, size: 0,
    desc: "A searing field damages everything near you.",
  },
  starfall: {
    name: "Starfall", behavior: "nova", color: "#9db4ff", proj: "star",
    cooldown: 2.2, dmg: 26, count: 6, speed: 300, size: 12, range: 500, burn: 0,
    desc: "Calls down a slow ring of falling stars.",
  },
  frost: {
    name: "Frostlance", behavior: "projectile", color: "#7fdfff", proj: "star",
    cooldown: 0.6, dmg: 14, speed: 520, count: 1, pierce: 2, size: 9, range: 600,
    slow: 0.45,
    desc: "Icy shards that pierce foes and chill them to a crawl.",
  },
  venom: {
    name: "Plague Spit", behavior: "spread", color: "#9cff5a", proj: "bullet",
    cooldown: 0.66, dmg: 8, speed: 440, count: 3, spread: 0.26, pierce: 1, size: 8, range: 520,
    burn: 9,
    desc: "A spray of toxic globs that poison everything they touch.",
  },
};

/* ---------- CHARACTERS ---------- */
const CHARACTERS = [
  {
    id: "bronte", name: "Brontë Bonkfist", title: "The Unmovable",
    color: "#ff9d3c", accent: "#5a2d00",
    desc: "A boulder of a brawler. Slow, but nigh unkillable, with hammers that never stop spinning.",
    maxHp: 150, speed: 0.92, armor: 2,
    weapon: "hammer",
    stats: { damage: 1.0, area: 1.15, maxHpBonus: 0 },
    unlock: null,
  },
  {
    id: "pip", name: "Pip Quickfletch", title: "The Blur",
    color: "#7CFF6B", accent: "#0c4a17",
    desc: "Fastest feet in the vale. Fragile, but rains arrows before foes get close.",
    maxHp: 92, speed: 1.26, armor: 0,
    weapon: "arrow",
    stats: { damage: 1.0, fireRateMult: 1.1, projectileSpeedMult: 1.15 },
    unlock: null,
  },
  {
    id: "volt", name: "Volt Sparkwise", title: "The Conductor",
    color: "#5BE9FF", accent: "#063a52",
    desc: "A balanced storm-mage. Chain lightning melts dense crowds.",
    maxHp: 108, speed: 1.05, armor: 1,
    weapon: "chain",
    stats: { damage: 1.05 },
    unlock: null,
  },
  {
    id: "ember", name: "Ember Vex", title: "The Pyre",
    color: "#ff5a3c", accent: "#5c1500",
    desc: "Erupts in rings of fire. Unlocked by reaching level 12 in a single run.",
    maxHp: 100, speed: 1.04, armor: 0,
    weapon: "firenova",
    stats: { damage: 1.0, area: 1.1 },
    unlock: { ach: "lvl12", hint: "Reach level 12 in one run." },
  },
  {
    id: "grimm", name: "Grimm Hollow", title: "The Gravecaller",
    color: "#bdbda8", accent: "#2a2a22",
    desc: "Sprays splintered bone in a deadly fan. Unlocked by slaying your first boss.",
    maxHp: 116, speed: 1.0, armor: 1,
    weapon: "boneshard",
    stats: { damage: 1.05 },
    unlock: { ach: "boss1", hint: "Defeat any boss." },
  },
  {
    id: "nyx", name: "Nyx Shade", title: "The Whisper",
    color: "#c08bff", accent: "#2c0a52",
    desc: "Strikes from the dark with critical fangs. Unlocked by banking 1500 total Glimmer.",
    maxHp: 88, speed: 1.18, armor: 0,
    weapon: "dagger",
    stats: { damage: 1.0, critChance: 0.15, critMult: 0.5 },
    unlock: { ach: "glimmer1500", hint: "Bank 1500 Glimmer in total." },
  },
  {
    id: "vesper", name: "Vesper Sunwell", title: "The Radiant",
    color: "#ffe680", accent: "#6b4d00",
    desc: "A living beacon wreathed in searing light. Unlocked by incinerating 100 Slimes with Cinderburst fireballs.",
    maxHp: 104, speed: 1.06, armor: 1,
    weapon: "aura",
    stats: { damage: 1.0, area: 1.18 },
    unlock: { ach: "pyromaniac", hint: "Incinerate 100 Slimes with fireballs (play Ember Vex)." },
  },
  {
    id: "astra", name: "Astra Nightfall", title: "The Stargazer",
    color: "#9db4ff", accent: "#1b2255",
    desc: "Calls the heavens down on her foes. Unlocked by zapping 350 enemies with Stormcoil lightning.",
    maxHp: 96, speed: 1.12, armor: 0,
    weapon: "starfall",
    stats: { damage: 1.05, area: 1.1 },
    unlock: { ach: "thunderlord", hint: "Zap 350 enemies with chain lightning (play Volt)." },
  },
  {
    id: "glace", name: "Glace Wintermend", title: "The Frostward",
    color: "#7fdfff", accent: "#0c3a4a",
    desc: "Freezes the swarm with piercing ice. Unlocked by bonking 350 enemies with Bonk Hammers.",
    maxHp: 120, speed: 1.0, armor: 1,
    weapon: "frost",
    stats: { damage: 1.0, pierce: 0 },
    unlock: { ach: "crushblow", hint: "Bonk 350 enemies with hammers (play Brontë)." },
  },
  {
    id: "sythe", name: "Sythe Venomar", title: "The Plaguebearer",
    color: "#9cff5a", accent: "#1f4a0c",
    desc: "Drowns the horde in toxic rot. Unlocked by skewering 500 enemies with Quickbow arrows.",
    maxHp: 100, speed: 1.1, armor: 0,
    weapon: "venom",
    stats: { damage: 1.0, fireRateMult: 1.05 },
    unlock: { ach: "volley", hint: "Skewer 500 enemies with arrows (play Pip)." },
  },
];

/* ---------- ENEMIES ----------
   tier 1 = weak swarm ... tier 4 = elite. Bosses defined separately.
   biomes pick from these by tier as time rises.
*/
const ENEMIES = {
  slime:   { name:"Slime",    tier:1, hp:14,  speed:52,  dmg:6,  radius:14, color:"#6fe06f", xp:1, glimmer:1, shape:"blob" },
  bat:     { name:"Bat",      tier:1, hp:9,   speed:96,  dmg:5,  radius:11, color:"#9a7bd6", xp:1, glimmer:1, shape:"bat", wobble:true },
  rat:     { name:"Rat",      tier:1, hp:11,  speed:74,  dmg:5,  radius:12, color:"#b08968", xp:1, glimmer:1, shape:"rat" },
  goblin:  { name:"Goblin",   tier:2, hp:30,  speed:66,  dmg:9,  radius:15, color:"#7fae4f", xp:2, glimmer:2, shape:"goblin" },
  skeleton:{ name:"Skeleton", tier:2, hp:26,  speed:60,  dmg:8,  radius:14, color:"#dcd6c2", xp:2, glimmer:2, shape:"skeleton" },
  spider:  { name:"Spider",   tier:2, hp:22,  speed:108, dmg:8,  radius:14, color:"#4a4a6a", xp:2, glimmer:2, shape:"spider" },
  orc:     { name:"Orc",      tier:3, hp:70,  speed:58,  dmg:14, radius:19, color:"#5e8c5e", xp:4, glimmer:4, shape:"orc" },
  wraith:  { name:"Wraith",   tier:3, hp:54,  speed:84,  dmg:12, radius:17, color:"#7d8cff", xp:4, glimmer:4, shape:"wraith", wobble:true },
  golem:   { name:"Golem",    tier:3, hp:130, speed:40,  dmg:18, radius:24, color:"#8a8a96", xp:6, glimmer:6, shape:"golem", armor:3 },
  brute:   { name:"Brute",    tier:4, hp:200, speed:54,  dmg:22, radius:27, color:"#c0563c", xp:9, glimmer:9, shape:"brute", armor:2 },
  shaman:  { name:"Shaman",   tier:4, hp:120, speed:62,  dmg:14, radius:18, color:"#c08bff", xp:8, glimmer:8, shape:"shaman", ranged:true, shootEvery:2.4, projSpeed:200 },
  shade:   { name:"Voidshade",tier:4, hp:160, speed:118, dmg:20, radius:18, color:"#3a2a55", xp:10, glimmer:10, shape:"wraith", wobble:true },
};

/* ---------- BOSSES ---------- */
const BOSSES = [
  { id:"slimeking", name:"The Slime King", hp:1600, speed:46, dmg:24, radius:52, color:"#3fcf6f", xp:120, glimmer:120, shape:"boss_slime", ability:"splitspawn" },
  { id:"gravewarden", name:"The Gravewarden", hp:2600, speed:54, dmg:30, radius:48, color:"#cfc8b0", xp:180, glimmer:180, shape:"boss_warden", ability:"barrage" },
  { id:"stonecolossus", name:"Stone Colossus", hp:4200, speed:38, dmg:38, radius:60, color:"#9aa0ad", xp:260, glimmer:260, shape:"boss_golem", ability:"slam" },
  { id:"voidqueen", name:"The Void Queen", hp:6200, speed:62, dmg:44, radius:50, color:"#a06bff", xp:380, glimmer:380, shape:"boss_queen", ability:"spiral" },
  { id:"glimmerdragon", name:"Glimmerwyrm, the Endless", hp:9000, speed:70, dmg:52, radius:64, color:"#ffd24a", xp:600, glimmer:600, shape:"boss_dragon", ability:"all" },
];

/* ---------- BIOMES (visual + enemy palette by phase) ----------
   tile = checker floor tint, decor = scenery props, density 0..1 */
const BIOMES = [
  { name:"Greenwild Meadows", bg:"#13251a", tile:"#172d20", grid:"#21392a", tier:[1,1,2], accent:"#2e6b3e",
    grid2:"#244a30", decor:["tree","bush","flower","rock","tree"], decorDensity:0.34, path:"#1d3526" },
  { name:"Hollow Catacombs",  bg:"#16131f", tile:"#1c1828", grid:"#2a2236", tier:[1,2,2], accent:"#6a5aaa",
    grid2:"#332a44", decor:["gravestone","pillar","bone","rock","cross"], decorDensity:0.32, path:"#221c30" },
  { name:"Ashen Wastes",      bg:"#1e1410", tile:"#261813", grid:"#3a221c", tier:[2,2,3], accent:"#c2653a",
    grid2:"#48291f", decor:["deadtree","lavarock","rock","bone","deadtree"], decorDensity:0.30, path:"#2c1c14" },
  { name:"Frostbite Tundra",  bg:"#0f1d27", tile:"#13242f", grid:"#1b3340", tier:[2,3,3], accent:"#4d9ac2",
    grid2:"#264457", decor:["pine","icerock","snowmound","rock","pine"], decorDensity:0.32, path:"#193039" },
  { name:"Voidlands",         bg:"#140d1d", tile:"#1a1226", grid:"#2a1c3c", tier:[3,3,4], accent:"#9a52d0",
    grid2:"#3a2456", decor:["crystal","pillar","rock","crystal","void"], decorDensity:0.30, path:"#221634" },
  { name:"The Glimmercore",   bg:"#211907", tile:"#2a2009", grid:"#3a2c10", tier:[3,4,4], accent:"#e0b528",
    grid2:"#4d3a14", decor:["orevein","crystal","goldrock","crystal","orevein"], decorDensity:0.36, path:"#2f2410" },
];

/* ---------- PERKS (level-up choices) ---------- */
const PERKS = [
  { id:"dmg",     name:"Sharpened Edge",   icon:"⚔", desc:"+15% damage",            apply:s=>s.damage+=0.15, max:99 },
  { id:"firerate",name:"Rapid Hands",      icon:"⏩", desc:"+12% attack speed",      apply:s=>s.fireRateMult+=0.12, max:12 },
  { id:"speed",   name:"Swift Boots",      icon:"👟", desc:"+10% move speed",        apply:s=>s.moveSpeedMult+=0.10, max:8 },
  { id:"hp",      name:"Iron Vitality",    icon:"❤", desc:"+25 max HP & heal 25",   apply:(s,p)=>{s.maxHpBonus+=25;p.maxHp+=25;p.hp=Math.min(p.maxHp,p.hp+25);}, max:20 },
  { id:"proj",    name:"Split Shot",       icon:"✦", desc:"+1 projectile",          apply:s=>s.projectileCount+=1, max:6 },
  { id:"pierce",  name:"Piercing",         icon:"➳", desc:"+1 pierce",              apply:s=>s.pierce+=1, max:8 },
  { id:"area",    name:"Big Bonk",         icon:"◎", desc:"+18% area / size",       apply:s=>s.area+=0.18, max:10 },
  { id:"regen",   name:"Regeneration",     icon:"✚", desc:"+0.6 HP/sec regen",      apply:s=>s.regen+=0.6, max:12 },
  { id:"magnet",  name:"Magnetism",        icon:"🧲", desc:"+40% pickup range",      apply:s=>s.magnet+=0.4, max:8 },
  { id:"crit",    name:"Deadly Aim",       icon:"🎯", desc:"+8% crit, +20% crit dmg",apply:s=>{s.critChance+=0.08;s.critMult+=0.2;}, max:12 },
  { id:"xp",      name:"Quick Learner",    icon:"📖", desc:"+15% XP gain",           apply:s=>s.xpMult+=0.15, max:10 },
  { id:"armor",   name:"Plating",          icon:"🛡", desc:"+2 armor (flat block)",  apply:(s,p)=>p.armor+=2, max:15 },
  { id:"greed",   name:"Greed",            icon:"💎", desc:"+20% Glimmer gain",      apply:s=>s.glimmerMult+=0.2, max:10 },
  { id:"haste",   name:"Adrenaline",       icon:"⚡", desc:"+8% speed & +8% atk spd",apply:s=>{s.moveSpeedMult+=0.08;s.fireRateMult+=0.08;}, max:8 },
  // weapon-granting perks (rare)
  { id:"w_aura",  name:"NEW: Glimmer Aura",icon:"🔆", desc:"Gain a damaging aura",   weapon:"aura", max:1 },
  { id:"w_star",  name:"NEW: Starfall",    icon:"🌠", desc:"Gain falling stars",     weapon:"starfall", max:1 },
];

/* ---------- META SHOP (permanent, bought with Glimmer) ---------- */
const SHOP = [
  { id:"m_hp",    name:"Vitality",   icon:"❤", desc:"+12 starting Max HP",   base:40,  growth:1.5, max:10, key:"maxHpBonus", val:12 },
  { id:"m_dmg",   name:"Might",      icon:"⚔", desc:"+6% damage",            base:50,  growth:1.55,max:10, key:"damage", val:0.06 },
  { id:"m_spd",   name:"Fleetfoot",  icon:"👟", desc:"+4% move speed",        base:45,  growth:1.5, max:8,  key:"moveSpeedMult", val:0.04 },
  { id:"m_arm",   name:"Bulwark",    icon:"🛡", desc:"+1 armor",              base:55,  growth:1.6, max:6,  key:"armor", val:1 },
  { id:"m_mag",   name:"Lodestone",  icon:"🧲", desc:"+20% pickup range",     base:35,  growth:1.45,max:6,  key:"magnet", val:0.2 },
  { id:"m_xp",    name:"Scholar",    icon:"📖", desc:"+6% XP gain",           base:50,  growth:1.5, max:8,  key:"xpMult", val:0.06 },
  { id:"m_greed", name:"Prospector", icon:"💎", desc:"+8% Glimmer gain",      base:60,  growth:1.55,max:8,  key:"glimmerMult", val:0.08 },
  { id:"m_regen", name:"Renewal",    icon:"✚", desc:"+0.3 HP/sec regen",     base:70,  growth:1.6, max:6,  key:"regen", val:0.3 },
  { id:"m_revive",name:"Phoenix Charm",icon:"🔥",desc:"Revive once per run", base:300, growth:2.0, max:2,  key:"revives", val:1 },
];

/* ---------- ACHIEVEMENTS ---------- */
const ACHIEVEMENTS = [
  { id:"firstblood", name:"First Blood",     desc:"Kill 10 enemies." },
  { id:"survive5",   name:"Survivor",        desc:"Survive 5 minutes in one run." },
  { id:"lvl12",      name:"Ascendant",       desc:"Reach level 12 in one run. (Unlocks Ember Vex)" },
  { id:"boss1",      name:"Boss Slayer",     desc:"Defeat any boss. (Unlocks Grimm Hollow)" },
  { id:"glimmer1500",name:"Glimmer Hoarder", desc:"Bank 1500 Glimmer total. (Unlocks Nyx Shade)" },
  { id:"untouchable",name:"Untouchable",     desc:"Reach 3 minutes without taking a hit." },
  { id:"slayer1000", name:"Exterminator",    desc:"Kill 1000 enemies total." },
  { id:"pyromaniac", name:"Pyromaniac",      desc:"Incinerate 100 Slimes with fireballs. (Unlocks Vesper Sunwell)" },
  { id:"thunderlord",name:"Thunderlord",     desc:"Zap 350 enemies with chain lightning. (Unlocks Astra Nightfall)" },
  { id:"crushblow",  name:"Crushing Blows",  desc:"Bonk 350 enemies with hammers. (Unlocks Glace Wintermend)" },
  { id:"volley",     name:"Volley Master",   desc:"Skewer 500 enemies with arrows. (Unlocks Sythe Venomar)" },
];
