import type { Message } from '@mtcute/core';
import type { tl } from '@mtcute/core';
import type { MessageButtonDto, MessageButtonStyle, MessageMarkupDto } from '../types';

/**
 * Inline keyboard mapping, split from `dto.ts` to keep the message mapper under
 * the god-file cap.
 */

export function toMessageMarkupDto(message: Message): MessageMarkupDto | null {
  const markup = message.markup;
  if (markup === null || markup.type !== 'inline') return null;
  const rows = markup.buttons
    .map((row) => row.map(toMessageButtonDto).filter((button): button is MessageButtonDto => button !== null))
    .filter((row) => row.length > 0);
  return rows.length > 0 ? { rows } : null;
}

function toMessageButtonDto(button: tl.TypeKeyboardInlineButton): MessageButtonDto | null {
  if (button._ !== 'keyboardInlineButton') return null;
  const style = toMessageButtonStyle(button.style);
  const base = { text: button.text, style };
  const type = button.type;
  switch (type._) {
    case 'inlineButtonTypeCallback': {
      return {
        ...base,
        kind: 'callback',
        data: toBase64(type.data),
        requiresPassword: type.requiresPassword === true,
      };
    }
    case 'inlineButtonTypeUrl': {
      return { ...base, kind: 'url', url: type.url };
    }
    case 'inlineButtonTypeWebView': {
      return { ...base, kind: 'webview', url: type.url };
    }
    case 'inlineButtonTypeCopy': {
      return { ...base, kind: 'copy', copyText: type.copyText.length > 0 ? type.copyText : button.text };
    }
    case 'inlineButtonTypeSwitchInline': {
      return { ...base, kind: 'switch_inline', query: type.query, samePeer: type.samePeer === true };
    }
    case 'inlineButtonTypeUrlAuth': {
      return { ...base, kind: 'url_auth', url: type.url };
    }
    case 'inlineButtonTypeUserProfile': {
      return { ...base, kind: 'user_profile', userId: type.userId };
    }
    case 'inlineButtonTypeGame': {
      return { ...base, kind: 'game' };
    }
    case 'inlineButtonTypeBuy': {
      return { ...base, kind: 'pay' };
    }
    case 'inlineButtonTypeDisabled': {
      return { ...base, kind: 'disabled' };
    }
    default: {
      return null;
    }
  }
}

function toMessageButtonStyle(style: tl.TypeKeyboardButtonStyle | undefined): MessageButtonStyle | null {
  if (style?.bgDanger === true) return 'danger';
  if (style?.bgSuccess === true) return 'success';
  if (style?.bgPrimary === true) return 'primary';
  return null;
}

/**
Callback payloads are opaque bytes; base64 is the JSON-safe carrier the SPA
sends back untouched.
*/
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
