import { createHmac, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WorkerCryptoProvider } from '../../packages/provider-clients/src/mtproto/crypto';
import type { CryptoWasmBindings } from '../../packages/provider-clients/src/mtproto/crypto';

/**
 * The workerd crypto provider's routing.
 *
 * SHA-1, AES and gzip come from the bundled mtcute wasm module; PBKDF2, HMAC
 * and the random source come from WebCrypto. The bindings are injected — Node
 * cannot instantiate the real module — and the fake proves which call each
 * method makes. The WebCrypto half is checked against node's own
 * implementations, so a wrong hash name or key length fails here rather than
 * in a login attempt against Telegram.
 */

const CONTEXT = 7;

function fakeWasm() {
  return {
    module: { compiled: true } as unknown as WebAssembly.Module,
    initSync: vi.fn(),
    sha1: vi.fn((_data: Uint8Array) => new Uint8Array([0x51])),
    sha256: vi.fn((_data: Uint8Array) => new Uint8Array([0x52])),
    createCtr256: vi.fn((_key: Uint8Array, _iv: Uint8Array) => CONTEXT),
    ctr256: vi.fn((_context: number, data: Uint8Array) => data.map((byte) => byte ^ 0xff)),
    freeCtr256: vi.fn((_context: number) => {}),
    ige256Encrypt: vi.fn((_data: Uint8Array, _key: Uint8Array, _iv: Uint8Array) => new Uint8Array([0x61])),
    ige256Decrypt: vi.fn((_data: Uint8Array, _key: Uint8Array, _iv: Uint8Array) => new Uint8Array([0x62])),
    deflateMaxSize: vi.fn((_data: Uint8Array, _maxSize: number) => new Uint8Array([0x71])),
    gunzip: vi.fn((_data: Uint8Array) => new Uint8Array([0x72])),
  } satisfies CryptoWasmBindings;
}

describe('WorkerCryptoProvider', () => {
  it('instantiates the wasm module once, no matter how often initialization is asked for', () => {
    const wasm = fakeWasm();
    const provider = new WorkerCryptoProvider(wasm);
    provider.initialize();
    provider.initialize();

    expect(wasm.initSync).toHaveBeenCalledTimes(1);
    expect(wasm.initSync).toHaveBeenCalledWith(wasm.module);
  });

  it('delegates SHA-1 and SHA-256 to the wasm bindings', () => {
    const wasm = fakeWasm();
    const provider = new WorkerCryptoProvider(wasm);
    const data = new Uint8Array([1, 2, 3]);

    expect(provider.sha1(data)).toEqual(new Uint8Array([0x51]));
    expect(provider.sha256(data)).toEqual(new Uint8Array([0x52]));
    expect(wasm.sha1).toHaveBeenCalledWith(data);
    expect(wasm.sha256).toHaveBeenCalledWith(data);
  });

  it('runs AES-CTR through one wasm context, and frees it on close', () => {
    const wasm = fakeWasm();
    const provider = new WorkerCryptoProvider(wasm);
    const key = new Uint8Array(32).fill(1);
    const iv = new Uint8Array(16).fill(2);
    const counter = provider.createAesCtr(key, iv);

    expect(wasm.createCtr256).toHaveBeenCalledWith(key, iv);
    expect(counter.process(new Uint8Array([0, 1]))).toEqual(new Uint8Array([0xff, 0xfe]));
    expect(wasm.ctr256).toHaveBeenCalledWith(CONTEXT, new Uint8Array([0, 1]));

    counter.close?.();
    expect(wasm.freeCtr256).toHaveBeenCalledWith(CONTEXT);
  });

  it('runs AES-IGE in both directions', () => {
    const wasm = fakeWasm();
    const provider = new WorkerCryptoProvider(wasm);
    const key = new Uint8Array(32).fill(3);
    const iv = new Uint8Array(32).fill(4);
    const ige = provider.createAesIge(key, iv);
    const data = new Uint8Array([9, 8]);

    expect(ige.encrypt(data)).toEqual(new Uint8Array([0x61]));
    expect(ige.decrypt(data)).toEqual(new Uint8Array([0x62]));
    expect(wasm.ige256Encrypt).toHaveBeenCalledWith(data, key, iv);
    expect(wasm.ige256Decrypt).toHaveBeenCalledWith(data, key, iv);
  });

  it('delegates gzip and gunzip to the wasm bindings', () => {
    const wasm = fakeWasm();
    const provider = new WorkerCryptoProvider(wasm);
    const data = new Uint8Array([5]);

    expect(provider.gzip(data, 1024)).toEqual(new Uint8Array([0x71]));
    expect(provider.gunzip(data)).toEqual(new Uint8Array([0x72]));
    expect(wasm.deflateMaxSize).toHaveBeenCalledWith(data, 1024);
    expect(wasm.gunzip).toHaveBeenCalledWith(data);
  });

  it('derives PBKDF2 bits with the hash the caller names', async () => {
    const provider = new WorkerCryptoProvider(fakeWasm());
    const password = new TextEncoder().encode('hunter2');
    const salt = new Uint8Array(8).fill(7);

    const derived = await provider.pbkdf2(password, salt, 1000, 32, 'sha1');

    expect(Buffer.from(derived).equals(pbkdf2Sync(password, salt, 1000, 32, 'sha1'))).toBe(true);
  });

  it('falls back to SHA-512 for an unknown PBKDF2 hash name', async () => {
    const provider = new WorkerCryptoProvider(fakeWasm());
    const password = new Uint8Array([1, 2]);
    const salt = new Uint8Array([3, 4]);

    const derived = await provider.pbkdf2(password, salt, 1000, 16, 'not-a-hash');

    expect(Buffer.from(derived).equals(pbkdf2Sync(password, salt, 1000, 16, 'sha512'))).toBe(true);
  });

  it('signs an HMAC-SHA-256 key with WebCrypto', async () => {
    const provider = new WorkerCryptoProvider(fakeWasm());
    const data = new Uint8Array([1, 2, 3]);
    const key = new Uint8Array([4, 5, 6]);

    const signature = await provider.hmacSha256(data, key);

    expect(Buffer.from(signature).equals(createHmac('sha256', key).update(data).digest())).toBe(true);
  });

  it('fills random bytes from WebCrypto', () => {
    const provider = new WorkerCryptoProvider(fakeWasm());
    const buffer = new Uint8Array(64);

    provider.randomFill(buffer);

    expect(buffer.some((byte) => byte !== 0)).toBe(true);
  });
});
