import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../apps/web/src/components/ConfirmDialog';

/**
 * The confirmation the SPA puts in front of a destructive action. Its modal
 * behaviours are the contract: focus lands on the safe choice, Tab stays in
 * the dialog, Escape and the scrim cancel, and focus goes back where it came
 * from.
 */

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog
      title="Delete the chat?"
      message="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...view, onConfirm, onCancel };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('ConfirmDialog', () => {
  it('shows both actions, focuses Cancel and locks the page scroll', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Delete the chat?' })).not.toBeNull();
    expect(screen.getByText('This cannot be undone.')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('runs the action it was given', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on the scrim but not on the dialog itself', () => {
    const { onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and swallows every dismissal while busy', () => {
    const { onCancel } = renderDialog({ busy: true, busyLabel: 'Deleting…' });

    expect(screen.getByRole('button', { name: 'Deleting…' })).not.toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape and restores focus to the opener', () => {
    const opener = document.createElement('button');
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
    document.body.appendChild(opener);
    opener.focus();

    const { unmount, onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
    opener.remove();
  });

  it('uses the return-focus callback when one was given', () => {
    const returnFocus = vi.fn();
    const { unmount } = renderDialog({ returnFocus });

    unmount();

    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog in both directions', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });

    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // From outside the dialog, either direction enters at the matching end.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('does not trap Tab when there is nowhere to go', () => {
    renderDialog({ busy: true });

    expect(() => fireEvent.keyDown(document, { key: 'Tab' })).not.toThrow();
  });
});
