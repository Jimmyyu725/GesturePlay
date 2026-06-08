// Generates GestureSeek extension icons (16/32/48/128) as PNGs.
// No deps — raw RGBA buffer encoded to PNG via zlib.
// Motif: a pinch — two near-touching dots on a violet→blue gradient.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // raw with per-scanline filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size / 2;
  // two pinch dots, near touching, centered
  const dotR = size * 0.17;
  const cy = size * 0.52;
  const d1 = { x: size * 0.40, y: cy };
  const d2 = { x: size * 0.60, y: cy };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-square background mask
      const cornerR = size * 0.22;
      let inside = true;
      const cx = [cornerR, cornerR], cxr = [size - cornerR, cornerR],
            cbl = [cornerR, size - cornerR], cbr = [size - cornerR, size - cornerR];
      function outCorner(c) { return Math.hypot(x - c[0], y - c[1]) > cornerR; }
      if (x < cornerR && y < cornerR && outCorner(cx)) inside = false;
      if (x > size - cornerR && y < cornerR && outCorner(cxr)) inside = false;
      if (x < cornerR && y > size - cornerR && outCorner(cbl)) inside = false;
      if (x > size - cornerR && y > size - cornerR && outCorner(cbr)) inside = false;
      if (!inside) { buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 0; continue; }
      // diagonal gradient violet (#7c3aed) -> blue (#2563eb)
      const t = (x + y) / (2 * size);
      let R = Math.round(lerp(0x7c, 0x25, t));
      let G = Math.round(lerp(0x3a, 0x63, t));
      let B = Math.round(lerp(0xed, 0xeb, t));
      // pinch dots in white
      const inDot = Math.hypot(x - d1.x, y - d1.y) < dotR || Math.hypot(x - d2.x, y - d2.y) < dotR;
      if (inDot) { R = 255; G = 255; B = 255; }
      buf[i] = R; buf[i+1] = G; buf[i+2] = B; buf[i+3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), drawIcon(s));
  console.log(`wrote icon${s}.png`);
}
