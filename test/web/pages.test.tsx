import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@pigeongram/web';
import type {
  ChatDto,
  DialogDto,
  DialogMessageDto,
  MessageDto,
  MessageMarkupDto,
  MessageMediaDto,
  MessagePollDto,
  MessageReplyDto,
  UpdateEvent,
} from '../../apps/web/src/types';

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
may answer with a promise the test resolves later. The callback also receives
the recorded calls, so it can add to them — a batched read records the calls it
carries beside the request that carried them.
*/
function installFetch(cb: (call: FetchCall, calls: FetchCall[]) => Response | Promise<Response> | undefined): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call: FetchCall = { method: init?.method ?? 'GET', path: url.pathname, body };
      calls.push(call);
      const response = await cb(call, calls);
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

/**
A ResizeObserver jsdom does not provide. Tests decide when a resize happens by
firing every observer watching a target.
*/
class FakeResizeObserver implements ResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  fire(): void {
    this.callback([], this);
  }
}

/**
Tells every observer watching `target` that its box changed size.
*/
function fireResize(target: Element): void {
  for (const observer of FakeResizeObserver.instances) {
    if (observer.targets.has(target)) observer.fire();
  }
}

/**
 * A stand-in for the browser's upload request: the bridge answers on the next
 * tick with a message, so a test can watch the pending bubble meanwhile.
 */
class FakeXhr {
  static readonly instances: FakeXhr[] = [];

  status = 200;
  response: unknown = null;
  responseType = '';
  url = '';
  readonly upload = { addEventListener: (): void => {} };
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(_method: string, url: string): void {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(): void {
    setTimeout(() => {
      this.response = { message: message({ id: 15, chatId: 2, outgoing: true, text: 'the note' }) };
      for (const listener of this.listeners.get('load') ?? []) listener({});
    }, 0);
  }
}

/**
The chat list's view of a message: the list renders a preview, not a thread.
*/
function dialogMessage(source: MessageDto): DialogMessageDto {
  return {
    id: source.id,
    date: source.date,
    text: source.text,
    media: source.media,
    poll: source.poll,
    outgoing: source.outgoing,
    service: source.service,
    groupedId: source.groupedId,
  };
}

const me = { id: 1, firstName: 'Ada', lastName: 'Lovelace', username: 'ada', phone: null, photo: null };
const dialogs: DialogDto[] = [
  {
    chat: { id: 2, kind: 'user', title: 'Bob', username: 'bob', photo: null, canSendMessages: true, presence: null },
    lastMessage: {
      id: 10,
      date: 1_700_000_000_000,
      text: 'see you',
      media: null,
      poll: null,
      outgoing: false,
      service: false,
      groupedId: null,
    },
    unread: 1,
    readInboxMaxId: 9,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
  },
];

const history: MessageDto[] = [
  {
    id: 9,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
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
    senderPhoto: null,
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

const carol: ChatDto = { id: 3, kind: 'user', title: 'Carol', username: 'carol', photo: null, canSendMessages: true, presence: null };

const carolDialog: DialogDto = {
  chat: carol,
  lastMessage: null,
  unread: 0,
  readInboxMaxId: 1,
  readOutboxMaxId: 0,
  pinned: false,
  muted: false,
  archived: false,
};

const carolHistory: MessageDto[] = [
  {
    id: 1,
    chatId: 3,
    groupedId: null,
    senderId: 3,
    senderName: 'Carol',
    senderPhoto: null,
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
    senderPhoto: null,
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
Answers a batched read: every call inside it is answered on its own and the
outcomes come back in order, the way the engine does. Each sub-call is
recorded as if it had been sent on its own, so a test can still watch what the
SPA asked for.
*/
async function answerBatch(
  call: FetchCall,
  answer: (call: FetchCall) => Response | Promise<Response> | undefined,
  record: (call: FetchCall) => void,
): Promise<Response> {
  const subCalls = ((call.body?.params as { calls?: unknown } | undefined)?.calls ?? []) as Array<{
    method: string;
    params?: Record<string, unknown>;
  }>;
  const results: Array<{ ok: boolean; result?: unknown; error?: string }> = [];
  for (const sub of subCalls) {
    const subCall: FetchCall = { method: 'POST', path: call.path, body: { method: sub.method, params: sub.params ?? {} } };
    record(subCall);
    const response = await answer(subCall);
    if (!response) {
      results.push({ ok: false, error: `Unhandled request: ${sub.method}` });
      continue;
    }
    const payload = (await response.json()) as unknown;
    results.push(
      response.ok ? { ok: true, result: payload } : { ok: false, error: (payload as { error?: string } | null)?.error ?? 'failed' },
    );
  }
  return json({ results });
}

/**
A fetch callback for the signed-in bridge: it answers the engine's surface and
expands a batch into the calls it carries, the way the engine does.
*/
function bridgeFetch(
  answer: (call: FetchCall) => Response | undefined,
  state: () => Response = () => json({ phase: 'authorized', authorized: true, me }),
): (call: FetchCall) => Response | Promise<Response> | undefined {
  return (call) => {
    if (call.path === '/user/state') return state();
    if (call.path !== '/user/rpc') return;
    if (call.body?.method === 'batch') return answerBatch(call, answer, () => {});
    return answer(call);
  };
}

/**
Routes the signed-in bridge surface — state, me, dialogs, per-chat history and
reads — with an `rpc` escape hatch for test-specific methods.
*/
function installSignedInFetch(
  options: {
    dialogs?: DialogDto[];
    archivedDialogs?: DialogDto[];
    history?: (chatId: number, params: Record<string, unknown>) => Response | Promise<Response>;
    rpc?: (call: FetchCall) => Response | Promise<Response> | undefined;
  } = {},
): FetchCall[] {
  const answer = (call: FetchCall): Response | Promise<Response> | undefined => {
    const params = (call.body?.params ?? {}) as Record<string, unknown>;
    switch (call.body?.method) {
      case 'getMe': {
        return json({ me });
      }
      case 'getDialogs': {
        // The archive is its own read: the same method with the flag set.
        if (params.archived === true) {
          return json({ dialogs: options.archivedDialogs ?? [] });
        }
        return json({ dialogs: options.dialogs ?? dialogs });
      }
      case 'getHistory': {
        return options.history ? options.history(Number(params.chatId), params) : json({ messages: history });
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
  };
  const calls = installFetch((call, all) => {
    if (call.path === '/user/state') {
      return json({ phase: 'authorized', authorized: true, me });
    }
    if (call.path !== '/user/rpc') {
      return;
    }
    if (call.body?.method === 'batch') {
      return answerBatch(call, answer, (sub) => all.push(sub));
    }
    return answer(call);
  });
  return calls;
}

/**
The first recorded call of one bridge method, for assertions about the request
rather than its answer.
*/
function bridgeCall(calls: FetchCall[], method: string): FetchCall | undefined {
  return calls.find((call) => call.body?.method === method);
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
The chat list in the sidebar, so an assertion about a row cannot match a title
in the open thread.
*/
function sidebar(): HTMLElement {
  const element = document.querySelector<HTMLElement>('aside.sidebar');
  if (!element) throw new Error('The sidebar is not rendered');
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

beforeEach(async () => {
  FakeWebSocket.instances.length = 0;
  FakeResizeObserver.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  stubScrollIntoView();
  globalThis.history.replaceState(null, '', '/');
  // A test that closed the media viewer left a history traversal pending:
  // `history.back()` lands a task later, and it moves the URL back to the chat
  // the test had opened. The next app would boot straight into that chat, so
  // the traversal is drained here — before the URL is reset for good.
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  read. The returned box stays mutable, so a test can grow the list or shrink
  the viewport (the on-screen keyboard) after the open.
  */
  function stubLayout({ listHeight, viewportHeight }: { listHeight: number; viewportHeight: number }): {
    listHeight: number;
    viewportHeight: number;
  } {
    let scroll = 0;
    const box = { listHeight, viewportHeight };
    layout = [];
    for (const key of ['scrollHeight', 'clientHeight', 'scrollTop', 'getBoundingClientRect'] as const) {
      layout.push([key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
    }
    Object.defineProperties(Element.prototype, {
      scrollHeight: { configurable: true, get: () => box.listHeight },
      clientHeight: { configurable: true, get: () => box.viewportHeight },
      scrollTop: {
        configurable: true,
        get: () => scroll,
        set: (value: number) => {
          scroll = value;
        },
      },
    });
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      if (this.classList.contains('messages')) return rect(0, box.viewportHeight);
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

  it('shows the public intro when Cloudflare Access rejects the request', async () => {
    const calls = installFetch(() => json({ error: 'Cloudflare Access token required', code: 'access' }, 401));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Your Telegram, on Cloudflare Workers' })).toBeDefined();
    const signIn = screen.getByRole('link', { name: 'Sign in with Cloudflare Access' });
    expect(signIn.getAttribute('href')).toBe('/user/login');
    expect(calls.some((call) => call.path === '/user/login/qr')).toBe(false);
  });

  it('carries a deep link through the Access login', async () => {
    globalThis.history.replaceState(null, '', '/chat/2');
    installFetch(() => json({ error: 'Cloudflare Access token required', code: 'access' }, 401));

    render(<App />);

    const signIn = await screen.findByRole('link', { name: 'Sign in with Cloudflare Access' });
    expect(signIn.getAttribute('href')).toBe('/user/login?next=%2Fchat%2F2');
  });

  it('treats an unreadable Access redirect as anonymous', async () => {
    installFetch((call) => {
      // An Access login redirect is cross-origin, so fetch rejects instead of
      // returning the 302 for the page to read. The public health plane is not
      // behind Access, so it still answers — which is how the app tells the
      // redirect apart from a network that is not there.
      if (call.path === '/api/health') return json({ status: 'ok' });
      throw new TypeError('Failed to fetch');
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your Telegram, on Cloudflare Workers' })).toBeDefined();
  });

  it('shows the offline screen when the network is gone', async () => {
    installFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'You are offline' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Sign in with Cloudflare Access' })).toBeNull();
  });

  it('treats an Access login page as anonymous', async () => {
    // A same-origin redirect can land on the login page with a 200 HTML body;
    // the state probe must not mistake it for an engine snapshot.
    installFetch(() => new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your Telegram, on Cloudflare Workers' })).toBeDefined();
  });

  it('keeps the access probe text-free behind the launch animation', () => {
    // A probe that never answers leaves the launch screen mounted, which is
    // the state a slow Access round-trip shows.
    installFetch(() => new Promise<Response>(() => {}));

    render(<App />);

    expect(screen.getByRole('status').textContent).toBe('Checking access…');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Connecting to the session engine…')).toBeNull();
  });

  it('surfaces a bridge failure on the access probe with a retry', async () => {
    installFetch(() => json({ error: 'Session engine unreachable' }, 503));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Connection failed' })).toBeDefined();
    expect(screen.getByText('Session engine unreachable')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the QR login when Access is verified but Telegram is not linked', async () => {
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
      if (call.path !== '/user/rpc') {
        return;
      }
      const answer = (sub: FetchCall): Response => {
        switch (sub.body?.method) {
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
      };
      if (call.body?.method === 'batch') {
        return answerBatch(call, answer, () => {});
      }
      return answer(call);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Use a phone number instead' }));
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText(/login code to your Telegram app/)).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Login code'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }));

    // The sign-in has to finish before the shell reads anything, so the
    // boot's own round trips are part of this wait.
    expect(await screen.findByText('Bob', {}, { timeout: 5000 })).toBeDefined();
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
        presence: null,
      };
      const post = message({
        id: 7,
        chatId: channel.id,
        text: 'A new feature shipped',
        comments: { hasComments: true, count: 2, discussionChatId: -1_000_000_000_030 },
      });
      installSignedInFetch({
        dialogs: [
          {
            chat: channel,
            lastMessage: dialogMessage(post),
            unread: 0,
            readInboxMaxId: 7,
            readOutboxMaxId: 0,
            pinned: false,
            muted: false,
            archived: false,
          },
        ],
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
    installFetch(
      bridgeFetch((call) => {
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
      }),
    );

    render(<App />);

    expect(await screen.findByText('Bob')).toBeDefined();
    fireEvent.click(screen.getByText('Bob'));
    expect(await screen.findByText('oldest')).toBeDefined();
    expect(screen.getAllByText('see you').length).toBeGreaterThan(0);
  });

  it('reads the account and the chat list in one batched request', async () => {
    const calls = installSignedInFetch();

    render(<App />);
    expect(await screen.findByText('Bob')).toBeDefined();

    const batches = calls.filter((call) => call.body?.method === 'batch');
    expect(batches).toHaveLength(1);
    const carried = (batches[0].body?.params as { calls?: Array<{ method: string }> }).calls ?? [];
    expect(carried.map((call) => call.method)).toEqual(['getMe', 'getDialogs']);
  });

  it('does not read the chat list twice when the updates socket opens', async () => {
    const calls = installSignedInFetch();

    render(<App />);
    expect(await screen.findByText('Bob')).toBeDefined();

    // The socket's first `ready` follows the boot's own read, so the list is
    // not fetched a second time.
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('No updates socket is open');
    act(() => {
      socket.emit('message', { data: JSON.stringify({ type: 'ready' }) });
    });

    const lists = calls.filter((call) => call.body?.method === 'getDialogs');
    expect(lists).toHaveLength(1);
  });

  it('loads the slash-command menu for an open bot chat', async () => {
    const helper: ChatDto = {
      id: 7,
      kind: 'bot',
      title: 'Helper',
      username: 'helper_bot',
      photo: null,
      canSendMessages: true,
      presence: null,
    };
    installSignedInFetch({
      dialogs: [
        { chat: helper, lastMessage: null, unread: 0, readInboxMaxId: 0, readOutboxMaxId: 0, pinned: false, muted: false, archived: false },
      ],
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
        senderUsername: null,
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    installSignedInFetch({ history: () => json({ messages: [forwarded] }) });

    render(<App />);
    fireEvent.click(await screen.findByText('Bob'));

    expect(await screen.findByText('Forwarded from News Channel')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'News Channel' })).toBeNull();
  });

  it('opens the origin chat from a clickable forwarded-from name', async () => {
    const forwarded = message({
      id: 11,
      chatId: 2,
      senderId: 2,
      senderName: 'Bob',
      text: 'fresh news',
      forward: {
        senderId: 3,
        senderName: 'Carol',
        senderUsername: 'carol',
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    const calls = installSignedInFetch({
      dialogs: [...dialogs, carolDialog],
      history: (chatId) => json({ messages: chatId === 3 ? carolHistory : [forwarded] }),
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Bob'));
    const header = await within(threadSection()).findByText('Forwarded from');
    const origin = within(header).getByRole('button', { name: 'Carol' });
    expect(header.textContent).toBe('Forwarded from Carol');
    expect(within(header).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(origin);
    expect(await within(threadSection()).findByText('carol says hi')).toBeDefined();
    const opened = calls.some((call) => {
      const params = call.body?.params as { chatId?: number } | undefined;
      return call.body?.method === 'getHistory' && params?.chatId === 3;
    });
    expect(opened).toBe(true);
  });

  it('hands an unknown forwarded origin to the installed app', async () => {
    const forwarded = message({
      id: 11,
      chatId: 2,
      senderId: 2,
      senderName: 'Bob',
      text: 'fresh news',
      forward: {
        senderId: 999,
        senderName: 'Unknown Channel',
        senderUsername: 'unknown_channel',
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    installSignedInFetch({ history: () => json({ messages: [forwarded] }) });

    render(<App />);
    fireEvent.click(await screen.findByText('Bob'));
    const origin = await within(threadSection()).findByRole('button', { name: 'Unknown Channel' });
    fireEvent.click(origin);

    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('tg://resolve?domain=unknown_channel');
    globalThis.dispatchEvent(new Event('blur'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders the forwarded-from header above the sender name in a group', async () => {
    const team: ChatDto = { id: 4, kind: 'supergroup', title: 'Team', username: null, photo: null, canSendMessages: true, presence: null };
    const forwarded = message({
      id: 20,
      chatId: 4,
      senderId: 2,
      senderName: 'Bob',
      text: 'fresh news',
      forward: {
        senderId: null,
        senderName: 'News Channel',
        senderUsername: null,
        date: 1_699_999_800_000,
        fromChatId: null,
        fromMessageId: null,
        signature: null,
      },
    });
    installSignedInFetch({
      dialogs: [
        { chat: team, lastMessage: null, unread: 0, readInboxMaxId: 0, readOutboxMaxId: 0, pinned: false, muted: false, archived: false },
      ],
      history: () => json({ messages: [forwarded] }),
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Team'));

    const origin = await screen.findByText('Forwarded from News Channel');
    const sender = screen.getByText('Bob', { selector: '.message .sender' });
    expect(origin.nextElementSibling).toBe(sender);
  });

  it("shows group senders' avatars beside their bubbles", async () => {
    const team: ChatDto = {
      id: 4,
      kind: 'supergroup',
      title: 'Team',
      username: null,
      photo: null,
      canSendMessages: true,
      presence: null,
    };
    const incoming = message({
      id: 20,
      chatId: 4,
      senderId: 2,
      senderName: 'Bob',
      senderPhoto: 'bob-photo',
      text: 'hello team',
    });
    const outgoing = message({
      id: 21,
      chatId: 4,
      senderId: 1,
      senderName: 'Ada',
      senderPhoto: 'ada-photo',
      outgoing: true,
      text: 'hi Bob',
    });
    installSignedInFetch({
      dialogs: [
        { chat: team, lastMessage: null, unread: 0, readInboxMaxId: 0, readOutboxMaxId: 0, pinned: false, muted: false, archived: false },
      ],
      history: () => json({ messages: [incoming, outgoing] }),
    });

    render(<App />);
    fireEvent.click(await screen.findByText('Team'));
    expect(await within(threadSection()).findByText('hello team')).toBeDefined();

    const incomingLine = threadSection().querySelector<HTMLElement>('[data-message-ids~="20"]')?.closest('.message-line');
    expect(incomingLine).not.toBeNull();
    expect(incomingLine?.classList.contains('own')).toBe(false);
    expect(incomingLine?.querySelector<HTMLImageElement>(':scope .avatar img')?.getAttribute('src')).toBe(
      '/user/avatar?chatId=2&size=small&v=bob-photo',
    );

    const outgoingLine = threadSection().querySelector<HTMLElement>('[data-message-ids~="21"]')?.closest('.message-line');
    expect(outgoingLine?.classList.contains('own')).toBe(true);
    expect(outgoingLine?.querySelector<HTMLImageElement>(':scope .avatar img')?.getAttribute('src')).toBe(
      '/user/avatar?chatId=1&size=small&v=ada-photo',
    );
  });

  it('toggles a reaction optimistically and posts sendReaction', async () => {
    const sent: unknown[] = [];
    installFetch(
      bridgeFetch((call) => {
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
      }),
    );

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
        lastMessage: dialogMessage(pollMessage({ id: 30, chatId: 3 })),
        unread: 0,
        readInboxMaxId: 1,
        readOutboxMaxId: 0,
        pinned: false,
        muted: false,
        archived: false,
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
      expect(within(threadSection()).getByTitle('Correct answer')).toBeDefined();
      expect(within(threadSection()).getByTitle('Wrong answer')).toBeDefined();
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
          outgoing: false,
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

    it('renders a resolved original for an unloaded quote, and the fallback when nothing is known', async () => {
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
                  outgoing: false,
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
                text: 'the answer',
                reply: {
                  origin: 'same_chat',
                  messageId: 5,
                  chatId: null,
                  senderName: 'Bob',
                  outgoing: false,
                  date: 1_699_999_500_000,
                  text: 'the old question',
                  entities: [],
                  mediaKind: null,
                  quote: false,
                },
              }),
              message({
                id: 14,
                chatId: 2,
                senderName: 'Bob',
                text: 'missing original',
                reply: {
                  origin: 'same_chat',
                  messageId: 6,
                  chatId: null,
                  senderName: null,
                  outgoing: false,
                  date: null,
                  text: '',
                  entities: [],
                  mediaKind: null,
                  quote: false,
                },
              }),
              message({
                id: 15,
                chatId: 2,
                senderName: 'Bob',
                text: 'my own reply',
                reply: {
                  origin: 'same_chat',
                  messageId: 7,
                  chatId: null,
                  senderName: 'Ada',
                  outgoing: true,
                  date: 1_699_999_400_000,
                  text: 'my earlier note',
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
      expect(quotes.length).toBe(4);
      // Cross-chat: the header's sender and media label, never clickable.
      expect(quotes[0].tagName).toBe('DIV');
      expect(quotes[0].textContent).toContain('Announcements');
      expect(quotes[0].textContent).toContain('Photo');
      // Out-of-window: the engine resolved the original while reading the page.
      expect(quotes[1].tagName).toBe('DIV');
      expect(quotes[1].textContent).toContain('Bob');
      expect(quotes[1].textContent).toContain('the old question');
      // Deleted or otherwise unreadable: the explicit fallback.
      expect(quotes[2].textContent).toContain('Quoted Content Unavailable');
      // An own original reads "You", like a loaded one.
      expect(quotes[3].textContent).toContain('You');
      expect(quotes[3].textContent).toContain('my earlier note');
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
      expect(sent[0].body).toEqual({
        method: 'sendMessage',
        params: expect.objectContaining({ chatId: 2, text: 'sure', replyTo: 10 }),
      });
      expect((sent[0].body as { params: { randomId?: string } }).params.randomId).toMatch(/^\d+$/);
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
        const params = call.body?.params as { anchorId?: number } | undefined;
        return call.body?.method === 'getHistory' && params?.anchorId === 30;
      });
      // The jump names the post it wants; the engine reads around it.
      expect(jump?.body?.params).toMatchObject({ anchorId: 30 });
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

  describe('search', () => {
    /**
    Opens the overlay from the sidebar and types a query.
    */
    async function searchEverywhere(query: string): Promise<HTMLElement> {
      fireEvent.click(await screen.findByRole('button', { name: 'Search messages' }));
      const dialog = await screen.findByRole('dialog', { name: 'Search messages' });
      fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search messages' }), { target: { value: query } });
      return dialog;
    }

    it('opens a global result from a chat the list does not carry', async () => {
      const hit = message({ id: 30, chatId: 3, senderId: 3, senderName: 'Carol', text: 'a global hit' });
      const calls = installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method === 'searchGlobal') return json({ messages: [hit], chats: [carol] });
        },
        history: (chatId) => json({ messages: chatId === 3 ? [hit] : history }),
      });

      render(<App />);
      const dialog = await searchEverywhere('global');

      fireEvent.click(await within(dialog).findByRole('button', { name: /Carol/ }));

      expect(await within(threadSection()).findByText('a global hit')).toBeDefined();
      expect(location.pathname).toBe('/chat/3/post/30');
      expect(screen.queryByRole('dialog', { name: 'Search messages' })).toBeNull();
      // The window was read around the hit, not from the chat's newest page.
      const jump = calls.find((call) => {
        const params = call.body?.params as { chatId?: number; anchorId?: number } | undefined;
        return call.body?.method === 'getHistory' && params?.chatId === 3 && params.anchorId === 30;
      });
      expect(jump).toBeDefined();
      // A transient chat has no folder in the list, so it cannot be archived.
      fireEvent.click(screen.getByRole('button', { name: 'Menu for Carol' }));
      expect(within(screen.getByRole('menu', { name: 'Menu for Carol' })).queryByRole('menuitem', { name: 'Archive Chat' })).toBeNull();
    });

    it('opens a search for a hashtag tapped in a message', async () => {
      const source = message({
        id: 9,
        chatId: 2,
        senderId: 2,
        senderName: 'Bob',
        text: 'try #cloudflare',
        entities: [{ offset: 4, length: 11, kind: 'hashtag' }],
      });
      const calls = installSignedInFetch({
        history: () => json({ messages: [source] }),
        rpc: (call) => (call.body?.method === 'searchGlobal' ? json({ messages: [], chats: [] }) : undefined),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await within(threadSection()).findByRole('button', { name: '#cloudflare' }));

      const dialog = await screen.findByRole('dialog', { name: 'Search messages' });
      expect((within(dialog).getByRole('searchbox', { name: 'Search messages' }) as HTMLInputElement).value).toBe('#cloudflare');
      expect(within(dialog).getByText('Messages in all chats')).toBeDefined();
      await waitFor(() => expect(bridgeCall(calls, 'searchGlobal')?.body?.params).toMatchObject({ query: '#cloudflare' }));
    });

    it('searches the open chat from the thread header', async () => {
      const calls = installSignedInFetch({
        rpc: (call) => (call.body?.method === 'searchMessages' ? json({ messages: [history[1]] }) : undefined),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      fireEvent.click(await screen.findByRole('button', { name: 'Search in Bob' }));

      const dialog = await screen.findByRole('dialog', { name: 'Search messages' });
      expect(within(dialog).getByText('Messages in Bob')).toBeDefined();
      fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'see' } });

      expect(await within(dialog).findByRole('button', { name: /see you/ })).toBeDefined();
      await waitFor(() => expect(bridgeCall(calls, 'searchMessages')?.body?.params).toMatchObject({ chatId: 2, query: 'see' }));
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
      // Every action carries its icon from the shared set.
      expect(within(menu).getByRole('menuitem', { name: 'Reply' }).querySelector('svg[data-icon="reply"]')).not.toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'Forward' }).querySelector('svg[data-icon="forward"]')).not.toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'Copy Text' }).querySelector('svg[data-icon="copy"]')).not.toBeNull();
      // A user chat has no Telegram message link.
      expect(within(menu).queryByRole('menuitem', { name: 'Copy Link' })).toBeNull();

      clickMenuItem('Copy Text');
      expect(clipboard.writeText).toHaveBeenCalledWith('see you');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('copies a channel post link from the menu', async () => {
      const channel: ChatDto = {
        id: -1_000_000_000_020,
        kind: 'channel',
        title: 'Announcements',
        username: 'announce',
        photo: null,
        canSendMessages: false,
        presence: null,
      };
      const photo: MessageMediaDto = {
        kind: 'photo',
        fileName: null,
        mime: null,
        size: 100,
        width: 100,
        height: 100,
        duration: null,
      };
      const post = message({ id: 7, chatId: channel.id, text: 'hello', media: photo });
      installSignedInFetch({
        dialogs: [
          {
            chat: channel,
            lastMessage: dialogMessage(post),
            unread: 0,
            readInboxMaxId: 7,
            readOutboxMaxId: 0,
            pinned: false,
            muted: false,
            archived: false,
          },
        ],
        history: () => json({ messages: [post] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('hello')).toBeDefined();

      const menu = openMessageMenu(7);
      expect(within(menu).getByRole('menuitem', { name: 'Copy Link' }).querySelector('svg[data-icon="link"]')).not.toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'Download' }).querySelector('svg[data-icon="download"]')).not.toBeNull();

      clickMenuItem('Copy Link');
      expect(clipboard.writeText).toHaveBeenCalledWith('https://t.me/announce/7');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('reacts from the right-click strip and clears the reaction again', async () => {
      const sent: unknown[] = [];
      installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'sendReaction') return;
          sent.push(call.body);
          return json({ message: null });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      let menu = openMessageMenu(10);
      const thumbs = within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍' });
      expect(thumbs.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(thumbs);

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(screen.queryByRole('menu')).toBeNull();
      await waitFor(() => {
        expect((screen.getByRole('button', { name: 'React 👍 (2)' }) as HTMLButtonElement).disabled).toBe(false);
      });

      menu = openMessageMenu(10);
      const chosen = within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍' });
      expect(chosen.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(chosen);

      await waitFor(() => expect(sent).toHaveLength(2));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'React 👍 (1)' }).getAttribute('aria-pressed')).toBe('false');
      });
      expect(sent).toEqual([
        { method: 'sendReaction', params: { chatId: 2, messageId: 10, emoji: '👍', customEmojiId: null } },
        { method: 'sendReaction', params: { chatId: 2, messageId: 10, emoji: null, customEmojiId: null } },
      ]);
    });

    it('expands the strip into the full reaction picker', async () => {
      const sent: unknown[] = [];
      installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'sendReaction') return;
          sent.push(call.body);
          return json({ message: null });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const menu = openMessageMenu(10);
      expect(within(menu).getByRole('menuitem', { name: 'Show all reactions' }).getAttribute('aria-expanded')).toBe('false');
      expect(within(menu).queryByRole('menuitemcheckbox', { name: 'React with 🦄' })).toBeNull();

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show all reactions' }));

      expect(within(menu).getByRole('menuitem', { name: 'Hide all reactions' }).getAttribute('aria-expanded')).toBe('true');
      expect(within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍' })).toBeDefined();
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'React with 🦄' }));

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent).toEqual([{ method: 'sendReaction', params: { chatId: 2, messageId: 10, emoji: '🦄', customEmojiId: null } }]);
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

    it('opens no message menu on service messages', async () => {
      installSignedInFetch({
        history: () => json({ messages: [history[0], message({ id: 14, chatId: 2, service: true, text: 'Bob joined Telegram' })] }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('Bob joined Telegram')).toBeDefined();

      const row = threadSection().querySelector<HTMLElement>('[data-message-id="14"]');
      if (!row) throw new Error('The service message is not rendered');
      // The row has nothing to offer; the global guard cancels the browser's menu.
      fireEvent.contextMenu(row);
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

    it('forwards a message to the picked writable destination', async () => {
      const dave: DialogDto = {
        ...carolDialog,
        chat: { ...carol, id: 4, title: 'Dave', username: 'dave', canSendMessages: false },
      };
      const calls = installSignedInFetch({
        dialogs: [dialogs[0], carolDialog, dave],
        rpc: (call) => {
          if (call.body?.method !== 'forwardMessages') return;
          return json({
            messages: [
              message({
                id: 21,
                chatId: 3,
                senderId: 1,
                senderName: 'Ada',
                outgoing: true,
                text: 'see you',
              }),
            ],
          });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      openMessageMenu(10);
      clickMenuItem('Forward');

      const picker = await screen.findByRole('dialog', { name: 'Forward message' });
      // A chat the account cannot post in is not a destination at all.
      expect(within(picker).queryByText('Dave')).toBeNull();
      fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'car' } });
      expect(within(picker).queryByText('Bob')).toBeNull();
      expect(within(picker).getByText('Carol')).toBeDefined();

      fireEvent.click(within(picker).getByRole('button', { name: /Carol/ }));

      await waitFor(() => {
        expect(calls.filter((call) => call.body?.method === 'forwardMessages').map((call) => call.body)).toEqual([
          { method: 'forwardMessages', params: { chatId: 2, messageIds: [10], toChatId: 3 } },
        ]);
      });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Forward message' })).toBeNull();
      });
      expect(screen.getByText('Forwarded to Carol')).toBeDefined();
    });

    it('forwards every member of an album as one batch', async () => {
      const photo: MessageMediaDto = {
        kind: 'photo',
        fileName: null,
        mime: null,
        size: 1000,
        width: 320,
        height: 240,
        duration: null,
      };
      const calls = installSignedInFetch({
        dialogs: [dialogs[0], carolDialog],
        history: () =>
          json({
            messages: [
              message({ id: 20, chatId: 2, groupedId: '555', media: photo, text: '' }),
              message({ id: 21, chatId: 2, groupedId: '555', media: photo, text: '' }),
            ],
          }),
        rpc: (call) => {
          if (call.body?.method !== 'forwardMessages') return;
          return json({ messages: [] });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      await waitFor(() => {
        expect(threadSection().querySelector('[data-message-ids="20 21"]')).not.toBeNull();
      });

      // Media-only messages have no text to copy, but forwarding is still an
      // action on the bubble.
      openMessageMenu(20);
      clickMenuItem('Forward');
      const picker = await screen.findByRole('dialog', { name: 'Forward 2 messages' });
      expect(within(picker).getByText('2 messages')).toBeDefined();
      fireEvent.click(within(picker).getByRole('button', { name: /Carol/ }));

      await waitFor(() => {
        expect(calls.filter((call) => call.body?.method === 'forwardMessages').map((call) => call.body?.params)).toEqual([
          { chatId: 2, messageIds: [20, 21], toChatId: 3 },
        ]);
      });
    });

    it('keeps the picker open with an inline error, then closes on Escape', async () => {
      installSignedInFetch({
        dialogs: [dialogs[0], carolDialog],
        rpc: (call) => {
          if (call.body?.method !== 'forwardMessages') return;
          return json({ error: 'CHAT_WRITE_FORBIDDEN' }, 403);
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      openMessageMenu(10);
      clickMenuItem('Forward');
      const picker = await screen.findByRole('dialog', { name: 'Forward message' });
      fireEvent.click(within(picker).getByRole('button', { name: /Carol/ }));

      await waitFor(() => {
        expect(within(picker).getByRole('alert').textContent).toBe('CHAT_WRITE_FORBIDDEN');
      });
      expect(screen.getByRole('dialog', { name: 'Forward message' })).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Forward message' })).toBeNull();
      });
    });
  });

  describe('chat list context menu', () => {
    it('marks an unread chat read from its right-click menu', async () => {
      const calls = installSignedInFetch();

      render(<App />);
      const row = (await screen.findByText('Bob')).closest('button');
      if (!row) throw new Error('Bob has no chat row');
      expect(document.querySelector('.badge')?.textContent).toBe('1');

      fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
      const menu = screen.getByRole('menu', { name: 'Chat actions' });
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mark As Read' }));

      expect(screen.queryByRole('menu', { name: 'Chat actions' })).toBeNull();
      expect(document.querySelector('.badge')).toBeNull();
      await waitFor(() => {
        expect(calls.filter((call) => call.body?.method === 'readHistory').map((call) => call.body?.params)).toEqual([{ chatId: 2 }]);
      });
    });
  });

  describe('unread position', () => {
    /**
    Bob's dialog with reading stopped at message 8: 9, 11 and 13 are unread
    (10 and 12 are the account's own messages).
    */
    const unreadDialog: DialogDto = { ...dialogs[0], unread: 3, readInboxMaxId: 8, readOutboxMaxId: 10 };

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

    it('lands on the divider when switching chats scrolls the reused list while it loads', async () => {
      let release: ((response: Response) => void) | undefined;
      stubLayout({ listHeight: 600, viewportHeight: 200 });
      installSignedInFetch({
        dialogs: [unreadDialog, carolDialog],
        history: (chatId) =>
          chatId === 3
            ? json({ messages: carolHistory })
            : new Promise<Response>((resolve) => {
                release = resolve;
              }),
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Carol'));
      expect(await within(threadSection()).findByText('carol says hi')).toBeDefined();

      // Switching chats empties the window. Clearing the previous chat's rows
      // clamps the reused list, and the browser reports that clamp as a scroll
      // before Bob's window exists.
      scrollIntoView.mockClear();
      fireEvent.click(screen.getByText('Bob'));
      expect(await within(threadSection()).findByText('Loading messages…')).toBeDefined();
      scrollContainer().scrollTop = 0;
      fireEvent.scroll(scrollContainer());

      await act(async () => {
        release?.(json({ messages: unreadHistory }));
      });
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();

      // The divider owns the landing; the loading skeleton's own scroll is not
      // a reader position to resume.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    });

    it('does not count the catch-up replay the chat list already counted', async () => {
      const snapshot: DialogDto = {
        ...unreadDialog,
        lastMessage: dialogMessage(unreadHistory[5]),
        unread: 3,
        readInboxMaxId: 8,
      };
      installSignedInFetch({ dialogs: [snapshot], history: () => json({ messages: unreadHistory }) });

      render(<App />);
      expect(await screen.findByText('Bob')).toBeDefined();
      expect(document.querySelector('.badge')?.textContent).toBe('3');

      // The engine's getDifference catch-up runs after the socket's ready and
      // replays the messages the chat-list read already counted. Counting them
      // again is what made the badge larger than the official app's.
      for (let id = 9; id <= 13; id += 1) {
        deliver({ type: 'new_message', message: unreadMessage(id, `replayed ${String(id)}`, id % 2 === 0) });
      }
      expect(document.querySelector('.badge')?.textContent).toBe('3');
      expect(sidebar().textContent).toContain('unread three');

      // A message that is genuinely new still counts and previews.
      deliver({ type: 'new_message', message: unreadMessage(14, 'brand new') });
      expect(document.querySelector('.badge')?.textContent).toBe('4');
      expect(sidebar().textContent).toContain('brand new');
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

    it('folds inbox reads into the badge and the divider, and keeps outbox reads off both', async () => {
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

    it('seeds sent checks from the dialog and doubles them when the peer reads', async () => {
      installUnreadFetch();
      stubLayout({ listHeight: 300, viewportHeight: 50 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();

      const ticks = (messageId: number): string | null | undefined =>
        threadSection()
          .querySelector(`:scope [data-message-id="${CSS.escape(String(messageId))}"] .ticks`)
          ?.getAttribute('aria-label');
      // The dialog's outbox watermark covers the first own message only.
      expect(ticks(10)).toBe('Read');
      expect(ticks(12)).toBe('Sent');
      // Incoming messages and service rows carry no status.
      expect(threadSection().querySelector(':scope [data-message-id="9"] .ticks')).toBeNull();

      deliver({ type: 'read', chatId: 2, maxId: 12, unread: 0, inbox: false });
      await waitFor(() => expect(ticks(12)).toBe('Read'));
      expect(ticks(10)).toBe('Read');

      // The dialog list folded the same update, so reopening keeps it.
      fireEvent.click(screen.getByRole('button', { name: 'Back to chat list' }));
      await waitFor(() => expect(document.querySelector('section.thread.empty')).not.toBeNull());
      fireEvent.click(screen.getByText('Bob'));
      expect(await within(threadSection()).findByText('unread three')).toBeDefined();
      expect(ticks(12)).toBe('Read');
    });

    describe('large backlog', () => {
      const watermark = 1000;

      function backlogMessage(id: number, text = `message ${id}`): MessageDto {
        return message({ id, chatId: 2, senderName: 'Bob', text });
      }

      function backlogDialog(lastMessageId: number): DialogDto {
        return {
          ...dialogs[0],
          lastMessage: dialogMessage(backlogMessage(lastMessageId)),
          unread: 300,
          readInboxMaxId: watermark,
        };
      }

      function page(from: number, to: number): MessageDto[] {
        return Array.from({ length: to - from + 1 }, (_, index) => {
          const id = from + index;
          return backlogMessage(id, id === 1001 ? 'first unread' : `message ${id}`);
        });
      }

      /**
      Answers the unread window and the page after it. The first window starts
      a little above the watermark and reaches into the backlog.
      */
      function installBacklogFetch(lastMessageId: number, pages: Record<number, MessageDto[]>): FetchCall[] {
        return installSignedInFetch({
          dialogs: [backlogDialog(lastMessageId)],
          history: (_chatId, params) => json({ messages: pages[Number(params.offsetId)] ?? [] }),
        });
      }

      it('opens at the first unread instead of reading the newest page', async () => {
        const calls = installBacklogFetch(1090, { 1000: page(991, 1040), 1040: page(1041, 1090) });
        stubLayout({ listHeight: 2500, viewportHeight: 100 });

        render(<App />);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await within(threadSection()).findByText('first unread')).toBeDefined();

        const opened = calls.find((call) => call.body?.method === 'getHistory');
        expect(opened?.body?.params).toMatchObject({ chatId: 2, limit: 50, offsetId: watermark, addOffset: -40 });
        expect(opened?.body?.params).not.toHaveProperty('anchorId');

        const divider = threadSection().querySelector('[data-unread-divider]');
        expect(divider?.textContent).toBe('Unread Messages');
        expect((divider?.nextElementSibling as HTMLElement | null)?.dataset.messageId).toBe('1001');
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

        // The stubbed jump leaves the list at the top, where only read context
        // is on screen: opening must not receipt the backlog it has not shown.
        expect(calls.filter((call) => call.body?.method === 'readHistory')).toHaveLength(0);

        // Scrolling to the divider receipts the unread rows in view, not the
        // whole loaded page.
        scrollContainer().scrollTop = 500;
        fireEvent.scroll(scrollContainer());
        await waitFor(() => {
          expect(calls.filter((call) => call.body?.method === 'readHistory').map((call) => call.body?.params)).toEqual([
            { chatId: 2, maxId: 1002 },
          ]);
        });
      });

      it('pages forward to the newest message and stops offering newer pages', async () => {
        const calls = installBacklogFetch(1090, { 1000: page(991, 1040), 1040: page(1041, 1090) });
        stubLayout({ listHeight: 2500, viewportHeight: 100 });

        render(<App />);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await within(threadSection()).findByText('first unread')).toBeDefined();
        const newer = within(threadSection()).getByRole('button', { name: 'Load newer messages' });

        fireEvent.click(newer);
        expect(await within(threadSection()).findByText('message 1090')).toBeDefined();
        expect(calls.filter((call) => call.body?.method === 'getHistory').map((call) => call.body?.params)).toContainEqual({
          chatId: 2,
          limit: 50,
          offsetId: 1040,
          addOffset: -50,
        });
        expect(within(threadSection()).queryByRole('button', { name: 'Load newer messages' })).toBeNull();
      });

      it('jumps to the newest message and reads the whole chat', async () => {
        const calls = installSignedInFetch({
          dialogs: [backlogDialog(1090)],
          // The opening window lands around the watermark; a read with no
          // cursor is the jump's newest page.
          history: (_chatId, params) => json({ messages: params.offsetId === undefined ? page(1041, 1090) : page(991, 1040) }),
        });
        stubLayout({ listHeight: 2500, viewportHeight: 100 });

        render(<App />);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await within(threadSection()).findByText('first unread')).toBeDefined();
        expect(document.querySelector('.badge')?.textContent).toBe('99+');

        fireEvent.click(within(threadSection()).getByRole('button', { name: 'Jump to latest and mark as read' }));

        expect(await within(threadSection()).findByText('message 1090')).toBeDefined();
        // The old backlog is left behind, not paged through one page at a time.
        expect(within(threadSection()).queryByText('first unread')).toBeNull();
        expect(within(threadSection()).queryByRole('button', { name: 'Jump to latest and mark as read' })).toBeNull();

        // One read covers the whole chat, backlog included, so the receipt
        // carries no max id.
        expect(calls.filter((call) => call.body?.method === 'readHistory').map((call) => call.body?.params)).toEqual([{ chatId: 2 }]);
        expect(calls.filter((call) => call.body?.method === 'getHistory').map((call) => call.body?.params)).toContainEqual({
          chatId: 2,
          limit: 50,
        });
        expect(document.querySelector('.badge')).toBeNull();
      });

      it('loads the next newer page as the reader approaches the end', async () => {
        const reads: Array<Record<string, unknown>> = [];
        const box = stubLayout({ listHeight: 2500, viewportHeight: 100 });
        installSignedInFetch({
          dialogs: [backlogDialog(1090)],
          history: (_chatId, params) => {
            reads.push(params);
            if (params.offsetId === watermark) return json({ messages: page(991, 1040) });
            // The forward page lands below the viewport; the list grows by its
            // rows.
            box.listHeight += 50 * 50;
            return json({ messages: page(1041, 1090) });
          },
        });

        render(<App />);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await within(threadSection()).findByText('first unread')).toBeDefined();
        expect(reads).toHaveLength(1);

        // One viewport before the end, the next page is read and merged.
        scrollContainer().scrollTop = 2400;
        fireEvent.scroll(scrollContainer());
        expect(await within(threadSection()).findByText('message 1090')).toBeDefined();
        expect(reads).toHaveLength(2);
        expect(reads[1]).toEqual({ chatId: 2, limit: 50, offsetId: 1040, addOffset: -50 });

        // The page reached the newest message, so the button and further
        // reads are gone.
        expect(within(threadSection()).queryByRole('button', { name: 'Load newer messages' })).toBeNull();
        fireEvent.scroll(scrollContainer());
        expect(reads).toHaveLength(2);
      });

      it('holds a live message until forward paging reaches it', async () => {
        installBacklogFetch(1089, { 1000: page(991, 1040), 1040: [...page(1041, 1089), backlogMessage(1090, 'live newest')] });
        stubLayout({ listHeight: 2500, viewportHeight: 100 });

        render(<App />);
        fireEvent.click(await screen.findByText('Bob'));
        expect(await within(threadSection()).findByText('first unread')).toBeDefined();

        // The range is still behind, so the live message waits: appending it
        // here would put it after a gap the reader has not paged through.
        deliver({ type: 'new_message', message: backlogMessage(1090, 'live newest') });
        expect(within(threadSection()).queryByText('live newest')).toBeNull();

        fireEvent.click(within(threadSection()).getByRole('button', { name: 'Load newer messages' }));
        expect(await within(threadSection()).findByText('live newest')).toBeDefined();
        expect(within(threadSection()).queryByRole('button', { name: 'Load newer messages' })).toBeNull();
      });
    });
  });

  describe('older history paging', () => {
    /**
    A full opening window (ids 100–149) and an older page behind it.
    */
    const recent = Array.from({ length: 50 }, (_, index) => message({ id: 100 + index, chatId: 2, text: `recent ${String(index + 1)}` }));
    const older = Array.from({ length: 3 }, (_, index) => message({ id: 97 + index, chatId: 2, text: `older ${String(index + 1)}` }));
    /**
    Bob's dialog with the whole window read, so the thread opens at the bottom.
    */
    const readDialog: DialogDto = { ...dialogs[0], unread: 0, readInboxMaxId: 149 };

    it('loads the next older page as the reader approaches the top', async () => {
      const reads: Array<Record<string, unknown>> = [];
      const box = stubLayout({ listHeight: 2500, viewportHeight: 500 });
      installSignedInFetch({
        dialogs: [readDialog],
        history: (_chatId, params) => {
          reads.push(params);
          if (params.offsetId === undefined) return json({ messages: recent });
          // The older page lands above the viewport; the list grows by its rows.
          box.listHeight += older.length * 50;
          return json({ messages: older });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('recent 50')).toBeDefined();
      expect(scrollContainer().scrollTop).toBe(2500);

      // Pinned to the bottom is not "near the top": no page is read.
      fireEvent.scroll(scrollContainer());
      expect(reads).toHaveLength(1);

      // One viewport before the top, the next page is read and merged.
      scrollContainer().scrollTop = 0;
      fireEvent.scroll(scrollContainer());
      expect(await within(threadSection()).findByText('older 1')).toBeDefined();
      expect(reads).toHaveLength(2);
      expect(reads[1]).toEqual({ chatId: 2, limit: 50, offsetId: 100, offsetDate: 1_700_000_000 });
      // The prepended page did not move the reader's row: the three older rows
      // (150px) are above it, so the position moved down by exactly that.
      expect(scrollContainer().scrollTop).toBe(150);

      // The short page was the start of history, so the button and further
      // reads are gone.
      expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
      scrollContainer().scrollTop = 0;
      fireEvent.scroll(scrollContainer());
      expect(reads).toHaveLength(2);
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

  describe('mobile keyboard', () => {
    /**
    Bob's dialog, fully read: a plain open lands at the bottom.
    */
    const readDialog: DialogDto = { ...dialogs[0], unread: 0, readInboxMaxId: 10 };

    it('keeps a pinned thread at the end when the viewport shrinks', async () => {
      installSignedInFetch({
        dialogs: [readDialog],
        history: () => json({ messages: [message({ id: 10, chatId: 2, text: 'latest' })] }),
      });
      const box = stubLayout({ listHeight: 300, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByText('latest')).toBeDefined();
      expect(scrollContainer().scrollTop).toBe(300);

      // The keyboard takes the bottom of the app. The browser clamps the old
      // scroll position against the shorter list; the pin restores the end so
      // the newest message stays above the composer.
      box.viewportHeight = 50;
      scrollContainer().scrollTop = 250;
      fireResize(scrollContainer());
      expect(scrollContainer().scrollTop).toBe(300);

      // A reader who scrolled away keeps their place.
      scrollContainer().scrollTop = 100;
      fireEvent.scroll(scrollContainer());
      box.viewportHeight = 40;
      fireResize(scrollContainer());
      expect(scrollContainer().scrollTop).toBe(100);
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
                  outgoing: false,
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

      const download = within(dialog).getByRole('link', { name: 'Download original' });
      expect(download.getAttribute('href')).toContain('/user/file?chatId=2&messageId=10');
      expect(download.getAttribute('href')).not.toContain('thumb=1');
      expect(download.getAttribute('download')).toBe('photo-10.jpg');

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('downloads a single media message from its context menu', async () => {
      installSignedInFetch({ history: () => json({ messages: [message({ id: 20, chatId: 2, text: '', media: photo })] }) });
      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await within(threadSection()).findByRole('button', { name: 'Open photo' })).toBeDefined();

      const menu = openMessageMenu(20);
      const item = within(menu).getByRole('menuitem', { name: 'Download' });
      const clicked: HTMLAnchorElement[] = [];
      const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
      try {
        fireEvent.click(item);
        expect(clicked[0]?.getAttribute('href')).toContain('/user/file?chatId=2&messageId=20');
        expect(clicked[0]?.getAttribute('href')).not.toContain('thumb=1');
        expect(clicked[0]?.getAttribute('download')).toBe('photo-20.jpg');
      } finally {
        spy.mockRestore();
      }
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
      presence: null,
    };

    const post = message({
      id: 7,
      chatId: channel.id,
      text: 'A new feature shipped',
      views: 1234,
      comments: { hasComments: true, count: 2, discussionChatId: GROUP },
    });

    const channelDialog: DialogDto = {
      chat: channel,
      lastMessage: dialogMessage(post),
      unread: 0,
      readInboxMaxId: 7,
      readOutboxMaxId: 0,
      pinned: false,
      muted: false,
      archived: false,
    };

    function comment(overrides: Partial<MessageDto> & { id: number }): MessageDto {
      return message({ chatId: GROUP, senderName: 'Dana', ...overrides });
    }

    /**
    A same-chat reply header into the thread, as the discussion group carries
    it (top-level comments point at the root).
    */
    function replyHeader(messageId: number): MessageReplyDto {
      return {
        origin: 'same_chat',
        messageId,
        chatId: null,
        senderName: null,
        outgoing: false,
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

    it('shows an out-of-window reply quote and keeps the thread root bare', async () => {
      const resolved = {
        ...replyHeader(ROOT + 40),
        senderName: 'Dana',
        date: 1_699_999_000_000,
        text: 'the earlier point',
      };
      installCommentsFetch((call) => {
        if (call.body?.method !== 'getComments') return;
        return json({
          comments: [
            comment({ id: ROOT + 1, text: 'top level', reply: replyHeader(ROOT) }),
            comment({ id: ROOT + 2, text: 'follow up', reply: resolved }),
          ],
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

      const quotes = threadSection().querySelectorAll('.reply-quote');
      expect(quotes.length).toBe(1);
      expect(quotes[0].tagName).toBe('DIV');
      expect(quotes[0].textContent).toContain('Dana');
      expect(quotes[0].textContent).toContain('the earlier point');
    });

    it("offers the linked discussion group's slash commands in the comments composer", async () => {
      installCommentsFetch((call) => {
        if (call.body?.method !== 'getComments') return;
        return json({
          comments: commentList,
          count: 2,
          discussionChatId: GROUP,
          discussionMessageId: ROOT,
          commands: [{ command: 'rules', description: 'Read the rules' }],
        });
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect(await screen.findByText('Comments')).toBeDefined();

      // The channel itself has no command menu; this one comes from the
      // discussion group, read together with the comments.
      fireEvent.click(screen.getByRole('button', { name: 'Bot commands' }));
      const menu = screen.getByRole('listbox', { name: 'Bot commands' });
      expect(within(menu).getByRole('option', { name: /\/rules/ })).toBeDefined();
    });

    it('copies a comment link that names the channel post', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      try {
        installCommentsFetch((call) => {
          if (call.body?.method !== 'getComments') return;
          return json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT });
        });

        render(<App />);
        fireEvent.click(await screen.findByText('Announcements'));
        expect(await screen.findByText('A new feature shipped')).toBeDefined();
        openComments();
        expect(await screen.findByText('Comments')).toBeDefined();

        openMessageMenu(ROOT + 1);
        clickMenuItem('Copy Link');
        expect(writeText).toHaveBeenCalledWith('https://t.me/announce/7?comment=11');
        expect(screen.queryByRole('menu')).toBeNull();
      } finally {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    });

    it('returns to the channel where it was left when comments close', async () => {
      const channelHistory = Array.from({ length: 7 }, (_, index) =>
        index + 1 === post.id ? post : message({ id: index + 1, chatId: channel.id, text: `post ${String(index + 1)}` }),
      );
      installCommentsFetch(
        (call) => {
          if (call.body?.method !== 'getComments') return;
          return json({ comments: commentList, count: 2, discussionChatId: GROUP, discussionMessageId: ROOT });
        },
        () => json({ messages: channelHistory }),
      );
      stubLayout({ listHeight: 600, viewportHeight: 100 });

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      // Fully read: the channel opens at the bottom.
      expect(scrollContainer().scrollTop).toBe(600);
      // Scroll up, then open comments from the post.
      scrollContainer().scrollTop = 200;
      fireEvent.scroll(scrollContainer());
      openComments();
      expect(await screen.findByText('Comments')).toBeDefined();

      act(() => {
        globalThis.history.replaceState({ app: 'telegram-web-client', depth: 1 }, '', `/chat/${String(channel.id)}`);
        dispatchEvent(new PopStateEvent('popstate'));
      });

      await waitFor(() => expect(screen.queryByText('Comments')).toBeNull());
      expect(within(threadSection()).getByText('A new feature shipped')).toBeDefined();
      expect(scrollContainer().scrollTop).toBe(200);
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

    it("shows commenters' avatars but not the pinned post's", async () => {
      const avatarComment = comment({
        id: ROOT + 1,
        senderId: 2,
        senderName: 'Dana',
        senderPhoto: 'dana-photo',
        text: 'nice',
      });
      installCommentsFetch(
        () => json({ comments: [avatarComment], count: 1, discussionChatId: GROUP, discussionMessageId: ROOT }),
        () =>
          json({
            messages: [{ ...post, senderId: channel.id, senderName: 'Announcements', senderPhoto: 'channel-photo' }],
          }),
      );

      render(<App />);
      fireEvent.click(await screen.findByText('Announcements'));
      expect(await screen.findByText('A new feature shipped')).toBeDefined();
      openComments();
      expect(await within(threadSection()).findByText('nice')).toBeDefined();

      const commentLine = threadSection().querySelector<HTMLElement>('[data-message-ids~="11"]')?.closest('.message-line');
      expect(commentLine?.querySelector<HTMLImageElement>(':scope .avatar img')?.getAttribute('src')).toBe(
        '/user/avatar?chatId=2&size=small&v=dana-photo',
      );
      // The pinned post is not a commenter, and its header already carries the
      // channel's avatar.
      expect(threadSection().querySelector(':scope .comments-post .avatar')).toBeNull();
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
      expect(meta?.textContent).toContain('1.2K');
      expect(meta?.querySelector('[data-icon="eye"]')).not.toBeNull();
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
      expect(await within(threadSection()).findByText('3.5K')).toBeDefined();
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
        params: expect.objectContaining({ chatId: channel.id, messageId: 7, text: 'shipping it' }),
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
        params: expect.objectContaining({ chatId: channel.id, messageId: 7, text: 'thanks', replyTo: ROOT + 1 }),
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

    it('loads the next older page as the reader approaches the top', async () => {
      const calls: FetchCall[] = [];
      const box = stubLayout({ listHeight: 2000, viewportHeight: 500 });
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
      expect(screen.getByRole('button', { name: 'Load older comments' })).toBeDefined();

      // The screen opens at the bottom; only a scroll toward the top asks for
      // the next page.
      fireEvent.scroll(scrollContainer());
      expect(calls).toHaveLength(1);

      scrollContainer().scrollTop = 0;
      box.listHeight += 50;
      fireEvent.scroll(scrollContainer());
      expect(await within(threadSection()).findByText('first ever')).toBeDefined();
      expect(calls).toHaveLength(2);
      expect(calls[1].body).toEqual({
        method: 'getComments',
        params: { chatId: channel.id, messageId: 7, limit: 50, offsetId: ROOT + 1, offsetDate: 1_700_000_000 },
      });
      // The prepended comment keeps the viewport on the comment it showed.
      expect(scrollContainer().scrollTop).toBe(50);

      // The cursor is gone, so there is no button and no further read.
      expect(screen.queryByRole('button', { name: 'Load older comments' })).toBeNull();
      scrollContainer().scrollTop = 0;
      fireEvent.scroll(scrollContainer());
      expect(calls).toHaveLength(2);
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
        params: expect.objectContaining({ chatId: channel.id, messageId: 7, text: 'first!' }),
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
        presence: null,
      };
      return {
        chat,
        lastMessage: dialogMessage(post),
        unread: 0,
        readInboxMaxId: 7,
        readOutboxMaxId: 0,
        pinned: false,
        muted: false,
        archived: false,
      };
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
      const group: ChatDto = {
        id: -30,
        kind: 'supergroup',
        title: 'Team',
        username: null,
        photo: null,
        canSendMessages: false,
        presence: null,
      };
      installSignedInFetch({
        dialogs: [
          {
            chat: group,
            lastMessage: null,
            unread: 0,
            readInboxMaxId: 0,
            readOutboxMaxId: 0,
            pinned: false,
            muted: false,
            archived: false,
          },
        ],
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

    it('keeps a live message when the opening window is empty', async () => {
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
        resolveHistory?.([]);
      });

      // There is no window to be behind, so the live message is the thread
      // rather than being dropped with the empty response.
      expect(within(threadSection()).getByText('racing in')).toBeDefined();
      expect(within(threadSection()).queryByRole('button', { name: 'Load newer messages' })).toBeNull();
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

  describe('chat list presence', () => {
    it('marks a peer that came online and unmarks one that went away', async () => {
      installSignedInFetch();

      render(<App />);
      expect(await screen.findByText('Bob')).toBeDefined();
      const bobRow = (): Element | null => screen.getByText('Bob').closest('button');
      expect(bobRow()?.querySelector('[data-status="online"]')).toBeNull();

      deliver({ type: 'user_status', userId: 2, presence: { status: 'online', lastSeenAt: null } });
      expect(bobRow()?.querySelector('[data-status="online"]')).not.toBeNull();

      deliver({ type: 'user_status', userId: 2, presence: { status: 'offline', lastSeenAt: 1_700_000_000_000 } });
      expect(bobRow()?.querySelector('[data-status="online"]')).toBeNull();
    });

    it('marks the peer in the open thread’s header', async () => {
      installSignedInFetch({ history: () => json({ messages: [] }) });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByRole('button', { name: 'Back to chat list' })).toBeDefined();
      expect(threadSection().querySelector('[data-status="online"]')).toBeNull();

      deliver({ type: 'user_status', userId: 2, presence: { status: 'online', lastSeenAt: null } });
      expect(threadSection().querySelector('[data-status="online"]')).not.toBeNull();
    });
  });

  describe('archive', () => {
    const archivedDialog: DialogDto = {
      chat: { id: 4, kind: 'user', title: 'Dave', username: 'dave', photo: null, canSendMessages: true, presence: null },
      lastMessage: null,
      unread: 0,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      pinned: false,
      muted: false,
      archived: true,
    };

    /**
    Opens the archive from the profile popup.
    */
    async function openArchive(): Promise<void> {
      const trigger = await screen.findByRole('button', { name: 'Account menu for Ada Lovelace' });
      // The router ignores navigation until its boot has seeded the history
      // stack, so a click that lands while the boot read is still in flight
      // would close the menu without going anywhere. The sidebar leaving its
      // loading state is the boot's signal that the stack is ready, whatever
      // the list turned out to hold.
      await waitFor(() => expect(within(sidebar()).queryByText('Loading chats…')).toBeNull());
      fireEvent.click(trigger);
      fireEvent.click(within(screen.getByRole('menu', { name: 'Account menu' })).getByRole('menuitem', { name: 'Archived Chats' }));
    }

    /**
    Moves the open chat through the menu and the confirmation that follows it.
    */
    async function moveChat(title: string, item: string, confirm: string): Promise<void> {
      fireEvent.click(screen.getByRole('button', { name: `Menu for ${title}` }));
      const menu = screen.getByRole('menu', { name: `Menu for ${title}` });
      fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    }

    it('reads the archive only when the reader asks for it', async () => {
      const calls = installSignedInFetch({ archivedDialogs: [archivedDialog] });

      render(<App />);
      expect(await screen.findByText('Bob')).toBeDefined();
      expect(calls.some((call) => (call.body?.params as { archived?: boolean } | undefined)?.archived === true)).toBe(false);

      await openArchive();

      expect(await screen.findByText('Dave')).toBeDefined();
      expect(within(sidebar()).queryByText('Bob')).toBeNull();
      expect(location.pathname).toBe('/archived');
      expect(calls.some((call) => (call.body?.params as { archived?: boolean } | undefined)?.archived === true)).toBe(true);
    });

    it('says so when the archive is empty', async () => {
      installSignedInFetch();

      render(<App />);
      await openArchive();

      expect(await screen.findByText('No archived chats.')).toBeDefined();
    });

    it('says that the account has no chats when the chat list is empty', async () => {
      installSignedInFetch({ dialogs: [] });

      render(<App />);

      // The list is read in one request with the account, so an empty list is
      // an answer, not a load that never finished.
      expect(await screen.findByText('No chats yet.')).toBeDefined();
    });

    it('leaves the archive for the chat list on back', async () => {
      installSignedInFetch({ archivedDialogs: [archivedDialog] });

      render(<App />);
      await openArchive();
      expect(await screen.findByText('Dave')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));

      expect(await screen.findByText('Bob')).toBeDefined();
      expect(location.pathname).toBe('/');
    });

    it('opens an archived chat in the thread', async () => {
      installSignedInFetch({ archivedDialogs: [archivedDialog] });

      render(<App />);
      await openArchive();

      fireEvent.click(await screen.findByText('Dave'));

      expect(await screen.findByText('oldest')).toBeDefined();
      expect(location.pathname).toBe('/chat/4');
      // The archive stays in the sidebar while one of its chats is open: the
      // thread is a detail of the list, not a way out of it.
      expect(within(sidebar()).getByText('Archived Chats')).toBeDefined();
      expect(within(sidebar()).getByText('Dave')).toBeDefined();
      expect(within(sidebar()).queryByText('Bob')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Back to chat list' }));

      await waitFor(() => expect(location.pathname).toBe('/archived'));
      expect(within(sidebar()).getByText('Archived Chats')).toBeDefined();
    });

    it('hands the sidebar back to the chat list without closing the open chat', async () => {
      installSignedInFetch({ archivedDialogs: [archivedDialog] });

      render(<App />);
      await openArchive();
      fireEvent.click(await screen.findByText('Dave'));
      expect(await screen.findByText('oldest')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));

      // The bar only leaves the archive list: the open message view is the
      // route's, so only the sidebar changes and the thread stays.
      await waitFor(() => expect(within(sidebar()).queryByText('Archived Chats')).toBeNull());
      expect(within(sidebar()).getByText('Bob')).toBeDefined();
      expect(within(threadSection()).getByText('oldest')).toBeDefined();
      expect(location.pathname).toBe('/chat/4');
    });

    it('opens an archived chat from a shared link', async () => {
      // The chat list does not carry the archived chats, so the link makes the
      // app read the archive before it gives up on the chat.
      globalThis.history.replaceState(null, '', '/chat/4');
      installSignedInFetch({ archivedDialogs: [archivedDialog] });

      render(<App />);

      expect(await screen.findByText('oldest')).toBeDefined();
      expect(location.pathname).toBe('/chat/4');
      // The link named a chat the archive holds, so the sidebar shows that
      // list beside it rather than the main list it is not in.
      expect(await within(sidebar()).findByText('Archived Chats')).toBeDefined();
    });

    it('archives a chat and takes it out of the chat list', async () => {
      const calls = installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'setArchived') return;
          const params = call.body?.params as { chatId: number; archived: boolean };
          return json({ chatId: params.chatId, archived: params.archived });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByRole('button', { name: 'Menu for Bob' })).toBeDefined();

      await moveChat('Bob', 'Archive Chat', 'Archive');

      await waitFor(() => expect(within(sidebar()).queryByText('Bob')).toBeNull());
      const move = calls.find((call) => call.body?.method === 'setArchived');
      expect(move?.body?.params).toEqual({ chatId: 2, archived: true });
      expect(await screen.findByText('Chat Archived')).toBeDefined();
    });

    it('puts an archived chat back into the chat list', async () => {
      const calls = installSignedInFetch({
        dialogs: [],
        archivedDialogs: [archivedDialog],
        rpc: (call) => {
          if (call.body?.method !== 'setArchived') return;
          const params = call.body?.params as { chatId: number; archived: boolean };
          return json({ chatId: params.chatId, archived: params.archived });
        },
      });

      render(<App />);
      await openArchive();
      fireEvent.click(await screen.findByText('Dave'));
      expect(await screen.findByRole('button', { name: 'Menu for Dave' })).toBeDefined();

      await moveChat('Dave', 'Unarchive Chat', 'Unarchive');

      await waitFor(() => expect(within(sidebar()).queryByText('Dave')).not.toBeNull());
      // The chat now lives in the main list, so the sidebar hands back to it.
      expect(within(sidebar()).queryByText('Archived Chats')).toBeNull();
      const move = calls.find((call) => call.body?.method === 'setArchived');
      expect(move?.body?.params).toEqual({ chatId: 4, archived: false });
      expect(await screen.findByText('Chat Restored')).toBeDefined();
    });

    it('puts a chat back where it was when the bridge refuses the move', async () => {
      installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'setArchived') return;
          return json({ error: 'FOLDER_ID_INVALID' }, 400);
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByRole('button', { name: 'Menu for Bob' })).toBeDefined();

      await moveChat('Bob', 'Archive Chat', 'Archive');

      expect(await within(sidebar()).findByText('Bob')).toBeDefined();
      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.queryByText('Chat Archived')).toBeNull();
    });
  });

  describe('optimistic sends', () => {
    it('shows the message in the thread and the chat list before the bridge answers', async () => {
      const resolvers: Array<(message: MessageDto) => void> = [];
      const sends: FetchCall[] = [];
      installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'sendMessage') return;
          sends.push(call);
          return new Promise<Response>((resolve) => {
            resolvers.push((sent) => resolve(json({ message: sent })));
          });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      const composer = screen.getByPlaceholderText('Message') as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(composer, { target: { value: 'first' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      });

      // The bubble is on screen before the bridge has answered.
      expect(within(threadSection()).getByText('first')).toBeDefined();
      const chatList = document.querySelector<HTMLElement>('.chats');
      expect(chatList).not.toBeNull();
      expect(within(chatList as HTMLElement).getByText('first')).toBeDefined();
      // The composer is free for the next message.
      expect(composer.value).toBe('');
      expect(sends).toHaveLength(1);

      await act(async () => {
        fireEvent.change(composer, { target: { value: 'second' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      });
      expect(within(threadSection()).getByText('second')).toBeDefined();
      expect(composer.value).toBe('');
      // Text sends are serialized, so the second one waits for the first.
      expect(sends).toHaveLength(1);

      await act(async () => {
        resolvers[0]?.(message({ id: 11, chatId: 2, outgoing: true, text: 'first' }));
      });
      await waitFor(() => {
        expect(sends).toHaveLength(2);
      });
      expect(within(threadSection()).getByText('first')).toBeDefined();

      await act(async () => {
        resolvers[1]?.(message({ id: 12, chatId: 2, outgoing: true, text: 'second' }));
      });
      await waitFor(() => {
        expect(within(threadSection()).getAllByText('first')).toHaveLength(1);
        expect(within(threadSection()).getAllByText('second')).toHaveLength(1);
      });
      expect(within(threadSection()).queryByText(/Not sent/)).toBeNull();
    });

    it('keeps a failed send as a not-sent bubble and retries it with the same random id', async () => {
      const sends: FetchCall[] = [];
      installSignedInFetch({
        rpc: (call) => {
          if (call.body?.method !== 'sendMessage') return;
          sends.push(call);
          return sends.length === 1
            ? json({ error: 'The bridge is offline' }, 500)
            : json({ message: message({ id: 13, chatId: 2, outgoing: true, text: 'retry me' }) });
        },
      });

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'retry me' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      expect(await within(threadSection()).findByText(/Not sent/)).toBeDefined();
      expect(within(threadSection()).getByText('retry me')).toBeDefined();

      const randomId = (sends[0]?.body as { params: { randomId?: string } }).params.randomId;
      expect(randomId).toMatch(/^\d+$/);

      fireEvent.click(within(threadSection()).getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(sends).toHaveLength(2);
      });
      expect((sends[1]?.body as { params: { randomId?: string } }).params.randomId).toBe(randomId);

      await waitFor(() => {
        expect(within(threadSection()).getAllByText('retry me')).toHaveLength(1);
      });
      expect(within(threadSection()).queryByText(/Not sent/)).toBeNull();
    });

    it('shows an attachment right away and sends it with a random id', async () => {
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
      installSignedInFetch();

      render(<App />);
      fireEvent.click(await screen.findByText('Bob'));
      expect(await screen.findByText('oldest')).toBeDefined();

      fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'the note' } });
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });
      fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

      // The dialog reviews the selection; confirming it starts the upload.
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

      // The file and its caption are on screen before the upload answers.
      expect(within(threadSection()).getByText(/note\.txt/)).toBeDefined();
      expect(within(threadSection()).getByText('the note')).toBeDefined();

      await waitFor(() => {
        expect(FakeXhr.instances).toHaveLength(1);
      });
      expect(FakeXhr.instances[0]?.url).toContain('randomId=');
      expect(FakeXhr.instances[0]?.url).toContain('caption=the+note');

      await waitFor(() => {
        expect(within(threadSection()).queryByText(/note\.txt/)).toBeNull();
      });
      expect(within(threadSection()).getAllByText('the note')).toHaveLength(1);
    });
  });
});
