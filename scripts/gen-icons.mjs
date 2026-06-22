/* Dependency-free PNG icon generator for GLIMMERBONK.
   Draws a neon "Glimmer gem" badge and writes PNGs via zlib. */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.cwd(), 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---- tiny CRC32 ---- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- drawing helpers on RGBA buffer ---- */
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ia = a / 255, ib = 1 - ia;
    buf[i] = buf[i] * ib + r * ia; buf[i + 1] = buf[i + 1] * ib + g * ia;
    buf[i + 2] = buf[i + 2] * ib + b * ia; buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const c = size / 2;
  // rounded background
  const rad = size * 0.46, corner = size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // rounded-square mask
    const dx = Math.abs(x - c) - (rad - corner), dy = Math.abs(y - c) - (rad - corner);
    const outside = (dx > 0 && dy > 0) ? Math.hypot(dx, dy) - corner : Math.max(dx, dy) - corner;
    if (outside < 1) {
      const t = y / size;
      const r = 18 + t * 14, g = 12 + t * 8, b = 32 + t * 28; // deep purple gradient
      set(x, y, r, g, b, 255);
    }
  }
  // glow disc behind gem
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c) / (size * 0.42);
    if (d < 1) set(x, y, 120, 80, 220, (1 - d) * 70);
  }
  // diamond gem (gold) with cyan top facet
  const gh = size * 0.30, gw = size * 0.24;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x - c) / gw, ny = (y - c) / gh;
    if (Math.abs(nx) + Math.abs(ny) <= 1) {
      // facet shading: top lighter (cyan), bottom gold
      if (ny < -0.05) set(x, y, 150, 235, 255, 255);
      else if (nx < 0) set(x, y, 255, 210, 74, 255);
      else set(x, y, 230, 170, 40, 255);
    }
  }
  // gem outline highlight
  for (let t = 0; t < 1; t += 0.002) {
    // top-left edge sparkle
    const x = c - gw * (1 - t), y = c - gh * t;
    set(x, y, 255, 255, 255, 200);
  }
  return encodePNG(size, size, buf);
}

for (const size of [192, 512]) {
  const png = makeIcon(size);
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  console.log('wrote icons/icon-' + size + '.png (' + png.length + ' bytes)');
}
// maskable = same art, generous padding already
fs.copyFileSync(path.join(OUT, 'icon-512.png'), path.join(OUT, 'maskable-512.png'));
console.log('wrote icons/maskable-512.png');
