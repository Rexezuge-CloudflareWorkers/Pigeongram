import { describe, expect, it } from 'vitest';
import { newerWindow, UNREAD_CONTEXT, unreadWindow, WINDOW_LIMIT } from '../../pages/src/thread-window';

describe('thread windows', () => {
  it('anchors the unread window above the read watermark', () => {
    const window = unreadWindow(100);
    expect(window).toEqual({ offsetId: 100, addOffset: UNREAD_CONTEXT - WINDOW_LIMIT });
    // The bridge clamps `addOffset` to -50, so the context has to sit inside
    // that bound or part of the intended page would be silently cut off.
    if (window === null) throw new Error('Expected an unread window');
    expect(window.addOffset).toBeGreaterThanOrEqual(-50);
  });

  it('keeps the newest window for a chat with no read watermark', () => {
    expect(unreadWindow(0)).toBeNull();
  });

  it('continues forward from the end of the loaded window', () => {
    expect(newerWindow(140)).toEqual({ offsetId: 140, addOffset: -WINDOW_LIMIT });
  });
});
