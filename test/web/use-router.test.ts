import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../apps/web/src/routes';
import { useRouter } from '../../apps/web/src/useRouter';

/**
 * The browser-history half of navigation: seeding the stack, pushing routes,
 * the viewer layer, and the popstate listener that keeps the screen in step.
 */

const APP = 'telegram-web-client';

function marker(depth: number, layer?: 'viewer'): Record<string, unknown> {
  return layer === undefined ? { app: APP, depth } : { app: APP, depth, layer };
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function harness(options: { canOpen?: (route: Route) => boolean; onViewerEnter?: () => void; onViewerLeave?: () => void } = {}) {
  const onRoute = vi.fn();
  const canOpen = options.canOpen ?? (() => true);
  const onViewerEnter = options.onViewerEnter ?? vi.fn();
  const onViewerLeave = options.onViewerLeave ?? vi.fn();
  const hook = renderHook(() => useRouter({ onRoute, canOpen, onViewerEnter, onViewerLeave }));
  return { ...hook, onRoute, onViewerEnter, onViewerLeave };
}

describe('useRouter', () => {
  it('boots a fresh list entry', () => {
    const test = harness();

    act(() => test.result.current.boot());

    expect(test.onRoute).toHaveBeenCalledWith({ view: 'list' }, expect.objectContaining({ force: false }));
    expect(history.state).toEqual(marker(0));
    expect(test.result.current.route()).toEqual({ view: 'list' });
  });

  it('seeds a parent behind a shared chat link', () => {
    history.replaceState(null, '', '/chat/2');
    const test = harness();

    act(() => test.result.current.boot());

    expect(history.state).toEqual(marker(1));
    expect(test.result.current.route()).toEqual({ view: 'chat', chatId: 2, postId: null });
  });

  it('seeds the chat and the post behind a shared comments link', () => {
    history.replaceState(null, '', '/chat/2/post/5/comments');
    const test = harness();

    act(() => test.result.current.boot());

    expect(history.state).toEqual(marker(2));
    expect(test.onRoute).toHaveBeenCalledWith({ view: 'comments', chatId: 2, postId: 5 }, expect.anything());
  });

  it('restores a reloaded entry and drops a viewer layer', () => {
    history.replaceState(marker(2, 'viewer'), '', '/chat/2');
    const test = harness();

    act(() => test.result.current.boot());

    expect(history.state).toEqual(marker(1));
    expect(test.result.current.route()).toEqual({ view: 'chat', chatId: 2, postId: null });
  });

  it('pushes the post parent when comments open from the list', () => {
    const test = harness();
    act(() => test.result.current.boot());

    act(() => test.result.current.navigateTo({ view: 'comments', chatId: 2, postId: 5 }));

    expect(history.state).toEqual(marker(2));
    expect(test.result.current.route()).toEqual({ view: 'comments', chatId: 2, postId: 5 });
  });

  it('does not push a parent when comments open from their own post', () => {
    history.replaceState(null, '', '/chat/2/post/5');
    const test = harness();
    act(() => test.result.current.boot());

    act(() => test.result.current.navigateTo({ view: 'comments', chatId: 2, postId: 5 }));

    expect(history.state).toEqual(marker(2));
  });

  it('reapplies the same route only when forced', () => {
    const test = harness();
    act(() => test.result.current.boot());
    test.onRoute.mockClear();

    act(() => test.result.current.navigateTo({ view: 'list' }));
    expect(test.onRoute).not.toHaveBeenCalled();

    act(() => test.result.current.navigateTo({ view: 'list' }, { force: true }));
    expect(test.onRoute).toHaveBeenCalledWith({ view: 'list' }, expect.objectContaining({ force: true }));
  });

  it('falls back to the list when a route cannot be opened', () => {
    const test = harness({ canOpen: (route) => route.view === 'list' });
    act(() => test.result.current.boot());
    test.onRoute.mockClear();

    act(() => test.result.current.navigateTo({ view: 'chat', chatId: 2, postId: null }));

    expect(history.state).toEqual(marker(1));
    expect(test.onRoute).toHaveBeenCalledWith({ view: 'list' }, expect.objectContaining({ replaceTo: expect.any(Function) as () => void }));
  });

  it('replaces the current entry through the returned helper', () => {
    const test = harness();
    act(() => test.result.current.boot());

    act(() => test.result.current.replaceTo({ view: 'archived' }));

    expect(history.state).toEqual(marker(0));
    expect(test.result.current.route()).toEqual({ view: 'archived' });
    expect(test.onRoute).toHaveBeenCalledWith({ view: 'archived' }, expect.anything());
  });

  it('walks back through the in-app stack and falls back to the parent', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const test = harness();
    act(() => test.result.current.boot());

    // The list itself is the floor.
    act(() => test.result.current.back());
    expect(back).not.toHaveBeenCalled();

    act(() => test.result.current.navigateTo({ view: 'chat', chatId: 2, postId: null }));
    act(() => test.result.current.back());
    expect(back).toHaveBeenCalledOnce();

    // An entry with no in-app parent is replaced by the route above it.
    act(() => test.result.current.replaceTo({ view: 'comments', chatId: 2, postId: 5 }));
    history.replaceState(marker(0), '', '/chat/2/post/5/comments');
    act(() => test.result.current.back());
    expect(test.result.current.route()).toEqual({ view: 'chat', chatId: 2, postId: 5 });
  });

  it('opens and closes the viewer layer', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const test = harness();
    act(() => test.result.current.boot());

    act(() => test.result.current.openViewer());
    expect(history.state).toEqual(marker(1, 'viewer'));

    act(() => test.result.current.closeViewer());
    expect(back).toHaveBeenCalledOnce();

    act(() => test.result.current.closeViewer());
    expect(back).toHaveBeenCalledOnce();
  });

  it('follows the viewer layer and route changes on popstate', () => {
    const test = harness();
    act(() => test.result.current.boot());

    history.replaceState(marker(1, 'viewer'), '', '/chat/2');
    act(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(test.onViewerEnter).toHaveBeenCalledOnce();

    history.replaceState(marker(1), '', '/chat/2');
    act(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(test.onViewerLeave).toHaveBeenCalledOnce();
    expect(test.result.current.route()).toEqual({ view: 'chat', chatId: 2, postId: null });

    history.replaceState(marker(1), '', '/archived');
    act(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(test.result.current.route()).toEqual({ view: 'archived' });
  });

  it('resets the stack on sign-out', () => {
    const test = harness();
    act(() => test.result.current.boot());
    act(() => test.result.current.navigateTo({ view: 'chat', chatId: 2, postId: null }));

    act(() => test.result.current.reset());

    expect(history.state).toEqual(marker(0));
    expect(test.result.current.route()).toEqual({ view: 'list' });

    // Sign-out stops applying routes until the next boot.
    test.onRoute.mockClear();
    act(() => test.result.current.navigateTo({ view: 'chat', chatId: 3, postId: null }));
    expect(test.onRoute).not.toHaveBeenCalled();
  });
});
