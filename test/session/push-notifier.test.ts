import { createDecipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageDto, PushNotificationPayload, UpdateEvent } from '../../packages/backend-services/src/types';
import { PushNotifier } from '../../packages/backend-services/src/session/push-notifier';
import { loadVapidKeys } from '../../packages/backend-services/src/session/push-crypto';
import type { StoredPushSubscription } from '../../packages/backend-services/src/session/push-subscriptions';

function vapidPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url');
}

const uaEcdh = createECDH('prime256v1');
const DEVICE: StoredPushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token',
  p256dh: uaEcdh.generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
  createdAt: 0,
  lastUsedAt: 0,
  failures: 0,
};

function message(id: number, options: Partial<MessageDto> = {}): UpdateEvent {
  return {
    type: 'new_message',
    message: { chatId: 1, id, outgoing: false, senderName: 'Ada', text: `Message ${id}`, ...options } as MessageDto,
  };
}

interface HarnessOptions {
  status?: number;
  devices?: StoredPushSubscription[];
  privateKey?: string;
  rejectFetch?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const scheduled: Promise<void>[] = [];
  const subscriptions = {
    all: vi.fn(() => options.devices ?? [DEVICE]),
    remove: vi.fn(),
    noteFailure: vi.fn(() => 1),
  };
  const fetch = vi.fn(async () => {
    if (options.rejectFetch) throw new Error('Network is gone');
    return new Response(null, { status: options.status ?? 201 });
  });
  const privateKey = options.privateKey ?? vapidPrivateKey();
  const notifier = new PushNotifier({
    env: { VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:test@example.com' },
    subscriptions: subscriptions as never,
    now: () => 1_700_000_000_000,
    schedule: (work) => {
      scheduled.push(work());
    },
    fetch: fetch as unknown as typeof fetch,
  });
  return { notifier, subscriptions, fetch, scheduled, privateKey };
}

async function settle(scheduled: Promise<void>[]): Promise<void> {
  await Promise.all(scheduled.splice(0));
}

/**
Opens the payload the browser would receive, with Node's crypto.
*/
async function decryptPayload(body: Uint8Array, privateKey: string): Promise<PushNotificationPayload> {
  const keys = await loadVapidKeys(privateKey);
  const salt = Buffer.from(body.slice(0, 16));
  const keyIdLength = body[20] as number;
  const ephemeral = Buffer.from(body.slice(21, 21 + keyIdLength));
  const ciphertext = Buffer.from(body.slice(21 + keyIdLength));
  const shared = uaEcdh.computeSecret(ephemeral);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), Buffer.from(keys.publicKey)]);
  const inputKey = Buffer.from(hkdfSync('sha256', shared, Buffer.from(DEVICE.auth, 'base64url'), info, 32));
  const contentKey = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce, { authTagLength: 16 });
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, padded.indexOf(2)).toString('utf8')) as PushNotificationPayload;
}

/**
Offers one batch and returns the payload sent to the push service.
*/
async function deliveredPayload(
  fetch: ReturnType<typeof vi.fn>,
  scheduled: Promise<void>[],
  privateKey: string,
): Promise<PushNotificationPayload> {
  await vi.advanceTimersByTimeAsync(250);
  await settle(scheduled);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  return decryptPayload(init.body as Uint8Array, privateKey);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('browser push notifier', () => {
  it('does nothing without a configured private key', async () => {
    vi.useFakeTimers();
    const { fetch, scheduled } = harness();
    const unconfigured = new PushNotifier({
      env: {},
      subscriptions: { all: () => [DEVICE], remove: vi.fn(), noteFailure: vi.fn() } as never,
      now: Date.now,
      schedule: (work) => {
        scheduled.push(work());
      },
      fetch: fetch as unknown as typeof fetch,
    });

    unconfigured.offer(message(1));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(scheduled);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('coalesces a replay into one authenticated request', async () => {
    vi.useFakeTimers();
    const { notifier, fetch, scheduled } = harness();

    notifier.offer(message(1));
    notifier.offer(message(2));
    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEVICE.endpoint);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
    expect((init.body as Uint8Array).length).toBeGreaterThan(100);
  });

  it('ignores duplicate and outgoing messages', async () => {
    vi.useFakeTimers();
    const { notifier, fetch, scheduled } = harness();

    notifier.offer(message(1));
    notifier.offer(message(1));
    notifier.offer(message(2, { outgoing: true }));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(scheduled);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('drops a subscription whose push service expired it', async () => {
    vi.useFakeTimers();
    const { notifier, subscriptions, scheduled } = harness({ status: 410 });

    notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(subscriptions.remove).toHaveBeenCalledWith(DEVICE.endpoint);
  });

  it('does not send anything when no device is subscribed', async () => {
    vi.useFakeTimers();
    const { notifier, fetch, scheduled } = harness({ devices: [] });

    notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('composes a generic title and a sender-prefixed summary', async () => {
    vi.useFakeTimers();
    const single = harness();
    single.notifier.offer(message(1, { senderName: null }));
    expect(await deliveredPayload(single.fetch, single.scheduled, single.privateKey)).toEqual({
      chatId: 1,
      title: 'New Message',
      body: 'Message 1',
    });

    const batch = harness();
    batch.notifier.offer(message(1));
    batch.notifier.offer(message(2));
    expect(await deliveredPayload(batch.fetch, batch.scheduled, batch.privateKey)).toEqual({
      chatId: 1,
      title: '2 New Messages',
      body: 'Ada: Message 2',
    });

    const anonymous = harness();
    anonymous.notifier.offer(message(1, { senderName: null }));
    anonymous.notifier.offer(message(2, { senderName: null }));
    expect(await deliveredPayload(anonymous.fetch, anonymous.scheduled, anonymous.privateKey)).toEqual({
      chatId: 1,
      title: '2 New Messages',
      body: 'Message 2',
    });
  });

  it('truncates long text and labels messages that carry no text', async () => {
    vi.useFakeTimers();
    const cases: Array<{ options: Partial<MessageDto>; expected: string }> = [
      { options: { text: 'x'.repeat(300) }, expected: `${'x'.repeat(179)}…` },
      { options: { text: '' }, expected: 'New Message' },
      { options: { text: '  ', media: { kind: 'photo' } as MessageDto['media'] }, expected: 'Photo' },
      { options: { text: '', media: { kind: 'video' } as MessageDto['media'] }, expected: 'Video' },
      { options: { text: '', media: { kind: 'animation' } as MessageDto['media'] }, expected: 'Animation' },
      { options: { text: '', media: { kind: 'audio' } as MessageDto['media'] }, expected: 'Audio' },
      { options: { text: '', media: { kind: 'sticker' } as MessageDto['media'] }, expected: 'Sticker' },
      { options: { text: '', media: { kind: 'document' } as MessageDto['media'] }, expected: 'Document' },
      { options: { text: '', media: { kind: 'voice' } as MessageDto['media'] }, expected: 'Voice Message' },
      { options: { text: '', media: { kind: 'other' } as unknown as MessageDto['media'] }, expected: 'Unsupported Message' },
      { options: { text: '', poll: { id: '1' } as MessageDto['poll'] }, expected: 'Poll' },
      { options: { text: '', webPage: { siteName: 'Site' } as MessageDto['webPage'] }, expected: 'Link Preview' },
      { options: { text: '', service: true }, expected: 'Service Message' },
    ];
    for (const [index, entry] of cases.entries()) {
      const run = harness();
      run.notifier.offer(message(index + 1, entry.options));
      const payload = await deliveredPayload(run.fetch, run.scheduled, run.privateKey);
      expect(payload.body).toBe(entry.expected);
    }
  });

  it('bounds the seen set and the pending batch', async () => {
    vi.useFakeTimers();
    const { notifier, fetch, scheduled } = harness();
    for (let id = 1; id <= 1030; id += 1) notifier.offer(message(id));

    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips a stale device with malformed keys instead of dropping the batch', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stale = { ...DEVICE, p256dh: 'not-base64' };
    const { notifier, fetch, scheduled } = harness({ devices: [stale] });

    notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a malformed VAPID key instead of failing the wake', async () => {
    vi.useFakeTimers();
    const { notifier, fetch, scheduled } = harness({ privateKey: 'not*base64' });

    notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(scheduled);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('retires a device after a refused or failed delivery', async () => {
    vi.useFakeTimers();
    const refused = harness({ status: 500 });
    refused.notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(refused.scheduled);
    expect(refused.subscriptions.noteFailure).toHaveBeenCalledWith(DEVICE.endpoint);

    const failed = harness({ rejectFetch: true });
    failed.notifier.offer(message(1));
    await vi.advanceTimersByTimeAsync(250);
    await settle(failed.scheduled);
    expect(failed.subscriptions.noteFailure).toHaveBeenCalledWith(DEVICE.endpoint);
  });
});
