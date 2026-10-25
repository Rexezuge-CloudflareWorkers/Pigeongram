import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallOverlay } from '../../apps/web/src/components/CallOverlay';
import type { CallView } from '../../apps/web/src/calls/session';
import type { ChatDto } from '../../apps/web/src/types';

/**
 * The overlay the reader sees during a call. Each phase has its own controls,
 * its own status line and its own way out, so the tests walk the phases rather
 * than a single happy path.
 */

const ringtone = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(async (): Promise<void> => {}) }));

vi.mock('../../apps/web/src/calls/ringtone', () => ({
  Ringtone: class {
    start(): void {
      ringtone.start();
    }
    stop(): Promise<void> {
      return ringtone.stop();
    }
  },
}));

const chat: ChatDto = {
  id: 2,
  kind: 'user',
  title: 'Bob',
  username: 'bob',
  photo: null,
  canSendMessages: true,
  presence: { status: 'online', lastSeenAt: null },
};

function view(overrides: Partial<CallView> = {}): CallView {
  return {
    callId: '9',
    chatId: 2,
    peerId: 2,
    direction: 'outgoing',
    phase: 'ringing',
    muted: false,
    fingerprint: null,
    error: null,
    startedAt: Date.now(),
    ...overrides,
  };
}

function renderOverlay(
  overrides: Partial<CallView> = {},
  options: { chat?: ChatDto | null; remoteStream?: MediaStream | null; onDismiss?: () => void } = {},
): void {
  render(
    <CallOverlay
      view={view(overrides)}
      chat={options.chat === undefined ? chat : options.chat}
      remoteStream={options.remoteStream ?? null}
      onAccept={() => {}}
      onDecline={() => {}}
      onHangUp={() => {}}
      onToggleMute={() => {}}
      onDismiss={options.onDismiss ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  ringtone.start.mockClear();
  ringtone.stop.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CallOverlay', () => {
  it('offers answer and decline on an incoming call', () => {
    renderOverlay({ direction: 'incoming' });

    expect(screen.getByRole('status').textContent).toBe('Incoming call');
    expect(screen.getByRole('button', { name: 'Answer the call' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Decline the call' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel the call' })).toBeNull();
    expect(ringtone.start).toHaveBeenCalled();
  });

  it('offers cancel on an outgoing call and uses the chat it was given', () => {
    renderOverlay();

    expect(screen.getByRole('heading', { name: 'Bob' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Calling…');
    expect(screen.getByRole('button', { name: 'Cancel the call' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Answer the call' })).toBeNull();
  });

  it('falls back to an unknown title when the chat list does not know the peer', () => {
    renderOverlay({}, { chat: null });

    expect(screen.getByRole('heading', { name: 'Unknown' })).not.toBeNull();
  });

  it('shows the connecting spinner after the call was accepted', () => {
    renderOverlay({ phase: 'connecting' });

    expect(screen.getByText('Connecting…')).not.toBeNull();
    expect(screen.getByText('Connecting the call…')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel the call' })).toBeNull();
  });

  it('shows a failure and the key fingerprint beside the call', () => {
    renderOverlay({ phase: 'connecting', error: 'The call could not be set up', fingerprint: '1234abcd' });

    expect(screen.getByText('The call could not be set up')).not.toBeNull();
    expect(screen.getByText('key 1234abcd')).not.toBeNull();
  });

  it('stops the ringtone once the call connects', () => {
    const { rerender } = render(
      <CallOverlay
        view={view()}
        chat={chat}
        remoteStream={null}
        onAccept={() => {}}
        onDecline={() => {}}
        onHangUp={() => {}}
        onToggleMute={() => {}}
        onDismiss={() => {}}
      />,
    );
    ringtone.start.mockClear();

    rerender(
      <CallOverlay
        view={view({ phase: 'active' })}
        chat={chat}
        remoteStream={null}
        onAccept={() => {}}
        onDecline={() => {}}
        onHangUp={() => {}}
        onToggleMute={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(ringtone.start).not.toHaveBeenCalled();
    expect(ringtone.stop).toHaveBeenCalled();
  });

  it('runs the clock and toggles the microphone while the call is active', () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    renderOverlay({ phase: 'active', startedAt });

    expect(screen.getByRole('status').textContent).toBe('0:00');
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByRole('status').textContent).toBe('1:05');
    expect(screen.getByRole('button', { name: 'Mute the microphone' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'End the call' })).not.toBeNull();
  });

  it('labels the button unmute when the microphone is muted', () => {
    renderOverlay({ phase: 'active', muted: true });

    expect(screen.getByRole('button', { name: 'Unmute the microphone' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('plays the remote audio once it arrives', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const stream = { id: 'remote' } as unknown as MediaStream;

    renderOverlay({ phase: 'active' }, { remoteStream: stream });

    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio.srcObject).toBe(stream);
    expect(play).toHaveBeenCalled();
  });

  it('survives a browser that refuses to autoplay the remote audio', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('autoplay blocked'));

    renderOverlay({ phase: 'active' }, { remoteStream: {} as MediaStream });

    // The rejection is swallowed by the component; nothing is thrown into the
    // test and the overlay is still there.
    expect(screen.getByRole('button', { name: 'End the call' })).not.toBeNull();
  });

  it('says the call ended and dismisses itself after a moment', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderOverlay({ phase: 'ended' }, { onDismiss });

    expect(screen.getByRole('status').textContent).toBe('The call ended');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('does not schedule a dismissal before the call ended', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderOverlay({ phase: 'active' }, { onDismiss });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
