import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOWER_WING_COLOR, TILE_COLOR, UPPER_WING_COLOR, renderIcon } from '../../pages/build/pwa/mark';
import { encodePng } from '../../pages/build/pwa/png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readHeader(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The IHDR chunk follows the 8-byte signature, the 4-byte length and the
  // 4-byte chunk type.
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function hex(color: { r: number; g: number; b: number }): string {
  return [color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('');
}

describe('the install icons', () => {
  it('writes a PNG the browser can read', () => {
    const bytes = encodePng(renderIcon(64, { radius: 0.2, scale: 0.8 }), 64, 64);
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(readHeader(bytes)).toEqual({ width: 64, height: 64 });
  });

  it('draws the mark in the app palette', () => {
    const pixels = renderIcon(64, { radius: 0, scale: 0.8 });
    const colours = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) continue;
      colours.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    }
    expect(colours.has(`${TILE_COLOR.r},${TILE_COLOR.g},${TILE_COLOR.b}`)).toBe(true);
    expect(colours.has(`${UPPER_WING_COLOR.r},${UPPER_WING_COLOR.g},${UPPER_WING_COLOR.b}`)).toBe(true);
    expect(colours.has(`${LOWER_WING_COLOR.r},${LOWER_WING_COLOR.g},${LOWER_WING_COLOR.b}`)).toBe(true);
  });

  it('rounds the corners of the tile and keeps the middle opaque', () => {
    const pixels = renderIcon(64, { radius: 0.2, scale: 0.8 });
    // The corner is outside the rounded tile.
    expect(pixels[3]).toBe(0);
    // The middle of the tile is painted.
    const middle = (32 * 64 + 32) * 4;
    expect(pixels[middle + 3]).toBe(255);
  });

  it('keeps the palette in step with base.css', () => {
    const css = readFileSync(new URL('../../pages/src/styles/base.css', import.meta.url), 'utf8');
    expect(css).toContain(`--bg: #${hex(TILE_COLOR)};`);
    expect(css).toContain(`--accent: #${hex(UPPER_WING_COLOR)};`);
    expect(css).toContain(`--badge: #${hex(LOWER_WING_COLOR)};`);
  });
});
