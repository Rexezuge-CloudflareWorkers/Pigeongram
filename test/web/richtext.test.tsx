import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMessageText } from '../../pages/src/richtext';
import type { LinkClickHandler } from '../../pages/src/richtext';
import type { MessageEntityDto } from '../../pages/src/types';

function body(text: string, entities: MessageEntityDto[], onLinkClick?: LinkClickHandler): HTMLElement {
  const { container } = render(<div data-testid="body">{renderMessageText(text, entities, onLinkClick)}</div>);
  return container;
}

afterEach(cleanup);

describe('renderMessageText', () => {
  it('returns plain text when there are no entities', () => {
    const container = body('just text', []);
    expect(container.textContent).toBe('just text');
    expect(container.querySelector('b, i, a, code, pre, blockquote, .spoiler')).toBeNull();
  });

  it('wraps formatting entities', () => {
    const container = body('bold world', [
      { offset: 0, length: 4, kind: 'bold' },
      { offset: 5, length: 5, kind: 'italic' },
    ]);
    expect(container.querySelector('b')?.textContent).toBe('bold');
    expect(container.querySelector('i')?.textContent).toBe('world');
    expect(container.textContent).toBe('bold world');
  });

  it('renders a text_link as a safe external anchor', () => {
    const container = body('see docs', [{ offset: 0, length: 8, kind: 'text_link', url: 'https://example.com/docs' }]);
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('derives hrefs for url, email and mention entities', () => {
    const container = body('example.com a@b.co @ada', [
      { offset: 0, length: 11, kind: 'url' },
      { offset: 12, length: 6, kind: 'email' },
      { offset: 19, length: 4, kind: 'mention' },
    ]);
    const hrefs = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com', 'mailto:a@b.co', 'https://t.me/ada']);
  });

  it('refuses unsafe link schemes but keeps the text', () => {
    const container = body('click me', [{ offset: 0, length: 8, kind: 'text_link', url: 'javascript:alert(1)' }]);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('click me');
  });

  it('renders a tg:// deep link as an anchor, like the app expects', () => {
    const container = body('open tg', [{ offset: 0, length: 7, kind: 'text_link', url: 'tg://resolve?domain=durov' }]);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('tg://resolve?domain=durov');
  });

  it('lets the router swallow a link click', () => {
    const handler = vi.fn(() => true);
    const container = body('see example.com', [{ offset: 4, length: 11, kind: 'url' }], handler);
    const anchor = container.querySelector('a');
    // `fireEvent.click` answers `false` when the event was canceled, i.e. the
    // browser's new-tab navigation was prevented.
    expect(fireEvent.click(anchor as Element)).toBe(false);
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
    expect(handler).toHaveBeenCalledWith('https://example.com');
  });

  it('keeps the default navigation when the router declines the link', () => {
    const handler = vi.fn(() => false);
    const container = body('see example.com', [{ offset: 4, length: 11, kind: 'url' }], handler);
    expect(fireEvent.click(container.querySelector('a') as Element)).toBe(true);
    expect(handler).toHaveBeenCalledWith('https://example.com');
  });

  it('nests entities inside one another', () => {
    const container = body('hello world', [
      { offset: 0, length: 11, kind: 'bold' },
      { offset: 6, length: 5, kind: 'text_link', url: 'https://example.com' },
    ]);
    const anchor = container.querySelector(':scope b a');
    expect(anchor?.textContent).toBe('world');
    expect(container.textContent).toBe('hello world');
  });

  it('renders spoilers, code blocks and quotes', () => {
    const container = body('sh code quote', [
      { offset: 0, length: 2, kind: 'spoiler' },
      { offset: 3, length: 4, kind: 'pre', language: 'ts' },
      { offset: 8, length: 5, kind: 'blockquote' },
    ]);
    expect(container.querySelector('.spoiler')?.textContent).toBe('sh');
    expect(container.querySelector('pre')?.textContent).toBe('code');
    expect(container.querySelector('blockquote')?.textContent).toBe('quote');
  });

  it('drops malformed entities without losing text', () => {
    const container = body('abcdef', [
      { offset: 99, length: 5, kind: 'bold' },
      { offset: 2, length: 0, kind: 'italic' },
      { offset: -4, length: 3, kind: 'code' },
    ]);
    expect(container.querySelector('b, i, code')).toBeNull();
    expect(container.textContent).toBe('abcdef');
  });

  it('escapes markup in message text', () => {
    const container = body('<img src=x onerror="boom">', []);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="boom">');
  });
});
