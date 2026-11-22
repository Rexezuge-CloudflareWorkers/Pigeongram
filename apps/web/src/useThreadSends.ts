import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendMessage, sendSticker } from './api';
import type { ChatThread } from './thread-state';
import { applyThreadSentMessages } from './thread-state';
import type { MessageDto, StickerDto } from './types';
import { sendUploadBatch } from './upload';
import type { UploadRequest } from './upload';
import type { useOutbox } from './useOutbox';

/**
The thread's three sends: text, an attachment and a sticker.

Split from `useThread.ts` so the controller stays under the god-file cap.
Every one is optimistic: the outbox owns the bridge round trip, the progress
and the retry, and the fold below only runs when the real message arrives.
*/
interface ThreadSendsOptions {
  thread: ChatThread | null;
  outbox: ReturnType<typeof useOutbox>;
  setThread: Dispatch<SetStateAction<ChatThread | null>>;
  onSent: (message: MessageDto) => void;
}

interface ThreadSends {
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (request: UploadRequest) => Promise<void>;
  sendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number) => Promise<void>;
}

export function useThreadSends({ thread, outbox, setThread, onSent }: ThreadSendsOptions): ThreadSends {
  const send = useCallback(
    (text: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return Promise.resolve();
      const replyPreview = replyTo === undefined ? null : (thread.messages.find((message) => message.id === replyTo) ?? null);
      outbox.send({
        chatId: chat.id,
        scope: String(chat.id),
        text,
        ...(replyTo !== undefined && { replyTo }),
        replyPreview,
        deliver: (body, randomIds) => {
          if (body.kind !== 'text') throw new Error('The Outbox Delivered A File Body For A Text Message');
          return sendMessage(chat.id, body.text, body.replyTo, randomIds[0]).then((result) => [result.message]);
        },
        onSettled: (messages) => {
          setThread((current) => applyThreadSentMessages(current, chat.id, messages));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, setThread, onSent],
  );

  const attach = useCallback(
    (request: UploadRequest): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return Promise.resolve();
      const replyPreview =
        request.replyTo === undefined ? null : (thread.messages.find((message) => message.id === request.replyTo) ?? null);
      outbox.attach({
        chatId: chat.id,
        scope: String(chat.id),
        request,
        replyPreview,
        deliver: (body, randomIds, onProgress) => {
          if (body.kind !== 'file') throw new Error('The Outbox Delivered A Text Body For An Attachment');
          const messages: MessageDto[] = [];
          return sendUploadBatch(
            { chatId: chat.id, ...(request.replyTo !== undefined && { replyTo: request.replyTo }) },
            body.request,
            (fraction) => onProgress(fraction ?? 0),
            (message) => {
              messages.push(message);
            },
            randomIds,
          ).then(() => messages);
        },
        onSettled: (messages) => {
          setThread((current) => applyThreadSentMessages(current, chat.id, messages));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, setThread, onSent],
  );

  const sendStickerMessage = useCallback(
    (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return Promise.resolve();
      const replyPreview = replyTo === undefined ? null : (thread.messages.find((message) => message.id === replyTo) ?? null);
      outbox.sendSticker({
        chatId: chat.id,
        scope: String(chat.id),
        sticker,
        set,
        ...(replyTo !== undefined && { replyTo }),
        replyPreview,
        deliver: (body, randomIds) => {
          if (body.kind !== 'sticker') throw new Error('The Outbox Delivered A Non-Sticker Body For A Sticker');
          return sendSticker(chat.id, body.documentId, {
            ...(body.replyTo !== undefined && { replyTo: body.replyTo }),
            ...(randomIds[0] !== undefined && { randomId: randomIds[0] }),
            ...(body.set !== undefined && { set: body.set }),
          }).then((result) => [result.message]);
        },
        onSettled: (messages) => {
          setThread((current) => applyThreadSentMessages(current, chat.id, messages));
          const last = messages.at(-1);
          if (last) onSent(last);
        },
      });
      return Promise.resolve();
    },
    [thread, outbox, setThread, onSent],
  );

  return { send, attach, sendSticker: sendStickerMessage };
}
