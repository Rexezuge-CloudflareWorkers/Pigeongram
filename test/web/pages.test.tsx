import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@telegram-web-client/pages';
import type { ChatDto, DialogDto, MessageDto, UpdateEvent } from '../../pages/src/types';

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
Installs a fetch mock routed by path; `cb` returns `undefined` for a miss, and
may answer with a promise the test resolves later.
*/
function installFetch(cb: (call: FetchCall) => Response | Promise<Response> | undefined): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call: FetchCall = { method: init?.method ?? 'GET', path: url.pathname, body };
      calls.push(call);
      const response = await cb(call);
      if (!response) throw new Error(`Unhandled request: ${call.method} ${call.path}`);
      return response;
    }),
  );
  return calls;
}

/**
A WebSocket that connects to nothing but keeps the hook from reconnecting,
and that tests can drive from the app's side.
*/
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly CONNECTING = 0;
  /**
  Every socket the app has opened, oldest first; tests deliver updates through
  the most recent one.
  */
  static readonly instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /**
  Dispatches one socket event to the listeners the app registered.
  */
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
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

const carol: ChatDto = { id: 3, kind: 'user', title: 'Carol', username: 'carol', photo: null };

const carolDialog: DialogDto = { chat: carol, lastMessage: null, unread: 0, pinned: false, muted: false };

const carolHistory: MessageDto[] = [
  {
    id: 1,
    chatId: 3,
    senderId: 3,
    senderName: 'Carol',
    outgoing: false,
    date: 1_699_999_950_000,
    text: 'carol says hi',
    entities: [],
    reactions: [],
    service: false,
    media: null,
  },
];

/**
A message fixture for the live-update tests.
*/
function message(overrides: Partial<MessageDto> & { id: number; chatId: number }): MessageDto {
  return {
    senderId: null,
    senderName: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: `message ${overrides.id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    ...overrides,
  };
}

/**
Routes the signed-in bridge surface — state, me, dialogs, per-chat history and
reads — with an `rpc` escape hatch for test-specific methods.
*/
function installSignedInFetch(
  options: {
    dialogs?: DialogDto[];
    history?: (chatId: number) => Response | Promise<Response>;
    rpc?: (call: FetchCall) => Response | Promise<Response> | undefined;
  } = {},
): FetchCall[] {
  return installFetch((call) => {
    if (call.path === '/api/state') {
      return json({ phase: 'authorized', authorized: true, me });
    }
    if (call.path !== '/api/rpc') {
      return;
    }
    const params = (call.body?.params ?? {}) as Record<string, unknown>;
    switch (call.body?.method) {
      case 'getMe': {
        return json({ me });
      }
      case 'getDialogs': {
        return json({ dialogs: options.dialogs ?? dialogs });
      }
      case 'getHistory': {
        return options.history ? options.history(Number(params.chatId)) : json({ messages: history });
      }
      case 'readHistory': {
        return json({});
      }
      default: {
        return options.rpc?.(call) ?? json({ error: `Unknown RPC method: ${String(call.body?.method)}` }, 404);
      }
    }
  });
}

/**
The rendered thread, so assertions cannot match chat-list previews.
*/
function threadSection(): HTMLElement {
  const element = document.querySelector<HTMLElement>('section.thread');
  if (!element) throw new Error('The thread is not rendered');
  return element;
}

/**
Feeds one bridge update through the app's update socket.
*/
function deliver(update: UpdateEvent): void {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('No updates socket is open');
  act(() => {
    socket.emit('message', { data: JSON.stringify({ type: 'update', update }) });
  });
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
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

  describe('thread scoping', () => {
    const bobAndCarol = [...dialogs, carolDialog];
    const perChatHistory = (chatId: number): Response => json({ messages: chatId === 3 ? carolHistory : history });

    it('keeps live messages from other chats out of the open thread', async () => {
      installSignedInFetch({ dialogs: bobAndCarol, history: perChatHistory });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      deliver({ type: 'new_message', message: message({ id: 9, chatId: 3, senderName: 'Carol', text: 'not for Bob' }) });
      expect(within(threadSection()).queryByText('not for Bob')).toBeNull();

      deliver({ type: 'new_message', message: message({ id: 11, chatId: 2, senderName: 'Bob', text: 'for Bob' }) });
      expect(await within(threadSection()).findByText('for Bob')).toBeDefined();
    });

    it('ignores edits from other chats in the open thread', async () => {
      installSignedInFetch({ dialogs: bobAndCarol, history: perChatHistory });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      // One edit shares an id with a loaded message (would replace it), the
      // other id is unknown (would be appended).
      deliver({ type: 'edit_message', message: message({ id: 10, chatId: 3, text: 'hijacked' }) });
      deliver({ type: 'edit_message', message: message({ id: 7, chatId: 3, text: 'stray edit' }) });

      expect(within(threadSection()).queryByText('hijacked')).toBeNull();
      expect(within(threadSection()).queryByText('stray edit')).toBeNull();
      expect(within(threadSection()).getByText('see you')).toBeDefined();
    });

    it('keeps a live message that arrived while history was loading', async () => {
      let resolveHistory: ((messages: MessageDto[]) => void) | undefined;
      installSignedInFetch({
        dialogs: bobAndCarol,
        history: () =>
          new Promise<Response>((resolve) => {
            resolveHistory = (messages) => resolve(json({ messages }));
          }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      deliver({ type: 'new_message', message: message({ id: 11, chatId: 2, senderName: 'Bob', text: 'racing in' }) });
      expect(await within(threadSection()).findByText('racing in')).toBeDefined();

      await act(async () => {
        resolveHistory?.(history);
      });

      expect(await within(threadSection()).findByText('oldest')).toBeDefined();
      expect(within(threadSection()).getByText('racing in')).toBeDefined();
    });

    it('drops a history response for a chat the user has left', async () => {
      let resolveBobHistory: ((messages: MessageDto[]) => void) | undefined;
      installSignedInFetch({
        dialogs: bobAndCarol,
        history: (chatId) =>
          chatId === 2
            ? new Promise<Response>((resolve) => {
                resolveBobHistory = (messages) => resolve(json({ messages }));
              })
            : json({ messages: carolHistory }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await screen.findByText('Carol'));
      expect(await screen.findByText('carol says hi')).toBeDefined();

      await act(async () => {
        resolveBobHistory?.(history);
      });

      expect(within(threadSection()).queryByText('oldest')).toBeNull();
      expect(within(threadSection()).getByText('carol says hi')).toBeDefined();
    });

    it('does not append a sent message to a chat the user switched to', async () => {
      let resolveSend: ((message: MessageDto) => void) | undefined;
      installSignedInFetch({
        dialogs: bobAndCarol,
        history: perChatHistory,
        rpc: (call) => {
          if (call.body?.method !== 'sendMessage') return;
          return new Promise<Response>((resolve) => {
            resolveSend = (message: MessageDto) => resolve(json({ message }));
          });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'hi Bob' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      fireEvent.click(await screen.findByText('Carol'));
      expect(await screen.findByText('carol says hi')).toBeDefined();

      await act(async () => {
        resolveSend?.(message({ id: 11, chatId: 2, senderName: 'Ada', text: 'hi Bob' }));
      });

      expect(within(threadSection()).queryByText('hi Bob')).toBeNull();
      expect(within(threadSection()).getByText('carol says hi')).toBeDefined();
    });
  });
});
