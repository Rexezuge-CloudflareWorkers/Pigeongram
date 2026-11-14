import { useEffect, useRef } from 'react';
import type { MessageDto } from './types';

/**
Seeds the composer's draft from the edit target and clears it when the target
closes.

The seed is keyed by the message id, not by the DTO: a live edit of the same
message refreshes the target object, and re-seeding then would overwrite what
the reader is typing. The focus and caret placement ride along so opening an
edit starts where the text ends.
*/
export function useEditDraft(
  editTarget: MessageDto | null,
  setDraft: (text: string) => void,
  setMenuOpen: (open: boolean) => void,
  textarea: { current: HTMLTextAreaElement | null },
): void {
  const lastSeededEdit = useRef<number | null>(null);

  useEffect(() => {
    if (editTarget === null) {
      if (lastSeededEdit.current === null) return;
      lastSeededEdit.current = null;
      setDraft('');
      return;
    }
    if (lastSeededEdit.current === editTarget.id) return;
    lastSeededEdit.current = editTarget.id;
    setDraft(editTarget.text);
    setMenuOpen(false);
    const element = textarea.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(editTarget.text.length, editTarget.text.length);
  }, [editTarget, setDraft, setMenuOpen, textarea]);
}
