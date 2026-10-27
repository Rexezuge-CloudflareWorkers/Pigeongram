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

`handlers` lets the caller route a click: `onLinkClick` receives an anchor's
href and returns whether it handled it (a `true` cancels the browser's new-tab
navigation), and `onHashtagClick` receives a hashtag's text so the app can
search for it.
*/
export function renderMessageText(text: string, entities: MessageEntityDto[], handlers?: RichTextHandlers): ReactNode[] {
  return entities.length === 0 ? [text] : renderSpans(text, clampSpans(text, entities), handlers);
}

/**
Decision made by a link click's router: `true` means the click was handled and
the anchor's default navigation must not happen.
*/
export type LinkClickHandler = (href: string) => boolean;

/**
Receives a hashtag's text (with its leading `#`) when the reader taps it.
*/
export type HashtagClickHandler = (hashtag: string) => void;

/**
What the app routes inside a message body. Both handlers are optional: without
one the text still renders, and the affordance keeps its default behavior (a
link) or stays inert (a hashtag).
*/
export interface RichTextHandlers {
  onLinkClick?: LinkClickHandler;
  onHashtagClick?: HashtagClickHandler;
}

function renderSpans(text: string, spans: Span[], handlers?: RichTextHandlers): ReactNode[] {
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
      push(wrapSpan(top.span, text.slice(top.span.start, top.span.end), top.children, key, handlers));
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

function wrapSpan(span: Span, spanText: string, children: ReactNode[], key: number, handlers?: RichTextHandlers): ReactNode {
  const { entity } = span;
  const href = linkHref(entity, spanText);
  if (href) {
    const onLinkClick = handlers?.onLinkClick;
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
  if (entity.kind === 'hashtag') {
    // Telegram's own search takes the tag with its `#`; the entity text is
    // exactly that, so the handler gets it verbatim.
    const hashtag = spanText.trim();
    const onHashtagClick = handlers?.onHashtagClick;
    if (onHashtagClick !== undefined && hashtag.length > 1) {
      return createElement('button', { type: 'button', key, className: 'hashtag', onClick: () => onHashtagClick(hashtag) }, children);
    }
    return createElement('span', { key, className: 'hashtag' }, children);
  }
  const tag = FORMAT_TAG[entity.kind];
  if (!tag) {
    // Not styled (bot command, cashtag, custom emoji, unknown kinds…):
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
