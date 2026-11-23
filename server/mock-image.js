// Mock image for tests (AI_PROVIDER=mock): a small, valid PNG drawn here. Not AI output, never charged.
const zlib = require('zlib');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
/** A W×H gradient "scene" whose colours depend on the seed, so different requests give visibly different images. */
function mockPng(seed = 'x', W = 512, H = 768) {
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [20 + (h % 60), 40 + ((h >> 3) % 80), 70 + ((h >> 6) % 100)];
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const i = y * (W * 3 + 1) + 1 + x * 3;
      const t = y / H, band = Math.abs(y - H * 0.62) < 40 ? 50 : 0;
      raw[i] = Math.min(255, a[0] + t * 60 + band); raw[i + 1] = Math.min(255, a[1] + (x / W) * 70 + band); raw[i + 2] = Math.min(255, a[2] + t * 40);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { mockPng };
