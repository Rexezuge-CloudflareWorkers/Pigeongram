import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDialogs, fetchHistory, fetchMe, logout, readHistory, sendMessage } from './api';
import { ChatList } from './components/ChatList';
import { LoginScreen } from './components/LoginScreen';
import { ThreadView } from './components/ThreadView';
import { initials } from './format';
import { useLoginFlow, useUpdatesSocket } from './hooks';
import { applyEditedMessage, applyNewMessage, applyReadUpdate, mergeMessages, replaceMessage } from './state';
import type { ChatDto, DialogDto, MeDto, MessageDto, PeerId, UpdateEvent } from './types';

export function App() {
  const { state, gate, error, reportError, onToken, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();

  const [me, setMe] = useState<MeDto | null>(null);
  const [dialogs, setDialogs] = useState<DialogDto[]>([]);
  const [dialogsLoading, setDialogsLoading] = useState(false);

  const [selected, setSelected] = useState<ChatDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const selectedRef = useRef<PeerId | null>(null);
  const authorized = state?.authorized ?? false;

  // The socket handler reads the open chat through a ref: it is created once
  // (when the socket attaches) but must always see the latest selection.
  useEffect(() => {
    selectedRef.current = selected?.id ?? null;
  }, [selected]);

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

  const handleUpdate = useCallback((update: UpdateEvent): void => {
    if (update.type === 'new_message') {
      const message = update.message;
      setDialogs((current) => applyNewMessage(current, message, selectedRef.current));
      if (message.chatId === selectedRef.current) {
        setMessages((current) => mergeMessages(current, [message]));
        void readHistory(message.chatId).catch(() => {
          // Read receipts are best-effort; the next open retries.
        });
      }
      return;
    }
    if (update.type === 'edit_message') {
      setDialogs((current) => applyEditedMessage(current, update.message));
      setMessages((current) => replaceMessage(current, update.message));
      return;
    }
    setDialogs((current) => applyReadUpdate(current, update.chatId, update.unread));
  }, []);

  const connected = useUpdatesSocket(authorized, handleUpdate, () => {
    void loadDialogs();
  });

  const openChat = useCallback(async (chat: ChatDto): Promise<void> => {
    setSelected(chat);
    setMessages([]);
    setThreadError(null);
    setThreadLoading(true);
    try {
      const result = await fetchHistory(chat.id, { limit: 50 });
      setMessages(mergeMessages([], result.messages));
      setDialogs((current) => applyReadUpdate(current, chat.id, 0));
      void readHistory(chat.id).catch(() => {
        // Best-effort.
      });
    } catch (failure) {
      setThreadError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const loadOlder = useCallback(async (): Promise<void> => {
    const chat = selected;
    const oldest = messages[0];
    if (!chat || !oldest) return;
    setOlderLoading(true);
    try {
      const result = await fetchHistory(chat.id, {
        limit: 50,
        offsetId: oldest.id,
        offsetDate: oldest.date,
      });
      setMessages((current) => mergeMessages(current, result.messages));
    } catch (failure) {
      setThreadError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOlderLoading(false);
    }
  }, [messages, selected]);

  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      const chat = selected;
      if (!chat) return;
      setSending(true);
      setThreadError(null);
      try {
        const result = await sendMessage(chat.id, text);
        setMessages((current) => mergeMessages(current, [result.message]));
        setDialogs((current) => applyNewMessage(current, result.message, chat.id));
      } catch (failure) {
        setThreadError(failure instanceof Error ? failure.message : String(failure));
        throw failure;
      } finally {
        setSending(false);
      }
    },
    [selected],
  );

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (failure) {
      reportError(failure);
    }
    setSelected(null);
    setMessages([]);
    setDialogs([]);
    setMe(null);
    reset();
  }, [reportError, reset]);

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
          <span className="avatar small">{initials(displayName)}</span>
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
      <ThreadView
        chat={selected}
        messages={messages}
        loading={threadLoading}
        loadingOlder={olderLoading}
        sending={sending}
        error={threadError}
        onBack={() => setSelected(null)}
        onLoadOlder={() => void loadOlder()}
        onSend={handleSend}
      />
      {error ? (
        <p className="toast" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default App;
