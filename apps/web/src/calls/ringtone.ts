/**
 * The ringtone of an incoming call.
 *
 * It is synthesised rather than shipped as a file: a ringtone is two tones
 * and a pause, and a page that carries a sound file for it pays for the file
 * on every load — and for the offline cache with it.
 *
 * The browser's autoplay policy applies: a context that was not started by a
 * gesture stays silent. The ringtone therefore listens for the reader's
 * first click anywhere and resumes itself then.
 */

/**
 * Makes the audio context. Injectable so the ringtone's lifecycle can be
 * tested without a real sound device.
 */
export type AudioContextFactory = () => AudioContext;

export class Ringtone {
  #context: AudioContext | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  constructor(private readonly createContext: AudioContextFactory = () => new AudioContext()) {}

  /**
   * Starts ringing, or does nothing when it is already ringing.
   */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
    document.addEventListener('pointerdown', this.#resume, { once: true });
  }

  /**
   * Stops ringing and releases the audio context.
   *
   * A context is a limited resource: a page that suspends one per call and
   * never closes it runs out after a handful of calls, and audio stops
   * working for the whole page. Closing also drops the context's audio
   * thread, which a suspend leaves running.
   */
  async stop(): Promise<void> {
    if (!this.#running && !this.#context) return;
    this.#running = false;
    document.removeEventListener('pointerdown', this.#resume);
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const context = this.#context;
    this.#context = null;
    if (context) await context.close().catch(() => {});
  }

  /**
   * The ringtone's voice: a short burst of two tones.
   */
  async #ring(): Promise<void> {
    if (!this.#running) return;
    const context = this.context;
    if (context.state === 'suspended') {
      await context.resume().catch(() => {});
    }
    // The call may have ended while the context was resuming.
    if (!this.#running || this.#context !== context) return;
    if (context.state !== 'running') return;
    const now = context.currentTime;
    for (const [frequency, offset] of [
      [440, 0],
      [480, 0.18],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.08, now + offset + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.18);
    }
  }

  /**
   * The next burst.
   */
  #schedule(): void {
    if (!this.#running) return;
    void this.#ring();
    this.#timer = setTimeout(() => this.#schedule(), 2400);
  }

  /**
   * The reader's first click lets the context sound.
   */
  #resume = (): void => {
    if (!this.#running) return;
    void this.#context?.resume().catch(() => {});
  };

  /**
   * The audio context, made on the first ring.
   */
  get context(): AudioContext {
    if (!this.#context) {
      this.#context = this.createContext();
    }
    return this.#context;
  }
}
