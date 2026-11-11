import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The reader's data-saving choices: which media the app may download and play
 * without being asked.
 *
 * Every switch is per device, like the theme and the dynamic-color choices, so
 * it lives in `localStorage` under one key and never reaches the engine. The
 * switches are read through a context because the components that own the
 * loads — `Avatar`, `Media`, `Sticker`, `WebPagePreview` — sit deep in the
 * thread and the chat list, and threading a prop through every screen would
 * couple all of them to a preference only four of them use.
 *
 * When nothing is stored yet, the browser's own hint decides: `saveData` (the
 * Data Saver flag, which the user may have set system-wide) or a slow
 * `effectiveType` starts every switch off. The first explicit choice is then
 * stored and wins from the next visit on.
 */

interface DataSaverSettings {
  /**
  Request profile pictures. Off renders initials everywhere.
  */
  loadAvatars: boolean;
  /**
  Request a link preview's thumbnail. Off keeps the text card.
  */
  loadPreviews: boolean;
  /**
  Request photo, video and album thumbnails. Off shows a tap-to-load tile.
  */
  loadMedia: boolean;
  /**
  Play animations, GIFs, video stickers and TGS stickers. Off keeps stills.
  */
  animateMedia: boolean;
}

const DATA_SAVER_KEYS = ['loadAvatars', 'loadPreviews', 'loadMedia', 'animateMedia'] as const;

export type DataSaverKey = (typeof DATA_SAVER_KEYS)[number];

export const DEFAULT_DATA_SAVER: DataSaverSettings = {
  loadAvatars: true,
  loadPreviews: true,
  loadMedia: true,
  animateMedia: true,
};

const SAVER_DATA_SAVER: DataSaverSettings = {
  loadAvatars: false,
  loadPreviews: false,
  loadMedia: false,
  animateMedia: false,
};

const STORAGE_KEY = 'pigeongram-data-saver';

interface NetworkHints {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * Whether the browser asks apps to economise. Both Chromium's Data Saver flag
 * and a connection reported as slow count; a browser that exposes neither
 * (Safari, Firefox) starts with everything loading.
 */
function browserRequestsDataSaver(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: NetworkHints }).connection;
  if (!connection) return false;
  return connection.saveData === true || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

function parseSettings(raw: string): DataSaverSettings {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_DATA_SAVER;
    const record = value as Record<string, unknown>;
    const settings = { ...DEFAULT_DATA_SAVER };
    for (const key of DATA_SAVER_KEYS) {
      const stored = record[key];
      if (typeof stored === 'boolean') settings[key] = stored;
    }
    return settings;
  } catch {
    return DEFAULT_DATA_SAVER;
  }
}

/**
 * The data-saver state and the setter the settings window reports to. The
 * stored value is read once (falling back to the browser's hint when there is
 * none) and written back on every change.
 */
export function useDataSaverPreferences(): DataSaverControls {
  const [settings, setSettings] = useState<DataSaverSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return parseSettings(stored);
    } catch {
      /*
      non-blocking
      */
    }
    return browserRequestsDataSaver() ? SAVER_DATA_SAVER : DEFAULT_DATA_SAVER;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /*
      non-blocking
      */
    }
  }, [settings]);

  const setSetting = useCallback((key: DataSaverKey, enabled: boolean): void => {
    setSettings((current) => ({ ...current, [key]: enabled }));
  }, []);

  return { settings, setSetting };
}

export interface DataSaverControls {
  settings: DataSaverSettings;
  setSetting: (key: DataSaverKey, enabled: boolean) => void;
}

const NO_CONTROLS: DataSaverControls = {
  settings: DEFAULT_DATA_SAVER,
  setSetting: () => {
    /*
    The default provider-less state: controls report, nothing persists.
    */
  },
};

const DataSaverContext = createContext<DataSaverControls>(NO_CONTROLS);

/**
 * Hands the current choices and their setter to the app. The default value is
 * "everything loads", so a component rendered on its own (a test, a screen
 * outside the signed-in shell) behaves as it did before the switch.
 */
export function DataSaverProvider({ value, children }: { value: DataSaverControls; children: ReactNode }) {
  return <DataSaverContext.Provider value={value}>{children}</DataSaverContext.Provider>;
}

/**
The media-loading choices only, for the components that own the loads.
*/
export function useDataSaver(): DataSaverSettings {
  return useContext(DataSaverContext).settings;
}

/**
The choices and the setter, for the settings window.
*/
export function useDataSaverControls(): DataSaverControls {
  return useContext(DataSaverContext);
}
