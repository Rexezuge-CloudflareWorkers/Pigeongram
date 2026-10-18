import { describe, expect, it, vi } from 'vitest';
import type { MeDto } from '../../worker/src/types';
import type { PhoneLoginCallbacks, QrLoginCallbacks, TelegramDriver } from '../../worker/src/session/driver';
import { EngineError } from '../../worker/src/session/errors';
import { LoginFlow } from '../../worker/src/session/login-flow';
import { describeLoginFailure } from '../../worker/src/session/rpc-errors';

/**
A stand-in for the driver's long-running `signInQr`/`signInPhone` promises.
*/
class FakeDriver {
  callbacks: QrLoginCallbacks | null = null;
  phoneCallbacks: PhoneLoginCallbacks | null = null;
  #resolve: ((me: MeDto) => void) | null = null;
  #reject: ((error: unknown) => void) | null = null;

  signInQr(callbacks: QrLoginCallbacks): Promise<MeDto> {
    this.callbacks = callbacks;
    return this.#pending(callbacks.abortSignal);
  }

  signInPhone(callbacks: PhoneLoginCallbacks): Promise<MeDto> {
    this.phoneCallbacks = callbacks;
    return this.#pending(callbacks.abortSignal);
  }

  #pending(abortSignal: AbortSignal): Promise<MeDto> {
    return new Promise<MeDto>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
      abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }

  settle(me: MeDto): void {
    this.#resolve?.(me);
  }

  fail(error: unknown): void {
    this.#reject?.(error);
  }
}

const ME: MeDto = { id: 1, firstName: 'Ada', lastName: null, username: 'ada', phone: null, photo: null };

function createFlow(): {
  driver: FakeDriver;
  flow: LoginFlow;
  settled: ReturnType<typeof vi.fn>;
  failed: ReturnType<typeof vi.fn>;
} {
  const driver = new FakeDriver();
  const settled = vi.fn();
  const failed = vi.fn();
  const flow = new LoginFlow(driver as unknown as TelegramDriver, settled, failed);
  return { driver, flow, settled, failed };
}

async function startWithUrl(flow: LoginFlow, driver: FakeDriver): Promise<void> {
  const started = flow.startQr();
  await vi.waitFor(() => expect(driver.callbacks).not.toBeNull());
  driver.callbacks?.onUrl('tg://login?token=abc', 1_800_000_000_000);
  await started;
}

async function startPhoneFlow(flow: LoginFlow, driver: FakeDriver): Promise<void> {
  const started = flow.startPhone('+15551234567');
  await vi.waitFor(() => expect(driver.phoneCallbacks).not.toBeNull());
  driver.phoneCallbacks?.onCodeSent('app');
  await started;
}

describe('LoginFlow', () => {
  it('exposes the QR URL and the scanned transition', async () => {
    const { driver, flow } = createFlow();
    const started = flow.startQr();
    await vi.waitFor(() => expect(driver.callbacks).not.toBeNull());
    driver.callbacks?.onUrl('tg://login?token=abc', 1_800_000_000_000);
    driver.callbacks?.onScanned();

    const snapshot = await started;
    expect(snapshot).toMatchObject({
      phase: 'scanned',
      qrUrl: 'tg://login?token=abc',
      qrExpires: 1_800_000_000_000,
    });
    expect(flow.running).toBe(true);
  });

  it('joins an in-flight login instead of starting a second one', async () => {
    const { driver, flow } = createFlow();
    const first = flow.startQr();
    const second = flow.startQr();
    await vi.waitFor(() => expect(driver.callbacks).not.toBeNull());
    driver.callbacks?.onUrl('tg://login?token=abc', 1);
    await Promise.all([first, second]);
    expect(flow.running).toBe(true);
    expect(driver.callbacks).not.toBeNull();
  });

  it('bridges the 2FA password leg and flags invalid attempts', async () => {
    const { driver, flow } = createFlow();
    await startWithUrl(flow, driver);

    expect(() => flow.submitPassword('too early')).toThrow(EngineError);

    const awaited = driver.callbacks?.waitForPassword();
    expect(flow.snapshot()).toMatchObject({ phase: 'password' });

    driver.callbacks?.onInvalidPassword();
    expect(flow.snapshot()).toMatchObject({ phase: 'password', passwordInvalid: true });

    flow.submitPassword('hunter2');
    await expect(awaited).resolves.toBe('hunter2');
    expect(flow.snapshot().passwordInvalid).toBeUndefined();
  });

  it('settles as authorized and reports the user exactly once', async () => {
    const { driver, flow, settled } = createFlow();
    await startWithUrl(flow, driver);
    driver.settle(ME);

    await vi.waitFor(() => {
      expect(flow.snapshot().phase).toBe('authorized');
    });
    expect(settled).toHaveBeenCalledWith(ME);
    await vi.waitFor(() => expect(flow.running).toBe(false));
  });

  it('surfaces sign-in failures as the error phase', async () => {
    const { driver, flow, failed } = createFlow();
    await startWithUrl(flow, driver);
    driver.fail(new Error('network down'));

    await vi.waitFor(() => {
      expect(flow.snapshot()).toMatchObject({ phase: 'error', error: 'network down' });
    });
    expect(failed).toHaveBeenCalledWith('network down');
  });

  it('resets to unauthorized on cancel without reporting a failure', async () => {
    const { driver, flow, failed } = createFlow();
    await startWithUrl(flow, driver);

    flow.cancel();
    expect(driver.callbacks?.abortSignal.aborted).toBe(true);

    await vi.waitFor(() => {
      expect(flow.snapshot()).toMatchObject({ phase: 'unauthorized' });
    });
    await vi.waitFor(() => expect(flow.running).toBe(false));
    expect(failed).not.toHaveBeenCalled();
  });

  it('exposes the phone flow up to the code entry', async () => {
    const { driver, flow, settled } = createFlow();
    const started = flow.startPhone('+15551234567');
    await vi.waitFor(() => expect(driver.phoneCallbacks).not.toBeNull());

    expect(() => flow.submitCode('12345')).toThrow(EngineError);

    driver.phoneCallbacks?.onCodeSent('app');
    const snapshot = await started;
    expect(snapshot).toMatchObject({ phase: 'code', phone: '+15551234567', codeType: 'app' });

    const awaited = driver.phoneCallbacks?.waitForCode();
    driver.phoneCallbacks?.onInvalidCode();
    expect(flow.snapshot()).toMatchObject({ phase: 'code', codeInvalid: true });

    flow.submitCode('12345');
    await expect(awaited).resolves.toBe('12345');
    expect(flow.snapshot().codeInvalid).toBeUndefined();

    driver.settle(ME);
    await vi.waitFor(() => {
      expect(flow.snapshot().phase).toBe('authorized');
    });
    expect(settled).toHaveBeenCalledWith(ME);
  });

  it('switches from an in-flight QR login to the phone flow', async () => {
    const { driver, flow } = createFlow();
    await startWithUrl(flow, driver);

    const swapping = flow.startPhone('+15551234567');
    await vi.waitFor(() => expect(driver.phoneCallbacks).not.toBeNull());
    driver.phoneCallbacks?.onCodeSent('app');
    await swapping;

    expect(driver.callbacks?.abortSignal.aborted).toBe(true);
    expect(flow.snapshot()).toMatchObject({ phase: 'code', phone: '+15551234567', codeType: 'app' });
  });

  it('releases a pending code wait when the flow is cancelled', async () => {
    const { driver, flow } = createFlow();
    await startPhoneFlow(flow, driver);

    const awaited = driver.phoneCallbacks?.waitForCode();
    flow.cancel();

    // Without this rejection the login task would stay pending forever and
    // `running` would never fall back to false.
    await expect(awaited).rejects.toThrow('Login cancelled');
    await vi.waitFor(() => expect(flow.running).toBe(false));
    expect(flow.snapshot()).toMatchObject({ phase: 'unauthorized' });
  });
});

describe('describeLoginFailure', () => {
  const rpcError = (text: string, extra: Record<string, unknown> = {}): Error =>
    Object.assign(new Error(`Telegram API error 400: ${text}`), { text, ...extra });

  it('explains the phone-number and code failures', () => {
    expect(describeLoginFailure(rpcError('PHONE_NUMBER_INVALID'))).toContain('international format');
    expect(describeLoginFailure(rpcError('PHONE_CODE_EXPIRED'))).toContain('expired');
  });

  it('includes the wait time on flood limits', () => {
    expect(describeLoginFailure(rpcError('FLOOD_WAIT_%d', { seconds: 42 }))).toContain('42 seconds');
  });

  it('keeps ordinary errors as they are', () => {
    expect(describeLoginFailure(new Error('network down'))).toBe('network down');
  });
});
