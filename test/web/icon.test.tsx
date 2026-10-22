import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from '../../pages/src/components/Icon';

afterEach(cleanup);

describe('Icon', () => {
  it('is decorative without a label', () => {
    const { container } = render(<Icon name="send" />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.dataset.icon).toBe('send');
    // The set's default size is the 20 px menu icon.
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('carries an accessible name when labelled', () => {
    render(<Icon name="pin" label="Pinned" />);

    const icon = screen.getByRole('img', { name: 'Pinned' });
    expect(icon.getAttribute('aria-hidden')).toBeNull();
    expect(icon.dataset.icon).toBe('pin');
  });

  it('passes the size and class through', () => {
    const { container } = render(<Icon name="eye" size={12} className="text-muted" />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('12');
    expect(svg?.getAttribute('height')).toBe('12');
    expect(svg?.classList.contains('icon')).toBe(true);
    expect(svg?.classList.contains('text-muted')).toBe(true);
  });
});
