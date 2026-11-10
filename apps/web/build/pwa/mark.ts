/**
 * The app's mark, and the rasteriser that draws it.
 *
 * The mark is the folded paper plane the tab favicon carries: a rounded tile
 * with two wings, the upper one in `--accent` and the underside in `--badge`,
 * on the `--bg` tile. The geometry below is the favicon's own, in the
 * favicon's 32-unit box, so the icons and the tab mark are the same drawing.
 *
 * The icons are rasterised here rather than checked in as binaries: the art is
 * then one definition instead of a definition plus four files nobody can edit.
 * A test asserts that the palette still matches `base.css`.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type Point = readonly [number, number];

/**
The tile behind the mark: `--bg`.
*/
export const TILE_COLOR: Rgb = { r: 0x0e, g: 0x16, b: 0x21 };

/**
The upper wing: `--accent`.
*/
export const UPPER_WING_COLOR: Rgb = { r: 0x5e, g: 0xb5, b: 0xf7 };

/**
The underside of the fold: `--badge`.
*/
export const LOWER_WING_COLOR: Rgb = { r: 0x3f, g: 0x8f, b: 0xd0 };

/**
The box the mark is drawn in, in the favicon's units.
*/
const BOX = 32;

/**
The tile's corner radius, in the same units.
*/
const TILE_RADIUS = 7;

/**
 * The tile's corner radius as a fraction of the icon's edge, so an icon of
 * any size keeps the favicon's proportions.
 */
export const TILE_RADIUS_RATIO = TILE_RADIUS / BOX;

const UPPER_WING: readonly [Point, Point, Point] = [
  [27, 4.5],
  [4.5, 13],
  [14.5, 18],
];

const LOWER_WING: readonly [Point, Point, Point] = [
  [27, 4.5],
  [14.5, 18],
  [18, 27],
];

/**
 * How an icon is drawn.
 */
export interface IconShape {
  /**
   * The tile's corner radius, as a fraction of the icon's edge. Zero squares
   * the tile off, which is what the maskable and iOS icons want: the platform
   * masks the icon itself.
   */
  readonly radius: number;
  /**
   * The mark's size, as a fraction of the icon's edge.
   */
  readonly scale: number;
}

/**
 * Draws the mark into straight RGBA bytes.
 *
 * The edges are anti-aliased by supersampling: every pixel takes sixteen
 * samples and averages the ones that landed on the shape.
 */
export function renderIcon(size: number, shape: IconShape): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const samples = 4;
  const step = 1 / samples;
  const radius = shape.radius * size;
  const markSize = shape.scale * size;
  const origin = (size - markSize) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const pointX = x + (sampleX + 0.5) * step;
          const pointY = y + (sampleY + 0.5) * step;
          if (!insideTile(pointX, pointY, size, radius)) continue;
          const color = markColor(((pointX - origin) / markSize) * BOX, ((pointY - origin) / markSize) * BOX);
          covered += 1;
          red += color.r;
          green += color.g;
          blue += color.b;
        }
      }
      if (covered === 0) continue;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(red / covered);
      pixels[offset + 1] = Math.round(green / covered);
      pixels[offset + 2] = Math.round(blue / covered);
      pixels[offset + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }
  return pixels;
}

/**
 * The colour of the mark at a point in the mark's own box.
 */
function markColor(x: number, y: number): Rgb {
  if (insideTriangle(x, y, LOWER_WING)) return LOWER_WING_COLOR;
  if (insideTriangle(x, y, UPPER_WING)) return UPPER_WING_COLOR;
  return TILE_COLOR;
}

/**
 * Whether a point is on the tile: the whole square, with the corners rounded
 * off.
 */
function insideTile(x: number, y: number, size: number, radius: number): boolean {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  if (radius <= 0) return true;
  const centerX = Math.min(Math.max(x, radius), size - radius);
  const centerY = Math.min(Math.max(y, radius), size - radius);
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Whether a point is inside a triangle.
 */
function insideTriangle(x: number, y: number, [a, b, c]: readonly [Point, Point, Point]): boolean {
  const first = edge(x, y, a, b);
  const second = edge(x, y, b, c);
  const third = edge(x, y, c, a);
  const negative = first < 0 || second < 0 || third < 0;
  const positive = first > 0 || second > 0 || third > 0;
  return !(negative && positive);
}

function edge(x: number, y: number, a: Point, b: Point): number {
  return (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
}
