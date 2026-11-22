import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordedVoice, VoiceRecording } from './recorder';
import { startVoiceRecording } from './recorder';
import { VOICE_MAX_SECONDS } from './types';

/**
The composer's microphone: one recording at a time, a live timer, and the
handover to the outbox when it ends.

The hook owns every transition the recorder cannot know about — the permission
wait, the tick that drives the visible clock, the automatic stop at the length
cap, and releases on unmount or a chat switch. A refusal is reported through
`onError` and leaves the composer in its idle state.
*/

export type VoiceRecorderState = 'idle' | 'starting' | 'recording';

interface VoiceRecorderControls {
  state: VoiceRecorderState;
  /**
  Whole seconds captured so far; zero outside a recording.
  */
  seconds: number;
  start: () => void;
  /**
  Ends the capture and reports it through `onRecorded`.
  */
  stop: () => void;
  /**
  Ends the capture and discards it.
  */
  cancel: () => void;
}

interface UseVoiceRecorderOptions {
  onRecorded: (voice: RecordedVoice) => void;
  onError: (message: string) => void;
  /**
  The recording stops by itself at this length, so a forgotten microphone
  never runs past what the bridge accepts.
  */
  maxSeconds?: number;
}

export function useVoiceRecorder({ onRecorded, onError, maxSeconds = VOICE_MAX_SECONDS }: UseVoiceRecorderOptions): VoiceRecorderControls {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recordingRef = useRef<VoiceRecording | null>(null);
  /**
  Each start gets a token. Cancelling while the permission prompt is still
  open bumps it, so the capture that finally resolves is released instead of
  becoming a recording the reader thought they had cancelled.
  */
  const attempt = useRef(0);
  const mounted = useRef(true);
  const recordedRef = useRef(onRecorded);
  const errorRef = useRef(onError);

  useEffect(() => {
    recordedRef.current = onRecorded;
    errorRef.current = onError;
  });

  const finish = useCallback((): void => {
    const recording = recordingRef.current;
    if (recording === null) return;
    recordingRef.current = null;
    setState('idle');
    setSeconds(0);
    void recording.stop().then((voice) => {
      if (!mounted.current) return;
      if (voice !== null) recordedRef.current(voice);
    });
  }, []);

  const cancel = useCallback((): void => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    // Invalidate a start that is still waiting for the microphone.
    attempt.current += 1;
    setState('idle');
    setSeconds(0);
    recording?.cancel();
  }, []);

  const start = useCallback((): void => {
    if (recordingRef.current !== null) return;
    attempt.current += 1;
    const id = attempt.current;
    setState('starting');
    void startVoiceRecording()
      .then((recording) => {
        if (!mounted.current || attempt.current !== id) {
          recording.cancel();
          return;
        }
        recordingRef.current = recording;
        setSeconds(0);
        setState('recording');
      })
      .catch((error: unknown) => {
        if (!mounted.current || attempt.current !== id) return;
        setState('idle');
        const message = error instanceof Error ? error.message : 'The Microphone Could Not Be Started.';
        errorRef.current(message);
      });
  }, []);

  // Escape cancels the recording wherever focus has landed: while a capture is
  // live the composer's text box is gone, so its own key handling cannot see
  // the press.
  useEffect(() => {
    if (state === 'idle') return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener('keydown', onEscape, { capture: true });
    return () => document.removeEventListener('keydown', onEscape, { capture: true });
  }, [state, cancel]);

  // One tick a quarter second: the label shows whole seconds, but the cap is
  // checked often enough that a recording never overshoots it by a second.
  useEffect(() => {
    if (state !== 'recording') return;
    const tick = (): void => {
      const recording = recordingRef.current;
      if (recording === null) return;
      const elapsed = recording.seconds();
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) finish();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [state, maxSeconds, finish]);

  // A real unmount (a chat switch remounts the composer) must release the
  // microphone: a recording the reader can no longer see would otherwise keep
  // the browser's capture indicator on.
  useEffect(
    () => () => {
      mounted.current = false;
      recordingRef.current?.cancel();
      recordingRef.current = null;
    },
    [],
  );

  return useMemo(() => ({ state, seconds, start, stop: finish, cancel }), [state, seconds, start, finish, cancel]);
}
