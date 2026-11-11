import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATA_SAVER, useDataSaverPreferences } from '../../apps/web/src/data-saver';

/**
 * The device's data-saving choices: everything loads by default, the browser's
 * own hint starts the switches off, and an explicit choice is stored and wins
 * from then on.
 */

const KEY = 'pigeongram-data-saver';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (navigator as Navigator & { connection?: unknown }).connection;
});

function stubConnection(hints: { saveData?: boolean; effectiveType?: string }): void {
  Object.defineProperty(navigator, 'connection', { configurable: true, value: hints });
}

function stored(): unknown {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('useDataSaverPreferences', () => {
  it('loads everything by default', () => {
    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings).toEqual(DEFAULT_DATA_SAVER);
    expect(stored()).toEqual(DEFAULT_DATA_SAVER);
  });

  it('starts every switch off when the browser asks to save data', () => {
    stubConnection({ saveData: true });
    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings).toEqual({
      loadAvatars: false,
      loadPreviews: false,
      loadMedia: false,
      animateMedia: false,
    });
  });

  it('starts every switch off on a slow connection', () => {
    stubConnection({ effectiveType: '2g' });
    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings.loadMedia).toBe(false);
    expect(result.current.settings.animateMedia).toBe(false);
  });

  it('leaves a fast connection alone', () => {
    stubConnection({ effectiveType: '4g' });
    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings).toEqual(DEFAULT_DATA_SAVER);
  });

  it('stores an explicit choice', () => {
    const { result } = renderHook(() => useDataSaverPreferences());

    act(() => {
      result.current.setSetting('loadAvatars', false);
    });

    expect(result.current.settings.loadAvatars).toBe(false);
    expect(result.current.settings.loadMedia).toBe(true);
    expect(stored()).toEqual({ ...DEFAULT_DATA_SAVER, loadAvatars: false });
  });

  it('restores a stored choice over the browser hint', () => {
    stubConnection({ saveData: true });
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_DATA_SAVER, loadAvatars: false, loadPreviews: false }));

    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings.loadAvatars).toBe(false);
    expect(result.current.settings.loadPreviews).toBe(false);
    expect(result.current.settings.loadMedia).toBe(true);
    expect(result.current.settings.animateMedia).toBe(true);
  });

  it('fills missing keys and ignores values that are not switches', () => {
    localStorage.setItem(KEY, JSON.stringify({ loadMedia: false, loadPreviews: 'no' }));

    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings).toEqual({ ...DEFAULT_DATA_SAVER, loadMedia: false });
  });

  it('falls back to the defaults for malformed storage', () => {
    localStorage.setItem(KEY, '{not json');

    const { result } = renderHook(() => useDataSaverPreferences());

    expect(result.current.settings).toEqual(DEFAULT_DATA_SAVER);
  });
});
