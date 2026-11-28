/**
The service worker's notification half.

The browser has already decrypted the Web Push payload by the time a `push`
event reaches here, so this module only reads a small JSON object and shows
a notification. A click is a navigation into the SPA: a chat is a pathname
route, so the existing Pages fallback serves a deep link to `/chat/:id`
without any extra routing in the worker.

The visible strings here are authored copy and are Title Case like the
catalogue's. They live in the worker rather than in i18next because a push
arrives with no page attached; the same strings are asserted by the PWA
tests instead of the locale validator.
*/

/*
The worker is built as its own classic script and ships no workspace
dependencies, so the payload shape is mirrored here rather than imported from
`@pigeongram/shared`. Keep the three fields in step with `push-types.ts`; the
PWA test asserts the parsed shape on this side.
*/
interface PushNotificationPayload {
  readonly chatId: number;
  readonly title: string;
  readonly body: string;
}

/*
The worker itself supplies the browser globals. Narrow structural shapes keep
this module testable under the test workspace's DOM lib: the WebWorker lib and
the DOM lib cannot both be in one TypeScript program.
*/
interface PushMessageDataLike {
  json(): unknown;
  text(): string;
}

interface PushEventLike {
  readonly data: PushMessageDataLike | null;
}

interface NotificationClickLike {
  readonly notification: {
    readonly data: unknown;
    close(): void;
  };
}

interface WorkerHost {
  readonly registration: {
    showNotification(title: string, options: Record<string, unknown>): Promise<void>;
  };
  readonly clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<ReadonlyArray<{ url: string; focus(): Promise<unknown> }>>;
    openWindow(url: string): Promise<unknown>;
  };
}

export const NOTIFICATION_ICON = '/icon-192.png';

interface NotificationView {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly icon: string;
  readonly url: string;
}

/**
Shown when a push has no readable payload — a message is still waiting.
*/
export const GENERIC_VIEW: NotificationView = {
  title: 'New Message',
  body: 'You Have A New Message.',
  tag: 'pigeongram',
  icon: NOTIFICATION_ICON,
  url: '/',
};

function isPayload(value: unknown): value is PushNotificationPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.chatId === 'number' &&
    Number.isFinite(payload.chatId) &&
    typeof payload.title === 'string' &&
    payload.title.length > 0 &&
    typeof payload.body === 'string' &&
    payload.body.length > 0
  );
}

/**
Turns a decrypted payload into the notification options. Never throws.
*/
export function notificationView(raw: unknown): NotificationView {
  if (!isPayload(raw)) return GENERIC_VIEW;
  return {
    title: raw.title,
    body: raw.body,
    // One notification per chat: a burst of messages replaces the row rather
    // than stacking a dozen copies in the notification tray.
    tag: `chat:${raw.chatId}`,
    icon: NOTIFICATION_ICON,
    url: `/chat/${raw.chatId}`,
  };
}

/**
Reads the payload from a push event without letting bad JSON fail the event.
*/
export function readPushPayload(event: PushEventLike): unknown {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    try {
      return event.data.text();
    } catch {
      return null;
    }
  }
}

/**
Shows the notification. The caller supplies `event.waitUntil`.
*/
export async function showNotification(event: PushEventLike, host: WorkerHost): Promise<void> {
  const view = notificationView(readPushPayload(event));
  await host.registration.showNotification(view.title, {
    body: view.body,
    icon: view.icon,
    badge: view.icon,
    tag: view.tag,
    data: { url: view.url },
  });
}

/**
Focuses an open tab on the chat, or opens one at the deep link.
*/
export async function openNotification(event: NotificationClickLike, host: WorkerHost): Promise<void> {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | null;
  const url = typeof data?.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  const clients = await host.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if (new URL(client.url).pathname === url) {
      await client.focus();
      return;
    }
  }
  await host.clients.openWindow(url);
}
