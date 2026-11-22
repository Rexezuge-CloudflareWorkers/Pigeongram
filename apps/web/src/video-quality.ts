import type { VideoQualityDto } from './types';

/**
Which stream variant `Auto` means.

Telegram sends the primary document followed by its alternative qualities.
The primary is not necessarily the best or the cheapest — it is whatever the
sender's client uploaded — so playback picks the smallest variant that covers
the height the video is actually displayed at: the fitted height times the
device pixel ratio, capped at 1080p. Streaming a 4K variant into a phone
screen spends data on pixels nobody sees, and keeping the sender's
low-resolution primary is how a sharp display ended up with the soft copy.

A data-saving reader gets the smallest variant instead, and a video whose
qualities carry no dimensions falls back to the primary (`0`), which is the
URL the route serves without a `quality` parameter.
*/

/**
The height `Auto` will not exceed: past it the extra pixels are invisible on
the screens this client runs on, and the data cost is real.
*/
const AUTO_MAX_HEIGHT = 1080;

/**
The height the viewer shows a video at, in physical pixels: the media's own
aspect ratio fitted inside the viewport, times the device pixel ratio. This
is the size `Auto` has to cover — a landscape clip on a portrait phone is
shorter than the viewport by a wide margin.
*/
export function targetVideoHeight(
  media: { width: number | null; height: number | null },
  viewport: { width: number; height: number },
  devicePixelRatio: number,
): number {
  const width = viewport.width > 0 ? viewport.width : (media.width ?? 0);
  const height = viewport.height > 0 ? viewport.height : (media.height ?? 0);
  let fitted = height;
  if (media.width !== null && media.height !== null && media.width > 0 && media.height > 0) {
    fitted = Math.min(height, (width * media.height) / media.width);
  }
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(AUTO_MAX_HEIGHT, Math.max(1, Math.round(fitted * ratio)));
}

/**
The index of the variant `Auto` plays, or null when the video has no
alternatives. `targetHeight` is the physical height {@link targetVideoHeight}
resolved; `saveData` swaps the choice for the cheapest variant.
*/
export function autoQualityIndex(qualities: readonly VideoQualityDto[], targetHeight: number, saveData = false): number | null {
  if (qualities.length === 0) return null;
  if (saveData) return smallestQuality(qualities);
  const known = qualities.filter((quality) => heightOf(quality) !== null);
  if (known.length === 0) return qualities[0]?.index ?? null;
  const covering = known
    .filter((quality) => (heightOf(quality) as number) >= targetHeight)
    .sort((left, right) => (heightOf(left) as number) - (heightOf(right) as number));
  return covering[0]?.index ?? largestQuality(known);
}

function heightOf(quality: VideoQualityDto): number | null {
  return quality.height !== null && quality.height > 0 ? quality.height : null;
}

function largestQuality(qualities: readonly VideoQualityDto[]): number {
  let best = qualities[0];
  for (const quality of qualities) {
    if ((heightOf(quality) ?? 0) > (heightOf(best) ?? 0)) best = quality;
  }
  return best?.index ?? 0;
}

function smallestQuality(qualities: readonly VideoQualityDto[]): number {
  let best = qualities[0];
  for (const quality of qualities) {
    if ((heightOf(quality) ?? Infinity) < (heightOf(best) ?? Infinity)) best = quality;
  }
  return best?.index ?? 0;
}
