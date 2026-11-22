import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordedVoice } from '../../apps/web/src/recorder';
import { useVoiceRecorder } from '../../apps/web/src/useVoiceRecorder';

/**
The composer's microphone state machine: the permission wait, the live
clock, the automatic stop at the length cap and the two exits. The encoder
itself is faked (`test/web/recorder.test.ts` owns it).
*/

const microphone = vi.hoisted(() => ({
  seconds: 0,
  cancel: vi.fn(),
  stop: vi.fn(async (): Promise<RecordedVoice | null> => null),
  startVoiceRecording: vi.fn(),
}));

vi.mock('../../apps/web/src/recorder', () => ({
  startVoiceRecording: microphone.startVoiceRecording,
}));

afterEach(() => {
  cleanup();
  microphone.seconds = 0;
  microphone.cancel.mockReset();
  microphone.stop.mockReset();
  microphone.startVoiceRecording.mockReset();
});

function recording() {
  return {
    seconds: () => microphone.seconds,
    stop: microphone.stop,
    cancel: microphone.cancel,
  };
}

function renderRecorder(options: { maxSeconds?: number } = {}) {
  const onRecorded = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useVoiceRecorder({ onRecorded, onError, ...options }));
  return { ...hook, onRecorded, onError };
}

describe('useVoiceRecorder', () => {
  it('waits for the microphone before showing the recording state', async () => {
    let open: ((value: ReturnType<typeof recording>) => void) | undefined;
    microphone.startVoiceRecording.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const { result } = renderRecorder();

    act(() => result.current.start());
    expect(result.current.state).toBe('starting');

    await act(async () => {
      open?.(recording());
    });
    expect(result.current.state).toBe('recording');
  });

  it('reports a refused microphone and stays idle', async () => {
    microphone.startVoiceRecording.mockRejectedValue(new Error('Microphone Access Was Denied.'));
    const { result, onError } = renderRecorder();

    act(() => result.current.start());

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Microphone Access Was Denied.'));
    expect(result.current.state).toBe('idle');
  });

  it('drops a capture the reader cancelled while the prompt was open', async () => {
    let open: ((value: ReturnType<typeof recording>) => void) | undefined;
    microphone.startVoiceRecording.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const { result } = renderRecorder();

    act(() => result.current.start());
    act(() => result.current.cancel());
    await act(async () => {
      open?.(recording());
    });

    expect(microphone.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
  });

  it('cancels with Escape wherever focus has landed', async () => {
    microphone.startVoiceRecording.mockResolvedValue(recording());
    const { result } = renderRecorder();

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('recording'));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(microphone.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
  });

  it('stops by itself at the length cap and hands the recording over', async () => {
    microphone.startVoiceRecording.mockResolvedValue(recording());
    const voice: RecordedVoice = { file: new File(['ogg'], 'voice-message.ogg', { type: 'audio/ogg' }), duration: 2 };
    microphone.stop.mockResolvedValue(voice);
    const { result, onRecorded } = renderRecorder({ maxSeconds: 1 });

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('recording'));

    microphone.seconds = 1;
    await waitFor(() => expect(microphone.stop).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(voice));
    expect(result.current.state).toBe('idle');
  });
});
