import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageButtons } from '../../apps/web/src/components/MessageButtons';
import { TelegramLinkProvider } from '../../apps/web/src/telegram-links';
import type { MessageButtonDto, MessageDto, MessageMarkupDto } from '../../apps/web/src/types';

/**
 * The inline keyboard under a message bubble.
 *
 * The kinds Telegram can send split into three behaviours: a link the app may
 * claim, a Mini App handed to the installed app, and a button the browser
 * cannot honour (shown disabled with a reason).
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function message(): MessageDto {
  return {
    id: 7,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bot',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    editDate: null,
    text: 'Pick one',
    entities: [],
    reactions: [],
    service: false,
    media: null,
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

function markup(rows: MessageButtonDto[][]): MessageMarkupDto {
  return { rows };
}

function renderButtons(
  rows: MessageButtonDto[][],
  options: {
    pressing?: boolean;
    onPress?: (message: MessageDto, button: MessageButtonDto) => void;
    handler?: (url: string) => boolean;
  } = {},
): void {
  render(
    <TelegramLinkProvider handler={options.handler ?? (() => false)}>
      <MessageButtons message={message()} markup={markup(rows)} pressing={options.pressing} onPress={options.onPress} />
    </TelegramLinkProvider>,
  );
}

describe('MessageButtons', () => {
  it('lets the link router claim a URL button it knows', () => {
    const handler = vi.fn(() => true);
    renderButtons([[{ kind: 'url', url: 'https://t.me/bob', text: 'Open', style: null }]], { handler });

    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(link)).toBe(false);
    expect(handler).toHaveBeenCalledWith('https://t.me/bob');
  });

  it('leaves an ordinary web link to the browser', () => {
    const handler = vi.fn(() => false);
    renderButtons([[{ kind: 'url', url: 'https://example.com', text: 'Open', style: null }]], { handler });

    expect(fireEvent.click(screen.getByRole('link', { name: 'Open' }))).toBe(true);
    expect(handler).toHaveBeenCalledWith('https://example.com');
  });

  it('hands a Telegram Mini App to the installed app', () => {
    vi.useFakeTimers();
    renderButtons([[{ kind: 'webview', url: 'https://t.me/somebot/app', text: 'Launch', style: null }]]);

    const link = screen.getByRole('link', { name: 'Launch' });
    expect(fireEvent.click(link)).toBe(false);

    const frame = document.querySelector<HTMLIFrameElement>('iframe');
    expect(frame?.src).toContain('tg://resolve');
    void act(() => vi.runAllTimers());
  });

  it('opens a non-Telegram web view as a normal link', () => {
    renderButtons([[{ kind: 'webview', url: 'https://example.com/app', text: 'Launch', style: null }]]);

    expect(fireEvent.click(screen.getByRole('link', { name: 'Launch' }))).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('runs a callback button and reports the press', () => {
    const onPress = vi.fn();
    renderButtons([[{ kind: 'callback', data: 'payload', requiresPassword: false, text: 'Press', style: 'primary' }]], { onPress });

    const button = screen.getByRole('button', { name: 'Press' });
    expect(button.className).toContain('primary');
    fireEvent.click(button);

    expect(onPress).toHaveBeenCalledWith(message(), expect.objectContaining({ kind: 'callback' }));
  });

  it('runs a copy button through the same controller', () => {
    const onPress = vi.fn();
    renderButtons([[{ kind: 'copy', copyText: 'text', text: 'Copy', style: null }]], { onPress });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('marks a callback in flight as busy and disables it', () => {
    renderButtons([[{ kind: 'callback', data: 'payload', requiresPassword: false, text: 'Press', style: null }]], {
      pressing: true,
      onPress: () => {},
    });

    const button = screen.getByRole('button', { name: 'Press' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Sending…');
  });

  it('refuses a password-protected callback in the browser', () => {
    renderButtons([[{ kind: 'callback', data: 'payload', requiresPassword: true, text: 'Press', style: null }]], { onPress: () => {} });

    const button = screen.getByRole('button', { name: 'Press' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Telegram password');
  });

  it('disables buttons in a view with no press handler', () => {
    renderButtons([[{ kind: 'callback', data: 'payload', requiresPassword: false, text: 'Press', style: null }]]);

    const button = screen.getByRole('button', { name: 'Press' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Buttons are not available in this view.');
  });

  it('explains every kind the browser cannot honour', () => {
    const cases: Array<[MessageButtonDto['kind'], string]> = [
      ['game', 'Telegram games need the native app.'],
      ['pay', 'Telegram payments need the native app.'],
      ['switch_inline', 'Inline mode is not supported in this client.'],
      ['url_auth', 'Telegram login buttons need the native app.'],
      ['user_profile', 'Profiles are not supported in this client.'],
      ['disabled', 'This button is disabled by the bot.'],
    ];
    for (const [kind, reason] of cases) {
      cleanup();
      renderButtons([[{ kind, text: 'Press', style: null } as unknown as MessageButtonDto]], { onPress: () => {} });
      const button = screen.getByRole('button', { name: 'Press' }) as HTMLButtonElement;
      expect(button.disabled, kind).toBe(true);
      expect(button.title, kind).toBe(reason);
    }
  });
});
