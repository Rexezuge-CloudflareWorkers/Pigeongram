import type { LoginPhase, MeDto } from '../types';
import type { TelegramDriver } from './driver';
import { EngineError } from './errors';
import { describeLoginFailure } from './rpc-errors';

export interface LoginSnapshot {
  phase: LoginPhase;
  qrUrl?: string;
  qrExpires?: number;
  phone?: string;
  codeType?: string;
  codeInvalid?: boolean;
  passwordInvalid?: boolean;
  error?: string;
}

/**
 * The login state machine, wrapping mtcute's `signInQr` and the phone-code
 * flow (`sendCode` → `signIn` → optional 2FA).
 *
 * Both are single long-running promises (connect → exchange the credential →
 * authorize). The flow holds the running one in a background task and exposes
 * a snapshot the SPA polls. The code and password legs are bridged with
 * deferred promises the matching `submit*` methods resolve.
 *
 * The flow lives in memory only: a DO eviction mid-login simply resets to
 * `unauthorized`. The SPA restarts the QR code on its next poll; the phone
 * flow waits for the operator to enter the number again.
 */
export class LoginFlow {
  #mode: 'qr' | 'phone' | null = null;
  #phase: LoginPhase = 'unauthorized';
  #qrUrl?: string;
  #qrExpires?: number;
  #phone?: string;
  #codeType?: string;
  #codeInvalid = false;
  #passwordInvalid = false;
  #error?: string;
  #task: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #codeResolver: ((code: string) => void) | null = null;
  #passwordResolver: ((password: string) => void) | null = null;

  constructor(
    private readonly driver: TelegramDriver,
    private readonly onSettled: (me: MeDto) => void,
    private readonly onFailed: (error: string) => void,
  ) {}

  get running(): boolean {
    return this.#task !== null;
  }

  snapshot(): LoginSnapshot {
    return {
      phase: this.#phase,
      ...(this.#qrUrl !== undefined && { qrUrl: this.#qrUrl }),
      ...(this.#qrExpires !== undefined && { qrExpires: this.#qrExpires }),
      ...(this.#phone !== undefined && { phone: this.#phone }),
      ...(this.#codeType !== undefined && { codeType: this.#codeType }),
      ...(this.#codeInvalid && { codeInvalid: true }),
      ...(this.#passwordInvalid && { passwordInvalid: true }),
      ...(this.#error !== undefined && { error: this.#error }),
    };
  }

  /**
  Starts (or joins) the QR login task and waits briefly for the first QR URL.
  */
  async startQr(): Promise<LoginSnapshot> {
    if (this.#task) {
      if (this.#mode === 'qr') return this.snapshot();
      await this.#settle();
    }
    this.#reset();
    this.#phase = 'qr';
    this.#begin('qr', (signal) => this.#runQr(signal));
    await waitFor(() => this.#qrUrl !== undefined || this.#phase === 'error', 10_000);
    return this.snapshot();
  }

  /**
  Starts (or joins) the phone-code login and waits for the code to be sent.

  The phase stays `unauthorized` until the server confirms the code went out;
  the SPA shows its own "sending" state meanwhile.
  */
  async startPhone(phone: string): Promise<LoginSnapshot> {
    if (this.#task) {
      if (this.#mode === 'phone') return this.snapshot();
      await this.#settle();
    }
    this.#reset();
    this.#phone = phone;
    this.#begin('phone', (signal) => this.#runPhone(phone, signal));
    await waitFor(() => this.#phase === 'code' || this.#phase === 'error', 10_000);
    return this.snapshot();
  }

  submitCode(code: string): void {
    if (this.#phase !== 'code' || !this.#codeResolver) {
      throw new EngineError('No login code is being awaited', 409);
    }
    this.#codeInvalid = false;
    const resolve = this.#codeResolver;
    this.#codeResolver = null;
    resolve(code);
  }

  submitPassword(password: string): void {
    if (this.#phase !== 'password' || !this.#passwordResolver) {
      throw new EngineError('No 2FA password is being awaited', 409);
    }
    this.#passwordInvalid = false;
    const resolve = this.#passwordResolver;
    this.#passwordResolver = null;
    resolve(password);
  }

  cancel(): void {
    this.#abort?.abort();
    this.#abort = null;
    this.#codeResolver = null;
    this.#passwordResolver = null;
    this.#reset();
    this.#phase = 'unauthorized';
  }

  async #runQr(signal: AbortSignal): Promise<void> {
    try {
      const me = await this.driver.signInQr({
        onUrl: (url, expiresMs) => {
          this.#qrUrl = url;
          this.#qrExpires = expiresMs;
          if (this.#phase !== 'password') this.#phase = 'qr';
        },
        onScanned: () => {
          // Printed so a failed attempt is diagnosable from the engine log:
          // this line means Telegram accepted the code the phone sent, and
          // anything after it is our side of the bridge.
          console.log('[engine] login: QR code accepted by a client');
          if (this.#phase === 'qr') this.#phase = 'scanned';
        },
        waitForPassword: () => {
          this.#phase = 'password';
          return this.#waitForValue(signal, (resolve) => (this.#passwordResolver = resolve));
        },
        onInvalidPassword: () => {
          this.#passwordInvalid = true;
        },
        abortSignal: signal,
      });
      this.#finish(me);
    } catch (error) {
      this.#fail(signal, error);
    }
  }

  async #runPhone(phone: string, signal: AbortSignal): Promise<void> {
    try {
      const me = await this.driver.signInPhone({
        phone,
        onCodeSent: (type) => {
          this.#codeType = type;
          this.#codeInvalid = false;
          this.#phase = 'code';
        },
        waitForCode: () => this.#waitForValue(signal, (resolve) => (this.#codeResolver = resolve)),
        onInvalidCode: () => {
          this.#codeInvalid = true;
        },
        waitForPassword: () => {
          this.#phase = 'password';
          return this.#waitForValue(signal, (resolve) => (this.#passwordResolver = resolve));
        },
        onInvalidPassword: () => {
          this.#passwordInvalid = true;
        },
        abortSignal: signal,
      });
      this.#finish(me);
    } catch (error) {
      this.#fail(signal, error);
    }
  }

  #finish(me: MeDto): void {
    this.#phase = 'authorized';
    this.#error = undefined;
    this.onSettled(me);
  }

  #fail(signal: AbortSignal, error: unknown): void {
    if (signal.aborted) {
      this.#phase = 'unauthorized';
      return;
    }
    this.#error = describeLoginFailure(error);
    this.#phase = 'error';
    this.onFailed(this.#error);
  }

  #begin(mode: 'qr' | 'phone', run: (signal: AbortSignal) => Promise<void>): void {
    const abort = new AbortController();
    this.#abort = abort;
    this.#mode = mode;
    this.#task = run(abort.signal).finally(() => {
      this.#task = null;
      this.#abort = null;
      this.#mode = null;
    });
  }

  /**
  Ends an in-flight login of the other mode before a new one starts.
  */
  async #settle(): Promise<void> {
    const task = this.#task;
    if (!task) return;
    this.cancel();
    try {
      await task;
    } catch {
      // The task reports its own failures.
    }
  }

  /**
   * A promise the operator settles through `submitCode`/`submitPassword`, which
   * rejects on cancellation — otherwise a cancel during a wait would leave the
   * login task pending forever and `running` stuck true.
   */
  #waitForValue<T>(signal: AbortSignal, assign: (resolve: (value: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      assign(resolve);
      signal.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
    });
  }

  #reset(): void {
    this.#qrUrl = undefined;
    this.#qrExpires = undefined;
    this.#phone = undefined;
    this.#codeType = undefined;
    this.#codeInvalid = false;
    this.#passwordInvalid = false;
    this.#error = undefined;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
}
