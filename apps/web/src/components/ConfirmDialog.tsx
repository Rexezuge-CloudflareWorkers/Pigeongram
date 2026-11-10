import { useId } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 A modal confirmation in the Material dialog shape: a scrim, a compact elevated
 surface and two text actions. It owns the modal behaviours the rest of the SPA
 expects — focus moves to Cancel (the non-destructive choice), Tab stays inside
 the dialog, Escape and a press on the scrim cancel, and the element that opened
 the dialog gets focus back when it closes.

 The parent owns the open/closed state and the busy state; `onConfirm` starts the
 work, and the buttons stay disabled with `busyLabel` while it runs. The confirm
 action wears the `danger` tone by default and the `accent` one when the action
 puts something back rather than taking it away.

 The shared `Dialog` carries the focus-trap and dismiss behaviour; this adds
 only the message content and the two actions.
 */

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /**
  The tone of the confirm action: `danger` for the action that undoes something
  the reader would have to undo by hand, `accent` for the one that restores it.
  */
  tone?: 'danger' | 'accent';
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
  /**
  Whether the dialog is animating out; forwarded to the shared Dialog.
  */
  exiting?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  busyLabel = 'Working…',
  onConfirm,
  onCancel,
  returnFocus,
  exiting = false,
}: ConfirmDialogProps) {
  const messageId = useId();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      busy={busy}
      initialFocus="cancel"
      returnFocus={returnFocus}
      exiting={exiting}
      actions={
        <>
          <span data-dialog-cancel className="contents">
            <Button tone="primary" variant="text" className="min-w-[88px]" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </Button>
          </span>
          <Button tone={tone === 'accent' ? 'accent' : 'danger'} className="min-w-[88px]" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p id={messageId}>{message}</p>
    </Dialog>
  );
}
