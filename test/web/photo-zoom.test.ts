import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  APPROXIMATE,
  clampView,
  DOUBLE_TAP_SCALE,
  distance,
  IDENTITY,
  MAX_SCALE,
  midpoint,
  MIN_SCALE,
  nextZoomStep,
  stageCenter,
  zoomAround,
} from '../../apps/web/src/photo-zoom';

/**
 * The viewer's zoom arithmetic. A wrong clamp drags a photo off its box; a
 * wrong step strands the toolbar between stops, so each bound is checked on
 * its own.
 */

function image(options: { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } = {}): HTMLImageElement {
  return {
    clientWidth: options.width ?? 400,
    clientHeight: options.height ?? 300,
    naturalWidth: options.naturalWidth ?? 800,
    naturalHeight: options.naturalHeight ?? 600,
    getAttribute: (name: string) => (name === 'width' || name === 'height' ? null : null),
  } as unknown as HTMLImageElement;
}

function stage(left: number, top: number, width: number, height: number): HTMLElement {
  return { getBoundingClientRect: () => ({ left, top, width, height }) } as unknown as HTMLElement;
}

describe('nextZoomStep', () => {
  it('moves to the next stop in each direction', () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1.5, 1)).toBe(2);
    expect(nextZoomStep(2, -1)).toBe(1.5);
    expect(nextZoomStep(4, -1)).toBe(3);
  });

  it('stops at the limits and ignores a scale already on a stop', () => {
    expect(nextZoomStep(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(nextZoomStep(MIN_SCALE, -1)).toBe(MIN_SCALE);
    expect(nextZoomStep(2 + APPROXIMATE / 2, 1)).toBe(3);
    expect(nextZoomStep(2 - APPROXIMATE / 2, -1)).toBe(1.5);
    expect(nextZoomStep(0.4, -1)).toBe(1);
  });
});

describe('clampView', () => {
  it('collapses to the identity at or below the minimum scale', () => {
    expect(clampView({ scale: 1, x: 50, y: 50 }, image())).toEqual(IDENTITY);
    expect(clampView({ scale: 0.5, x: 50, y: 50 }, null)).toEqual(IDENTITY);
    expect(clampView({ scale: 9, x: 0, y: 0 }, null)).toEqual({ scale: MAX_SCALE, x: 0, y: 0 });
  });

  it('centres the photo when the box has no size', () => {
    expect(clampView({ scale: 2, x: 5, y: 5 }, image({ width: 0, height: 0 }))).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('clamps a pan to the rendered content overflow', () => {
    // 800×600 fitted into 400×300: at 2× the overflow is 200 by 150.
    expect(clampView({ scale: 2, x: 500, y: -500 }, image())).toEqual({ scale: 2, x: 200, y: -150 });
    expect(clampView({ scale: 2, x: 120, y: -80 }, image())).toEqual({ scale: 2, x: 120, y: -80 });
  });

  it('uses the layout box when the image has no intrinsic size', () => {
    expect(clampView({ scale: 2, x: 100, y: 0 }, image({ naturalWidth: 0, naturalHeight: 0 }))).toEqual({
      scale: 2,
      x: 100,
      y: 0,
    });
  });

  it('reads the width and height attributes when the bitmap has not decoded', () => {
    const element = {
      clientWidth: 400,
      clientHeight: 300,
      naturalWidth: 0,
      naturalHeight: 0,
      getAttribute: (name: string) => (name === 'width' ? '1600' : '1200'),
    } as unknown as HTMLImageElement;

    expect(clampView({ scale: 2, x: 999, y: 0 }, element)).toEqual({ scale: 2, x: 200, y: 0 });
  });
});

describe('zoomAround', () => {
  it('returns the identity when the scale lands at the minimum', () => {
    expect(zoomAround(IDENTITY, 1, { x: 100, y: 100 }, image())).toEqual(IDENTITY);
  });

  it('keeps the anchor fixed and clamps the result', () => {
    expect(zoomAround(IDENTITY, DOUBLE_TAP_SCALE, { x: 40, y: 20 }, image())).toEqual({
      scale: 2,
      x: -40,
      y: -20,
    });
    expect(zoomAround({ scale: 2, x: 0, y: 0 }, 9, { x: 0, y: 0 }, image())).toEqual({ scale: MAX_SCALE, x: 0, y: 0 });
  });
});

describe('screen geometry', () => {
  it('anchors a point to the stage centre', () => {
    expect(stageCenter(null)).toEqual({ x: 0, y: 0 });
    expect(stageCenter(stage(10, 20, 100, 50))).toEqual({ x: 60, y: 45 });
    expect(anchorPoint(60, 45, stage(10, 20, 100, 50))).toEqual({ x: 0, y: 0 });
    expect(anchorPoint(70, 25, stage(10, 20, 100, 50))).toEqual({ x: 10, y: -20 });
  });

  it('measures the midpoint and the distance between two pointers', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
    expect(distance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5);
  });
});
