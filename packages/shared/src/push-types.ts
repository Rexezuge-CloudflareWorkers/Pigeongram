/**
The contract half of browser push notifications.

A subscription is created in the browser and crosses the Access-gated bridge
once; the engine keeps it in the Durable Object's SQLite. A notification is
the reverse: the engine encrypts one of these payloads for the push service,
and the service worker reads it after the browser has decrypted it.

The payload carries only what a notification needs — a peer id for the deep
link, a title and a snippet. Message history stays behind the account plane;
nothing here is enough to reconstruct a chat.
*/

import type { PeerId } from './types';

/**
The shape `PushSubscription.toJSON()` produces. Both halves need it: the
SPA sends it, the engine validates and stores it.
*/
export interface PushSubscriptionDto {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
  readonly expirationTime?: number | null;
}

/**
The decrypted body of a push message.

`title` and `body` are authored by the engine; `chatId` is what a
notification click opens. A payload that fails to parse is replaced by a
generic notification in the service worker, never dropped.
*/
export interface PushNotificationPayload {
  readonly chatId: PeerId;
  readonly title: string;
  readonly body: string;
}
