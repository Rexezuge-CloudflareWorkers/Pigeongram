import { cloneElement, isValidElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useExitAnimation } from './useExitAnimation';

interface PresenceProps {
  /**
  The overlay's source of truth. When it flips off the child stays mounted for
  one exit beat and receives `exiting`.
  */
  visible: boolean;
  /**
  How long the exit keyframe runs. The default matches the 150ms exits.
  */
  exitMs?: number;
  children: ReactNode;
}

/**
 * Keeps an overlay mounted while it animates out and tells it that it is
 * leaving. The child must accept an optional `exiting` prop and add its own
 * `is-exiting` class; keeping the timing here means no caller has to hold
 * stale overlay props just to play an exit.
 *
 * A caller closes an overlay by nulling its state, so the child it had while
 * open is remembered for the exit beat — the alternative is every caller
 * keeping the closed overlay's data alive by hand.
 */
export function Presence({ visible, exitMs = 150, children }: PresenceProps) {
  const { mounted, exiting } = useExitAnimation(visible, exitMs);
  const [lastVisible, setLastVisible] = useState({ visible, child: children });
  if (lastVisible.visible !== visible) {
    setLastVisible({ visible, child: visible ? children : lastVisible.child });
  }
  if (!mounted) return null;
  const content = visible ? children : lastVisible.child;
  if (!isValidElement(content)) return <>{content}</>;
  return cloneElement(content as ReactElement<{ exiting?: boolean }>, { exiting });
}
