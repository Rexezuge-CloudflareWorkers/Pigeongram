import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@telegram-web-client/pages';
import type { DialogDto, MessageDto } from '../../pages/src/types';

interface FetchCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
Installs a fetch mock routed by path; `cb` returns `undefined` for a miss.
*/
function installFetch(cb: (call: FetchCall) => Response | undefined): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call: FetchCall = { method: init?.method ?? 'GET', path: url.pathname, body };
      calls.push(call);
      const response = cb(call);
      if (!response) throw new Error(`Unhandled request: ${call.method} ${call.path}`);
      return response;
    }),
  );
  return calls;
}

/**
A WebSocket that connects to nothing but keeps the hook from reconnecting.
*/
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly CONNECTING = 0;

  readyState = FakeWebSocket.OPEN;
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

const me = { id: 1, firstName: 'Ada', lastName: 'Lovelace', username: 'ada', phone: null, photo: null };

const dialogs: DialogDto[] = [
  {
    chat: { id: 2, kind: 'user', title: 'Bob', username: 'bob', photo: null },
    lastMessage: {
      id: 10,
      chatId: 2,
      senderId: 2,
      senderName: 'Bob',
      outgoing: false,
      date: 1_700_000_000_000,
      text: 'see you',
      entities: [],
      reactions: [],
      service: false,
      media: null,
    },
    unread: 1,
    pinned: false,
    muted: false,
  },
];

const history: MessageDto[] = [
  {
    id: 9,
    chatId: 2,
    senderId: 2,
    senderName: 'Bob',
    outgoing: false,
    date: 1_699_999_900_000,
    text: 'oldest',
    entities: [],
    reactions: [],
    service: false,
    media: null,
  },
  {
    id: 10,
    chatId: 2,
    senderId: 2,
    senderName: 'Bob',
    outgoing: false,
    date: 1_700_000_000_000,
    text: 'see you',
    entities: [],
    reactions: [{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }],
    service: false,
    media: null,
  },
];

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('asks for the access token when the bridge is gated', async () => {
    installFetch(() => json({ error: 'Missing or wrong session token', code: 'gate' }, 401));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Access token required' })).toBeDefined();
  });

  it('shows the login screen and starts a QR flow when unauthorized', async () => {
    const calls = installFetch((call) => {
      if (call.path === '/api/state') {
        return json({ phase: 'unauthorized', authorized: false, me: null });
      }
      if (call.path === '/api/login/qr') {
        return json({ phase: 'qr', authorized: false, me: null, qrUrl: 'tg://login?token=abc' });
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in to Telegram' })).toBeDefined();
    expect(await screen.findByText(/Scan this QR code/)).toBeDefined();
    expect(calls.some((call) => call.path === '/api/login/qr')).toBe(true);
  });

  it('signs in through the phone flow when the QR path is not usable', async () => {
    let phase = 'unauthorized';
    installFetch((call) => {
      if (call.path === '/api/state') {
        return json({ phase, authorized: phase === 'authorized', me: phase === 'authorized' ? me : null });
      }
      if (call.path === '/api/login/qr') {
        phase = 'qr';
        return json({ phase: 'qr', authorized: false, me: null, qrUrl: 'tg://login?token=abc' });
      }
      if (call.path === '/api/login/phone') {
        phase = 'code';
        return json({ phase: 'code', authorized: false, me: null, phone: '+15551234567', codeType: 'app' });
      }
      if (call.path === '/api/login/code') {
        phase = 'authorized';
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/api/rpc') {
        switch (call.body?.method) {
          case 'getMe': {
            return json({ me });
          }
          case 'getDialogs': {
            return json({ dialogs });
          }
          default: {
            return json({});
          }
        }
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Use a phone number instead' }));
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText(/login code to your Telegram app/)).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Login code'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }));

    expect(await screen.findByText('Bob')).toBeDefined();
  });

  it('renders the chat list and opens a thread once authorized', async () => {
    installFetch((call) => {
      if (call.path === '/api/state') {
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/api/rpc') {
        switch (call.body?.method) {
          case 'getMe': {
            return json({ me });
          }
          case 'getDialogs': {
            return json({ dialogs });
          }
          case 'getHistory': {
            return json({ messages: history });
          }
          case 'readHistory': {
            return json({});
          }
          default: {
            return json({ error: 'Unknown RPC method' }, 404);
          }
        }
      }
    });

    render(<App />);

    expect(await screen.findByText('Bob')).toBeDefined();
    fireEvent.click(screen.getByText('Bob'));
    expect(await screen.findByText('oldest')).toBeDefined();
    expect(screen.getAllByText('see you').length).toBeGreaterThan(0);
  });

  it('toggles a reaction optimistically and posts sendReaction', async () => {
    const sent: unknown[] = [];
    installFetch((call) => {
      if (call.path === '/api/state') {
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/api/rpc') {
        switch (call.body?.method) {
          case 'getMe': {
            return json({ me });
          }
          case 'getDialogs': {
            return json({ dialogs });
          }
          case 'getHistory': {
            return json({ messages: history });
          }
          case 'readHistory': {
            return json({});
          }
          case 'sendReaction': {
            sent.push(call.body);
            return json({ message: null });
          }
          default: {
            return json({ error: 'Unknown RPC method' }, 404);
          }
        }
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByText('Bob'));
    const chip = await screen.findByRole('button', { name: 'React 👍 (1)' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(chip);
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'React 👍 (2)' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'React 👍 (2)' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'React 👍 (2)' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'React 👍 (1)' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'React 👍 (1)' }).getAttribute('aria-pressed')).toBe('false');

    expect(sent).toEqual([
      { method: 'sendReaction', params: { chatId: 2, messageId: 10, emoji: '👍', customEmojiId: null } },
      { method: 'sendReaction', params: { chatId: 2, messageId: 10, emoji: null, customEmojiId: null } },
    ]);
  });
});
