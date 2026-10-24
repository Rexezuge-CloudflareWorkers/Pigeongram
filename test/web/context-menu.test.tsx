import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSuppressNativeContextMenu } from '../../pages/src/useSuppressNativeContextMenu';

/**
The document-level guard as `main.tsx` installs it: an effect on a host around
the app's tree.
*/
function Guarded({ children }: { children?: ReactNode }) {
  useSuppressNativeContextMenu();
  return <>{children}</>;
}

afterEach(cleanup);

describe('useSuppressNativeContextMenu', () => {
  it('cancels the browser menu on a plain element', () => {
    render(
      <Guarded>
        <div data-testid="target" />
      </Guarded>,
    );

    expect(fireEvent.contextMenu(screen.getByTestId('target'))).toBe(false);
  });

  it('still cancels it when a handler stops propagation', () => {
    render(
      <Guarded>
        <div data-testid="target" onContextMenu={(event) => event.stopPropagation()} />
      </Guarded>,
    );

    // The media viewer and the forward picker stop the event on their own
    // handler; only a capture-phase listener on the document sees it anyway.
    expect(fireEvent.contextMenu(screen.getByTestId('target'))).toBe(false);
  });

  it('lets the app handler run beside the suppression', () => {
    const handler = vi.fn();
    render(
      <Guarded>
        <div data-testid="target" onContextMenu={handler} />
      </Guarded>,
    );

    // `preventDefault` alone: the message menu still opens on a right-click.
    expect(fireEvent.contextMenu(screen.getByTestId('target'))).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps the browser menu in editable fields', () => {
    render(
      <Guarded>
        <input data-testid="input" />
        <textarea data-testid="textarea" />
        <div data-testid="editable" contentEditable />
      </Guarded>,
    );

    // Paste, copy and spellcheck have no replacement in the app.
    expect(fireEvent.contextMenu(screen.getByTestId('input'))).toBe(true);
    expect(fireEvent.contextMenu(screen.getByTestId('textarea'))).toBe(true);
    expect(fireEvent.contextMenu(screen.getByTestId('editable'))).toBe(true);
  });

  it('restores the browser menu when the app unmounts', () => {
    const { unmount } = render(<Guarded />);

    expect(fireEvent.contextMenu(document.body)).toBe(false);
    unmount();
    expect(fireEvent.contextMenu(document.body)).toBe(true);
  });
});
