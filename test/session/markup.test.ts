import { describe, expect, it } from 'vitest';
import type { Message } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import { toMessageMarkupDto } from '../../packages/backend-services/src/session/markup';

/**
 * The inline keyboard mapper: every button kind Telegram can put on a
 * message, and the rows that do not survive the mapping.
 */

function message(markup: unknown): Message {
  return { markup } as unknown as Message;
}

function button(type: unknown, overrides: Record<string, unknown> = {}): tl.TypeKeyboardInlineButton {
  return {
    _: 'keyboardInlineButton',
    text: 'Press',
    type,
    ...overrides,
  } as unknown as tl.TypeKeyboardInlineButton;
}

function inline(buttons: tl.TypeKeyboardInlineButton[][], style?: unknown): Message {
  return message({
    type: 'inline',
    buttons,
    ...(style !== undefined && { style }),
  });
}

describe('toMessageMarkupDto', () => {
  it('returns nothing when there is no inline keyboard', () => {
    expect(toMessageMarkupDto(message(null))).toBeNull();
    expect(toMessageMarkupDto(message({ type: 'reply', buttons: [] }))).toBeNull();
    expect(toMessageMarkupDto(inline([]))).toBeNull();
    expect(toMessageMarkupDto(inline([[]]))).toBeNull();
  });

  it('drops a button that is not an inline button and a row that becomes empty', () => {
    const nonInline = { _: 'keyboardButton', text: 'Other' } as unknown as tl.TypeKeyboardInlineButton;
    expect(toMessageMarkupDto(inline([[nonInline]]))).toBeNull();

    const mapped = toMessageMarkupDto(inline([[nonInline, button({ _: 'inlineButtonTypeUrl', url: 'https://example.com' })]]));
    expect(mapped?.rows).toEqual([[{ text: 'Press', style: null, kind: 'url', url: 'https://example.com' }]]);
  });

  it('maps every button kind the SPA understands', () => {
    const data = new Uint8Array([1, 2, 3]);
    const mapped = toMessageMarkupDto(
      inline([
        [
          button({ _: 'inlineButtonTypeCallback', data, requiresPassword: true }),
          button({ _: 'inlineButtonTypeUrl', url: 'https://example.com' }),
          button({ _: 'inlineButtonTypeWebView', url: 'https://example.com/web' }),
        ],
        [
          button({ _: 'inlineButtonTypeCopy', copyText: 'copied' }),
          button({ _: 'inlineButtonTypeCopy', copyText: '' }),
          button({ _: 'inlineButtonTypeSwitchInline', query: 'query', samePeer: true }),
        ],
        [
          button({ _: 'inlineButtonTypeSwitchInline', query: 'query', samePeer: false }),
          button({ _: 'inlineButtonTypeUrlAuth', url: 'https://example.com/auth' }),
          button({ _: 'inlineButtonTypeUserProfile', userId: 7 }),
        ],
        [button({ _: 'inlineButtonTypeGame' }), button({ _: 'inlineButtonTypeBuy' }), button({ _: 'inlineButtonTypeDisabled' })],
      ]),
    );

    expect(mapped?.rows).toEqual([
      [
        { text: 'Press', style: null, kind: 'callback', data: 'AQID', requiresPassword: true },
        { text: 'Press', style: null, kind: 'url', url: 'https://example.com' },
        { text: 'Press', style: null, kind: 'webview', url: 'https://example.com/web' },
      ],
      [
        { text: 'Press', style: null, kind: 'copy', copyText: 'copied' },
        { text: 'Press', style: null, kind: 'copy', copyText: 'Press' },
        { text: 'Press', style: null, kind: 'switch_inline', query: 'query', samePeer: true },
      ],
      [
        { text: 'Press', style: null, kind: 'switch_inline', query: 'query', samePeer: false },
        { text: 'Press', style: null, kind: 'url_auth', url: 'https://example.com/auth' },
        { text: 'Press', style: null, kind: 'user_profile', userId: 7 },
      ],
      [
        { text: 'Press', style: null, kind: 'game' },
        { text: 'Press', style: null, kind: 'pay' },
        { text: 'Press', style: null, kind: 'disabled' },
      ],
    ]);
  });

  it('maps the four button styles', () => {
    const url = { _: 'inlineButtonTypeUrl', url: 'https://example.com' };
    const mapped = toMessageMarkupDto(
      inline(
        [
          [button(url, { style: { bgDanger: true } })],
          [button(url, { style: { bgSuccess: true } })],
          [button(url, { style: { bgPrimary: true } })],
          [button(url, { style: {} })],
        ],
        { bgDanger: true },
      ),
    );

    expect(mapped?.rows.map((row) => row[0]?.style)).toEqual(['danger', 'success', 'primary', null]);
  });

  it('drops an unknown button type without dropping its row', () => {
    const mapped = toMessageMarkupDto(inline([[button({ _: 'inlineButtonTypeFuture' }), button({ _: 'inlineButtonTypeGame' })]]));
    expect(mapped?.rows).toEqual([[{ text: 'Press', style: null, kind: 'game' }]]);
  });
});
