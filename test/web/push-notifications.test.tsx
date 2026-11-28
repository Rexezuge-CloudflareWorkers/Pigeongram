import { createECDH } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { HttpStatusError } from '@rexezuge/web/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribePush, unsubscribePush } from '../../apps/web/src/api';
import { vapidPublicKey } from '../../apps/web/src/pwa/vapid';
import { useNotifications } from '../../apps/web/src/pwa/useNotifications';

vi.mock('../../apps/web/src/api', () => ({
  subscribePush: vi.fn(async () => ({ ok: true as const })),
  unsubscribePush: vi.fn(async () => ({ ok: true as const })),
}));

const PUBLIC_KEY = createECDH('prime256v1').generateKeys().toString('base64url');
const SUB_JSON = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token',
  keys: { p256dh: createECDH('prime256v1').generateKeys().toString('base64url'), auth: 'AQIDBAUGBwgJCgsMDQ4PEA' },
};
const SUBSCRIPTION = {
  endpoint: SUB_JSON.endpoint,
  toJSON: () => SUB_JSON,
  unsubscribe: vi.fn(async () => true),
};

interface SetupOptions {
  subscription?: typeof SUBSCRIPTION | null;
  permission?: NotificationPermission;
}

function setup(options: SetupOptions = {}) {
  const pushManager = {
    getSubscription: vi.fn(async () => options.subscription ?? null),
    subscribe: vi.fn(async () => SUBSCRIPTION),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperties(globalThis, {
    PushManager: { configurable: true, value: function PushManager() {} },
    Notification: {
      configurable: true,
      value: { requestPermission: vi.fn(async () => options.permission ?? 'granted') },
    },
  });
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUBLIC_KEY);
  return { pushManager };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the VAPID public key', () => {
  it('accepts one raw P-256 point and nothing else', () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUBLIC_KEY);
    const key = vapidPublicKey();
    expect(key?.length).toBe(65);
    expect(key?.[0]).toBe(4);
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    expect(vapidPublicKey()).toBeNull();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'not*base64');
    expect(vapidPublicKey()).toBeNull();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', Buffer.alloc(64).toString('base64url'));
    expect(vapidPublicKey()).toBeNull();
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', Buffer.alloc(65, 2).toString('base64url'));
    expect(vapidPublicKey()).toBeNull();
  });
});

describe('the notification toggle', () => {
  it('is hidden outside a production build with a key', async () => {
    setup();
    vi.stubEnv('PROD', false);
    const onProblem = vi.fn();
    const { result } = renderHook(() => useNotifications(onProblem));
    expect(result.current.available).toBe(false);
    await act(async () => {
      await result.current.toggle();
    });
    expect(onProblem).not.toHaveBeenCalled();
  });

  it('reads an existing device subscription on mount', async () => {
    setup({ subscription: SUBSCRIPTION });
    const { result } = renderHook(() => useNotifications(vi.fn()));
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it('asks for permission, subscribes and posts the keys', async () => {
    const { pushManager } = setup();
    const onProblem = vi.fn();
    const { result } = renderHook(() => useNotifications(onProblem));

    await act(async () => {
      await result.current.toggle();
    });

    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    expect(subscribePush).toHaveBeenCalledWith(SUBSCRIPTION.toJSON());
    expect(result.current.enabled).toBe(true);
    expect(onProblem).not.toHaveBeenCalled();
  });

  it('reports a denied permission without subscribing', async () => {
    setup({ permission: 'denied' });
    const onProblem = vi.fn();
    const { result } = renderHook(() => useNotifications(onProblem));

    await act(async () => {
      await result.current.toggle();
    });

    expect(onProblem).toHaveBeenCalledWith('denied');
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it('unsubscribes locally even when the engine cannot be reached', async () => {
    setup({ subscription: SUBSCRIPTION });
    vi.mocked(unsubscribePush).mockRejectedValueOnce(new Error('offline'));
    const onProblem = vi.fn();
    const { result } = renderHook(() => useNotifications(onProblem));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.toggle();
    });

    expect(unsubscribePush).toHaveBeenCalledWith(SUBSCRIPTION.endpoint);
    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
    expect(onProblem).toHaveBeenCalledWith('failed');
  });

  it('undoes a subscription the engine refused for a full table', async () => {
    setup();
    vi.mocked(subscribePush).mockRejectedValueOnce(new HttpStatusError(409, 'Too Many Devices', 'conflict'));
    const onProblem = vi.fn();
    const { result } = renderHook(() => useNotifications(onProblem));

    await act(async () => {
      await result.current.toggle();
    });

    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalled();
    expect(onProblem).toHaveBeenCalledWith('limit');
    expect(result.current.enabled).toBe(false);
  });
});
