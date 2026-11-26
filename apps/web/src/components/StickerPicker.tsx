import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchStickerLibrary, fetchStickerSet, stickerUrl } from '../api';
import type { StickerDto, StickerLibraryDto, StickerSetDto } from '../types';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
The composer's sticker and emoji picker.

A popover, not a history layer: Back leaves the thread, exactly as it does
for the profile popup. The library is read the first time the sticker tab is
shown, one bridge request for the recents, the saved stickers and the
installed packs; a pack's stickers are read when the reader opens it.

A sticker is sent by its decimal document id. The pack identity rides along
so the engine can recover the document after a restart emptied its registry.
*/

interface StickerPickerProps {
  /**
  Whether the sticker tab is offered. It is hidden while the composer edits
  a message: an edit changes text, not the conversation.
  */
  stickersEnabled: boolean;
  onClose: () => void;
  /**
  Inserts one emoji at the composer's caret. The panel stays open.
  */
  onPickEmoji: (char: string) => void;
  onSendSticker: (sticker: StickerDto, set: { id: string; accessHash: string } | null) => void;
}

export function StickerPicker({ stickersEnabled, onClose, onPickEmoji, onSendSticker }: StickerPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'sticker' | 'emoji'>(stickersEnabled ? 'sticker' : 'emoji');
  const activeTab = stickersEnabled ? tab : 'emoji';
  const [library, setLibrary] = useState<StickerLibraryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSet, setOpenSet] = useState<StickerSetDto | null>(null);
  const [loadingSet, setLoadingSet] = useState(false);
  // A brief pack triggers a second read. Without a ticket the slower answer
  // can win the race, and an answer after unmount can update a dead picker.
  const packTicket = useRef(0);
  useEffect(
    () => () => {
      packTicket.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!stickersEnabled || library !== null) return;
    let live = true;
    fetchStickerLibrary()
      .then((result) => {
        if (live) setLibrary(result);
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      live = false;
    };
  }, [library, stickersEnabled]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel !== null && event.target instanceof Node && !panel.contains(event.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  const packs = useMemo(() => {
    const sets = library?.sets ?? [];
    const needle = query.trim().toLowerCase();
    if (needle === '') return sets;
    return sets.filter((set) => set.title.toLowerCase().includes(needle) || set.shortName.toLowerCase().includes(needle));
  }, [library, query]);

  const openPack = useCallback((set: StickerSetDto): void => {
    if (set.stickers.length > 0) {
      setOpenSet(set);
      return;
    }
    const ticket = (packTicket.current += 1);
    setLoadingSet(true);
    setError(null);
    fetchStickerSet({ id: set.id, accessHash: set.accessHash })
      .then((result) => {
        if (ticket === packTicket.current) setOpenSet(result);
      })
      .catch((failure: unknown) => {
        if (ticket === packTicket.current) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (ticket === packTicket.current) setLoadingSet(false);
      });
  }, []);

  const pickSticker = (sticker: StickerDto): void => {
    const set = openSet === null ? null : { id: openSet.id, accessHash: openSet.accessHash };
    onSendSticker(sticker, set);
    onClose();
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Stickers and emoji"
      className="absolute bottom-[calc(100%+8px)] left-3 right-3 z-30 flex h-[360px] max-h-[70vh] flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3 shadow-2xl sm:right-auto sm:w-[380px]"
    >
      <div className="flex shrink-0 items-center gap-1">
        {stickersEnabled ? (
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-sm font-semibold ${activeTab === 'sticker' ? 'bg-accent/15 text-fg' : 'text-muted'}`}
            aria-pressed={activeTab === 'sticker'}
            onClick={() => setTab('sticker')}
          >
            Stickers
          </button>
        ) : null}
        <button
          type="button"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${activeTab === 'emoji' ? 'bg-accent/15 text-fg' : 'text-muted'}`}
          aria-pressed={activeTab === 'emoji'}
          onClick={() => setTab('emoji')}
        >
          Emoji
        </button>
        <button
          type="button"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-fg"
          aria-label="Close picker"
          title="Close"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {activeTab === 'emoji' ? (
        <EmojiPicker onPick={onPickEmoji} />
      ) : (
        <>
          <input
            type="search"
            value={query}
            placeholder="Search Sticker Packs"
            aria-label="Search sticker packs"
            className="w-full shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-fg outline-none focus-visible:border-accent"
            onChange={(event) => setQuery(event.target.value)}
          />
          {error === null ? null : <p className="text-sm text-danger">{error}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {openSet === null ? (
              <StickerOverview library={library} packs={packs} onPick={pickSticker} onOpenPack={openPack} />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-fg"
                    aria-label="Back to packs"
                    title="Back"
                    onClick={() => setOpenSet(null)}
                  >
                    <Icon name="arrow-left" size={18} />
                  </button>
                  <span className="truncate text-sm font-semibold text-fg">{openSet.title}</span>
                  <span className="ml-auto text-xs text-muted">{openSet.count}</span>
                </div>
                <StickerGrid stickers={openSet.stickers} onPick={pickSticker} label={openSet.title} />
              </div>
            )}
            {loadingSet ? (
              <div className="flex justify-center py-4">
                <Spinner size={20} />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

interface StickerOverviewProps {
  library: StickerLibraryDto | null;
  packs: readonly StickerSetDto[];
  onPick: (sticker: StickerDto) => void;
  onOpenPack: (set: StickerSetDto) => void;
}

function StickerOverview({ library, packs, onPick, onOpenPack }: StickerOverviewProps) {
  if (library === null) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size={20} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {library.recent.length > 0 ? <StickerSection title="Recent" stickers={library.recent} onPick={onPick} /> : null}
      {library.faved.length > 0 ? <StickerSection title="Saved" stickers={library.faved} onPick={onPick} /> : null}
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Packs</p>
        {packs.length === 0 ? (
          <p className="py-2 text-sm text-muted">No Sticker Packs.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {packs.map((set) => (
              <button
                key={set.id}
                type="button"
                className="flex flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                aria-label={set.title}
                title={set.title}
                onClick={() => onOpenPack(set)}
              >
                {set.thumb === null ? (
                  <span className="flex h-12 w-12 items-center justify-center rounded-md bg-panel text-xs text-muted">?</span>
                ) : (
                  <img
                    className="h-12 w-12 object-contain"
                    src={stickerUrl(set.thumb.id, set.thumb.version)}
                    alt=""
                    loading="lazy"
                    width={set.thumb.width}
                    height={set.thumb.height}
                  />
                )}
                <span className="w-full truncate text-center text-[11px] text-muted">{set.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StickerSection({
  title,
  stickers,
  onPick,
}: {
  title: string;
  stickers: readonly StickerDto[];
  onPick: (sticker: StickerDto) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</p>
      <StickerGrid stickers={stickers} onPick={onPick} label={title} />
    </div>
  );
}

function StickerGrid({
  stickers,
  onPick,
  label,
}: {
  stickers: readonly StickerDto[];
  onPick: (sticker: StickerDto) => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {stickers.map((sticker) => (
        <button
          key={sticker.id}
          type="button"
          className="flex items-center justify-center rounded-lg p-1 hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
          aria-label={sticker.emoji === null ? `${label} sticker` : `${sticker.emoji} sticker`}
          title={sticker.emoji ?? undefined}
          onClick={() => onPick(sticker)}
        >
          <img
            className="h-14 w-14 object-contain"
            src={stickerUrl(sticker.id, sticker.version)}
            alt=""
            loading="lazy"
            width={sticker.width}
            height={sticker.height}
          />
        </button>
      ))}
    </div>
  );
}
