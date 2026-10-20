import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@telegram-web-client/pages';
import type { ChatDto, DialogDto, MessageDto, MessageMarkupDto, MessageMediaDto, MessagePollDto, UpdateEvent } from '../../pages/src/types';

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
    chat: { id: 2, kind: 'user', title: 'Bob', username: 'bob', photo: null, canSendMessages: true },
    lastMessage: {
      id: 10,
      chatId: 2,
      groupedId: null,
      senderId: 2,
      senderName: 'Bob',
      outgoing: false,
      date: 1_700_000_000_000,
      text: 'see you',
      entities: [],
      reactions: [],
      service: false,
      media: null,
      poll: null,
      markup: null,
      reply: null,
      forward: null,
      views: null,
      comments: null,
    },
    unread: 1,
    readInboxMaxId: 9,
    pinned: false,
    muted: false,
  },
];

const history: MessageDto[] = [
  {
    id: 9,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    outgoing: false,
    date: 1_699_999_900_000,
    text: 'oldest',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  },
  {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    outgoing: false,
    date: 1_700_000_000_000,
    text: 'see you',
    entities: [],
    reactions: [{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  },
];

const carol: ChatDto = { id: 3, kind: 'user', title: 'Carol', username: 'carol', photo: null, canSendMessages: true };

const carolDialog: DialogDto = { chat: carol, lastMessage: null, unread: 0, readInboxMaxId: 1, pinned: false, muted: false };

const carolHistory: MessageDto[] = [
  {
    id: 1,
    chatId: 3,
    groupedId: null,
    senderId: 3,
    senderName: 'Carol',
    outgoing: false,
    date: 1_699_999_950_000,
    text: 'carol says hi',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  },
];

/**
A message fixture for the live-update tests.
*/
function message(overrides: Partial<MessageDto> & { id: number; chatId: number }): MessageDto {
  return {
    groupedId: null,
    senderId: null,
    senderName: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: `message ${overrides.id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
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
    if (call.path === '/user/state') {
      return json({ phase: 'authorized', authorized: true, me });
    }
    if (call.path !== '/user/rpc') {
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
        return options.rpc?.(call) ?? json({});
      }
      case 'getBotCommands': {
        return options.rpc?.(call) ?? json({ commands: [] });
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
Opens a loaded message's context menu the way a right-click does, and returns
the menu so a test can inspect or click its items.
*/
function openMessageMenu(messageId: number): HTMLElement {
  const row = threadSection().querySelector<HTMLElement>(`[data-message-id="${CSS.escape(String(messageId))}"]`);
  if (!row) throw new Error(`Message ${String(messageId)} is not rendered`);
  fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
  return screen.getByRole('menu', { name: 'Message actions' });
}

/**
Clicks an open menu's item by label, e.g. `Reply`.
*/
function clickMenuItem(name: string): void {
  fireEvent.click(within(screen.getByRole('menu', { name: 'Message actions' })).getByRole('menuitem', { name }));
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

/**
jsdom has no `scrollIntoView`, and the thread calls it for the open jump and
for quote jumps; every suite gets a no-op spy it can assert on.
*/
function stubScrollIntoView(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  Element.prototype.scrollIntoView = spy as unknown as Element['scrollIntoView'];
  return spy;
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubScrollIntoView();
  globalThis.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  // jsdom has no layout; the scroll tests share one painted layout. The
  // mutable box `stubLayout` returns lets a test grow the list, which is how
  // a late media load changes `scrollHeight` with no scroll event.
  let scrollIntoView: ReturnType<typeof vi.fn>;
  /**
  Descriptors `stubLayout` replaced, restored after each test.
  */
  let layout: Array<[string, PropertyDescriptor | undefined]> | null;

  beforeEach(() => {
    scrollIntoView = stubScrollIntoView();
    layout = null;
  });

  afterEach(() => {
    for (const [key, descriptor] of layout ?? []) {
      if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
      else delete (Element.prototype as unknown as Record<string, unknown>)[key];
    }
  });

  function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  }

  /**
  jsdom has no layout, so paint one: each message is a 50px row in document
  order inside a `listHeight` list, and the `.messages` viewport is
  `viewportHeight` tall at its current `scrollTop`. Only the rows
  overlapping the viewport (or a bottom before the last row) are reported
  read.
  */
  function stubLayout({ listHeight, viewportHeight }: { listHeight: number; viewportHeight: number }): { listHeight: number } {
    let scroll = 0;
    const box = { listHeight };
    layout = [];
    for (const key of ['scrollHeight', 'clientHeight', 'scrollTop', 'getBoundingClientRect'] as const) {
      layout.push([key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
    }
    Object.defineProperties(Element.prototype, {
      scrollHeight: { configurable: true, get: () => box.listHeight },
      clientHeight: { configurable: true, get: () => viewportHeight },
      scrollTop: {
        configurable: true,
        get: () => scroll,
        set: (value: number) => {
          scroll = value;
        },
      },
    });
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      if (this.classList.contains('messages')) return rect(0, viewportHeight);
      const rows = this.parentElement?.querySelectorAll('[data-message-id]');
      const index = rows ? Array.from(rows).indexOf(this) : -1;
      if (index < 0) return rect(0, 0);
      const top = index * 50 - scroll;
      return rect(top, top + 50);
    } as Element['getBoundingClientRect'];
    return box;
  }

  function scrollContainer(): HTMLElement {
    const element = threadSection().querySelector<HTMLElement>('.messages');
    if (!element) throw new Error('The thread has no scroll container');
    return element;
  }

  it('asks the operator to reload when Cloudflare Access rejects the request', async () => {
    installFetch(() => json({ error: 'Cloudflare Access token required', code: 'access' }, 401));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign-in required' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });

  it('shows the login screen and starts a QR flow when unauthorized', async () => {
    const calls = installFetch((call) => {
      if (call.path === '/user/state') {
        return json({ phase: 'unauthorized', authorized: false, me: null });
      }
      if (call.path === '/user/login/qr') {
        return json({ phase: 'qr', authorized: false, me: null, qrUrl: 'tg://login?token=abc' });
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in to Telegram' })).toBeDefined();
    expect(await screen.findByText(/Scan this QR code/)).toBeDefined();
    expect(calls.some((call) => call.path === '/user/login/qr')).toBe(true);
  });

  it('signs in through the phone flow when the QR path is not usable', async () => {
    let phase = 'unauthorized';
    installFetch((call) => {
      if (call.path === '/user/state') {
        return json({ phase, authorized: phase === 'authorized', me: phase === 'authorized' ? me : null });
      }
      if (call.path === '/user/login/qr') {
        phase = 'qr';
        return json({ phase: 'qr', authorized: false, me: null, qrUrl: 'tg://login?token=abc' });
      }
      if (call.path === '/user/login/phone') {
        phase = 'code';
        return json({ phase: 'code', authorized: false, me: null, phone: '+15551234567', codeType: 'app' });
      }
      if (call.path === '/user/login/code') {
        phase = 'authorized';
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/user/rpc') {
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

  describe('browser history', () => {
    const APP = 'telegram-web-client';

    function entry(depth: number, layer?: 'viewer'): Record<string, unknown> {
      return layer === undefined ? { app: APP, depth } : { app: APP, depth, layer };
    }

    /**
    Replaces the current entry, as a browser traversal would land on it, then
    fires the event the app listens to.
    */
    function arrive(path: string, state: unknown): void {
      act(() => {
        globalThis.history.replaceState(state, '', path);
        dispatchEvent(new PopStateEvent('popstate'));
      });
    }

    it('records the open chat in the URL and returns to the list on popstate', async () => {
      installSignedInFetch();
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      expect(await screen.findByText('oldest')).toBeDefined();
      expect(location.pathname).toBe('/chat/2');
      expect(globalThis.history.state).toMatchObject({ app: APP, depth: 1 });

      arrive('/', entry(0));

      await waitFor(() => expect(document.querySelector('section.thread.empty')).not.toBeNull());
      expect(location.pathname).toBe('/');
    });

    it('boots a shared chat link into the thread with the list behind it', async () => {
      globalThis.history.replaceState(null, '', '/chat/2');
      installSignedInFetch();
      render(<App />);

      expect(await screen.findByText('oldest')).toBeDefined();
      expect(location.pathname).toBe('/chat/2');
      expect(globalThis.history.state).toMatchObject({ app: APP, depth: 1 });
    });

    it('normalizes a linked post the window cannot produce to its chat', async () => {
      globalThis.history.replaceState(null, '', '/chat/2/post/999');
      installSignedInFetch({ history: () => json({ messages: [] }) });
      render(<App />);

      await waitFor(() => expect(globalThis.location.pathname).toBe('/chat/2'));
      expect(globalThis.history.state).toMatchObject({ app: APP, depth: 1 });
      expect(within(threadSection()).getByText('No messages yet — say hello.')).toBeDefined();
    });

    it('delegates the thread back button to browser history', async () => {
      installSignedInFetch();
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const back = vi.spyOn(globalThis.history, 'back').mockImplementation(() => {});
      fireEvent.click(screen.getByRole('button', { name: 'Back to chat list' }));

      expect(back).toHaveBeenCalledTimes(1);
      back.mockRestore();
    });

    it('leaves only the comments screen when back returns to the thread', async () => {
      const channel: ChatDto = {
        id: -1_000_000_000_020,
        kind: 'channel',
        title: 'Announcements',
        username: 'announce',
        photo: null,
        canSendMessages: false,
      };
      const post = message({
        id: 7,
        chatId: channel.id,
        text: 'A new feature shipped',
        comments: { hasComments: true, count: 2, discussionChatId: -1_000_000_000_030 },
      });
      installSignedInFetch({
        dialogs: [{ chat: channel, lastMessage: post, unread: 0, readInboxMaxId: 7, pinned: false, muted: false }],
        history: () => json({ messages: [post] }),
        rpc: (call) =>
          call.body?.method === 'getComments'
            ? json({ comments: [], count: 2, discussionChatId: -1_000_000_000_030, discussionMessageId: 10 })
            : undefined,
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /2 comments/ }));

      expect(await screen.findByText('Comments')).toBeDefined();
      expect(location.pathname).toBe(`/chat/${String(channel.id)}/post/7/comments`);

      arrive(`/chat/${String(channel.id)}/post/7`, entry(1));

      await waitFor(() => expect(screen.queryByText('Comments')).toBeNull());
      expect(within(threadSection()).getByText('A new feature shipped')).toBeDefined();
    });

    it('closes the media viewer on back and reopens it on forward', async () => {
      const photo: MessageMediaDto = {
        kind: 'photo',
        fileName: null,
        mime: null,
        size: 1000,
        width: 320,
        height: 240,
        duration: null,
      };
      installSignedInFetch({ history: () => json({ messages: [message({ id: 10, chatId: 2, text: '', media: photo })] }) });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await within(threadSection()).findByRole('button', { name: 'Open photo' }));

      expect(await screen.findByRole('dialog', { name: 'Media viewer' })).toBeDefined();
      expect(globalThis.history.state).toMatchObject({ app: APP, depth: 2, layer: 'viewer' });

      arrive('/chat/2', entry(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(within(threadSection()).getByRole('button', { name: 'Open photo' })).toBeDefined();

      arrive('/chat/2', entry(2, 'viewer'));
      expect(await screen.findByRole('dialog', { name: 'Media viewer' })).toBeDefined();
    });
  });

  it('renders the chat list and opens a thread once authorized', async () => {
    installFetch((call) => {
      if (call.path === '/user/state') {
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/user/rpc') {
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

  it('loads the slash-command menu for an open bot chat', async () => {
    const helper: ChatDto = { id: 7, kind: 'bot', title: 'Helper', username: 'helper_bot', photo: null, canSendMessages: true };
    installSignedInFetch({
      dialogs: [{ chat: helper, lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false }],
      history: () => json({ messages: [] }),
      rpc: (call) =>
        call.body?.method === 'getBotCommands' ? json({ commands: [{ command: 'start', description: 'Start the bot' }] }) : undefined,
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Helper'));

    fireEvent.click(await screen.findByRole('button', { name: 'Bot commands' }));
    expect(screen.getByRole('option', { name: /\/start/ })).toBeDefined();
  });

  it('renders the forwarded-from header in a private chat', async () => {
    const forwarded = message({
      id: 11,
      chatId: 2,
      senderId: 2,
      senderName: 'Bob',
      text: 'fresh news',
      forward: {
        senderId: null,
        senderName: 'News Channel',
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    installSignedInFetch({ history: () => json({ messages: [forwarded] }) });

    render(<App />);
    fireEvent.click(await screen.findByText('Bob'));

    expect(await screen.findByText('↗ Forwarded from News Channel')).toBeDefined();
  });

  it('renders the forwarded-from header above the sender name in a group', async () => {
    const team: ChatDto = { id: 4, kind: 'supergroup', title: 'Team', username: null, photo: null, canSendMessages: true };
    const forwarded = message({
      id: 20,
      chatId: 4,
      senderId: 2,
      senderName: 'Bob',
      text: 'fresh news',
      forward: {
        senderId: null,
        senderName: 'News Channel',
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    installSignedInFetch({
      dialogs: [{ chat: team, lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false }],
      history: () => json({ messages: [forwarded] }),
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Team'));

    const origin = await screen.findByText('↗ Forwarded from News Channel');
    const sender = screen.getByText('Bob', { selector: '.message .sender' });
    expect(origin.nextElementSibling).toBe(sender);
  });

  it('toggles a reaction optimistically and posts sendReaction', async () => {
    const sent: unknown[] = [];
    installFetch((call) => {
      if (call.path === '/user/state') {
        return json({ phase: 'authorized', authorized: true, me });
      }
      if (call.path === '/user/rpc') {
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

  describe('inline keyboard buttons', () => {
    const markup: MessageMarkupDto = {
      rows: [
        [
          { text: 'Create', style: 'primary', kind: 'callback', data: 'AQID', requiresPassword: false },
          { text: 'Docs', style: null, kind: 'url', url: 'https://example.com/docs' },
        ],
        [
          { text: 'Copy token', style: null, kind: 'copy', copyText: 'token-123' },
          { text: 'Locked', style: null, kind: 'callback', data: 'BA==', requiresPassword: true },
          { text: 'Play', style: null, kind: 'game' },
        ],
      ],
    };

    const buttonMessage = message({ id: 10, chatId: 2, senderName: 'Bob', text: 'Tap the button below.', markup });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    function installButtonFetch(calls: FetchCall[]): void {
      installSignedInFetch({
        history: () => json({ messages: [buttonMessage] }),
        rpc: (call) => {
          if (call.body?.method !== 'pressCallbackButton') {
            return;
          }

          calls.push(call);
          return json({ text: 'Button pressed', alert: false, url: null });
        },
      });
    }

    it('renders the keyboard, presses callbacks and copies text', async () => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      const calls: FetchCall[] = [];
      installButtonFetch(calls);
      render(<App />);

      fireEvent.click(await screen.findByText('Bob'));
      const create = await screen.findByRole('button', { name: 'Create' });
      expect(create.className).toContain('primary');
      expect(threadSection().querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
      expect((screen.getByRole('button', { name: 'Locked' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(create);
      expect(await screen.findByText('Button pressed')).toBeDefined();
      expect(calls.map((call) => call.body?.params)).toEqual([{ chatId: 2, messageId: 10, data: 'AQID' }]);

      fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('token-123');
      });
      expect(await screen.findByText('Copied to clipboard')).toBeDefined();
    });

    it('removes the keyboard when an edit no longer carries one', async () => {
      const calls: FetchCall[] = [];
      installButtonFetch(calls);
      render(<App />);

      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByRole('button', { name: 'Create' })).toBeDefined();

      deliver({
        type: 'edit_message',
        message: { ...buttonMessage, text: 'The keyboard is gone.', markup: null },
      });
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
      });
      expect(within(threadSection()).getByText('The keyboard is gone.')).toBeDefined();
    });
  });

  describe('polls', () => {
    const poll: MessagePollDto = {
      id: '1234567890',
      question: 'Tea or coffee?',
      answers: [
        { text: 'Tea', voters: 1, chosen: false, correct: null },
        { text: 'Coffee', voters: 2, chosen: false, correct: null },
      ],
      totalVoters: 3,
      closed: false,
      quiz: false,
      multiple: false,
      revotingDisabled: false,
      hideResultsUntilClose: false,
      solution: null,
    };

    const pollMessage = (overrides: Partial<MessageDto> = {}): MessageDto =>
      message({ id: 20, chatId: 2, senderName: 'Bob', text: '', poll, ...overrides });

    /**
    Serves the thread with `initial` and answers the poll RPCs from a script, so
    a test can watch the SPA fold each answer in and record what it sent.
    */
    function installPollFetch(initial: MessagePollDto, answers: readonly MessagePollDto[], calls: unknown[]): void {
      let index = 0;
      installSignedInFetch({
        history: () => json({ messages: [pollMessage({ poll: initial })] }),
        rpc: (call) => {
          if (call.body?.method !== 'sendVote' && call.body?.method !== 'getPollResults') return;
          calls.push(call.body);
          const answer = answers[Math.min(index, answers.length - 1)];
          index += 1;
          return json({ poll: answer });
        },
      });
    }

    it('previews the question in the chat list', async () => {
      const pollDialog: DialogDto = {
        chat: carol,
        lastMessage: pollMessage({ id: 30, chatId: 3 }),
        unread: 0,
        readInboxMaxId: 1,
        pinned: false,
        muted: false,
      };
      installSignedInFetch({ dialogs: [pollDialog] });

      render(<App />);
      expect(await screen.findByText('Poll: Tea or coffee?')).toBeDefined();
    });

    it('votes for the tapped answer and folds the fresh results in', async () => {
      const calls: unknown[] = [];
      installPollFetch(
        poll,
        [
          {
            ...poll,
            totalVoters: 4,
            answers: [
              { text: 'Tea', voters: 3, chosen: true, correct: null },
              { text: 'Coffee', voters: 1, chosen: false, correct: null },
            ],
          },
        ],
        calls,
      );

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('Tea or coffee?')).toBeDefined();
      expect(within(threadSection()).getByText('3 votes')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Vote for Coffee (67%)' }));

      await waitFor(() => {
        expect(within(threadSection()).getByText('4 votes')).toBeDefined();
      });
      expect(calls).toEqual([{ method: 'sendVote', params: { chatId: 2, messageId: 20, options: [1] } }]);
      expect(screen.getByRole('button', { name: 'Retract vote' })).toBeDefined();
    });

    it('retracts the vote through the sendVote call', async () => {
      const calls: unknown[] = [];
      const chosen: MessagePollDto = {
        ...poll,
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: false, correct: null },
        ],
      };
      installPollFetch(chosen, [{ ...poll, totalVoters: 2 }], calls);

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await screen.findByRole('button', { name: 'Retract vote' }));

      await waitFor(() => {
        expect(calls).toEqual([{ method: 'sendVote', params: { chatId: 2, messageId: 20, options: null } }]);
      });
    });

    it('accumulates a multiple-choice selection across taps', async () => {
      const multiple: MessagePollDto = { ...poll, multiple: true };
      const calls: unknown[] = [];
      installPollFetch(
        multiple,
        [
          {
            ...multiple,
            totalVoters: 4,
            answers: [
              { text: 'Tea', voters: 2, chosen: true, correct: null },
              { text: 'Coffee', voters: 2, chosen: false, correct: null },
            ],
          },
          {
            ...multiple,
            totalVoters: 5,
            answers: [
              { text: 'Tea', voters: 3, chosen: true, correct: null },
              { text: 'Coffee', voters: 2, chosen: true, correct: null },
            ],
          },
        ],
        calls,
      );

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await screen.findByRole('button', { name: 'Vote for Tea (33%)' }));

      const coffee = await screen.findByRole('button', { name: 'Vote for Coffee (50%)' });
      fireEvent.click(coffee);

      await waitFor(() => {
        expect(calls).toHaveLength(2);
      });
      expect(calls).toEqual([
        { method: 'sendVote', params: { chatId: 2, messageId: 20, options: [0] } },
        { method: 'sendVote', params: { chatId: 2, messageId: 20, options: [0, 1] } },
      ]);
    });

    it('folds a full poll update without asking again', async () => {
      const calls: unknown[] = [];
      installPollFetch(poll, [poll], calls);

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      await screen.findByText('Tea or coffee?');

      deliver({ type: 'poll', chatId: 2, messageId: 20, pollId: poll.id, poll: { ...poll, totalVoters: 7 } });

      await waitFor(() => {
        expect(within(threadSection()).getByText('7 votes')).toBeDefined();
      });
      expect(calls).toEqual([]);
    });

    it('refetches a short poll update for the loaded message', async () => {
      const calls: unknown[] = [];
      installPollFetch(poll, [{ ...poll, totalVoters: 9 }], calls);

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      await screen.findByText('Tea or coffee?');

      // A short update names neither the chat nor the message.
      deliver({ type: 'poll', chatId: null, messageId: null, pollId: poll.id, poll: null });

      await waitFor(() => {
        expect(within(threadSection()).getByText('9 votes')).toBeDefined();
      });
      expect(calls).toEqual([{ method: 'getPollResults', params: { chatId: 2, messageId: 20 } }]);
    });

    it('keeps a vote that may no longer change inert', async () => {
      const quiz: MessagePollDto = {
        ...poll,
        quiz: true,
        revotingDisabled: true,
        answers: [
          { text: 'Tea', voters: 1, chosen: true, correct: false },
          { text: 'Coffee', voters: 2, chosen: false, correct: true },
        ],
      };
      installPollFetch(quiz, [quiz], []);

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      expect(await screen.findByText('Quiz')).toBeDefined();
      expect(within(threadSection()).getByText('✓')).toBeDefined();
      expect(within(threadSection()).getByText('✗')).toBeDefined();
      expect(screen.queryByRole('button', { name: /^Vote for/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Retract vote' })).toBeNull();
    });
  });

  describe('replies', () => {
    /**
    jsdom has no layout, so `scrollIntoView` is a spy the jump tests can watch.
    */
    let scrollIntoView: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      scrollIntoView = stubScrollIntoView();
    });

    const bobReply = (): MessageDto =>
      message({
        id: 11,
        chatId: 2,
        senderName: 'Bob',
        text: 'right back',
        reply: {
          origin: 'same_chat',
          messageId: 10,
          chatId: null,
          senderName: null,
          date: null,
          text: '',
          entities: [],
          mediaKind: null,
          quote: false,
        },
      });

    it('shows the loaded original in a same-chat quote and jumps to it on click', async () => {
      installSignedInFetch({ history: () => json({ messages: [...history, bobReply()] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('right back')).toBeDefined();

      const quote = await within(threadSection()).findByTitle('Go to the replied message');
      expect(quote.textContent).toContain('Bob');
      expect(quote.textContent).toContain('see you');

      expect(document.querySelector('[data-message-id="10"]')?.classList.contains('reply-flash')).toBe(false);
      fireEvent.click(quote);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      expect(document.querySelector('[data-message-id="10"]')?.classList.contains('reply-flash')).toBe(true);
    });

    it('falls back to the reply header for cross-chat and unloaded originals', async () => {
      installSignedInFetch({
        history: () =>
          json({
            messages: [
              message({
                id: 12,
                chatId: 2,
                senderName: 'Bob',
                text: 'from the channel',
                reply: {
                  origin: 'other_chat',
                  messageId: 3,
                  chatId: -1_000_000_000_020,
                  senderName: 'Announcements',
                  date: 1_699_999_000_000,
                  text: '',
                  entities: [],
                  mediaKind: 'photo',
                  quote: false,
                },
              }),
              message({
                id: 13,
                chatId: 2,
                senderName: 'Bob',
                text: 'missing original',
                reply: {
                  origin: 'same_chat',
                  messageId: 5,
                  chatId: null,
                  senderName: null,
                  date: null,
                  text: '',
                  entities: [],
                  mediaKind: null,
                  quote: false,
                },
              }),
            ],
          }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('from the channel')).toBeDefined();

      const quotes = threadSection().querySelectorAll('.reply-quote');
      expect(quotes.length).toBe(2);
      expect(quotes[0].tagName).toBe('DIV');
      expect(quotes[0].textContent).toContain('Announcements');
      expect(quotes[0].textContent).toContain('Photo');
      expect(quotes[1].textContent).toContain('Original message');
    });

    it('prefills the composer from the context menu and sends replyTo', async () => {
      const sent: FetchCall[] = [];
      installSignedInFetch({
        history: () => json({ messages: [...history, bobReply()] }),
        rpc: (call) => {
          if (call.body?.method !== 'sendMessage') return;
          sent.push(call);
          return json({ message: message({ id: 12, chatId: 2, senderName: 'Ada', outgoing: true, text: 'sure' }) });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      openMessageMenu(10);
      clickMenuItem('Reply');
      expect(screen.getByText('Reply to Bob')).toBeDefined();

      // Escape clears the reply target without touching the draft.
      fireEvent.keyDown(screen.getByPlaceholderText('Message'), { key: 'Escape' });
      expect(screen.queryByText('Reply to Bob')).toBeNull();

      openMessageMenu(10);
      clickMenuItem('Reply');
      fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'sure' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(sent.length).toBe(1);
      });
      expect(sent[0].body).toEqual({ method: 'sendMessage', params: { chatId: 2, text: 'sure', replyTo: 10 } });
      await waitFor(() => {
        expect(screen.queryByText('Reply to Bob')).toBeNull();
      });
    });
  });

  describe('telegram links', () => {
    it('opens a known chat from a message link instead of leaving the app', async () => {
      const source = message({
        id: 9,
        chatId: 2,
        senderId: 2,
        senderName: 'Bob',
        text: 'open carol',
        entities: [{ offset: 0, length: 10, kind: 'text_link', url: 'https://t.me/carol' }],
      });
      const calls = installSignedInFetch({
        dialogs: [...dialogs, carolDialog],
        history: (chatId) => json({ messages: chatId === 3 ? carolHistory : [source] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      const link = await within(threadSection()).findByText('open carol');
      // The click is swallowed — the chat opens here instead of in a new tab.
      expect(fireEvent.click(link)).toBe(false);

      expect(await within(threadSection()).findByText('carol says hi')).toBeDefined();
      expect(within(threadSection()).getByText('Carol')).toBeDefined();
      const opened = calls.some((call) => {
        const params = call.body?.params as { chatId?: number } | undefined;
        return call.body?.method === 'getHistory' && params?.chatId === 3;
      });
      expect(opened).toBe(true);
    });

    it('re-opens the chat around the linked post and lands on it', async () => {
      const post = message({ id: 30, chatId: 2, senderId: 2, senderName: 'Bob', text: 'linked post' });
      const source = message({
        id: 9,
        chatId: 2,
        senderId: 2,
        senderName: 'Bob',
        text: 't.me/bob/30',
        entities: [{ offset: 0, length: 11, kind: 'url' }],
      });
      const calls = installSignedInFetch({ history: () => json({ messages: [post, source] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      await within(threadSection()).findByText('linked post');

      const link = within(threadSection()).getByText('t.me/bob/30');
      expect(fireEvent.click(link)).toBe(false);

      await waitFor(() => {
        expect(document.querySelector('[data-message-id="30"]')?.classList.contains('reply-flash')).toBe(true);
      });
      const jump = calls.find((call) => {
        const params = call.body?.params as { offsetId?: number } | undefined;
        return call.body?.method === 'getHistory' && params?.offsetId === 30;
      });
      expect(jump?.body?.params).toMatchObject({ offsetId: 30, addOffset: -25 });
    });

    it('hands an unknown Telegram link to the installed app', async () => {
      const source = message({
        id: 9,
        chatId: 2,
        senderId: 2,
        senderName: 'Bob',
        text: 'open channel',
        entities: [{ offset: 0, length: 12, kind: 'text_link', url: 'https://t.me/unknown_channel' }],
      });
      installSignedInFetch({ history: () => json({ messages: [source] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      const link = await within(threadSection()).findByText('open channel');
      expect(fireEvent.click(link)).toBe(false);

      const frame = document.querySelector('iframe');
      expect(frame?.getAttribute('src')).toBe('tg://resolve?domain=unknown_channel');
      // The app takes the tab over: the fallback timer is cancelled with it.
      globalThis.dispatchEvent(new Event('blur'));
      expect(document.querySelector('iframe')).toBeNull();
    });
  });

  describe('message context menu', () => {
    let clipboard: { writeText: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.useRealTimers();
    });

    it('opens on right-click and copies the message text', async () => {
      installSignedInFetch();

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const menu = openMessageMenu(10);
      // jsdom has no layout, so the menu keeps the gesture's coordinates.
      expect(menu.style.left).toBe('40px');
      expect(menu.style.top).toBe('60px');
      expect(within(menu).getByRole('menuitem', { name: 'Reply' })).toBeDefined();

      clickMenuItem('Copy text');
      expect(clipboard.writeText).toHaveBeenCalledWith('see you');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on Escape and on a press outside', async () => {
      installSignedInFetch();

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      openMessageMenu(10);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();

      openMessageMenu(10);
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('leaves the browser menu on service messages', async () => {
      installSignedInFetch({
        history: () => json({ messages: [history[0], message({ id: 14, chatId: 2, service: true, text: 'Bob joined Telegram' })] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('Bob joined Telegram')).toBeDefined();

      const row = threadSection().querySelector<HTMLElement>('[data-message-id="14"]');
      if (!row) throw new Error('The service message is not rendered');
      // Not cancelled, so the browser's own menu (e.g. copy) still opens.
      expect(fireEvent.contextMenu(row)).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps the double-click reply shortcut', async () => {
      installSignedInFetch();

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const row = threadSection().querySelector<HTMLElement>('[data-message-id="10"]');
      if (!row) throw new Error('Message 10 is not rendered');
      fireEvent.doubleClick(row);
      expect(screen.getByText('Reply to Bob')).toBeDefined();
    });

    it('opens on a long press and cancels when the finger drifts', async () => {
      installSignedInFetch();

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const row = threadSection().querySelector<HTMLElement>('[data-message-id="10"]');
      if (!row) throw new Error('Message 10 is not rendered');

      vi.useFakeTimers();
      // A press that drifts is a scroll gesture; it must not mature.
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 40, clientY: 60 });
      fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 80, clientY: 60 });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('menu')).toBeNull();

      // A steady press matures into the menu.
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 40, clientY: 60 });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('menu', { name: 'Message actions' })).toBeDefined();
    });
  });

  describe('unread position', () => {
    /**
    Bob's dialog with reading stopped at message 8: 9, 11 and 13 are unread
    (10 and 12 are the account's own messages).
    */
    const unreadDialog: DialogDto = { ...dialogs[0], unread: 3, readInboxMaxId: 8 };

    function unreadMessage(id: number, text: string, outgoing = false): MessageDto {
      return message({ id, chatId: 2, senderId: outgoing ? 1 : 2, senderName: outgoing ? 'Ada' : 'Bob', outgoing, text });
    }

    const unreadHistory: MessageDto[] = [
      unreadMessage(8, 'read already'),
      unreadMessage(9, 'unread one'),
      unreadMessage(10, 'my reply', true),
      unreadMessage(11, 'unread two'),
      unreadMessage(12, 'another reply', true),
      unreadMessage(13, 'unread three'),
    ];

    function installUnreadFetch(): FetchCall[] {
      const reads: FetchCall[] = [];
      installSignedInFetch({
        dialogs: [unreadDialog],
        history: () => json({ messages: unreadHistory }),
        rpc: (call) => {
          if (call.body?.method !== 'readHistory') return;
          reads.push(call);
          return json({});
        },
      });
      return reads;
    }

    it('opens at the first unread message, under the divider', async () => {
      installUnreadFetch();
      // A viewport showing only the already-read row: opening must not jump to
      // the bottom just because more (unread) messages follow.
      stubLayout({ listHeight: 300, viewportHeight: 50 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();

      const divider = threadSection().querySelector('[data-unread-divider]');
      expect(divider?.textContent).toBe('Unread Messages');
      // The divider sits right above the first unread message.
      expect((divider?.nextElementSibling as HTMLElement | null)?.dataset.messageId).toBe('9');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    });

    it('reads only the incoming messages the viewport covers, as the user scrolls', async () => {
      const reads = installUnreadFetch();
      stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();

      // Rows 8 and 9 are in view; 10 is outgoing and carries no watermark, so
      // the receipt stops at 9 rather than reading the chat wholesale.
      await waitFor(() => {
        expect(reads.map((read) => read.body?.params)).toEqual([{ chatId: 2, maxId: 9 }]);
      });

      // One more screen brings 10–12 into view; the outgoing rows are skipped
      // and 11 is the read watermark.
      scrollContainer().scrollTop = 100;
      fireEvent.scroll(scrollContainer());
      await waitFor(() => {
        expect(reads.map((read) => read.body?.params)).toEqual([
          { chatId: 2, maxId: 9 },
          { chatId: 2, maxId: 11 },
        ]);
      });

      // Reaching the bottom follows the newest unread message.
      scrollContainer().scrollTop = 200;
      fireEvent.scroll(scrollContainer());
      await waitFor(() => {
        expect(reads.at(-1)?.body?.params).toEqual({ chatId: 2, maxId: 13 });
      });
      expect(reads).toHaveLength(3);
    });

    it('keeps the divider at its opening position while reading advances the receipts', async () => {
      const reads = installUnreadFetch();
      stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();

      const dividerMessageId = (): string | undefined =>
        (threadSection().querySelector('[data-unread-divider]')?.nextElementSibling as HTMLElement | null | undefined)?.dataset.messageId;
      expect(dividerMessageId()).toBe('9');

      // Scrolling past the line advances the read watermark to 11 and then to
      // the bottom; the line itself stays above the message it opened at.
      scrollContainer().scrollTop = 100;
      fireEvent.scroll(scrollContainer());
      await waitFor(() => {
        expect(reads.at(-1)?.body?.params).toEqual({ chatId: 2, maxId: 11 });
      });
      expect(dividerMessageId()).toBe('9');

      scrollContainer().scrollTop = 200;
      fireEvent.scroll(scrollContainer());
      await waitFor(() => {
        expect(reads.at(-1)?.body?.params).toEqual({ chatId: 2, maxId: 13 });
      });
      expect(dividerMessageId()).toBe('9');

      // A message arriving while the thread is open does not move the line
      // either; it stays above the message the chat opened at.
      deliver({ type: 'new_message', message: message({ id: 14, chatId: 2, senderName: 'Bob', text: 'brand new' }) });
      expect(await within(threadSection()).findByText('brand new')).toBeDefined();
      expect(dividerMessageId()).toBe('9');
    });

    it('seeds a fresh divider when the chat is reopened', async () => {
      installUnreadFetch();
      stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();
      expect(threadSection().querySelector('[data-unread-divider]')).not.toBeNull();

      // Read everything, then leave and come back: the stretch was read, so the
      // reopened thread has no line.
      scrollContainer().scrollTop = 200;
      fireEvent.scroll(scrollContainer());
      await waitFor(() => {
        expect(document.querySelector('.badge')).toBeNull();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Back to chat list' }));
      await waitFor(() => expect(document.querySelector('section.thread.empty')).not.toBeNull());
      fireEvent.click(screen.getByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();
      expect(threadSection().querySelector('[data-unread-divider]')).toBeNull();
    });

    it('folds inbox reads into the badge and the divider, and ignores outbox reads', async () => {
      installUnreadFetch();
      // The viewport covers only the already-read row, so the test's own
      // read updates are the only ones moving anything.
      stubLayout({ listHeight: 300, viewportHeight: 50 });

      render(<App />);
      expect(await screen.findByText('Bob')).toBeDefined();
      expect(document.querySelector('.badge')?.textContent).toBe('3');

      fireEvent.click(screen.getByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();
      expect(threadSection().querySelector('[data-unread-divider]')).not.toBeNull();

      // The peer reading the account's own messages says nothing about the
      // account's unread incoming ones.
      deliver({ type: 'read', chatId: 2, maxId: 12, unread: 0, inbox: false });
      expect(document.querySelector('.badge')?.textContent).toBe('3');
      expect(threadSection().querySelector('[data-unread-divider]')).not.toBeNull();

      // The account's own read moves the badge on, but not the line: the
      // divider stays where the chat opened for as long as it is open.
      deliver({ type: 'read', chatId: 2, maxId: 11, unread: 1, inbox: true });
      expect(document.querySelector('.badge')?.textContent).toBe('1');
      expect(
        (threadSection().querySelector('[data-unread-divider]')?.nextElementSibling as HTMLElement | null | undefined)?.dataset.messageId,
      ).toBe('9');

      deliver({ type: 'read', chatId: 2, maxId: 13, unread: 0, inbox: true });
      expect(document.querySelector('.badge')).toBeNull();
      expect(
        (threadSection().querySelector('[data-unread-divider]')?.nextElementSibling as HTMLElement | null | undefined)?.dataset.messageId,
      ).toBe('9');
    });
  });

  describe('media settling', () => {
    const photo: MessageMediaDto = {
      kind: 'photo',
      fileName: null,
      mime: null,
      size: 1000,
      width: 320,
      height: 240,
      duration: null,
    };

    /**
    Bob's dialog, fully read: a plain open lands at the bottom.
    */
    const readDialog: DialogDto = { ...dialogs[0], unread: 0, readInboxMaxId: 10 };

    it('reserves the media box from the DTO dimensions', async () => {
      installSignedInFetch({
        dialogs: [readDialog],
        history: () => json({ messages: [message({ id: 10, chatId: 2, media: photo })] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('message 10')).toBeDefined();

      const img = threadSection().querySelector('img.photo');
      if (!(img instanceof HTMLImageElement)) throw new Error('The photo is not rendered');
      expect(img.getAttribute('width')).toBe('320');
      expect(img.getAttribute('height')).toBe('240');
    });

    it('keeps a fully read thread at the bottom while media grows the list', async () => {
      installSignedInFetch({
        dialogs: [readDialog],
        history: () => json({ messages: [message({ id: 10, chatId: 2, media: photo })] }),
      });
      const box = stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('message 10')).toBeDefined();
      // Opened at the bottom, before the image loaded.
      expect(scrollContainer().scrollTop).toBe(300);

      // The image settling grows the list; the pinned view follows it.
      const img = threadSection().querySelector('img.photo');
      if (!(img instanceof HTMLImageElement)) throw new Error('The photo is not rendered');
      box.listHeight = 600;
      fireEvent.load(img);
      expect(scrollContainer().scrollTop).toBe(600);

      // A reader who scrolled away is not dragged back by a later load.
      scrollContainer().scrollTop = 100;
      fireEvent.scroll(scrollContainer());
      box.listHeight = 900;
      fireEvent.load(img);
      expect(scrollContainer().scrollTop).toBe(100);
    });

    it('leaves a view opened at the unread divider alone when media settles', async () => {
      installSignedInFetch({
        dialogs: [{ ...dialogs[0], unread: 1, readInboxMaxId: 8 }],
        history: () =>
          json({
            messages: [message({ id: 8, chatId: 2, text: 'read already' }), message({ id: 9, chatId: 2, media: photo })],
          }),
      });
      const box = stubLayout({ listHeight: 300, viewportHeight: 50 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('Unread Messages')).toBeDefined();
      // The divider jump owns the position; the stubbed scrollIntoView left
      // the list at the top.
      expect(scrollContainer().scrollTop).toBe(0);

      const img = threadSection().querySelector('img.photo');
      if (!(img instanceof HTMLImageElement)) throw new Error('The photo is not rendered');
      box.listHeight = 600;
      fireEvent.load(img);
      expect(scrollContainer().scrollTop).toBe(0);
    });
  });

  describe('albums', () => {
    const photo: MessageMediaDto = {
      kind: 'photo',
      fileName: null,
      mime: null,
      size: 1000,
      width: 320,
      height: 240,
      duration: null,
    };

    const album = (): MessageDto[] => [
      message({ id: 20, chatId: 2, groupedId: '555', text: 'trip', media: photo }),
      message({ id: 21, chatId: 2, groupedId: '555', text: '', media: photo }),
      message({ id: 22, chatId: 2, groupedId: '555', text: '', media: { ...photo, kind: 'video' } }),
    ];

    it('renders grouped media as one bubble with one caption and timestamp', async () => {
      installSignedInFetch({ history: () => json({ messages: album() }) });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('trip')).toBeDefined();

      const bubble = threadSection().querySelector(':scope [data-message-ids="20 21 22"]');
      expect(bubble).not.toBeNull();
      expect(bubble?.querySelectorAll(':scope .album .cell')).toHaveLength(3);
      expect(threadSection().querySelectorAll(':scope .message .meta')).toHaveLength(1);
    });

    it("reacts on the album's first message", async () => {
      const calls: FetchCall[] = [];
      installSignedInFetch({
        history: () =>
          json({
            messages: [
              message({
                id: 20,
                chatId: 2,
                groupedId: '555',
                media: photo,
                reactions: [{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }],
              }),
              message({ id: 21, chatId: 2, groupedId: '555', media: photo }),
            ],
          }),
        rpc: (call) => {
          if (call.body?.method !== 'sendReaction') return;
          calls.push(call);
          return json({ message: null });
        },
      });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await within(threadSection()).findByRole('button', { name: /React 👍/ }));
      await waitFor(() => {
        expect(calls.map((call) => call.body?.params)).toEqual([{ chatId: 2, messageId: 20, emoji: '👍', customEmojiId: null }]);
      });
    });

    it('groups album items that arrive live', async () => {
      installSignedInFetch();
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('see you')).toBeDefined();

      deliver({ type: 'new_message', message: message({ id: 30, chatId: 2, groupedId: 'g', text: '', media: photo }) });
      deliver({ type: 'new_message', message: message({ id: 31, chatId: 2, groupedId: 'g', text: '', media: photo }) });

      const bubble = threadSection().querySelector(':scope [data-message-ids="30 31"]');
      expect(bubble?.querySelectorAll(':scope .album .cell')).toHaveLength(2);
    });

    it('jumps to the album bubble when replying to a member', async () => {
      const scrollIntoView = stubScrollIntoView();
      installSignedInFetch({
        history: () =>
          json({
            messages: [
              ...album(),
              message({
                id: 23,
                chatId: 2,
                text: 'which one?',
                reply: {
                  origin: 'same_chat',
                  messageId: 21,
                  chatId: null,
                  senderName: null,
                  date: null,
                  text: '',
                  entities: [],
                  mediaKind: null,
                  quote: false,
                },
              }),
            ],
          }),
      });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      fireEvent.click(await within(threadSection()).findByTitle('Go to the replied message'));
      const bubble = threadSection().querySelector(':scope [data-message-ids="20 21 22"]');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      expect(bubble?.classList.contains('reply-flash')).toBe(true);
    });
  });

  describe('media viewer', () => {
    const photo: MessageMediaDto = {
      kind: 'photo',
      fileName: null,
      mime: null,
      size: 1000,
      width: 320,
      height: 240,
      duration: null,
    };

    const video: MessageMediaDto = {
      kind: 'video',
      fileName: 'clip.mp4',
      mime: 'video/x-matroska',
      size: 2048,
      width: 640,
      height: 360,
      duration: 12,
    };

    const album = (): MessageDto[] => [
      message({ id: 20, chatId: 2, groupedId: '555', text: 'trip', media: photo }),
      message({ id: 21, chatId: 2, groupedId: '555', text: '', media: photo }),
      message({ id: 22, chatId: 2, groupedId: '555', text: '', media: video }),
    ];

    it('opens a photo full-page and closes it with Escape', async () => {
      installSignedInFetch({
        history: () => json({ messages: [message({ id: 10, chatId: 2, text: '', media: photo })] }),
      });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      fireEvent.click(await within(threadSection()).findByRole('button', { name: 'Open photo' }));
      const dialog = await screen.findByRole('dialog', { name: 'Media viewer' });
      const image = dialog.querySelector<HTMLImageElement>('img.media-viewer-media');
      if (!image) throw new Error('The viewer has no image');

      // The viewer asks for the original, not the album thumbnail.
      expect(image.getAttribute('src')).toContain('/user/file?chatId=2&messageId=10');
      expect(image.getAttribute('src')).not.toContain('thumb=1');

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('opens an album at the clicked item and navigates it', async () => {
      installSignedInFetch({ history: () => json({ messages: album() }) });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('trip')).toBeDefined();

      const cells = threadSection().querySelectorAll(':scope .album .cell');
      fireEvent.click(cells[1]!);

      const dialog = await screen.findByRole('dialog', { name: 'Media viewer' });
      expect(within(dialog).getByText('2 / 3')).toBeDefined();
      expect(dialog.querySelector('img.media-viewer-media')?.getAttribute('src')).toContain('messageId=21');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Next media' }));
      expect(within(dialog).getByText('3 / 3')).toBeDefined();
      expect(dialog.querySelector('video.media-viewer-media')?.getAttribute('src')).toContain('messageId=22');
      expect((within(dialog).getByRole('button', { name: 'Next media' }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.keyDown(document, { key: 'ArrowLeft' });
      expect(within(dialog).getByText('2 / 3')).toBeDefined();
      expect(dialog.querySelector('img.media-viewer-media')?.getAttribute('src')).toContain('messageId=21');
    });

    it('uses a poster tile for a video and keeps the download fallback when playback fails', async () => {
      installSignedInFetch({
        history: () => json({ messages: [message({ id: 30, chatId: 2, text: '', media: video })] }),
      });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));

      // The bubble loads only the thumbnail; the original is the viewer's.
      expect(threadSection().querySelector('video')).toBeNull();
      fireEvent.click(await within(threadSection()).findByRole('button', { name: 'Play clip.mp4' }));

      const dialog = await screen.findByRole('dialog', { name: 'Media viewer' });
      const player = dialog.querySelector<HTMLVideoElement>('video.media-viewer-media');
      if (!player) throw new Error('The viewer has no video');
      expect(player.getAttribute('src')).toContain('/user/file?chatId=2&messageId=30');
      expect(player.getAttribute('poster')).toContain('thumb=1');

      fireEvent.error(player);
      const link = await within(dialog).findByRole('link', { name: /clip\.mp4/ });
      expect(link.getAttribute('href')).toContain('/user/file?chatId=2&messageId=30');
    });
  });

  describe('channel comments', () => {
    const GROUP = -1_000_000_000_030;
    /**
    Id of the thread's root message in the discussion group.
    */
    const ROOT = 10;

    const channel: ChatDto = {
      id: -1_000_000_000_020,
      kind: 'channel',
      title: 'Announcements',
      username: 'announce',
      photo: null,
      canSendMessages: false,
    };

    const post = message({
      id: 7,
      chatId: channel.id,
      text: 'A new feature shipped',
      views: 1234,
      comments: { hasComments: true, count: 2, discussionChatId: GROUP },
    });

    const channelDialog: DialogDto = { chat: channel, lastMessage: post, unread: 0, readInboxMaxId: 7, pinned: false, muted: false };

    function comment(overrides: Partial<MessageDto> & { id: number }): MessageDto {
      return message({ chatId: GROUP, senderName: 'Dana', ...overrides });
    }

    /**
    A same-chat reply header into the thread, as the discussion group carries
    it (top-level comments point at the root).
    */
    function replyHeader(messageId: number): MessageDto['reply'] {
      return {
        origin: 'same_chat',
        messageId,
        chatId: null,
        senderName: null,
        date: null,
        text: '',
        entities: [],
        mediaKind: null,
        quote: false,
      };
    }

    const commentList: MessageDto[] = [
      comment({ id: ROOT + 1, text: 'nice', reply: replyHeader(ROOT) }),
      comment({ id: ROOT + 2, text: 'congrats', reply: replyHeader(ROOT + 1) }),
    ];

    const poll: MessagePollDto = {
      id: 'comment-poll',
      question: 'Ship it?',
      answers: [
        { text: 'Yes', voters: 1, chosen: false, correct: null },
        { text: 'No', voters: 1, chosen: false, correct: null },
      ],
      totalVoters: 2,
      closed: false,
      quiz: false,
      multiple: false,
      revotingDisabled: false,
      hideResultsUntilClose: false,
      solution: null,
    };

    const answeredPoll: MessagePollDto = {
      ...poll,
      totalVoters: 3,
      answers: [
        { text: 'Yes', voters: 2, chosen: true, correct: null },
        { text: 'No', voters: 1, chosen: false, correct: null },
      ],
    };

    function openComments(): void {
      const button = screen.getByRole('button', { name: /2 comments/ });
      fireEvent.click(button);
    }

    /**
    Routes the channel's history and the test-specific comments RPCs, keeping
    the signed-in base surface (state, dialogs, reads) intact.
    */
    function installCommentsFetch(
      rpc: (call: FetchCall) => Response | undefined,
      history: () => Response = () => json({ messages: [post] }),
    ): FetchCall[] {
      return installSignedInFetch({
        dialogs: [channelDialog],
        history,
        rpc,
      });
    }

    it('opens a dedicated comments screen with the post and its thread', async () => {
      const calls: FetchCall[] = [];
      installCommentsFetch((call) => {
        if (call.body?.method !== 'getComments') return;
        calls.push(call);
        return json({
          comments: commentList,
          count: 2,
          discussionChatId: GROUP,
          discussionMessageId: ROOT,
        });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();

      openComments();

      expect(await screen.findByText('Comments')).toBeDefined();
      expect(within(threadSection()).getAllByText('nice').length).toBeGreaterThan(0);
      expect(within(threadSection()).getByText('congrats')).toBeDefined();
      expect(screen.getByPlaceholderText('Comment')).toBeDefined();
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ method: 'getComments', params: { chatId: channel.id, messageId: 7, limit: 50 } });
    });

    it('votes in a poll comment and folds live results in', async () => {
      const calls: unknown[] = [];
      const pollComment = comment({ id: ROOT + 1, poll, reply: replyHeader(ROOT) });
      installCommentsFetch((call) => {
        if (call.body?.method === 'getComments') {
          return json({ comments: [pollComment], count: 1, discussionChatId: GROUP, discussionMessageId: ROOT });
        }
        if (call.body?.method !== 'sendVote') {
          return;
        }

        calls.push(call.body);
        return json({ poll: answeredPoll });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();

      fireEvent.click(await screen.findByRole('button', { name: 'Vote for Yes (50%)' }));

      await waitFor(() => {
        expect(within(threadSection()).getByText('3 votes')).toBeDefined();
      });
      expect(calls).toEqual([{ method: 'sendVote', params: { chatId: GROUP, messageId: ROOT + 1, options: [0] } }]);

      deliver({ type: 'poll', chatId: GROUP, messageId: ROOT + 1, pollId: poll.id, poll: { ...poll, totalVoters: 6 } });

      await waitFor(() => {
        expect(within(threadSection()).getByText('6 votes')).toBeDefined();
      });
    });

    it('votes in a poll on the pinned post', async () => {
      const calls: unknown[] = [];
      const pollPost = { ...post, text: '', poll };
      installCommentsFetch(
        (call) => {
          if (call.body?.method === 'getComments') {
            return json({ comments: [], count: 0, discussionChatId: null, discussionMessageId: null });
          }
          if (call.body?.method !== 'sendVote') {
            return;
          }

          calls.push(call.body);
          return json({ poll: answeredPoll });
        },
        () => json({ messages: [pollPost] }),
      );

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('Ship it?')).toBeDefined();
      openComments();

      fireEvent.click(await screen.findByRole('button', { name: 'Vote for Yes (50%)' }));

      await waitFor(() => {
        expect(within(threadSection()).getByText('3 votes')).toBeDefined();
      });
      expect(calls).toEqual([{ method: 'sendVote', params: { chatId: channel.id, messageId: 7, options: [0] } }]);
    });

    it('keeps the pinned comments screen at the bottom while comment media settles', async () => {
      installCommentsFetch((call) => {
        if (call.body?.method !== 'getComments') return;
        return json({
          comments: [
            comment({
              id: ROOT + 1,
              text: 'with a photo',
              media: { kind: 'photo', fileName: null, mime: null, size: 1000, width: 320, height: 240, duration: null },
            }),
          ],
          count: 1,
          discussionChatId: GROUP,
          discussionMessageId: ROOT,
        });
      });
      const box = stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect(await within(threadSection()).findByText('with a photo')).toBeDefined();

      // Opened at the bottom, before the image loaded.
      expect(scrollContainer().scrollTop).toBe(300);
      const img = threadSection().querySelector('img.photo');
      if (!(img instanceof HTMLImageElement)) throw new Error('The comment photo is not rendered');
      box.listHeight = 600;
      fireEvent.load(img);
      expect(scrollContainer().scrollTop).toBe(600);
    });

    it('leaves the comments button off non-channel chats', async () => {
      installSignedInFetch({ history: () => json({ messages: [history[0]] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();
      expect(within(threadSection()).queryByRole('button', { name: /comments/ })).toBeNull();
      // Views belong to channel posts; a user chat never shows the counter.
      expect(threadSection().querySelector('.views')).toBeNull();
    });

    it('shows the post views left of the time, with the comments button below', async () => {
      installCommentsFetch(() => json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT }));

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();

      const bubble = threadSection().querySelector<HTMLElement>('[data-message-ids="7"]');
      expect(bubble).not.toBeNull();
      const meta = bubble?.querySelector<HTMLElement>(':scope > .meta');
      expect(meta?.textContent).toContain('👁 1.2K');
      // The count leads the meta line — the time follows it.
      expect(meta?.firstElementChild?.className).toBe('views');
      // The comments button is the bubble's footer, below the meta line.
      const children = Array.from(bubble?.children ?? []);
      const button = within(bubble as HTMLElement).getByRole('button', { name: /2 comments/ });
      expect(children.indexOf(meta as Element)).toBeLessThan(children.indexOf(button));
    });

    it('bumps the view count from a live view update', async () => {
      installCommentsFetch(() => json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT }));

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();

      deliver({ type: 'views', chatId: channel.id, messageId: 7, views: 3456 });
      expect(await within(threadSection()).findByText('👁 3.5K')).toBeDefined();
    });

    it('sends a comment and replies to a comment through sendComment', async () => {
      const sent: FetchCall[] = [];
      installCommentsFetch((call) => {
        if (call.body?.method === 'getComments') {
          return json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT });
        }
        if (call.body?.method !== 'sendComment') return;
        sent.push(call);
        const params = call.body.params as { text: string; replyTo?: number };
        return json({ message: comment({ id: 20, text: params.text, outgoing: true, senderName: 'Ada' }) });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect((await within(threadSection()).findAllByText('nice')).length).toBeGreaterThan(0);

      // A top-level comment posts without a reply target.
      fireEvent.change(screen.getByPlaceholderText('Comment'), { target: { value: 'shipping it' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => {
        expect(sent).toHaveLength(1);
      });
      expect(sent[0].body).toEqual({
        method: 'sendComment',
        params: { chatId: channel.id, messageId: 7, text: 'shipping it' },
      });
      expect(await within(threadSection()).findByText('shipping it')).toBeDefined();

      // Replying to a comment carries its id.
      openMessageMenu(ROOT + 1);
      clickMenuItem('Reply');
      expect(screen.getByText('Reply to Dana')).toBeDefined();
      fireEvent.keyDown(screen.getByPlaceholderText('Comment'), { key: 'Escape' });
      expect(screen.queryByText('Reply to Dana')).toBeNull();

      openMessageMenu(ROOT + 1);
      clickMenuItem('Reply');
      fireEvent.change(screen.getByPlaceholderText('Comment'), { target: { value: 'thanks' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => {
        expect(sent).toHaveLength(2);
      });
      expect(sent[1].body).toEqual({
        method: 'sendComment',
        params: { chatId: channel.id, messageId: 7, text: 'thanks', replyTo: ROOT + 1 },
      });
      await waitFor(() => {
        expect(screen.queryByText('Reply to Dana')).toBeNull();
      });
    });

    it('loads older comments with the cursor getComments returned', async () => {
      const calls: FetchCall[] = [];
      installCommentsFetch((call) => {
        if (call.body?.method !== 'getComments') return;
        calls.push(call);
        return calls.length === 1
          ? json({
              comments: commentList,
              count: 3,
              discussionChatId: GROUP,
              discussionMessageId: ROOT,
              nextOffsetId: ROOT + 1,
              nextOffsetDate: 1_700_000_000,
            })
          : json({
              comments: [comment({ id: ROOT - 1, text: 'first ever', reply: replyHeader(ROOT) })],
              count: 3,
              discussionChatId: GROUP,
              discussionMessageId: ROOT,
            });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect((await within(threadSection()).findAllByText('nice')).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: 'Load older comments' }));
      expect(await within(threadSection()).findByText('first ever')).toBeDefined();
      expect(calls).toHaveLength(2);
      expect(calls[1].body).toEqual({
        method: 'getComments',
        params: { chatId: channel.id, messageId: 7, limit: 50, offsetId: ROOT + 1, offsetDate: 1_700_000_000 },
      });
      // The thread start is loaded, so the button goes away.
      expect(screen.queryByRole('button', { name: 'Load older comments' })).toBeNull();
    });

    it('merges live comments from the discussion group only', async () => {
      installCommentsFetch((call) => {
        if (call.body?.method === 'getComments') {
          return json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT });
        }
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect((await within(threadSection()).findAllByText('nice')).length).toBeGreaterThan(0);

      deliver({ type: 'new_message', message: comment({ id: 30, text: 'live reply', reply: replyHeader(ROOT + 2) }) });
      expect(await within(threadSection()).findByText('live reply')).toBeDefined();

      // A message in the group that belongs to a different thread stays out.
      deliver({ type: 'new_message', message: comment({ id: 31, text: 'other thread', reply: replyHeader(999) }) });
      expect(within(threadSection()).queryByText('other thread')).toBeNull();
    });

    it('posts the first comment through the channel and re-reads the new thread', async () => {
      const sent: FetchCall[] = [];
      let reads = 0;
      installCommentsFetch((call) => {
        if (call.body?.method === 'getComments') {
          reads += 1;
          return reads === 1
            ? json({ comments: [], count: 0, discussionChatId: null, discussionMessageId: null })
            : json({
                comments: [comment({ id: 40, text: 'first!', outgoing: true, senderName: 'Ada' })],
                count: 1,
                discussionChatId: GROUP,
                discussionMessageId: ROOT,
              });
        }
        if (call.body?.method !== 'sendComment') {
          return;
        }

        sent.push(call);
        // The first comment is mirrored into the group by Telegram; the
        // bridge may answer with the channel-side copy.
        return json({ message: comment({ id: 40, chatId: channel.id, text: 'first!', outgoing: true, senderName: 'Ada' }) });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect(await within(threadSection()).findByText('No comments yet — be the first.')).toBeDefined();

      fireEvent.change(screen.getByPlaceholderText('Comment'), { target: { value: 'first!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await waitFor(() => {
        expect(sent).toHaveLength(1);
      });
      expect(sent[0].body).toEqual({
        method: 'sendComment',
        params: { chatId: channel.id, messageId: 7, text: 'first!' },
      });
      await waitFor(() => {
        expect(reads).toBe(2);
      });
      expect(await within(threadSection()).findByText('first!')).toBeDefined();
    });
  });

  describe('channel send permission', () => {
    const READ_ONLY_CHANNEL = -1_000_000_000_020;

    const post = message({ id: 7, chatId: READ_ONLY_CHANNEL, text: 'A new feature shipped' });

    function channelDialog(canSendMessages: boolean): DialogDto {
      const chat: ChatDto = {
        id: READ_ONLY_CHANNEL,
        kind: 'channel',
        title: 'Announcements',
        username: 'announce',
        photo: null,
        canSendMessages,
      };
      return { chat, lastMessage: post, unread: 0, readInboxMaxId: 7, pinned: false, muted: false };
    }

    it('replaces the composer with a notice in a read-only channel', async () => {
      installSignedInFetch({ dialogs: [channelDialog(false)], history: () => json({ messages: [post] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();

      expect(within(threadSection()).getByText('Only admins can post in this channel.')).toBeDefined();
      expect(screen.queryByPlaceholderText('Message')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Attach a file' })).toBeNull();
    });

    it('keeps the composer for a channel the account can post in', async () => {
      installSignedInFetch({ dialogs: [channelDialog(true)], history: () => json({ messages: [post] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();

      expect(screen.getByPlaceholderText('Message')).toBeDefined();
      expect(screen.queryByText('Only admins can post in this channel.')).toBeNull();
    });

    it('explains a revoked send permission in a group', async () => {
      const group: ChatDto = { id: -30, kind: 'supergroup', title: 'Team', username: null, photo: null, canSendMessages: false };
      installSignedInFetch({
        dialogs: [{ chat: group, lastMessage: null, unread: 0, readInboxMaxId: 0, pinned: false, muted: false }],
        history: () => json({ messages: [message({ id: 1, chatId: -30, text: 'hello team' })] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Team'));
      expect(await screen.findByText('hello team')).toBeDefined();

      expect(within(threadSection()).getByText('The admins of this chat have restricted your ability to send messages.')).toBeDefined();
    });
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
