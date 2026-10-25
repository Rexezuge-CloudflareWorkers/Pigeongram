import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder.
 *
 * The app needs four PNG files (the manifest icons and the iOS touch icon),
 * and a rasteriser is not worth a dependency: a PNG is a signature, three
 * chunks and a CRC, and Node's zlib already knows how to deflate. The encoder
 * writes 8-bit RGBA, which is what every icon here needs.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * Encodes straight RGBA bytes as a PNG.
 *
 * @param pixels The image, `width * height * 4` bytes, row by row.
 */
export function encodePng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  // Every scanline is prefixed with its filter byte; filter 0 is "none".
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(type.length + data.length);
  for (let index = 0; index < type.length; index += 1) body[index] = type.charCodeAt(index);
  body.set(data, type.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
