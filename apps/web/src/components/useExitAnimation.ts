import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for its exit animation after its visibility flips
 * off, so a dialog, toast or viewer can fade/scale out instead of vanishing.
 * `visible` is the source of truth; `exiting` reports the extra beat in
 * which the exit keyframe runs. Overlays add their matching `is-exiting`
 * class while it is true and the parent keeps rendering them.
 */
export function useExitAnimation(visible: boolean, exitMs = 200): { mounted: boolean; exiting: boolean } {
  const [phase, setPhase] = useState<'mounted' | 'closed'>(visible ? 'mounted' : 'closed');
  const exiting = phase === 'mounted' && !visible;
  useEffect(() => {
    if (phase !== 'mounted' || visible) return;
    const timer = setTimeout(() => setPhase('closed'), exitMs);
    return () => clearTimeout(timer);
  }, [phase, visible, exitMs]);
  const mounted = phase === 'mounted' || visible;
  return { mounted, exiting };
}
