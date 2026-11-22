/**
The driver's injected seams and login callbacks.

Split from `driver.ts` so the class file stays under the god-file cap; both
are contracts a test or the login flow names directly.
*/

import type { MtBundle } from '@pigeongram/provider-clients/mtproto/client';
import type { TransactionalStorageLike } from '@pigeongram/provider-clients/mtproto/sqlite';

/**
How the driver builds its client stack. Injectable so the lifecycle and
delegation can be tested without wasm, a network or a real credential.
*/
export type MtBundleFactory = (env: CloudflareEnv, storage: TransactionalStorageLike) => MtBundle;

export interface QrLoginCallbacks {
  onUrl(url: string, expiresMs: number): void;
  onScanned(): void;
  /**
  Resolves with the 2FA password once the operator submits it.
  */
  waitForPassword(): Promise<string>;
  onInvalidPassword(): void;
  abortSignal: AbortSignal;
}

export interface PhoneLoginCallbacks {
  phone: string;
  /**
  The confirmation code was sent (`app`, `sms`, `call`, …).
  */
  onCodeSent(type: string): void;
  /**
  Resolves with the login code once the operator submits it.
  */
  waitForCode(): Promise<string>;
  onInvalidCode(): void;
  /**
  Resolves with the 2FA password once the operator submits it.
  */
  waitForPassword(): Promise<string>;
  onInvalidPassword(): void;
  abortSignal: AbortSignal;
}
