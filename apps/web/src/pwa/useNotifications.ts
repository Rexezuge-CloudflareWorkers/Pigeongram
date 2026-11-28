import { useCallback, useEffect, useState } from 'react';
import { HttpStatusError } from '@rexezuge/web/api';
import { subscribePush, unsubscribePush } from '../api';
import { vapidPublicKey } from './vapid';

/**
The notification toggle's device half.

A subscription is local to the browser and is sent to the account's engine
once. The switch reads its initial state from `pushManager`, so a reload
does not lie about whether this device is subscribed; the engine is never
read on a screen just to render a toggle.

The service worker is registered only in a production build, so the same
gate applies here: no half-working switch in development.
*/
export type NotificationProblem = 'unsupported' | 'denied' | 'failed' | 'limit';

export interface NotificationsState {
  /**
  Whether this browser can subscribe at all.
  */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly busy: boolean;
  /**
  Turns push on or off, reporting only the outcome the reader can act on.
  */
  readonly toggle: () => Promise<void>;
}

function isAvailable(): boolean {
  return (
    import.meta.env.PROD &&
    'serviceWorker' in navigator &&
    'PushManager' in globalThis &&
    'Notification' in globalThis &&
    vapidPublicKey() !== null
  );
}

export function useNotifications(onProblem: (problem: NotificationProblem) => void): NotificationsState {
  const [available] = useState(isAvailable);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (active) setEnabled(subscription !== null);
      })
      .catch(() => {
        // A browser that refuses the push manager leaves the switch off.
      });
    return () => {
      active = false;
    };
  }, [available]);

  const toggle = useCallback(async (): Promise<void> => {
    if (!available || busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Stop receiving locally even when the engine cannot be reached: the
        // browser is the authority for this device's subscription.
        await unsubscribePush(existing.endpoint).catch(() => onProblem('failed'));
        await existing.unsubscribe();
        setEnabled(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        onProblem('denied');
        return;
      }
      const key = vapidPublicKey();
      if (!key) {
        onProblem('unsupported');
        return;
      }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      try {
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The subscription has no keys');
        await subscribePush({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          expirationTime: json.expirationTime,
        });
      } catch (error) {
        // A rejected subscription is not usable: undo it so the next toggle
        // starts clean instead of looking enabled with no engine record.
        await subscription.unsubscribe().catch(() => {});
        if (error instanceof HttpStatusError && error.status === 409) onProblem('limit');
        else onProblem('failed');
        return;
      }
      setEnabled(true);
    } catch {
      onProblem(enabled ? 'failed' : 'unsupported');
    } finally {
      setBusy(false);
    }
  }, [available, busy, enabled, onProblem]);

  return { available, enabled, busy, toggle };
}
