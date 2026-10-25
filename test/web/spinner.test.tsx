import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Spinner } from '../../apps/web/src/components/Spinner';

afterEach(cleanup);

describe('Spinner', () => {
  it('exposes a labelled page spinner as a live status', () => {
    render(<Spinner label="Loading messages…" />);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading messages…');
    expect(status.querySelector('.animate-spin')).not.toBeNull();
  });

  it('keeps an unlabelled spinner decorative', () => {
    const { container } = render(<Spinner inline size={14} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not nest a status inside an inline label', () => {
    render(<Spinner inline label="Loading…" />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Loading…')).toBeDefined();
  });
});
