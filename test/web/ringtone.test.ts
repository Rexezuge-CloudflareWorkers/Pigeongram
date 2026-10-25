import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ringtone } from '../../apps/web/src/calls/ringtone';

/**
 * The ringtone's voice is a resource, not just a sound: every call that rings
 * makes an AudioContext, and a page only gets a handful of them. The tests
 * pin that a stopped ringtone closes its context, keeps one context per
 * instance while it rings, and stays silent after it stops.
 */

interface FakeOscillator {
  type: string;
  frequency: { value: number };
  connect(target: unknown): FakeOscillator;
  start(at: number): void;
  stop(at: number): void;
}

function audioContext(state: AudioContextState = 'running') {
  const oscillators: FakeOscillator[] = [];
  const context = {
    state,
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn((): FakeOscillator => {
      const oscillator = {
        type: 'sine',
        frequency: { value: 0 },
        connect: () => oscillator,
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: (target: unknown) => target,
    })),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { context: context as unknown as AudioContext, oscillators, raw: context };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Ringtone', () => {
  it('closes its audio context when it stops', async () => {
    vi.useFakeTimers();
    const made = audioContext();
    const ringtone = new Ringtone(() => made.context);
    ringtone.start();
    expect(made.raw.createOscillator).toHaveBeenCalledTimes(2);

    await ringtone.stop();

    expect(made.raw.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(made.raw.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('keeps one context per instance while it rings', () => {
    vi.useFakeTimers();
    const made = audioContext();
    const factory = vi.fn(() => made.context);
    const ringtone = new Ringtone(factory);
    ringtone.start();

    vi.advanceTimersByTime(2400);
    vi.advanceTimersByTime(2400);

    expect(factory).toHaveBeenCalledOnce();
    expect(made.raw.createOscillator).toHaveBeenCalledTimes(6);
  });

  it('makes a fresh context after a stop', async () => {
    vi.useFakeTimers();
    const first = audioContext();
    const second = audioContext();
    const factory = vi.fn().mockReturnValueOnce(first.context).mockReturnValueOnce(second.context);
    const ringtone = new Ringtone(factory);
    ringtone.start();
    await ringtone.stop();
    ringtone.start();

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not ring when the context resumes after the call ended', async () => {
    const made = audioContext('suspended');
    let resume: () => void = () => {};
    made.raw.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
    const ringtone = new Ringtone(() => made.context);
    ringtone.start();
    expect(made.raw.resume).toHaveBeenCalled();

    await ringtone.stop();
    resume();

    expect(made.raw.createOscillator).not.toHaveBeenCalled();
  });

  it('does nothing when it is already running or already stopped', async () => {
    vi.useFakeTimers();
    const made = audioContext();
    const ringtone = new Ringtone(() => made.context);
    ringtone.start();
    ringtone.start();
    expect(made.raw.createOscillator).toHaveBeenCalledTimes(2);
    await ringtone.stop();
    await ringtone.stop();
    expect(made.raw.close).toHaveBeenCalledOnce();
  });
});
