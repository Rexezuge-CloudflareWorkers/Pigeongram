import { BaseCryptoProvider } from '@mtcute/core/utils.js';
import type { IAesCtr, IEncryptionScheme } from '@mtcute/core/utils.js';
import {
  createCtr256,
  ctr256,
  deflateMaxSize,
  freeCtr256,
  gunzip,
  ige256Decrypt,
  ige256Encrypt,
  initSync,
  sha1,
  sha256,
} from '@mtcute/wasm';
import wasmModule from '@mtcute/wasm/mtcute.wasm';

const ALGO_TO_SUBTLE: Record<string, string> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512',
};

/**
 * TS's `BufferSource` is `ArrayBuffer`-backed while mtcute's provider contract
 * uses plain `Uint8Array`; both are the same bytes at runtime.
 */
const asBufferSource = (data: Uint8Array): BufferSource => data as unknown as BufferSource;
const asRandomTarget = (buf: Uint8Array): Uint8Array<ArrayBuffer> => buf as unknown as Uint8Array<ArrayBuffer>;

/**
 * Crypto provider for workerd, adapted from `@mtcute/web`'s `WebCryptoProvider`
 * (mtcute 0.32.5, MIT licence).
 *
 * The difference is WASM loading: instead of fetching the module over HTTP at
 * `initialize()` time, Wrangler compiles the bundled `.wasm` import into a
 * `WebAssembly.Module` and `initSync` instantiates it synchronously. SHA-1,
 * AES-CTR/IGE and gzip all come from that module; only PBKDF2, HMAC and
 * DRBG delegate to WebCrypto (`crypto.subtle`, available in workerd).
 */
export class WorkerCryptoProvider extends BaseCryptoProvider {
  #initialized = false;

  initialize(): void {
    if (this.#initialized) return;
    initSync(wasmModule);
    this.#initialized = true;
  }

  sha1(data: Uint8Array): Uint8Array {
    return sha1(data);
  }

  sha256(data: Uint8Array): Uint8Array {
    return sha256(data);
  }

  createAesCtr(key: Uint8Array, iv: Uint8Array): IAesCtr {
    const ctx = createCtr256(key, iv);
    return {
      process: (data) => ctr256(ctx, data),
      close: () => freeCtr256(ctx),
    };
  }

  createAesIge(key: Uint8Array, iv: Uint8Array): IEncryptionScheme {
    return {
      encrypt: (data) => ige256Encrypt(data, key, iv),
      decrypt: (data) => ige256Decrypt(data, key, iv),
    };
  }

  gzip(data: Uint8Array, maxSize: number): Uint8Array | null {
    return deflateMaxSize(data, maxSize);
  }

  gunzip(data: Uint8Array): Uint8Array {
    return gunzip(data);
  }

  async pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, keylen = 64, algo = 'sha512'): Promise<Uint8Array> {
    const keyMaterial = await crypto.subtle.importKey('raw', asBufferSource(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: asBufferSource(salt),
        iterations,
        hash: ALGO_TO_SUBTLE[algo] ?? 'SHA-512',
      },
      keyMaterial,
      keylen * 8,
    );
    return new Uint8Array(bits);
  }

  async hmacSha256(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    const keyMaterial = await crypto.subtle.importKey('raw', asBufferSource(key), { name: 'HMAC', hash: { name: 'SHA-256' } }, false, [
      'sign',
    ]);
    const signature = await crypto.subtle.sign({ name: 'HMAC' }, keyMaterial, asBufferSource(data));
    return new Uint8Array(signature);
  }

  randomFill(buf: Uint8Array): void {
    crypto.getRandomValues(asRandomTarget(buf));
  }
}
