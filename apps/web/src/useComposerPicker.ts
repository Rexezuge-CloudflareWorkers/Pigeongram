import { useState } from 'react';
import type { RefObject } from 'react';
import type { StickerDto } from './types';

/**
 * The composer's sticker/emoji popover state and the two actions it needs.
 *
 * Split from `Composer.tsx` so the component stays under the god-file cap. The
 * panel is a popover, not a history layer: it closes on its own button, Escape
 * or an outside press (the picker owns those), and sending a sticker closes it.
 */
interface ComposerPickerOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  replyTargetId?: number;
  onSendSticker?: (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number) => Promise<void>;
  beforeSend: () => void;
}

interface ComposerPicker {
  open: boolean;
  toggle: () => void;
  close: () => void;
  /**
   * Inserts an emoji at the caret and leaves the panel open: a message is often
   * several emoji, and reopening the picker for each one would lose the place.
   */
  insertEmoji: (char: string) => void;
  sendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null) => void;
}

export function useComposerPicker({
  textareaRef,
  draft,
  setDraft,
  replyTargetId,
  onSendSticker,
  beforeSend,
}: ComposerPickerOptions): ComposerPicker {
  const [open, setOpen] = useState(false);

  const insertEmoji = (char: string): void => {
    const field = textareaRef.current;
    const start = field?.selectionStart ?? draft.length;
    const end = field?.selectionEnd ?? start;
    setDraft(draft.slice(0, start) + char + draft.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      const caret = start + char.length;
      field?.setSelectionRange(caret, caret);
    });
  };

  const sendSticker = (sticker: StickerDto, set: { id: string; accessHash: string } | null): void => {
    beforeSend();
    setOpen(false);
    void Promise.resolve(onSendSticker?.(sticker, set, replyTargetId)).catch(() => {});
  };

  return {
    open,
    toggle: () => setOpen((current) => !current),
    close: () => setOpen(false),
    insertEmoji,
    sendSticker,
  };
}
