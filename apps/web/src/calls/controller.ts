import { useCallback, useEffect, useReducer, useState } from 'react';
import type { ClientSocketMessage, UpdateEvent } from '../types';
import { CallOrchestrator } from './orchestrator';
import { callReducer } from './session';
import type { CallView } from './session';

/**
 * What the controller offers the UI.
 */
export interface CallController {
  /**
   * The call the reader is in, or `null` when there is none.
   */
  view: CallView | null;
  /**
   * The other side's audio, once it arrives.
   */
  remoteStream: MediaStream | null;
  /**
   * Starts a call to a chat.
   */
  startCall: (chatId: number) => void;
  /**
   * Answers an incoming call.
   */
  accept: () => void;
  /**
   * Turns an incoming call down.
   */
  decline: () => void;
  /**
   * Ends the call the reader is in.
   */
  hangUp: () => void;
  /**
   * Mutes or unmutes the microphone.
   */
  toggleMute: () => void;
  /**
   * Takes the overlay away after a finished call.
   */
  dismiss: () => void;
  /**
   * Folds a bridge event into the call.
   */
  handleUpdate: (update: UpdateEvent) => void;
}

/**
 * Drives the calls of the account, as the React half.
 *
 * The ordering rules — the key exchange, the media connection, the guards
 * between the awaits — live in `CallOrchestrator`. This hook only joins them
 * to the reducer and keeps the callbacks the app hands in behind refs, so a
 * re-render never rebuilds the live call.
 */
export function useCalls(send: (message: ClientSocketMessage) => void, onError: (failure: unknown) => void): CallController {
  const [view, dispatch] = useReducer(callReducer, null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [orchestrator] = useState(() => new CallOrchestrator({ dispatch, setRemoteStream, onError, send }));

  useEffect(() => {
    orchestrator.setHandlers({ send, onError });
  }, [orchestrator, send, onError]);

  useEffect(() => () => orchestrator.dispose(), [orchestrator]);

  const dismiss = useCallback((): void => {
    dispatch({ type: 'dismissed' });
  }, []);

  return {
    view,
    remoteStream,
    startCall: orchestrator.startCall,
    accept: orchestrator.accept,
    decline: orchestrator.decline,
    hangUp: orchestrator.hangUp,
    toggleMute: orchestrator.toggleMute,
    dismiss,
    handleUpdate: orchestrator.handleUpdate,
  };
}
