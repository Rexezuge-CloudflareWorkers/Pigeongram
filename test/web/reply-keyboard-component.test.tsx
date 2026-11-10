import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyKeyboard } from '../../apps/web/src/components/ReplyKeyboard';
import type { ActiveReplyKeyboard } from '../../apps/web/src/reply-keyboard';
import type { MessageReplyKeyboardButtonDto } from '../../apps/web/src/types';

/**
 * The chat's reply keyboard, the custom keyboard a bot shows above the
 * composer. Text buttons send their text; web-view buttons are Mini Apps; the
 * kinds only the native app can honour are shown disabled with a reason.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function keyboard(rows: MessageReplyKeyboardButtonDto[][]): ActiveReplyKeyboard {
  return { messageId: 1, keyboard: { kind: 'keyboard', rows, oneTime: false, placeholder: null } };
}

function renderKeyboard(rows: MessageReplyKeyboardButtonDto[][], onPress = vi.fn()): ReturnType<typeof vi.fn> {
  render(<ReplyKeyboard keyboard={keyboard(rows)} onPress={onPress} />);
  return onPress;
}

describe('ReplyKeyboard', () => {
  it('renders every row as a group', () => {
    renderKeyboard([[{ text: 'Yes', style: null, kind: 'text' }], [{ text: 'No', style: null, kind: 'text' }]]);

    expect(screen.getByRole('group', { name: 'Bot keyboard' })).toBeDefined();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('sends the text of a text button', () => {
    const onPress = renderKeyboard([[{ text: 'Yes', style: null, kind: 'text' }]]);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    expect(onPress).toHaveBeenCalledWith({ text: 'Yes', style: null, kind: 'text' });
  });

  it('hands a Telegram-hosted web view to the installed app', () => {
    vi.useFakeTimers();
    renderKeyboard([[{ text: 'Launch', style: null, kind: 'webview', url: 'https://t.me/somebot/app' }]]);

    const link = screen.getByRole('link', { name: 'Launch' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(link)).toBe(false);

    expect(document.querySelector<HTMLIFrameElement>('iframe')?.src).toContain('tg://resolve');
    void act(() => vi.runAllTimers());
  });

  it('opens a non-Telegram web view as a normal link', () => {
    renderKeyboard([[{ text: 'Launch', style: null, kind: 'webview', url: 'https://example.com/app' }]]);

    const link = screen.getByRole('link', { name: 'Launch' });
    expect(fireEvent.click(link)).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('applies the requested emphasis to a button', () => {
    renderKeyboard([
      [{ text: 'Go', style: 'primary', kind: 'text' }],
      [{ text: 'Stop', style: 'danger', kind: 'text' }],
      [{ text: 'Ok', style: 'success', kind: 'text' }],
    ]);

    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Stop' }).className).toContain('bg-error-container');
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('bg-tertiary-container');
  });

  it('disables the kinds that need the native app and says why', () => {
    const cases: Array<[MessageReplyKeyboardButtonDto['kind'], string]> = [
      ['request_phone', 'Sharing a phone number needs the native app.'],
      ['request_geo', 'Sharing a location needs the native app.'],
      ['request_poll', 'Creating a poll needs the native app.'],
      ['request_peer', 'Choosing a chat needs the native app.'],
      ['unsupported', 'This button is not supported in this client.'],
    ];

    for (const [kind, reason] of cases) {
      cleanup();
      renderKeyboard([[{ text: 'Press', style: null, kind } as MessageReplyKeyboardButtonDto]]);
      const button = screen.getByRole('button', { name: 'Press' }) as HTMLButtonElement;
      expect(button.disabled, kind).toBe(true);
      expect(button.title, kind).toBe(reason);
    }
  });
});
