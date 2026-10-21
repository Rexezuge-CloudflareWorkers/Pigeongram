import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
A modal confirmation in the Material dialog shape: a scrim, a compact elevated
surface and two text actions. It owns the modal behaviours the rest of the SPA
expects — focus moves to Cancel (the non-destructive choice), Tab stays inside
the dialog, Escape and a press on the scrim cancel, and the element that opened
the dialog gets focus back when it closes.

The parent owns the open/closed state and the busy state; `onConfirm` starts the
work, and the buttons stay disabled with `busyLabel` while it runs.
*/

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
  Focuses this callback's target when the dialog unmounts. Defaults to the
  element focused at mount, which can already be gone when the dialog opens
  from a menu item.
  */
  returnFocus?: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  busyLabel = 'Working…',
  onConfirm,
  onCancel,
  returnFocus,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocusRef.current === undefined) {
        previousFocusRef.current?.focus();
      } else {
        returnFocusRef.current();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!busy) onCancel();
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;

      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons.at(-1)!;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture, so Escape lands before the menu that opened this dialog (or any
    // other shortcut) sees the key.
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-[380px] rounded-3xl border border-line bg-panel-2 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <p id={messageId} className="mt-3 text-[15px] text-muted">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="min-w-[88px] rounded-full px-4 py-2 font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="min-w-[88px] rounded-full bg-danger px-4 py-2 font-semibold text-[#1a0e0e] transition-colors hover:bg-[#ff9a93] focus-visible:bg-[#ff9a93] focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
