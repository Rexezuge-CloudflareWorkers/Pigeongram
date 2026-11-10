import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The app's dialog, in the Material 3 shape: a scrim, an extra-large
 * (28px) `surface-container-high` panel, title, content and actions at the
 * end. Owns the modal behaviours every dialog in the app needs — focus moves
 * to `initialFocus`, Tab stays inside, Escape and a scrim press cancel, the
 * page scroll locks, and the element that opened the dialog gets focus back.
 *
 * This is the shared implementation behind ConfirmDialog (and, later,
 * UploadDialog, ProfilePopup, ForwardPicker, SearchOverlay); each of those
 * adds only its content and its busy semantics.
 */

interface DialogProps {
  title: string;
  children: ReactNode;
  /**
  The dialog's actions, laid out at the end, gap-separated.
  */
  actions: ReactNode;
  onClose: () => void;
  /**
  While busy the dialog neither cancels nor dismisses.
  */
  busy?: boolean;
  /**
  Which focusable element receives focus on open. Defaults to the dialog itself.
  */
  initialFocus?: 'firstAction' | 'cancel';
  /**
  Focuses this when the dialog unmounts. Defaults to the element focused at mount.
  */
  returnFocus?: () => void;
  /**
  Panel width class; defaults to the confirmation width.
  */
  className?: string;
}

export function Dialog({
  title,
  children,
  actions,
  onClose,
  busy = false,
  initialFocus = 'firstAction',
  returnFocus,
  className = 'max-w-[380px]',
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // `inert` on the background makes it un-tabbable and hidden from assistive
    // tech while the dialog is open. The shell is a portal parent, so we inert
    // the app root. This is the trap; the Tab loop below is the backstop.
    const root = document.querySelector<HTMLElement>('#root');
    if (root) root.inert = true;
    const panel = panelRef.current;
    if (panel) {
      const target =
        (initialFocus === 'cancel' ? panel.querySelector<HTMLElement>(':scope [data-dialog-cancel] button') : null) ??
        panel.querySelector<HTMLElement>('button:not(:disabled)') ??
        panel;
      target.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = false;
      if (returnFocusRef.current === undefined) {
        previousFocusRef.current?.focus();
      } else {
        returnFocusRef.current();
      }
    };
  }, [initialFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!busy) onClose();
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables.at(-1)!;
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active) ?? false;
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
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`dialog-panel w-full border border-outline-variant bg-surface-container-high ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="p-6">
          <h2 id={titleId} className="text-xl font-semibold" style={{ fontWeight: 650 }}>
            {title}
          </h2>
          <div className="mt-3 text-[15px] text-on-surface-variant">{children}</div>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
