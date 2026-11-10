import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageSkeleton } from '../../apps/web/src/components/MessageSkeleton';

afterEach(cleanup);

describe('MessageSkeleton', () => {
  it('announces the wait and draws decorative bones', () => {
    const { container } = render(<MessageSkeleton label="Loading messages…" />);

    expect(screen.getByRole('status').textContent).toContain('Loading messages…');
    expect(container.querySelectorAll('.thread-skeleton-row')).toHaveLength(5);
    expect(container.querySelector('.thread-skeleton')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.skeleton-avatar')).toBeNull();
  });

  it('caps the stagger so a long skeleton settles quickly', () => {
    const { container } = render(<MessageSkeleton label="Loading messages…" rows={12} />);

    const rows = [...container.querySelectorAll<HTMLElement>('.thread-skeleton-row')];
    expect(rows[0].style.getPropertyValue('--row-index')).toBe('0');
    expect(rows[8].style.getPropertyValue('--row-index')).toBe('8');
    expect(rows[11].style.getPropertyValue('--row-index')).toBe('8');
    expect(rows.every((row) => row.classList.contains('row-enter'))).toBe(true);
  });

  it('reserves the sender gutter for the comments screen', () => {
    const { container } = render(<MessageSkeleton label="Loading comments…" avatars />);

    expect(screen.getByRole('status').textContent).toContain('Loading comments…');
    expect(container.querySelectorAll('.skeleton-avatar')).toHaveLength(3);
  });
});
