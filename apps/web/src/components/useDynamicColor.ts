import { useEffect, useState } from 'react';

/**
 * The app's dynamic color: a seed selection that re-themes the whole
 * `--md-sys-color-*` palette under `data-seed`, plus MD3's three contrast
 * levels under `data-contrast`. Mirrors `useTheme` — dark remains the default,
 * the choice persists in localStorage, and the attributes live on the same
 * `<html>` element as `data-theme`. The `theme-color` meta stays in step with
 * the active seed's dark surface (it is derived, not static).
 *
 * Seeds in `SEEDS`: the Telegram blue is the default (the brand, untouched
 * by any other code), the rest are material-tonal neighbours so the switch
 * is a pure token rename.
 */

export type Seed = 'telegram' | 'indigo' | 'amber' | 'mint' | 'rose';
export type Contrast = 'standard' | 'medium' | 'high';

export const SEEDS: ReadonlyArray<{ id: Seed; label: string; hex: string }> = [
  { id: 'telegram', label: 'Telegram Blue', hex: '#2aabee' },
  { id: 'indigo', label: 'Indigo', hex: '#5f6cff' },
  { id: 'amber', label: 'Amber', hex: '#f0a13c' },
  { id: 'mint', label: 'Mint', hex: '#46c887' },
  { id: 'rose', label: 'Rose', hex: '#f15b7f' },
];

const SEED_KEY = 'pigeongram-seed';
const CONTRAST_KEY = 'pigeongram-contrast';

function isSeed(value: string | null): value is Seed {
  return value !== null && SEEDS.some((seed) => seed.id === value);
}

function isContrast(value: string | null): value is Contrast {
  return value === 'standard' || value === 'medium' || value === 'high';
}

export function useDynamicColor(): {
  seed: Seed;
  setSeed: React.Dispatch<React.SetStateAction<Seed>>;
  contrast: Contrast;
  setContrast: React.Dispatch<React.SetStateAction<Contrast>>;
} {
  const [seed, setSeed] = useState<Seed>(() => {
    try {
      const stored = localStorage.getItem(SEED_KEY);
      return isSeed(stored) ? stored : 'telegram';
    } catch {
      return 'telegram';
    }
  });
  const [contrast, setContrast] = useState<Contrast>(() => {
    try {
      const stored = localStorage.getItem(CONTRAST_KEY);
      return isContrast(stored) ? stored : 'standard';
    } catch {
      return 'standard';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SEED_KEY, seed);
    } catch {
      /*
      non-blocking
      */
    }
    document.documentElement.dataset['seed'] = seed;
    document.documentElement.dataset['contrast'] = contrast;
    try {
      localStorage.setItem(CONTRAST_KEY, contrast);
    } catch {
      /*
      non-blocking
      */
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const surfaces: Record<Seed, string> = {
      telegram: '#0e1621',
      indigo: '#101023',
      amber: '#1a1206',
      mint: '#0a1a12',
      rose: '#1a0b11',
    };
    meta.content = surfaces[seed];
  }, [seed, contrast]);

  return { seed, setSeed, contrast, setContrast };
}
