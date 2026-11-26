import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageButtonDto, MessageDto } from '../../apps/web/src/types';

const pressCallbackButton = vi.fn<() => Promise<{ url: string | null; text: string | null; alert: boolean }>>();
const open = vi.fn<() => Window | null>();

vi.mock('../../apps/web/src/api', () => ({ pressCallbackButton }));

const { useMessageButtons } = await import('../../apps/web/src/useMessageButtons');

const message: MessageDto = {
  id: 1,
  chatId: 2,
  groupedId: null,
  senderId: 2,
  senderName: 'Bot',
  senderPhoto: null,
  outgoing: false,
  date: 1_700_000_000_000,
  pinned: false,
  editDate: null,
  text: 'Press',
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

const button: MessageButtonDto = { kind: 'callback', data: 'AQID', requiresPassword: false, text: 'Press', style: null };

describe('useMessageButtons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    pressCallbackButton.mockReset();
    open.mockReset();
    vi.stubGlobal('open', open);
  });

  it('opens an allowlisted URL a bot returned', async () => {
    pressCallbackButton.mockResolvedValue({ url: 'https://example.com', text: null, alert: false });
    const { result } = renderHook(() => useMessageButtons(vi.fn(), vi.fn()));

    await act(async () => {
      result.current.press(message, button);
    });

    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('ignores an unsafe URL a bot returned', async () => {
    pressCallbackButton.mockResolvedValue({ url: 'javascript:alert(1)', text: null, alert: false });
    const { result } = renderHook(() => useMessageButtons(vi.fn(), vi.fn()));

    await act(async () => {
      result.current.press(message, button);
    });

    expect(open).not.toHaveBeenCalled();
  });
});
