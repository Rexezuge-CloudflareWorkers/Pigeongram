/**
 * The pure geometry behind photo zoom. The viewer's hook owns React state and
 * gestures; this module only answers "what view does this zoom, anchor and pan
 * produce, and where may it stop?".
 *
 * A view is a scale plus a screen-space translation in pixels. The translation
 * is relative to the photo's layout centre, which is also its transform origin;
 * anchors and clamp bounds are therefore measured from that centre. Panning is
 * clamped to the photo's rendered content (the image's `object-fit: contain`
 * box), not to the stage, so a letterboxed photo cannot be dragged into empty
 * space.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2;
export const APPROXIMATE = 0.001;
export const IDENTITY: View = { scale: MIN_SCALE, x: 0, y: 0 };
const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
const CENTER: Point = { x: 0, y: 0 };

export interface Point {
  x: number;
  y: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface StoredView extends View {
  mediaId: number | null;
}

/**
 * The next toolbar stop in the requested direction, or the nearest limit when
 * the wheel has landed between stops.
 */
export function nextZoomStep(scale: number, direction: 1 | -1): number {
  return direction > 0
    ? (ZOOM_STEPS.find((value) => value > scale + APPROXIMATE) ?? MAX_SCALE)
    : (ZOOM_STEPS.findLast((value) => value < scale - APPROXIMATE) ?? MIN_SCALE);
}

/**
 * Zooms around `anchor`, keeping the content point under it fixed, then clamps
 * the result so the photo still fills its box.
 */
export function zoomAround(base: View, scale: number, anchor: Point, image: HTMLImageElement | null): View {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (next <= MIN_SCALE + APPROXIMATE) return IDENTITY;
  const ratio = next / base.scale;
  return clampView(
    {
      scale: next,
      x: anchor.x - (anchor.x - base.x) * ratio,
      y: anchor.y - (anchor.y - base.y) * ratio,
    },
    image,
  );
}

/**
 * Keeps the photo's scaled content covering its layout box. The bounds are the
 * overflow of the rendered content on each axis; at 1x they collapse to zero.
 */
export function clampView(view: View, image: HTMLImageElement | null): View {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  if (scale <= MIN_SCALE + APPROXIMATE) return IDENTITY;
  const boxWidth = image?.clientWidth ?? 0;
  const boxHeight = image?.clientHeight ?? 0;
  if (boxWidth <= 0 || boxHeight <= 0) return { scale, x: 0, y: 0 };
  const content = contentSize(image, boxWidth, boxHeight);
  const maxX = Math.max(0, (content.width * scale - boxWidth) / 2);
  const maxY = Math.max(0, (content.height * scale - boxHeight) / 2);
  return {
    scale,
    x: clamp(view.x, -maxX, maxX),
    y: clamp(view.y, -maxY, maxY),
  };
}

/**
 * Converts a client-space point to coordinates relative to the photo's layout
 * centre. The stage's padding is symmetrical, so its rect centre is also the
 * photo's centre even while the photo is transformed.
 */
export function anchorPoint(clientX: number, clientY: number, stage: HTMLElement | null): Point {
  const center = stageCenter(stage);
  return { x: clientX - center.x, y: clientY - center.y };
}

export function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function stageCenter(stage: HTMLElement | null): Point {
  if (stage === null) return CENTER;
  const rect = stage.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function contentSize(image: HTMLImageElement | null, boxWidth: number, boxHeight: number): { width: number; height: number } {
  const naturalWidth = image?.naturalWidth || Number(image?.getAttribute('width')) || 0;
  const naturalHeight = image?.naturalHeight || Number(image?.getAttribute('height')) || 0;
  if (naturalWidth <= 0 || naturalHeight <= 0) return { width: boxWidth, height: boxHeight };
  const fit = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  return { width: naturalWidth * fit, height: naturalHeight * fit };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
