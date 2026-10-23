import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CallOverlay } from '../components/CallOverlay';
import { useUpdatesSocket } from '../hooks';
import type { ChatDto, ClientSocketMessage, UpdateEvent } from '../types';
import { useCalls } from './controller';

/**
 * The calls' half of the app shell.
 *
 * The call controller needs the updates socket — its signalling rides that
 * socket — and the socket's handler needs the controller, because a call
 * arrives as an ordinary bridge event. The two are joined here so neither has
 * to know about the other, and so the app shell keeps only a couple of lines
 * for a feature that is not the app's main business.
 *
 * The overlay is returned rather than rendered: it belongs to the app's tree,
 * and it is a portal, so it lands on `document.body` either way.
 */
export interface CallHostOptions {
  /**
   * Whether the account is signed in: the socket only attaches then.
   */
  enabled: boolean;
  /**
   * The app's own update handler.
   */
  onUpdate: (update: UpdateEvent) => void;
  /**
   * Called when the socket reconnects and the app should read the state it
   * may have missed. The first socket after a sign-in is the boot's own
   * connection, and the app has just read everything it needs — so the
   * callback is only made for a socket that dropped.
   */
  onResync: () => void | Promise<void>;
  /**
   * The chat a call belongs to, for the overlay's name and picture.
   */
  findChat: (chatId: number) => ChatDto | null;
  /**
   * Reports a failure that has no overlay to show it on — a call that could
   * not even be started, for instance.
   */
  onError: (failure: unknown) => void;
}

/**
 * What the app shell gets from the calls.
 */
export interface CallHost {
  /**
   * Whether the updates socket is attached.
   */
  connected: boolean;
  /**
   * Starts a call to a chat.
   */
  startCall: (chatId: number) => void;
  /**
   * The overlay, or nothing when no call is up.
   */
  overlay: ReactNode;
}

export function useCallHost({ enabled, onUpdate, onResync, findChat, onError }: CallHostOptions): CallHost {
  /**
   * The socket's send function, behind a ref: the controller needs it before
   * the socket exists, and the socket needs the controller.
   */
  const sendRef = useRef<(message: ClientSocketMessage) => void>(() => {});
  const send = useCallback((message: ClientSocketMessage): void => {
    sendRef.current(message);
  }, []);

  const calls = useCalls(send, onError);
  const handleCallUpdate = calls.handleUpdate;

  /**
   * The app's handler, behind a ref: the socket's handler is created once,
   * when the socket attaches, and must always see the latest one.
   */
  const updateRef = useRef(onUpdate);
  const resyncRef = useRef(onResync);
  useEffect(() => {
    updateRef.current = onUpdate;
    resyncRef.current = onResync;
  });

  const handleUpdate = useCallback(
    (update: UpdateEvent): void => {
      updateRef.current(update);
      handleCallUpdate(update);
    },
    [handleCallUpdate],
  );

  const { connected, send: socketSend } = useUpdatesSocket(enabled, handleUpdate, (resync) => {
    // The first socket after a sign-in is the boot's own connection: the app
    // has just read everything it needs, and only a dropped connection means
    // the state may be stale.
    if (resync) void resyncRef.current();
  });

  useLayoutEffect(() => {
    sendRef.current = socketSend;
  }, [socketSend]);

  /**
   * The overlay. The chat is looked up as the overlay renders, so the name
   * and the picture are the ones the chat list has.
   */
  const overlay = calls.view ? (
    <CallOverlay
      view={calls.view}
      chat={findChat(calls.view.chatId)}
      remoteStream={calls.remoteStream}
      onAccept={calls.accept}
      onDecline={calls.decline}
      onHangUp={calls.hangUp}
      onToggleMute={calls.toggleMute}
      onDismiss={calls.dismiss}
    />
  ) : null;

  return { connected, startCall: calls.startCall, overlay };
}
