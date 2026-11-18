import type { MessageReplyKeyboardButtonDto, StickerDto } from './types';
import type { UploadRequest } from './upload';

/**
 * The view's send wrappers: every one clears the open reply target first, so a
 * second send never carries the previous reply.
 *
 * Split from `ThreadView.tsx` so the screen stays under the god-file cap. The
 * outbox carries the reply preview, so clearing here costs nothing.
 */
interface ComposerSendsOptions {
  clearReply: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
  onSendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number) => Promise<void>;
  onPressReplyKeyboard: (button: MessageReplyKeyboardButtonDto, replyTo?: number) => void;
}

export interface ComposerSends {
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  sendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number) => Promise<void>;
  pressReplyKeyboard: (button: MessageReplyKeyboardButtonDto, replyTo?: number) => void;
}

export function composerSends({ clearReply, onSend, onAttach, onSendSticker, onPressReplyKeyboard }: ComposerSendsOptions): ComposerSends {
  return {
    send: (text, replyTo) => {
      clearReply();
      return onSend(text, replyTo);
    },
    attach: (request) => {
      clearReply();
      return onAttach(request);
    },
    sendSticker: (sticker, set, replyTo) => {
      clearReply();
      return onSendSticker(sticker, set, replyTo);
    },
    pressReplyKeyboard: (button, replyTo) => {
      clearReply();
      onPressReplyKeyboard(button, replyTo);
    },
  };
}
