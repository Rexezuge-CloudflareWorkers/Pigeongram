import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for its exit animation after its visibility flips
 * off, so a dialog, toast or viewer can fade/scale out instead of vanishing.
 * `visible` is the source of truth; `exiting` reports the extra beat in
 * which the exit keyframe runs. Overlays add their matching `is-exiting`
 * class while it is true and the parent keeps rendering them.
 */
export function useExitAnimation(visible: boolean, exitMs = 200): { mounted: boolean; exiting: boolean } {
  // The previous `visible` is kept in state so the flip off is handled during
  // render (the overlay stays mounted for the beat) while the actual unmount
  // waits for the timer below. Keeping this in an effect instead would both
  // cascade a render and miss the first exit of an overlay that started closed.
  const [phase, setPhase] = useState({ visible, mounted: visible });
  if (phase.visible !== visible) {
    setPhase({ visible, mounted: visible || phase.mounted });
  }
  const exiting = phase.mounted && !visible;
  useEffect(() => {
    if (visible || !phase.mounted) return;
    const timer = setTimeout(() => setPhase({ visible: false, mounted: false }), exitMs);
    return () => clearTimeout(timer);
  }, [phase.mounted, visible, exitMs]);
  return { mounted: phase.mounted, exiting };
}
