import { afterEach, describe, expect, it } from 'vitest';
import { useDynamicColor } from '../../apps/web/src/components/useDynamicColor';
import { renderHook } from '@testing-library/react';

afterEach(() => {
  localStorage.clear();
  document.documentElement.dataset['seed'] = '';
  document.documentElement.dataset['contrast'] = '';
});

describe('useDynamicColor', () => {
  it('defaults to the telegram seed and standard contrast', () => {
    const { result } = renderHook(() => useDynamicColor());
    expect(result.current.seed).toBe('telegram');
    expect(result.current.contrast).toBe('standard');
    expect(document.documentElement.dataset['seed']).toBe('telegram');
    expect(document.documentElement.dataset['contrast']).toBe('standard');
  });

  it('persists the seed and sets the attribute', () => {
    const { result, rerender } = renderHook(() => useDynamicColor());
    result.current.setSeed('indigo');
    rerender();
    expect(document.documentElement.dataset['seed']).toBe('indigo');
    expect(localStorage.getItem('pigeongram-seed')).toBe('indigo');
  });

  it('syncs the theme-color meta to the seed surface', () => {
    document.querySelector('meta[name="theme-color"]')?.remove();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.content = '#0e1621';
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- same overload note as confirm-dialog test
    document.head.appendChild(meta);

    const { result, rerender } = renderHook(() => useDynamicColor());
    result.current.setSeed('amber');
    rerender();
    expect(meta.content).toBe('#1a1206');
  });

  it('supports the three contrast levels', () => {
    const { result, rerender } = renderHook(() => useDynamicColor());
    result.current.setContrast('high');
    rerender();
    expect(document.documentElement.dataset['contrast']).toBe('high');
    expect(localStorage.getItem('pigeongram-contrast')).toBe('high');
  });
});
