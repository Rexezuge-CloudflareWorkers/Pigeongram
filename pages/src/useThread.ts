import { useCallback, useState } from 'react';
import { fetchHistory, sendMessage, sendReaction, uploadFile } from './api';
import { applyCommentCountDelta, applyReactionUpdate, mergeMessages, replaceMessage, toggleReaction, updateThread } from './state';
import type { ChatThread } from './state';
import type { ChatDto, MessageDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { prepareUpload } from './upload';

/**
The chat thread's controller: the open chat with its loaded window, the read
watermark the view reports scroll positions against, and the send/attach/react
actions and folding of live updates. A hook rather than state inside `App` so
both stay readable (and under the god-file cap), mirroring `useComments`.
*/

export interface ThreadController {
  /**
  The open chat and its loaded messages, or null while no chat is open.
  */
  thread: ChatThread | null;
  loading: boolean;
  loadingOlder: boolean;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  /**
  The last failure of an open, page, send or upload, as shown by the thread.
  */
  error: string | null;
  /**
  Message ids with a reaction request in flight; their chips are disabled.
  */
  reactingIds: ReadonlySet<number>;
  /**
  Opens a chat at the dialog's read watermark, reading the first window. The
  watermark comes from the dialog list, which belongs to the caller.
  */
  open: (chat: ChatDto, readInboxMaxId: number) => Promise<void>;
  close: () => void;
  loadOlder: () => Promise<void>;
  send: (text: string, replyTo?: number) => Promise<void>;
  attach: (file: File, caption: string, replyTo?: number) => Promise<void>;
  react: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  Advances the open thread's read watermark, for a read the view reported or
  the server confirmed.
  */
  setReadWatermark: (chatId: PeerId, maxId: number) => void;
  /**
  Bumps a loaded channel post's comment count after one of the account's own
  comments was accepted by the comments screen.
  */
  bumpCommentCount: (chatId: PeerId, postId: number) => void;
  /**
  Folds one socket update into the open thread. `App`'s update handler
  forwards every event; updates that are not the thread pass through.
  */
  applyUpdate: (update: UpdateEvent) => void;
}

interface UseThreadOptions {
  /**
  A message the caller sent was accepted: fold it into the dialogs, which
  belong to the caller.
  */
  onSent: (message: MessageDto) => void;
  /**
  Reports a background failure (a reaction that had to roll back) to the
  global toast.
  */
  onError: (error: unknown) => void;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useThread({ onSent, onError }: UseThreadOptions): ThreadController {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());

  const open = useCallback(async (chat: ChatDto, readInboxMaxId: number): Promise<void> => {
    setThread({ chat, messages: [], readInboxMaxId });
    setError(null);
    setLoading(true);
    try {
      const result = await fetchHistory(chat.id, { limit: 50 });
      setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, result.messages)));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback((): void => {
    setThread(null);
    setError(null);
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const chat = thread?.chat;
    const oldest = thread?.messages[0];
    if (!chat || !oldest) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const result = await fetchHistory(chat.id, { limit: 50, offsetId: oldest.id, offsetDate: oldest.date });
      setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, result.messages)));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setLoadingOlder(false);
    }
  }, [thread]);

  const setReadWatermark = useCallback((chatId: PeerId, maxId: number): void => {
    setThread((current) =>
      current && current.chat.id === chatId ? { ...current, readInboxMaxId: Math.max(current.readInboxMaxId, maxId) } : current,
    );
  }, []);

  const bumpCommentCount = useCallback((chatId: PeerId, postId: number): void => {
    setThread((current) => updateThread(current, chatId, (messages) => applyCommentCountDelta(messages, postId)));
  }, []);

  const send = useCallback(
    async (text: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setSending(true);
      setError(null);
      try {
        const result = await sendMessage(chat.id, text, replyTo);
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, [result.message])));
        onSent(result.message);
      } catch (failure) {
        setError(failureText(failure));
        throw failure;
      } finally {
        setSending(false);
      }
    },
    [thread, onSent],
  );

  const attach = useCallback(
    async (file: File, caption: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setUploading(true);
      setUploadProgress(null);
      setError(null);
      try {
        const prepared = await prepareUpload(file);
        const result = await uploadFile(
          {
            chatId: chat.id,
            kind: prepared.kind,
            fileName: prepared.fileName,
            mime: prepared.mime,
            size: prepared.body.size,
            ...(caption.length > 0 && { caption }),
            ...(replyTo !== undefined && { replyTo }),
            ...(prepared.width !== undefined && { width: prepared.width }),
            ...(prepared.height !== undefined && { height: prepared.height }),
            ...(prepared.duration !== undefined && { duration: prepared.duration }),
          },
          prepared.body,
          setUploadProgress,
        );
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, [result.message])));
        onSent(result.message);
      } catch (failure) {
        setError(failureText(failure));
        throw failure;
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [thread, onSent],
  );

  const react = useCallback(
    (message: MessageDto, reaction: MessageReactionDto): void => {
      if (reactingIds.has(message.id)) return;
      if (!reaction.chosen && reaction.emoji === null && reaction.customEmojiId === null) return;
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      const apply = (list: MessageReactionDto[]): void => {
        setThread((current) =>
          updateThread(current, message.chatId, (messages) => applyReactionUpdate(messages, message.chatId, message.id, list)),
        );
      };
      apply(after);
      setReactingIds((current) => new Set(current).add(message.id));
      const target = reaction.chosen
        ? null
        : reaction.emoji === null
          ? { customEmojiId: reaction.customEmojiId as string }
          : { emoji: reaction.emoji };
      void sendReaction(message.chatId, message.id, target)
        .then((result) => {
          if (result.message) apply(result.message.reactions);
        })
        .catch((failure: unknown) => {
          apply(before);
          onError(failure);
        })
        .finally(() => {
          setReactingIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        });
    },
    [reactingIds, onError],
  );

  const applyUpdate = useCallback((update: UpdateEvent): void => {
    if (update.type === 'new_message') {
      setThread((current) => updateThread(current, update.message.chatId, (messages) => mergeMessages(messages, [update.message])));
      return;
    }
    if (update.type === 'edit_message') {
      setThread((current) => updateThread(current, update.message.chatId, (messages) => replaceMessage(messages, update.message)));
      return;
    }
    if (update.type === 'reactions') {
      setThread((current) =>
        updateThread(current, update.chatId, (messages) =>
          applyReactionUpdate(messages, update.chatId, update.messageId, update.reactions),
        ),
      );
      return;
    }
    if (update.type === 'read' && update.inbox) {
      // The peer reading the account's own messages says nothing about the
      // account's unread incoming ones, so only inbox reads move the
      // watermark.
      setThread((current) =>
        current && current.chat.id === update.chatId
          ? { ...current, readInboxMaxId: Math.max(current.readInboxMaxId, update.maxId) }
          : current,
      );
    }
  }, []);

  return {
    thread,
    loading,
    loadingOlder,
    sending,
    uploading,
    uploadProgress,
    error,
    reactingIds,
    open,
    close,
    loadOlder,
    send,
    attach,
    react,
    setReadWatermark,
    bumpCommentCount,
    applyUpdate,
  };
}
