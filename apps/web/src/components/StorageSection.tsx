import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { purgeAll, pruneToLimit, useCacheUsage } from '../cache';
import { CACHE_SIZE_OPTIONS, cacheLimitBytes, formatCacheSize, setCacheSize, useCacheSize } from '../cache/settings';
import type { CacheSizeOption } from '../cache/settings';
import { Button } from './Button';
import { Select } from './Select';
import { SettingsRow } from './SettingsRow';

/**
The device's local-data budget, beside the other device choices in
Settings. Changing the size takes effect at once: zero drops every stored
projection, and a smaller cap evicts the cheapest entries immediately.

Clearing this cache does not sign out, drop the push subscription or touch
the browser's media cache — it is only the app's structured projections.
*/

interface StorageSectionProps {
  onNotice: (text: string) => void;
}

export function StorageSection({ onNotice }: StorageSectionProps) {
  const { t } = useTranslation();
  const size = useCacheSize();
  const bytes = useCacheUsage();

  useEffect(() => {
    void pruneToLimit();
  }, []);

  const choose = (next: CacheSizeOption): void => {
    setCacheSize(next);
    if (next === 0) {
      void purgeAll();
      return;
    }
    void pruneToLimit();
  };

  const clear = (): void => {
    void purgeAll().then(() => onNotice(t('settings.cacheCleared', 'Cache Cleared')));
  };

  return (
    <div className="flex flex-col">
      <SettingsRow
        icon="storage"
        label={t('settings.cacheSize', 'Cache Size')}
        hint={t('settings.cacheSizeHint', 'Keep Chats, Profiles And Stickers For Faster Loading')}
      >
        <div className="w-36 shrink-0">
          <Select
            aria-label={t('a11y.cacheSize', 'Maximum cache size')}
            value={String(size)}
            onChange={(event) => choose(Number(event.target.value) as CacheSizeOption)}
          >
            {CACHE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 0 ? t('settings.cacheOff', 'Off') : `${option} MB`}
              </option>
            ))}
          </Select>
        </div>
      </SettingsRow>
      <div className="flex min-h-14 items-center justify-between gap-4 py-2">
        <span className="text-xs text-muted">
          {t('settings.cacheUsage', 'Using {{used}} Of {{limit}}', {
            used: formatCacheSize(bytes),
            limit: size === 0 ? t('settings.cacheOff', 'Off') : formatCacheSize(cacheLimitBytes()),
          })}
        </span>
        <Button variant="text" onClick={clear}>
          {t('settings.clearCache', 'Clear Cache')}
        </Button>
      </div>
    </div>
  );
}
