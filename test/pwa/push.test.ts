import { describe, expect, it, vi } from 'vitest';
import {
  GENERIC_VIEW,
  NOTIFICATION_ICON,
  notificationView,
  openNotification as openPushNotification,
  readPushPayload,
  showNotification as showPushNotification,
} from '../../apps/web/sw/push';

function fakeHost(clients: Array<{ url: string; focus: () => Promise<void> }> = []) {
  return {
    registration: { showNotification: vi.fn(async () => {}) },
    clients: {
      matchAll: vi.fn(async () => clients),
      openWindow: vi.fn(async () => null),
    },
  };
}

describe('the service worker notifications', () => {
  it('builds a deep link and one notification per chat', () => {
    const view = notificationView({ chatId: -100_123, title: 'Ada', body: 'Hello there' });
    expect(view).toEqual({
      title: 'Ada',
      body: 'Hello there',
      tag: 'chat:-100123',
      icon: NOTIFICATION_ICON,
      url: '/chat/-100123',
    });
  });

  it('falls back to a visible notification for an unreadable payload', () => {
    expect(notificationView(null)).toEqual(GENERIC_VIEW);
    expect(notificationView({ chatId: 'nope', title: '', body: '' })).toEqual(GENERIC_VIEW);
    expect(GENERIC_VIEW.title).toBe('New Message');
    expect(GENERIC_VIEW.body).toBe('You Have A New Message.');
  });

  it('reads a payload without letting malformed data fail the event', () => {
    expect(readPushPayload({ data: { json: () => ({ chatId: 1, title: 'Ada', body: 'Hi' }) } } as never)).toEqual({
      chatId: 1,
      title: 'Ada',
      body: 'Hi',
    });
    expect(
      readPushPayload({
        data: {
          json: () => {
            throw new Error('bad JSON');
          },
          text: () => 'plain',
        },
      } as never),
    ).toBe('plain');
    expect(readPushPayload({ data: null } as never)).toBeNull();
    expect(
      readPushPayload({
        data: {
          json: () => {
            throw new Error('bad JSON');
          },
          text: () => {
            throw new Error('bad text');
          },
        },
      } as never),
    ).toBeNull();
  });

  it('shows the notification through the worker host', async () => {
    const host = fakeHost();
    await showPushNotification({ data: { json: () => ({ chatId: 1, title: 'Ada', body: 'Hi' }) } } as never, host);

    expect(host.registration.showNotification).toHaveBeenCalledWith(
      'Ada',
      expect.objectContaining({ body: 'Hi', tag: 'chat:1', data: { url: '/chat/1' } }),
    );
  });

  it('focuses an open chat on a click, or opens one at the deep link', async () => {
    const focus = vi.fn(async () => {});
    const host = fakeHost([{ url: 'https://pigeongram.example/chat/1', focus }]);
    const close = vi.fn();
    await openPushNotification({ notification: { close, data: { url: '/chat/1' } } } as never, host);
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(host.clients.openWindow).not.toHaveBeenCalled();

    const other = fakeHost([{ url: 'https://pigeongram.example/chat/2', focus }]);
    await openPushNotification({ notification: { close: vi.fn(), data: { url: '/chat/1' } } } as never, other);
    expect(other.clients.openWindow).toHaveBeenCalledWith('/chat/1');

    const malformed = fakeHost();
    await openPushNotification({ notification: { close: vi.fn(), data: { url: 'https://elsewhere.example/' } } } as never, malformed);
    expect(malformed.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
