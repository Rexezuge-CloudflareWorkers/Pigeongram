import { describe, expect, it } from 'vitest';
import type { VideoQualityDto } from '../../apps/web/src/types';
import { autoQualityIndex, targetVideoHeight } from '../../apps/web/src/video-quality';

/**
`Auto` quality: the variant is chosen from the height the video is shown at,
so a phone does not pull a 4K copy and a sharp display is not handed the
sender's low-resolution primary.
*/

function quality(index: number, height: number | null): VideoQualityDto {
  return { index, width: null, height, size: null, codec: null };
}

describe('targetVideoHeight', () => {
  it('fits a landscape clip inside a portrait viewport', () => {
    // 390×844 at 3x: the clip is 390 wide → 219 tall, capped nowhere.
    expect(targetVideoHeight({ width: 1280, height: 720 }, { width: 390, height: 844 }, 3)).toBe(658);
  });

  it('never asks for more than 1080 rows', () => {
    expect(targetVideoHeight({ width: 3840, height: 2160 }, { width: 2160, height: 2160 }, 1)).toBe(1080);
  });

  it('uses the viewport when the media carries no dimensions', () => {
    expect(targetVideoHeight({ width: null, height: null }, { width: 1024, height: 768 }, 1)).toBe(768);
  });
});

describe('autoQualityIndex', () => {
  it('picks the smallest variant that covers the target', () => {
    const qualities = [quality(0, 480), quality(1, 720), quality(2, 1080)];

    expect(autoQualityIndex(qualities, 576)).toBe(1);
  });

  it('takes the largest known variant when none covers the target', () => {
    const qualities = [quality(0, 240), quality(1, 360)];

    expect(autoQualityIndex(qualities, 768)).toBe(1);
  });

  it('picks the smallest variant for a data-saving reader', () => {
    const qualities = [quality(0, 480), quality(1, 1080)];

    expect(autoQualityIndex(qualities, 576, true)).toBe(0);
  });

  it('falls back to the primary when no variant names a height', () => {
    expect(autoQualityIndex([quality(0, null), quality(1, null)], 576)).toBe(0);
    expect(autoQualityIndex([], 576)).toBeNull();
  });
});
