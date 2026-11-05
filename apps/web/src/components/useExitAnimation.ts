import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for its exit animation after its visibility flips
 * off, so a dialog, toast or viewer can fade/scale out instead of vanishing.
 * `visible` is the source of truth; `exiting` reports the extra beat in
 * which the exit keyframe runs. Overlays add their matching `is-exiting`
 * class while it is true and the parent keeps rendering them.
 */
export function useExitAnimation(visible: boolean, exitMs = 200): { mounted: boolean; exiting: boolean } {
  const [mounted, setMounted] = useState(visible);
  const exiting = mounted && !visible;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, mounted, exitMs]);
  return { mounted, exiting };
}
