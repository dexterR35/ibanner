import { zlibSync } from 'fflate';

/** Minimal indexed-colour PNG encoder (colour type 3) for size-limited exports. */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * @param {Uint8Array} index palette index per pixel
 * @param {number[][]} palette RGB or RGBA entries (≤ 256)
 */
export function encodeIndexedPng(index, palette, width, height) {
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(index.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) => plte.set(c.slice(0, 3), i * 3));
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('PLTE', plte),
  ];
  if (palette.some((c) => c.length > 3 && c[3] < 255))
    parts.push(
      chunk(
        'tRNS',
        Uint8Array.from(palette, (c) => c[3] ?? 255),
      ),
    );
  parts.push(chunk('IDAT', zlibSync(rows, { level: 9 })), chunk('IEND', new Uint8Array()));
  return new Blob(parts, { type: 'image/png' });
}
