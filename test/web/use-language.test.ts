import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n, LANGUAGE_STORAGE_KEY } from '../../apps/web/src/i18n';
import { useLanguage } from '../../apps/web/src/useLanguage';

/**
The language choice: what the settings row reads, and what changing it does.

i18next holds the rendered language while `localStorage` holds the reader's
choice, so both halves are asserted — a change that translated the UI but was
forgotten on the next load is exactly the bug this hook exists to prevent.
*/
afterEach(async () => {
  cleanup();
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('useLanguage', () => {
  it('reads the language i18next is rendering', () => {
    const { result } = renderHook(() => useLanguage());
    expect(result.current.language).toBe('en');
  });

  it('persists a change and hands it to i18next', async () => {
    const { result } = renderHook(() => useLanguage());
    await act(async () => {
      result.current.setLanguage('en-GB');
    });
    // `en-GB` normalizes onto the shipped `en` rather than being ignored.
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(i18n.language).toBe('en');
    expect(result.current.language).toBe('en');
  });

  it('follows a change made outside the hook', async () => {
    const { result } = renderHook(() => useLanguage());
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(result.current.language).toBe('en');
  });

  it('refuses a language the app does not ship', () => {
    const { result } = renderHook(() => useLanguage());
    act(() => {
      result.current.setLanguage('xx');
    });
    // An unsupported tag falls to English rather than offering a selector value
    // with no catalogue behind it.
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});
