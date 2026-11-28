import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PUSH_FAILURES,
  MAX_PUSH_SUBSCRIPTIONS,
  PushSubscriptions,
} from '../../packages/backend-services/src/session/push-subscriptions';
import { parsePushSubscription } from '../../packages/backend-services/src/session/push-spec';
import type { PushSubscriptionDto } from '../../packages/backend-services/src/types';
import { createNodeSqlStorage, openNodeDatabase } from './node-sql';

function subscription(index = 0): PushSubscriptionDto {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${index}`,
    keys: {
      p256dh: Buffer.alloc(65, 4 + index).toString('base64url'),
      auth: Buffer.alloc(16, 7 + index).toString('base64url'),
    },
  };
}

describe('push subscription validation', () => {
  it('accepts a browser subscription and keeps its shape', () => {
    expect(parsePushSubscription(subscription() as unknown as Record<string, unknown>)).toEqual({
      endpoint: subscription().endpoint,
      keys: subscription().keys,
      expirationTime: null,
    });
  });

  it('refuses shapes that would fail inside the crypto layer or reach a local service', () => {
    const base = subscription() as unknown as Record<string, unknown>;
    expect(() => parsePushSubscription({ ...base, endpoint: 'http://fcm.googleapis.com/push' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: 'https://127.0.0.1/push' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: 'https://user:pass@fcm.googleapis.com/push' })).toThrow();
    expect(() => parsePushSubscription({ ...base, keys: { p256dh: 'AAAA', auth: 'AAAA' } })).toThrow();
    expect(() => parsePushSubscription({ ...base, expirationTime: 'later' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: '' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: 'not a url' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: 'https://[::1]/push' })).toThrow();
    expect(() => parsePushSubscription({ ...base, endpoint: `${subscription().endpoint}#fragment` })).toThrow();
    expect(() => parsePushSubscription({ ...base, keys: [] })).toThrow();
    expect(() => parsePushSubscription({ ...base, keys: { p256dh: subscription().keys.p256dh, auth: 'AAAA' } })).toThrow();
    expect(parsePushSubscription({ ...base, expirationTime: null }).expirationTime).toBeNull();
    expect(parsePushSubscription({ ...base, expirationTime: 123 }).expirationTime).toBe(123);
  });
});

describe('push subscription storage', () => {
  function store() {
    return new PushSubscriptions(createNodeSqlStorage(openNodeDatabase()), () => 1000);
  }

  it('upserts one row per device', () => {
    const subscriptions = store();
    expect(subscriptions.count()).toBe(0);
    subscriptions.upsert(subscription());
    subscriptions.upsert({
      ...subscription(),
      keys: { p256dh: Buffer.alloc(65, 9).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') },
    });

    expect(subscriptions.count()).toBe(1);
    expect(subscriptions.all()[0]?.p256dh).toBe(Buffer.alloc(65, 9).toString('base64url'));
    expect(subscriptions.all()[0]?.createdAt).toBe(1000);
  });

  it('bounds the table and removes a device', () => {
    const subscriptions = store();
    for (let index = 0; index < MAX_PUSH_SUBSCRIPTIONS; index += 1) subscriptions.upsert(subscription(index));

    expect(() => subscriptions.upsert(subscription(MAX_PUSH_SUBSCRIPTIONS))).toThrow();
    subscriptions.remove(subscription(0).endpoint);
    expect(subscriptions.count()).toBe(MAX_PUSH_SUBSCRIPTIONS - 1);
    subscriptions.upsert(subscription(MAX_PUSH_SUBSCRIPTIONS));
    expect(subscriptions.count()).toBe(MAX_PUSH_SUBSCRIPTIONS);
  });

  it('retires a device after repeated refusals', () => {
    const subscriptions = store();
    const device = subscription();
    subscriptions.upsert(device);
    expect(subscriptions.noteFailure(device.endpoint)).toBe(1);
    expect(subscriptions.noteFailure(device.endpoint)).toBe(2);
    expect(subscriptions.noteFailure(device.endpoint)).toBe(3);
    expect(subscriptions.count()).toBe(0);
  });

  it('keeps deliveries alive when a spent write budget refuses cleanup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createNodeSqlStorage(openNodeDatabase());
    let refuseWrites = false;
    const storage = {
      exec(query: string, ...bindings: unknown[]) {
        if (refuseWrites && /delete|update/.test(query.toLowerCase())) throw new Error('Exceeded rows written');
        return db.exec(query, ...bindings);
      },
    };
    const subscriptions = new PushSubscriptions(storage, () => 1000);
    const device = subscription();
    subscriptions.upsert(device);
    refuseWrites = true;

    expect(() => subscriptions.remove(device.endpoint)).not.toThrow();
    expect(() => subscriptions.clear()).not.toThrow();
    expect(subscriptions.noteFailure(device.endpoint)).toBe(MAX_PUSH_FAILURES);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
