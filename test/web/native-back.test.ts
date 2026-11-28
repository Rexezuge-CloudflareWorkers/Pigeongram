import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeBack } from '../../apps/web/src/native-back';
import type { Route } from '../../apps/web/src/routes';

/**
The Android shell's back seam: the page answers whether it handled the press,
and only the chat list hands it back to the shell, which then leaves the app.
*/

afterEach(() => {
  delete globalThis.__pigeongramBack;
});

function harness(route: Route) {
  const back = vi.fn();
  const uninstall = installNativeBack({ back, route: () => route });
  return { uninstall, back };
}

describe('installNativeBack', () => {
  it('leaves the app from the chat list', () => {
    const { back } = harness({ view: 'list' });

    expect(globalThis.__pigeongramBack?.()).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('steps back from a chat', () => {
    const { back } = harness({ view: 'chat', chatId: 7, postId: null });

    expect(globalThis.__pigeongramBack?.()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('steps back from the archive and from a comments thread', () => {
    const archived = harness({ view: 'archived' });
    expect(globalThis.__pigeongramBack?.()).toBe(true);
    expect(archived.back).toHaveBeenCalledTimes(1);

    const comments = harness({ view: 'comments', chatId: 7, postId: 9 });
    expect(globalThis.__pigeongramBack?.()).toBe(true);
    expect(comments.back).toHaveBeenCalledTimes(1);
  });

  it('removes only its own handler', () => {
    const first = harness({ view: 'list' });
    const second = harness({ view: 'list' });

    first.uninstall();
    expect(globalThis.__pigeongramBack).toBeTypeOf('function');

    second.uninstall();
    expect(globalThis.__pigeongramBack).toBeUndefined();
  });
});
