import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageWebPage } from '../../apps/web/src/components/WebPagePreview';
import { TelegramLinkProvider } from '../../apps/web/src/telegram-links';
import type { MessageDto, MessageWebPageDto } from '../../apps/web/src/types';

/**
 * The link preview card: Telegram's copy of the page, linked whole. The photo
 * comes from `/user/file` with the preview's id as a cache-buster, so an edit
 * that changes the image never serves a stale one from the browser cache.
 */

afterEach(cleanup);

function message(): MessageDto {
  return {
    id: 10,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: 'Bob',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: 'https://example.com/article',
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

function page(overrides: Partial<MessageWebPageDto> = {}): MessageWebPageDto {
  return {
    url: 'https://example.com/article',
    displayUrl: 'example.com/article',
    siteName: 'Example',
    title: 'An article',
    description: 'A description',
    displaySize: 'default',
    photo: { id: '1234', width: 320, height: 200 },
    ...overrides,
  };
}

describe('MessageWebPage', () => {
  it('renders the page as one external link with its photo', () => {
    const { container } = render(<MessageWebPage message={message()} page={page()} />);

    const card = screen.getByRole('link');
    expect(card.getAttribute('href')).toBe('https://example.com/article');
    expect(card.getAttribute('target')).toBe('_blank');
    expect(card.getAttribute('rel')).toBe('noopener noreferrer');
    expect(card.textContent).toContain('Example');
    expect(card.textContent).toContain('An article');
    expect(card.textContent).toContain('A description');
    expect(card.textContent).toContain('example.com/article');

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('/user/file?chatId=2&messageId=10&v=1234');
    expect(image?.getAttribute('width')).toBe('320');
    expect(image?.getAttribute('height')).toBe('200');
    expect(image?.getAttribute('loading')).toBe('lazy');
  });

  it("keeps a small preview's thumbnail beside the text", () => {
    const { container } = render(<MessageWebPage message={message()} page={page({ displaySize: 'small' })} />);

    const card = container.querySelector('a');
    expect(card?.className).toContain('flex-row-reverse');
    expect(card?.className).not.toContain('flex-col');
  });

  it('puts the image above the text for a large preview', () => {
    const { container } = render(<MessageWebPage message={message()} page={page({ displaySize: 'large' })} />);

    const card = container.querySelector('a');
    expect(card?.className).toContain('flex-col');
    expect(card?.className).not.toContain('flex-row-reverse');
  });

  it('keeps a page without a photo as a text card', () => {
    const { container } = render(<MessageWebPage message={message()} page={page({ photo: null })} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.textContent).toContain('An article');
  });

  it('keeps a sparse page down to its display URL', () => {
    const sparse = page({ siteName: null, title: null, description: null, photo: null });
    const { container } = render(<MessageWebPage message={message()} page={sparse} />);

    expect(container.querySelector('a')?.textContent).toBe('example.com/article');
  });

  it('drops the image when it fails to load and keeps the card', () => {
    const { container } = render(<MessageWebPage message={message()} page={page()} />);

    fireEvent.error(container.querySelector('img') as Element);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.textContent).toContain('An article');
  });

  it('renders nothing for a URL that is not on the web', () => {
    const { container } = render(<MessageWebPage message={message()} page={page({ url: 'javascript:alert(1)' })} />);
    expect(container.firstChild).toBeNull();

    const telegram = render(<MessageWebPage message={message()} page={page({ url: 'tg://resolve?domain=telegram' })} />);
    expect(telegram.container.firstChild).toBeNull();
  });

  it("routes a Telegram link through the app's handler", () => {
    const handler = vi.fn(() => true);
    render(
      <TelegramLinkProvider handler={handler}>
        <MessageWebPage message={message()} page={page({ url: 'https://t.me/telegram' })} />
      </TelegramLinkProvider>,
    );

    expect(fireEvent.click(screen.getByRole('link'))).toBe(false);
    expect(handler).toHaveBeenCalledWith('https://t.me/telegram');
  });

  it('keeps the default new-tab behavior for an ordinary link', () => {
    render(<MessageWebPage message={message()} page={page()} />);

    expect(fireEvent.click(screen.getByRole('link'))).toBe(true);
  });
});
