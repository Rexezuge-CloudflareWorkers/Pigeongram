import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchDialogs, fetchHistory, fetchMe, logout, readHistory, sendMessage, sendReaction, uploadFile } from './api';
import { Avatar } from './components/Avatar';
import { ChatList } from './components/ChatList';
import { CommentsView } from './components/CommentsView';
import { LoginScreen } from './components/LoginScreen';
import { ThreadView } from './components/ThreadView';
import { useLoginFlow, useUpdatesSocket } from './hooks';
import {
  applyCommentCountDelta,
  applyEditedMessage,
  applyNewMessage,
  applyReactionUpdate,
  applyReadUpdate,
  mergeMessages,
  replaceMessage,
  toggleReaction,
  updateThread,
} from './state';
import type { ChatThread } from './state';
import type { ChatDto, DialogDto, MeDto, MessageDto, MessageReactionDto, PeerId, UpdateEvent } from './types';
import { prepareUpload } from './upload';
import { useComments } from './useComments';

export function App() {
  const { state, gate, error, reportError, onToken, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();

  const [me, setMe] = useState<MeDto | null>(null);
  const [dialogs, setDialogs] = useState<DialogDto[]>([]);
  const [dialogsLoading, setDialogsLoading] = useState(false);

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(new Set());

  /**
  A comment the caller sent was accepted: bump the post's count in the open
  channel thread, and fold the comment into the dialogs when it landed in the
  discussion group. The channel is the right target only for the first comment
  (Telegram mirrors it into the group but the send response may describe it in
  the channel), so that case is left to the dialogs' own update.
  */
  const handleCommentSent = useCallback((chatId: PeerId, postId: number, comment: MessageDto): void => {
    setThread((current) => updateThread(current, chatId, (messages) => applyCommentCountDelta(messages, postId)));
    if (comment.chatId !== chatId) {
      setDialogs((current) => applyNewMessage(current, comment, null));
    }
  }, []);

  const comments = useComments({ onCommentSent: handleCommentSent, onError: reportError });
  // Stable helpers, so the callbacks that depend on them keep their identity.
  const closeComments = comments.close;
  const applyCommentUpdate = comments.applyUpdate;

  const selectedRef = useRef<PeerId | null>(null);
  const selected = thread?.chat ?? null;
  const messages = thread?.messages ?? [];
  const authorized = state?.authorized ?? false;

  // The socket handler is created once (when the socket attaches) but must
  // always see the latest selection. A layout effect runs with the commit, so
  // no socket event can observe the previous chat after a switch.
  useLayoutEffect(() => {
    selectedRef.current = thread?.chat.id ?? null;
  }, [thread]);

  // ---- signed-in data: dialogs, live updates, thread ----------------------

  const loadDialogs = useCallback(async (): Promise<void> => {
    setDialogsLoading(true);
    try {
      const result = await fetchDialogs();
      setDialogs(result.dialogs);
    } catch (failure) {
      reportError(failure);
    } finally {
      setDialogsLoading(false);
    }
  }, [reportError]);

  const booted = useRef(false);
  useEffect(() => {
    if (!authorized) {
      booted.current = false;
      return;
    }
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      if (state?.me) setMe(state.me);
      try {
        setMe((await fetchMe()).me);
      } catch (failure) {
        reportError(failure);
      }
      await loadDialogs();
    })();
  }, [authorized, state?.me, reportError, loadDialogs]);

  const handleUpdate = useCallback(
    (update: UpdateEvent): void => {
      // The comments screen listens to the same stream: it folds the open
      // thread's comments in and lets everything else pass.
      applyCommentUpdate(update);
      if (update.type === 'new_message') {
        const message = update.message;
        setDialogs((current) => applyNewMessage(current, message, selectedRef.current));
        setThread((current) => updateThread(current, message.chatId, (messages) => mergeMessages(messages, [message])));
        if (message.chatId === selectedRef.current) {
          void readHistory(message.chatId).catch(() => {
            // Read receipts are best-effort; the next open retries.
          });
        }
        return;
      }
      if (update.type === 'edit_message') {
        setDialogs((current) => applyEditedMessage(current, update.message));
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
      if (update.type === 'read') {
        setDialogs((current) => applyReadUpdate(current, update.chatId, update.unread));
      }
    },
    [applyCommentUpdate],
  );

  const connected = useUpdatesSocket(authorized, handleUpdate, () => {
    void loadDialogs();
  });

  const openChat = useCallback(
    async (chat: ChatDto): Promise<void> => {
      setThread({ chat, messages: [] });
      closeComments();
      setThreadError(null);
      setThreadLoading(true);
      try {
        const result = await fetchHistory(chat.id, { limit: 50 });
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, result.messages)));
        setDialogs((current) => applyReadUpdate(current, chat.id, 0));
        void readHistory(chat.id).catch(() => {
          // Best-effort.
        });
      } catch (failure) {
        setThreadError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setThreadLoading(false);
      }
    },
    [closeComments],
  );

  const loadOlder = useCallback(async (): Promise<void> => {
    const chat = thread?.chat;
    const oldest = thread?.messages[0];
    if (!chat || !oldest) return;
    setOlderLoading(true);
    try {
      const result = await fetchHistory(chat.id, {
        limit: 50,
        offsetId: oldest.id,
        offsetDate: oldest.date,
      });
      setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, result.messages)));
    } catch (failure) {
      setThreadError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOlderLoading(false);
    }
  }, [thread]);

  const handleSend = useCallback(
    async (text: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setSending(true);
      setThreadError(null);
      try {
        const result = await sendMessage(chat.id, text, replyTo);
        setThread((current) => updateThread(current, chat.id, (messages) => mergeMessages(messages, [result.message])));
        setDialogs((current) => applyNewMessage(current, result.message, chat.id));
      } catch (failure) {
        setThreadError(failure instanceof Error ? failure.message : String(failure));
        throw failure;
      } finally {
        setSending(false);
      }
    },
    [thread],
  );

  const handleAttach = useCallback(
    async (file: File, caption: string, replyTo?: number): Promise<void> => {
      const chat = thread?.chat;
      if (!chat) return;
      setUploading(true);
      setUploadProgress(null);
      setThreadError(null);
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
        setDialogs((current) => applyNewMessage(current, result.message, chat.id));
      } catch (failure) {
        setThreadError(failure instanceof Error ? failure.message : String(failure));
        throw failure;
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [thread],
  );

  const handleReact = useCallback(
    (message: MessageDto, reaction: MessageReactionDto): void => {
      if (reactingIds.has(message.id)) return;
      if (!reaction.chosen && reaction.emoji === null && reaction.customEmojiId === null) return;
      const before = message.reactions;
      const after = toggleReaction(before, reaction);
      setThread((current) =>
        updateThread(current, message.chatId, (messages) => applyReactionUpdate(messages, message.chatId, message.id, after)),
      );
      setReactingIds((current) => new Set(current).add(message.id));
      const target = reaction.chosen
        ? null
        : reaction.emoji === null
          ? { customEmojiId: reaction.customEmojiId as string }
          : { emoji: reaction.emoji };
      void sendReaction(message.chatId, message.id, target)
        .then((result) => {
          const updated = result.message;
          if (updated) {
            setThread((current) =>
              updateThread(current, message.chatId, (messages) =>
                applyReactionUpdate(messages, message.chatId, message.id, updated.reactions),
              ),
            );
          }
        })
        .catch((failure: unknown) => {
          setThread((current) =>
            updateThread(current, message.chatId, (messages) => applyReactionUpdate(messages, message.chatId, message.id, before)),
          );
          reportError(failure);
        })
        .finally(() => {
          setReactingIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        });
    },
    [reactingIds, reportError],
  );

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (failure) {
      reportError(failure);
    }
    setThread(null);
    closeComments();
    setDialogs([]);
    setMe(null);
    reset();
  }, [closeComments, reportError, reset]);

  if (gate || !authorized) {
    return (
      <LoginScreen
        state={state}
        gate={gate}
        error={error}
        onToken={onToken}
        onPhone={onPhone}
        onCode={onCode}
        onPassword={onPassword}
        onRetry={onRetry}
      />
    );
  }

  const displayName = me ? `${me.firstName}${me.lastName ? ` ${me.lastName}` : ''}` : 'Telegram';
  return (
    <div className={`app${selected ? ' thread-open' : ''}`}>
      <aside className="sidebar">
        <header className="me">
          <Avatar chatId={me?.id ?? 0} photo={me?.photo ?? null} title={displayName} small />
          <div className="me-id">
            <strong>{displayName}</strong>
            <span className="muted small">{connected ? 'live' : 'polling'}</span>
          </div>
          <button type="button" className="ghost" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </header>
        <ChatList dialogs={dialogs} activeChatId={selected?.id ?? null} loading={dialogsLoading} onSelect={(chat) => void openChat(chat)} />
      </aside>
      {comments.thread ? (
        <CommentsView
          thread={comments.thread}
          loading={comments.loading}
          loadingOlder={comments.loadingOlder}
          sending={comments.sending}
          uploading={comments.uploading}
          uploadProgress={comments.uploadProgress}
          error={comments.error}
          reactingIds={comments.reactingIds}
          onBack={comments.close}
          onLoadOlder={() => void comments.loadOlder()}
          onSend={comments.send}
          onAttach={comments.attach}
          onReact={comments.react}
        />
      ) : (
        <ThreadView
          chat={selected}
          messages={messages}
          loading={threadLoading}
          loadingOlder={olderLoading}
          sending={sending}
          uploading={uploading}
          uploadProgress={uploadProgress}
          error={threadError}
          reactingIds={reactingIds}
          onBack={() => {
            setThread(null);
            closeComments();
          }}
          onLoadOlder={() => void loadOlder()}
          onSend={handleSend}
          onAttach={handleAttach}
          onReact={handleReact}
          onOpenComments={(message) => {
            if (selected) void comments.open(selected, message);
          }}
        />
      )}
      {error ? (
        <p className="toast" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default App;
