import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { EMOJI_CATEGORIES, readRecentEmoji, rememberRecentEmoji, searchEmoji } from '../emoji';

/**
The emoji half of the composer's picker.

Picking inserts at the caret and leaves the panel open, the way a keyboard
behaves: a message is often several emoji, and reopening the picker for each
one would lose the reader's place. The recents row is the only state kept
between sessions, and it lives in `localStorage` (see `emoji.ts`).
*/
interface EmojiPickerProps {
  onPick: (char: string) => void;
}

export function EmojiPicker({ onPick }: EmojiPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>(() => readRecentEmoji());
  const [category, setCategory] = useState(0);
  const results = useMemo(() => searchEmoji(query), [query]);

  const pick = (char: string): void => {
    setRecents(rememberRecentEmoji(char));
    onPick(char);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        type="search"
        value={query}
        placeholder={t('stickers.searchEmoji', 'Search Emoji')}
        aria-label={t('a11y.searchEmoji', 'Search emoji')}
        className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-fg outline-none focus-visible:border-accent"
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() === '' && recents.length > 0 ? (
        <div className="shrink-0">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{t('stickers.recent', 'Recent')}</p>
          <div className="flex flex-wrap gap-0.5">
            {recents.map((char) => (
              <button
                key={`recent-${char}`}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-xl hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
                aria-label={t('a11y.emojiLabel', 'Emoji {{emoji}}', { emoji: char })}
                onClick={() => pick(char)}
              >
                {char}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {query.trim() === '' ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto" role="tablist" aria-label={t('a11y.emojiCategories', 'Emoji categories')}>
          {EMOJI_CATEGORIES.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              aria-selected={index === category}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                index === category ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-panel-2'
              }`}
              onClick={() => setCategory(index)}
            >
              {categoryLabel(t, entry.name)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.trim() !== '' && results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('stickers.noEmoji', 'No Emoji Found.')}</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {(query.trim() === '' ? (EMOJI_CATEGORIES[category]?.emoji ?? []) : results).map((entry) => (
              <button
                key={`${entry.char}-${entry.name}`}
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-md text-2xl hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
                aria-label={entry.name}
                title={entry.name}
                onClick={() => pick(entry.char)}
              >
                {entry.char}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
The category tab's label. Spelled out per category rather than composed from
the data's name: the kit's call-site check reads literal translation keys, and
a computed one would be invisible to it.
*/
function categoryLabel(t: TFunction, name: string): string {
  switch (name) {
    case 'Smileys': {
      return t('stickers.categorySmileys', 'Smileys');
    }
    case 'Gestures': {
      return t('stickers.categoryGestures', 'Gestures');
    }
    case 'People': {
      return t('stickers.categoryPeople', 'People');
    }
    case 'Animals': {
      return t('stickers.categoryAnimals', 'Animals');
    }
    case 'Food': {
      return t('stickers.categoryFood', 'Food');
    }
    case 'Activities': {
      return t('stickers.categoryActivities', 'Activities');
    }
    case 'Travel': {
      return t('stickers.categoryTravel', 'Travel');
    }
    case 'Objects': {
      return t('stickers.categoryObjects', 'Objects');
    }
    case 'Symbols': {
      return t('stickers.categorySymbols', 'Symbols');
    }
    default: {
      return name;
    }
  }
}
