import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageText } from '../../apps/web/src/components/MessageText';
import { TelegramLinkProvider } from '../../apps/web/src/telegram-links';

afterEach(cleanup);

describe('MessageText', () => {
  it('routes a Telegram link through the provider and swallows the click', () => {
    const handler = vi.fn(() => true);
    const { container } = render(
      <TelegramLinkProvider handler={handler}>
        <MessageText text="@ada" entities={[{ offset: 0, length: 4, kind: 'mention' }]} />
      </TelegramLinkProvider>,
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://t.me/ada');
    expect(fireEvent.click(anchor as Element)).toBe(false);
    expect(handler).toHaveBeenCalledWith('https://t.me/ada');
  });

  it('keeps the default new-tab behavior without a provider', () => {
    const { container } = render(<MessageText text="see example.com" entities={[{ offset: 4, length: 11, kind: 'url' }]} />);
    expect(fireEvent.click(container.querySelector('a') as Element)).toBe(true);
  });

  it('routes a hashtag through the provider', () => {
    const onHashtag = vi.fn();
    const { container } = render(
      <TelegramLinkProvider handler={() => false} onHashtag={onHashtag}>
        <MessageText text="try #cloudflare" entities={[{ offset: 4, length: 11, kind: 'hashtag' }]} />
      </TelegramLinkProvider>,
    );
    const button = container.querySelector('button.hashtag');
    expect(button?.textContent).toBe('#cloudflare');
    fireEvent.click(button as Element);
    expect(onHashtag).toHaveBeenCalledWith('#cloudflare');
  });
});
