import type { PushSubscriptionDto } from '../types';
import { request } from './request';

/**
The two device-local calls behind the notification toggle. Both go through
the Access-gated account plane: a subscription belongs to the signed-in
account's Durable Object, never to the public `/api/*` surface.
*/
export const subscribePush = (subscription: PushSubscriptionDto): Promise<{ ok: true }> =>
  request('/user/push/subscribe', { method: 'POST', body: subscription });

export const unsubscribePush = (endpoint: string): Promise<{ ok: true }> =>
  request('/user/push/unsubscribe', { method: 'POST', body: { endpoint } });
