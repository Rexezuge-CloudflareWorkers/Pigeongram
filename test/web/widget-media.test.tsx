import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetAction, WidgetHostOptions } from '@telegram/widget-sandbox/host/widget-host';
import type { MessageDto, MessageMediaDto } from '../../apps/web/src/types';
import { TelegramLinkProvider } from '../../apps/web/src/telegram-links';

/**
Widget bubbles: the compressed payload is inflated in the browser, the
official sandbox is loaded lazily, the read-only host gets no request
callback, links are routed through the app, and a broken widget degrades to
the labelled card rather than a hole.
*/

const sandbox = vi.hoisted(() => ({
  hosts: [] as Array<{
    options: WidgetHostOptions;
    visible: boolean;
    destroyed: boolean;
    setVisible: (value: boolean) => void;
    setTheme: (value: unknown) => void;
    destroy: () => void;
  }>,
  action: null as ((action: WidgetAction) => void) | null,
  resize: null as ((height: number, anchor: 'top' | 'bottom') => void) | null,
  dead: null as ((reason: string) => void) | null,
}));

const loader = vi.hoisted(() => ({ inflate: vi.fn() as ReturnType<typeof vi.fn> }));

vi.mock('../../apps/web/src/widget-loader', () => ({
  loadWidgetSandbox: vi.fn(async () => ({
    WidgetHost: class {
      options: WidgetHostOptions;
      visible = false;
      destroyed = false;
      constructor(_container: HTMLElement, _html: string, options: WidgetHostOptions) {
        this.options = options;
        sandbox.hosts.push(this as never);
        sandbox.action = options.onAction ?? null;
        sandbox.resize = options.onResize ?? null;
        sandbox.dead = options.onDead ?? null;
      }
      setVisible(value: boolean): void {
        this.visible = value;
      }
      setTheme(): void {}
      destroy(): void {
        this.destroyed = true;
      }
    },
    rendererFactory: vi.fn(),
  })),
}));

vi.mock('../../apps/web/src/widget-decode', () => ({ inflateWidgetPayload: loader.inflate }));

const { WidgetMedia } = await import('../../apps/web/src/components/WidgetMedia');

function widgetMedia(overrides: Partial<MessageMediaDto['widget']> = {}): MessageMediaDto {
  return {
    kind: 'widget',
    fileName: null,
    mime: null,
    size: null,
    width: 320,
    height: 200,
    duration: null,
    widget: {
      payload: 'eJwBAgM=',
      width: 320,
      height: 200,
      isCopy: false,
      canQuery: true,
      canQueryInBackground: false,
      widgetId: null,
      publicData: '{"score":1}',
      chatData: null,
      publicDataHash: null,
      ...overrides,
    },
  };
}

function message(media: MessageMediaDto): MessageDto {
  return {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 1,
    senderName: 'Bot',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    pinned: false,
    editDate: null,
    text: 'A caption',
    entities: [],
    reactions: [],
    service: false,
    media,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

beforeEach(() => {
  sandbox.hosts.length = 0;
  sandbox.action = null;
  sandbox.resize = null;
  sandbox.dead = null;
  loader.inflate.mockReset();
  loader.inflate.mockResolvedValue('<html><body>widget</body></html>');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WidgetMedia', () => {
  it('reserves the bot size and creates a strict host without a request callback', async () => {
    const { container } = render(<WidgetMedia message={message(widgetMedia())} media={widgetMedia()} />);

    await waitFor(() => expect(sandbox.hosts).toHaveLength(1));
    const bubble = container.querySelector<HTMLElement>('[data-widget-message]');
    expect(bubble?.style.width).toBe('320px');
    expect(bubble?.style.height).toBe('200px');
    expect(sandbox.hosts[0]?.options.onRequest).toBeUndefined();
    expect(sandbox.hosts[0]?.options.context).toMatchObject({ canQuery: true, chatType: 'private' });
    expect(sandbox.hosts[0]?.options.data).toEqual({ chatData: null, publicData: '{"score":1}' });
    expect(sandbox.hosts[0]?.options.features).toEqual(['webAnimations']);
  });

  it('uses the reported height for an auto-height widget and never for a fixed one', async () => {
    const auto = render(<WidgetMedia message={message(widgetMedia({ height: 0 }))} media={widgetMedia({ height: 0 })} />);
    await waitFor(() => expect(sandbox.hosts).toHaveLength(1));
    expect(auto.container.querySelector<HTMLElement>('[data-widget-message]')?.style.height).toBe('180px');
    sandbox.resize?.(240, 'top');
    await waitFor(() => expect(auto.container.querySelector<HTMLElement>('[data-widget-message]')?.style.height).toBe('240px'));
    auto.unmount();
    expect(sandbox.hosts[0]?.destroyed).toBe(true);

    sandbox.hosts.length = 0;
    const fixed = render(<WidgetMedia message={message(widgetMedia())} media={widgetMedia()} />);
    await waitFor(() => expect(sandbox.hosts).toHaveLength(1));
    sandbox.resize?.(999, 'top');
    expect(fixed.container.querySelector<HTMLElement>('[data-widget-message]')?.style.height).toBe('200px');
  });

  it('confirms an ordinary link before opening it', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(<WidgetMedia message={message(widgetMedia())} media={widgetMedia()} />);
    await waitFor(() => expect(sandbox.action).not.toBeNull());

    act(() => sandbox.action?.({ kind: 'openLink', url: 'https://example.com/page' }));
    expect(open).not.toHaveBeenCalled();
    // A plain substring query keeps the URL out of a regex: the dialog text
    // surrounds it with the rest of the confirmation sentence.
    expect(screen.getByText('https://example.com/page', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Link' }));
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
  });

  it('routes a Telegram link through the app before the browser', async () => {
    const handler = vi.fn(() => true);
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(
      <TelegramLinkProvider handler={handler}>
        <WidgetMedia message={message(widgetMedia())} media={widgetMedia()} />
      </TelegramLinkProvider>,
    );
    await waitFor(() => expect(sandbox.action).not.toBeNull());

    sandbox.action?.({ kind: 'openTelegramLink', url: 'https://t.me/announce/7' });
    expect(handler).toHaveBeenCalledWith('https://t.me/announce/7');
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to the labelled card when the payload cannot be inflated or the host dies', async () => {
    loader.inflate.mockRejectedValueOnce(new Error('no inflater'));
    const first = render(<WidgetMedia message={message(widgetMedia())} media={widgetMedia()} link="https://t.me/announce/7" />);
    expect(await screen.findByText("This Message Isn't Supported Yet")).toBeTruthy();
    expect(first.container.querySelector('[data-widget-message]')).toBeNull();
    first.unmount();

    const second = render(<WidgetMedia message={message(widgetMedia())} media={widgetMedia()} />);
    await waitFor(() => expect(sandbox.hosts).toHaveLength(1));
    act(() => sandbox.dead?.('stopped'));
    expect(await screen.findByText("This Message Isn't Supported Yet")).toBeTruthy();
    expect(second.container.querySelector('[data-widget-message]')).toBeNull();
  });
});
