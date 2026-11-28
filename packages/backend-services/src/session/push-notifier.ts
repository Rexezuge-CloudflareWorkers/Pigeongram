/**
The engine's outbound Web Push fan-out.

Every `UpdateEvent` reaches `handleEvent`, but only wake mode has no browser
attached — that is when a notification is worth sending. The notifier is
offered incoming messages, keeps a short deduplicated batch, and flushes it
outside the Durable Object's input gate through the lifecycle's `background`
seam. One flush is one notification per device, not one per message: a
`getDifference` replay of forty messages would otherwise be forty pushes.

Nothing here writes on a read path. The in-memory seen set is enough,
because the mtcute update cursor is already durable and a replay after a
Durable Object restart only covers messages that were never notified.
*/

import type { MessageDto, MessageMediaKind, PushNotificationPayload, UpdateEvent } from '../types';
import { encryptPushPayload, loadVapidKeys, vapidAuthorization } from './push-crypto';
import type { VapidKeys } from './push-crypto';
import { log } from './log';
import { MAX_PUSH_FAILURES, type PushSubscriptions, type StoredPushSubscription } from './push-subscriptions';

interface PushEnv {
  /**
  base64url PKCS#8 P-256 private key, provisioned as a worker secret.
  */
  readonly VAPID_PRIVATE_KEY?: string;
  /**
  The `sub` claim: a contact URL push services can attribute to this app.
  */
  readonly VAPID_SUBJECT?: string;
}

interface PushNotifierHost {
  readonly env: PushEnv;
  readonly subscriptions: PushSubscriptions;
  readonly now: () => number;
  /**
  Runs the delivery outside the input gate (`lifecycle.background`).
  */
  readonly schedule: (work: () => Promise<void>) => void;
  /**
  Replaceable in tests; workerd supplies the global.
  */
  readonly fetch?: typeof fetch;
}

/**
How long the batch waits for more messages from the same wake.
*/
const PUSH_COALESCE_MS = 250;
const MAX_SEEN = 1024;
const MAX_PENDING = 20;
const MAX_SNIPPET = 180;
const DEFAULT_SUBJECT = 'mailto:pigeongram@example.com';

interface Candidate {
  readonly chatId: number;
  readonly senderName: string | null;
  readonly snippet: string;
}

export class PushNotifier {
  private readonly fetchImpl: typeof fetch;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private pending: Candidate[] = [];
  private scheduled = false;
  private keys: VapidKeys | null = null;
  private keysPromise: Promise<VapidKeys> | null = null;

  constructor(private readonly host: PushNotifierHost) {
    this.fetchImpl = host.fetch ?? fetch.bind(globalThis);
  }

  /**
  Offers one engine event. Outgoing messages, edits, reads and calls never
  produce a notification; neither does a message this object already saw.
  The method is synchronous on purpose: the input gate must not wait for
  a signing key or a network call.
  */
  offer(event: UpdateEvent | null): void {
    if (!this.host.env.VAPID_PRIVATE_KEY || event?.type !== 'new_message') return;
    const message = event.message;
    if (message.outgoing) return;
    const id = `${message.chatId}:${message.id}`;
    if (this.seen.has(id)) return;
    this.remember(id);
    this.pending.push({ chatId: message.chatId, senderName: message.senderName, snippet: snippetOf(message) });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    // The delay runs inside the lifecycle's `waitUntil` promise: a timer
    // started on its own could be lost when the Durable Object hibernates
    // between the wake event and the notification.
    this.host.schedule(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, PUSH_COALESCE_MS);
      });
      this.scheduled = false;
      await this.flush();
    });
  }

  /**
  Sends the current batch to every subscription. Public so tests can drive
  it without fake timers; production only reaches it through `schedule`.
  */
  async flush(): Promise<void> {
    const candidates = this.pending;
    this.pending = [];
    if (candidates.length === 0 || !this.host.env.VAPID_PRIVATE_KEY) return;
    const subscriptions = this.host.subscriptions.all();
    if (subscriptions.length === 0) return;

    const keys = await this.vapidKeys();
    if (!keys) return;
    const payload: PushNotificationPayload = compose(candidates);
    const body = JSON.stringify(payload);
    // One stale device must not stop the batch: prepare each request on its
    // own and drop only the one that cannot be encrypted or signed.
    const prepared: Array<{ subscription: StoredPushSubscription; bytes: Uint8Array; authorization: string }> = [];
    for (const subscription of subscriptions) {
      try {
        prepared.push({
          subscription,
          bytes: await encryptPushPayload(body, subscription, keys.publicKey),
          authorization: await vapidAuthorization(
            subscription.endpoint,
            keys,
            this.host.env.VAPID_SUBJECT ?? DEFAULT_SUBJECT,
            this.host.now,
          ),
        });
      } catch (error) {
        log.warn('push.prepare_failed', { host: new URL(subscription.endpoint).host, error });
      }
    }
    log.info('push.batched', { messages: candidates.length, devices: prepared.length, chatId: payload.chatId });
    await Promise.all(prepared.map((entry) => this.deliver(entry.subscription, entry.bytes, entry.authorization)));
  }

  private async deliver(subscription: StoredPushSubscription, bytes: Uint8Array, authorization: string): Promise<void> {
    const host = new URL(subscription.endpoint).host;
    try {
      const response = await this.fetchImpl(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          TTL: '60',
        },
        body: bytes as BodyInit,
      });
      if (response.status === 404 || response.status === 410) {
        this.host.subscriptions.remove(subscription.endpoint);
        log.info('push.expired', { host, status: response.status });
      } else if (!response.ok) {
        const failures = this.host.subscriptions.noteFailure(subscription.endpoint);
        log.warn('push.refused', { host, status: response.status, failures });
      }
    } catch (error) {
      const failures = this.host.subscriptions.noteFailure(subscription.endpoint);
      log.warn('push.failed', { host, error, failures, remaining: failures < MAX_PUSH_FAILURES });
    }
  }

  private async vapidKeys(): Promise<VapidKeys | null> {
    if (this.keys) return this.keys;
    if (!this.keysPromise) {
      this.keysPromise = loadVapidKeys(this.host.env.VAPID_PRIVATE_KEY as string).then((keys) => {
        this.keys = keys;
        return keys;
      });
    }
    try {
      return await this.keysPromise;
    } catch (error) {
      this.keysPromise = null;
      this.keys = null;
      log.warn('push.vapid_invalid', { error });
      return null;
    }
  }

  private remember(id: string): void {
    if (this.seen.add(id).size > MAX_SEEN) {
      const oldest = this.seenOrder.shift();
      if (oldest) this.seen.delete(oldest);
    }
    this.seenOrder.push(id);
  }
}

function compose(candidates: readonly Candidate[]): PushNotificationPayload {
  const first = candidates[0];
  const last = candidates.at(-1) as Candidate;
  if (candidates.length === 1) {
    return { chatId: first.chatId, title: first.senderName ?? 'New Message', body: first.snippet };
  }
  const prefix = last.senderName ? `${last.senderName}: ` : '';
  return { chatId: last.chatId, title: `${candidates.length} New Messages`, body: `${prefix}${last.snippet}` };
}

/**
The snippet authored from a message. Text is data and keeps its own casing;
the fallback labels are visible copy, so they are Title Case like the SPA's.
*/
function snippetOf(message: MessageDto): string {
  const text = message.text.trim();
  if (text) return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET - 1)}…` : text;
  if (message.media) return mediaLabel(message.media.kind);
  if (message.poll) return 'Poll';
  if (message.webPage) return 'Link Preview';
  if (message.service) return 'Service Message';
  return 'New Message';
}

function mediaLabel(kind: MessageMediaKind): string {
  switch (kind) {
    case 'photo': {
      return 'Photo';
    }
    case 'video': {
      return 'Video';
    }
    case 'animation': {
      return 'Animation';
    }
    case 'audio': {
      return 'Audio';
    }
    case 'voice': {
      return 'Voice Message';
    }
    case 'sticker': {
      return 'Sticker';
    }
    case 'document': {
      return 'Document';
    }
    default: {
      return 'Unsupported Message';
    }
  }
}
