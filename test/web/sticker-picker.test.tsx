import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StickerDto, StickerLibraryDto, StickerSetDto } from '../../apps/web/src/types';

/**
 * The composer's sticker and emoji picker.
 *
 * The popover reads its library once, opens a brief pack by reading it in full,
 * and names a sticker by the decimal document id the engine minted. These cases
 * pin that read flow, the emoji insert that leaves the panel open, and the
 * Escape/outside-press close.
 */

const bridge = vi.hoisted(() => ({
  fetchStickerLibrary: vi.fn(),
  fetchStickerSet: vi.fn(),
  stickerUrl: (id: string, version: string) => `/user/sticker?documentId=${id}&v=${version}&thumb=1`,
}));

vi.mock('../../apps/web/src/api', () => bridge);

const { StickerPicker } = await import('../../apps/web/src/components/StickerPicker');
const { Composer } = await import('../../apps/web/src/components/Composer');
const { EmojiPicker } = await import('../../apps/web/src/components/EmojiPicker');

afterEach(() => {
  cleanup();
  bridge.fetchStickerLibrary.mockReset();
  bridge.fetchStickerSet.mockReset();
});

function sticker(id: number, emoji: string | null = '🙂'): StickerDto {
  return { id: String(id), emoji, kind: 'static', width: 512, height: 512, version: `v${String(id)}` };
}

function pack(id: number, overrides: Partial<StickerSetDto> = {}): StickerSetDto {
  return {
    id: String(id),
    accessHash: String(id * 10),
    shortName: `pack${String(id)}`,
    title: `Pack ${String(id)}`,
    kind: 'sticker',
    count: 2,
    installed: true,
    thumb: sticker(id * 100),
    stickers: [],
    ...overrides,
  };
}

function library(overrides: Partial<StickerLibraryDto> = {}): StickerLibraryDto {
  return { recent: [sticker(1)], faved: [], sets: [pack(10), pack(11)], ...overrides };
}

function renderPicker(
  options: {
    stickersEnabled?: boolean;
    onSendSticker?: (sticker: StickerDto, set: { id: string; accessHash: string } | null) => void;
  } = {},
) {
  const onSendSticker = options.onSendSticker ?? vi.fn();
  render(
    <StickerPicker
      stickersEnabled={options.stickersEnabled ?? true}
      onClose={vi.fn()}
      onPickEmoji={vi.fn()}
      onSendSticker={onSendSticker}
    />,
  );
  return { onSendSticker };
}

describe('the sticker picker', () => {
  it('lists recents and the installed packs from one library read', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    renderPicker();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '🙂 sticker' })).toBeTruthy();
    });
    expect(bridge.fetchStickerLibrary).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pack 10' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pack 11' })).toBeTruthy();
  });

  it('sends a recent sticker with no pack identity', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    const { onSendSticker } = renderPicker();

    const cell = await screen.findByRole('button', { name: '🙂 sticker' });
    fireEvent.click(cell);

    expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), null);
  });

  it('reads a brief pack when it is opened and sends with its identity', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    bridge.fetchStickerSet.mockResolvedValue(pack(10, { stickers: [sticker(101, '😺'), sticker(102, '😸')] }));
    const { onSendSticker } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Pack 10' }));

    const cell = await screen.findByRole('button', { name: '😺 sticker' });
    expect(bridge.fetchStickerSet).toHaveBeenCalledWith({ id: '10', accessHash: '100' });

    fireEvent.click(cell);

    expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: '101' }), {
      id: '10',
      accessHash: '100',
    });
  });

  it('returns from the emoji tab the same way it left', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Emoji' }));
    expect(screen.getByPlaceholderText('Search Emoji')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stickers' }));
    expect(screen.getByPlaceholderText('Search Sticker Packs')).toBeTruthy();
  });

  it('opens an already-full pack without reading it again, and goes back to the list', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library({ recent: [], sets: [pack(10, { stickers: [sticker(101, '😺')] })] }));
    const { onSendSticker } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Pack 10' }));
    await screen.findByRole('button', { name: '😺 sticker' });
    expect(bridge.fetchStickerSet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back to packs' }));
    expect(screen.getByRole('button', { name: 'Pack 10' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pack 10' }));
    fireEvent.click(await screen.findByRole('button', { name: '😺 sticker' }));
    expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: '101' }), {
      id: '10',
      accessHash: '100',
    });
  });

  it('filters the pack list by title', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    renderPicker();

    await screen.findByRole('button', { name: 'Pack 10' });
    fireEvent.change(screen.getByPlaceholderText('Search Sticker Packs'), { target: { value: 'pack 11' } });

    expect(screen.queryByRole('button', { name: 'Pack 10' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pack 11' })).toBeTruthy();
  });

  it('reports a library the bridge refused instead of an empty list', async () => {
    bridge.fetchStickerLibrary.mockRejectedValue(new Error('the bridge is offline'));
    renderPicker();

    await screen.findByText('the bridge is offline');
  });

  it('shows the emoji tab without reading the library when stickers are withheld', async () => {
    renderPicker({ stickersEnabled: false });

    expect(screen.getByPlaceholderText('Search Emoji')).toBeTruthy();
    expect(bridge.fetchStickerLibrary).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stickers' })).toBeNull();
  });

  it('closes on Escape', () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    const onClose = vi.fn();
    render(<StickerPicker stickersEnabled onClose={onClose} onPickEmoji={vi.fn()} onSendSticker={vi.fn()} />);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(onClose).toHaveBeenCalled();
  });
});

describe('the composer picker button', () => {
  function renderComposer(
    onSendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null) => Promise<void> = vi.fn(async () => {}),
  ) {
    render(
      <Composer
        placeholder="Message"
        replyTarget={null}
        botCommands={[]}
        onCancelReply={() => {
          // Not exercised here.
        }}
        onSend={async () => {
          // Not exercised here.
        }}
        onAttach={async () => {
          // Not exercised here.
        }}
        onSendSticker={onSendSticker}
      />,
    );
    return onSendSticker;
  }

  it('opens the picker and inserts an emoji at the caret without closing it', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Sticker and emoji picker' }));
    const dialog = screen.getByRole('dialog', { name: 'Stickers and emoji' });
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
    fireEvent.change(screen.getByPlaceholderText('Search Emoji'), { target: { value: 'pizza' } });
    fireEvent.click(await screen.findByRole('button', { name: 'pizza' }));

    const field = screen.getByPlaceholderText('Message') as HTMLTextAreaElement;
    expect(field.value).toBe('🍕');
    // The panel is still there for the next emoji.
    expect(screen.getByRole('dialog', { name: 'Stickers and emoji' })).toBeTruthy();
  });

  it('sends a sticker from the composer and closes the panel', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    const onSendSticker = renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Sticker and emoji picker' }));
    fireEvent.click(await screen.findByRole('button', { name: '🙂 sticker' }));

    expect(onSendSticker).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), null, undefined);
    expect(screen.queryByRole('dialog', { name: 'Stickers and emoji' })).toBeNull();
  });

  it('offers no sticker tab while a message is being edited', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    render(
      <Composer
        placeholder="Message"
        replyTarget={null}
        botCommands={[]}
        editTarget={{
          id: 7,
          chatId: 1,
          groupedId: null,
          senderId: null,
          senderName: null,
          senderPhoto: null,
          outgoing: true,
          date: 1_700_000_000_000,
          pinned: false,
          editDate: null,
          text: 'draft',
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
        }}
        onCancelReply={() => {
          // Not exercised here.
        }}
        onSend={async () => {
          // Not exercised here.
        }}
        onAttach={async () => {
          // Not exercised here.
        }}
        onSendSticker={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sticker and emoji picker' }));

    expect(screen.getByPlaceholderText('Search Emoji')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stickers' })).toBeNull();
  });
});

describe('the sticker library states', () => {
  it('shows the saved stickers above the packs', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library({ faved: [sticker(2, '⭐')], sets: [] }));
    renderPicker();

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByRole('button', { name: '⭐ sticker' })).toBeTruthy();
    expect(screen.getByText('No Sticker Packs.')).toBeTruthy();
  });

  it('shows a placeholder when a pack has no cover', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library({ recent: [], sets: [pack(12, { thumb: null })] }));
    renderPicker();

    expect(await screen.findByRole('button', { name: 'Pack 12' })).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('reports a pack the bridge refused', async () => {
    bridge.fetchStickerLibrary.mockResolvedValue(library());
    bridge.fetchStickerSet.mockRejectedValue(new Error('the pack is gone'));
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: 'Pack 10' }));

    await screen.findByText('the pack is gone');
  });
});

describe('the emoji picker', () => {
  it('offers recents, category tabs and a search with no matches', () => {
    localStorage.setItem('pigeongram-recent-emoji', JSON.stringify(['🍕']));
    render(<EmojiPicker onPick={vi.fn()} />);

    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Emoji 🍕' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Symbols' }));
    expect(screen.getByRole('tab', { name: 'Symbols' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.change(screen.getByPlaceholderText('Search Emoji'), { target: { value: 'zzzznotanemoji' } });
    expect(screen.getByText('No Emoji Found.')).toBeTruthy();
  });

  it('remembers a picked emoji', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.change(screen.getByPlaceholderText('Search Emoji'), { target: { value: 'pizza' } });
    fireEvent.click(screen.getByRole('button', { name: 'pizza' }));

    expect(onPick).toHaveBeenCalledWith('🍕');
    expect(JSON.parse(localStorage.getItem('pigeongram-recent-emoji') ?? '[]')).toContain('🍕');
  });
});
