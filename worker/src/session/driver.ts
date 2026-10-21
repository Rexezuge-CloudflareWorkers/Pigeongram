import type { ConnectionState } from '@mtcute/core';
import { User } from '@mtcute/core';
import type { MeDto, MessageDto, UpdateEvent } from '../types';
import { toMeDto } from './dto';
import type { AvatarSize, MediaDownload, MessageMediaOptions } from './media';
import { readAvatar, readAvatarVersion, streamMessageMedia } from './media';
import type { AvatarImage } from './media';
import type { UploadGroupSpec, UploadSpec } from './upload-spec';
import { sendUploadedMedia, sendUploadedMediaGroup } from './upload';
import { createMtBundle } from './mtproto/client';
import type { MtBundle } from './mtproto/client';
import type { TransactionalStorageLike } from './mtproto/sqlite';
import { dispatchRpc } from './rpc';
import { rpcErrorText } from './rpc-errors';
import { mapRawUpdate } from './updates';

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

/**
 * Owns the mtcute client for one Telegram account: constructs it lazily (so a
 * missing credential surfaces as a typed error, not a boot failure), exposes
 * the connect/disconnect lifecycle the wake cycle and the live session drive,
 * and turns raw updates into bridge events.
 *
 * The bundle survives across `connect`/`disconnect` cycles; `logout` drops it
 * so the next login starts from an empty session.
 */
export class TelegramDriver {
  #bundle: MtBundle | null = null;
  readonly #listeners = new Set<(event: UpdateEvent | null) => void>();

  constructor(
    private readonly env: CloudflareEnv,
    private readonly storage: TransactionalStorageLike,
  ) {}

  /**
   * Subscribes to mapped updates. `null` marks a raw update the bridge has no
   * event for — the soak counters still want to see it.
   */
  onEvent(listener: (event: UpdateEvent | null) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #ensure(): MtBundle {
    if (this.#bundle) return this.#bundle;
    const bundle = createMtBundle(this.env, this.storage);
    bundle.base.onRawUpdate.add((info) => {
      let mapped: UpdateEvent | null = null;
      try {
        mapped = mapRawUpdate(info);
      } catch {
        // A mapping failure must never break mtcute's update machinery.
        mapped = null;
      }
      for (const listener of this.#listeners) {
        try {
          listener(mapped);
        } catch {
          // Listener failures are isolated the same way.
        }
      }
    });
    this.#bundle = bundle;
    return bundle;
  }

  /**
  Loads the storage (running mtcute's migrations on first use), no network.
  */
  async prepare(): Promise<void> {
    await this.#ensure().base.prepare();
  }

  /**
  Whether the storage holds a session; also warms the storage up.
  */
  async isAuthorized(): Promise<boolean> {
    const { base } = this.#ensure();
    await base.prepare();
    return (await base.storage.self.fetch()) !== null;
  }

  async signInQr(callbacks: QrLoginCallbacks): Promise<MeDto> {
    const { client } = this.#ensure();
    const user = await client.signInQr({
      onUrlUpdated: (url, expires) => callbacks.onUrl(url, expires.getTime()),
      onQrScanned: () => callbacks.onScanned(),
      password: () => callbacks.waitForPassword(),
      invalidPasswordCallback: () => callbacks.onInvalidPassword(),
      abortSignal: callbacks.abortSignal,
    });
    return toMeDto(user);
  }

  /**
   * The phone-number path: `auth.sendCode`, then the operator's code, with the
   * 2FA leg folded in exactly the way the QR path handles it. The code loop is
   * deliberate — a mistyped code keeps the flow alive instead of ending it.
   */
  async signInPhone(callbacks: PhoneLoginCallbacks): Promise<MeDto> {
    const { client } = this.#ensure();
    const sent = await client.sendCode({ phone: callbacks.phone, abortSignal: callbacks.abortSignal });
    // `sendCode` answers with the user directly when the session turned out to
    // be authorized server-side in the meantime (`auth.sentCodeSuccess`).
    if (sent instanceof User) return toMeDto(sent);
    callbacks.onCodeSent(sent.type);
    for (;;) {
      const code = await callbacks.waitForCode();
      try {
        const user = await client.signIn({
          phone: callbacks.phone,
          phoneCodeHash: sent.phoneCodeHash,
          phoneCode: code,
          abortSignal: callbacks.abortSignal,
        });
        return toMeDto(user);
      } catch (error) {
        const text = rpcErrorText(error);
        if (text === 'PHONE_CODE_INVALID') {
          callbacks.onInvalidCode();
          continue;
        }
        if (text === 'SESSION_PASSWORD_NEEDED') {
          return await this.#signInWithPassword(callbacks);
        }
        throw error;
      }
    }
  }

  async #signInWithPassword(callbacks: PhoneLoginCallbacks): Promise<MeDto> {
    const { client } = this.#ensure();
    for (;;) {
      const password = await callbacks.waitForPassword();
      try {
        return toMeDto(await client.checkPassword({ password, abortSignal: callbacks.abortSignal }));
      } catch (error) {
        if (rpcErrorText(error) !== 'PASSWORD_HASH_INVALID') throw error;
        callbacks.onInvalidPassword();
      }
    }
  }

  async connect(): Promise<void> {
    await this.#ensure().base.connect();
  }

  /**
   * Ends the connection and, if the updates manager never managed to establish
   * a state, drops the bundle entirely.
   *
   * The second part is not optional: mtcute's updates loop restarts without
   * backoff when the initial state fetch fails, and a client that was
   * disconnected mid-fetch would keep failing it forever. A bundle that never
   * caught up has nothing worth keeping — auth keys are written through, so the
   * next connect rebuilds it from storage.
   */
  async disconnect(): Promise<void> {
    const bundle = this.#bundle;
    if (!bundle) return;
    await bundle.base.stopUpdatesLoop();
    await bundle.base.disconnect();
    if (bundle.base.destroyed || bundle.base.updates?.pts !== undefined) {
      return;
    }

    this.#bundle = null;
    try {
      await bundle.base.destroy();
    } catch {
      // Best effort; the DO owns the database, so a half-torn-down client
      // only wastes memory until it is collected.
    }
  }

  /**
   * Replays missed updates: starts the updates loop (idempotent) and waits for
   * the manager's catch-up to settle — `updating` → `connected` — with a
   * timeout so a wake can never hang forever.
   *
   * Refuses to start on a disconnected client: mtcute's updates loop restarts
   * without backoff when it cannot fetch the initial state, so the engine must
   * never hand it a dead connection.
   */
  async catchUp(timeoutMs = 25_000): Promise<void> {
    const { base } = this.#ensure();
    if (!base.isConnected) {
      throw new Error('Not connected to any DC');
    }
    let catchingUp = false;
    const { promise: settled, resolve: settle } = Promise.withResolvers<void>();
    const handler = (state: ConnectionState): void => {
      if (state === 'updating') {
        catchingUp = true;
      } else if (state === 'connected' && catchingUp) {
        settle();
      }
    };
    base.onConnectionState.add(handler);
    const grace = setTimeout(() => {
      if (!catchingUp) settle();
    }, 3000);
    try {
      await base.startUpdatesLoop();
      base.updates?.catchUp();
      await Promise.race([settled, delay(timeoutMs)]);
    } finally {
      clearTimeout(grace);
      base.onConnectionState.remove(handler);
    }
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    return dispatchRpc(this.#ensure().client, method, params);
  }

  async streamMessageMedia(chatId: number, messageId: number, options: MessageMediaOptions = {}): Promise<MediaDownload> {
    return streamMessageMedia(this.#ensure().client, chatId, messageId, options);
  }

  /**
   * Reads a profile photo whole, with the version token that identifies it.
   */
  async readAvatar(chatId: number, size: AvatarSize): Promise<AvatarImage> {
    return readAvatar(this.#ensure().client, chatId, size);
  }

  /**
   * The version token of a profile photo, without reading its bytes.
   */
  async readAvatarVersion(chatId: number, size: AvatarSize): Promise<string | null> {
    return readAvatarVersion(this.#ensure().client, chatId, size);
  }

  async sendUpload(spec: UploadSpec, body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<MessageDto> {
    return sendUploadedMedia(this.#ensure().client, spec, body, signal);
  }

  async sendUploadGroup(spec: UploadGroupSpec, body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<MessageDto[]> {
    return sendUploadedMediaGroup(this.#ensure().client, spec, body, signal);
  }

  /**
  Signs out on the server, then drops this driver's client entirely.
  */
  async logout(): Promise<void> {
    const bundle = this.#bundle;
    if (!bundle) return;
    this.#bundle = null;
    try {
      await bundle.client.logOut();
    } finally {
      try {
        await bundle.base.destroy();
      } catch {
        // The session is already revoked server-side; teardown is best-effort.
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
