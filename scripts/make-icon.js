// Draws the 256x256 app icon: a dark rounded square with five light waveform bars. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256;
const px = Buffer.alloc(N * N * 4);

const bg = [25, 25, 25];
const fg = [244, 244, 242];
const bars = [[64, 26], [96, 52], [128, 78], [160, 44], [192, 22]]; // [center x, half height]

const clamp = (v) => Math.max(0, Math.min(1, v));

function sdRoundRect(x, y, half, r) {
  const qx = Math.abs(x - N / 2) - (half - r);
  const qy = Math.abs(y - N / 2) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCapsule(x, y, cx, hh, r) {
  const top = N / 2 - hh + r, bottom = N / 2 + hh - r;
  const cy = Math.max(top, Math.min(bottom, y));
  return Math.hypot(x - cx, y - cy) - r;
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const a = clamp(0.5 - sdRoundRect(x + 0.5, y + 0.5, 126, 56));
    let col = bg;
    let barA = 0;
    for (const [cx, hh] of bars) barA = Math.max(barA, clamp(0.5 - sdCapsule(x + 0.5, y + 0.5, cx, hh, 9)));
    col = bg.map((c, k) => Math.round(c * (1 - barA) + fg[k] * barA));
    px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = Math.round(a * 255);
  }
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, png);
console.log('icon written', out);
