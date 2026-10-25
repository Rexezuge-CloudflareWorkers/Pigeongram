import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { MessageEntityDto } from './types';

/**
 * Rich-text rendering for message bodies.
 *
 * Telegram describes formatting and links as UTF-16 spans of the plain text
 * (`MessageEntityDto.offset`/`length`), so rendering means slicing `text` and
 * wrapping the entity segments. The walk is a stack pass: properly nested
 * entities (a link inside bold inside a quote) nest naturally, and malformed
 * or overlapping spans degrade to plain text instead of throwing.
 */

interface Span {
  entity: MessageEntityDto;
  start: number;
  end: number;
}

interface OpenSpan {
  span: Span;
  children: ReactNode[];
}

const SAFE_SCHEME = /^(?:https?|mailto|tel|tg):/i;
const HAS_SCHEME = /^[a-z][\d+.a-z-]*:/i;
const EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
const USERNAME = /^\w{3,}$/i;

/**
Entity kinds that map straight onto a formatting tag; everything else is
either a link (`linkHref`) or plain text.
*/
const FORMAT_TAG: Partial<Record<MessageEntityDto['kind'], 'b' | 'i' | 'u' | 's' | 'span' | 'code' | 'pre' | 'blockquote'>> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strikethrough: 's',
  spoiler: 'span',
  code: 'code',
  pre: 'pre',
  blockquote: 'blockquote',
};

/**
Only `http(s)`, `mailto`, `tel` and `tg` URLs become anchors — anything else
(`javascript:`, `data:`) renders as plain text.
*/
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

function urlHref(text: string): string | null {
  return safeHref(HAS_SCHEME.test(text) ? text : `https://${text}`);
}

function emailHref(text: string): string | null {
  return EMAIL.test(text) ? `mailto:${text}` : null;
}

function mentionHref(text: string): string | null {
  const name = text.replace(/^@/, '');
  return USERNAME.test(name) ? `https://t.me/${name}` : null;
}

function phoneHref(text: string): string | null {
  const digits = text.replaceAll(/[^\d+]/g, '');
  return digits.length >= 5 ? `tel:${digits}` : null;
}

/**
Clamps entities to the text and drops empty ones, then orders them so a
containing span always precedes the ones it contains.
*/
function clampSpans(text: string, entities: MessageEntityDto[]): Span[] {
  const spans: Span[] = [];
  for (const entity of entities) {
    const start = Math.max(0, Math.min(text.length, Math.trunc(entity.offset)));
    const end = Math.max(start, Math.min(text.length, Math.trunc(entity.offset + entity.length)));
    if (end > start) spans.push({ entity, start, end });
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
Renders `text` as React nodes: entity spans become formatting elements or
anchors, everything else stays a plain string (React escapes it).

`onLinkClick` lets the caller route an anchor click: it receives the href and
returns whether it handled it — a `true` cancels the browser's new-tab
navigation, a `false` (or no handler) keeps it.
*/
export function renderMessageText(text: string, entities: MessageEntityDto[], onLinkClick?: LinkClickHandler): ReactNode[] {
  return entities.length === 0 ? [text] : renderSpans(text, clampSpans(text, entities), onLinkClick);
}

/**
Decision made by a link click's router: `true` means the click was handled and
the anchor's default navigation must not happen.
*/
export type LinkClickHandler = (href: string) => boolean;

function renderSpans(text: string, spans: Span[], onLinkClick?: LinkClickHandler): ReactNode[] {
  const nodes: ReactNode[] = [];
  const stack: OpenSpan[] = [];
  let key = 0;
  let pos = 0;

  const push = (node: ReactNode): void => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else nodes.push(node);
  };

  // Closes every open span that ends at or before `limit`, attaching their
  // text and nested output to their parent.
  const closeThrough = (limit: number): void => {
    while (stack.length > 0 && (stack.at(-1) as OpenSpan).span.end <= limit) {
      const top = stack.pop() as OpenSpan;
      const tail = text.slice(pos, top.span.end);
      if (tail) top.children.push(tail);
      pos = Math.max(pos, top.span.end);
      push(wrapSpan(top.span, text.slice(top.span.start, top.span.end), top.children, key, onLinkClick));
      key += 1;
    }
  };

  for (const span of spans) {
    if (span.start < pos) continue; // overlapping malformed span: keep the text plain
    closeThrough(span.start);
    if (span.start > pos) push(text.slice(pos, span.start));
    stack.push({ span, children: [] });
    pos = span.start;
  }
  closeThrough(Infinity);
  if (pos < text.length) push(text.slice(pos));
  return nodes;
}

function wrapSpan(span: Span, spanText: string, children: ReactNode[], key: number, onLinkClick?: LinkClickHandler): ReactNode {
  const { entity } = span;
  const href = linkHref(entity, spanText);
  if (href) {
    const onClick =
      onLinkClick === undefined
        ? undefined
        : (event: { preventDefault: () => void }): void => {
            if (onLinkClick(href)) event.preventDefault();
          };
    return createElement(
      'a',
      { href, key, target: '_blank', rel: 'noopener noreferrer', ...(onClick !== undefined && { onClick }) },
      children,
    );
  }
  const tag = FORMAT_TAG[entity.kind];
  if (!tag) {
    // Not styled (hashtag, bot command, custom emoji, unknown kinds…):
    // render the plain text so nothing is ever lost.
    return createElement('span', { key }, children);
  }
  return createElement(tag, { key, className: entity.kind === 'spoiler' ? 'spoiler' : undefined }, children);
}

function linkHref(entity: MessageEntityDto, spanText: string): string | null {
  switch (entity.kind) {
    case 'text_link': {
      return entity.url ? safeHref(entity.url) : null;
    }
    case 'url': {
      return urlHref(spanText);
    }
    case 'email': {
      return emailHref(spanText);
    }
    case 'mention': {
      return mentionHref(spanText);
    }
    case 'phone_number': {
      return phoneHref(spanText);
    }
    default: {
      return null;
    }
  }
}
