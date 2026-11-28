import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from '../../apps/web/src/components/ToggleSwitch';

afterEach(cleanup);

describe('ToggleSwitch', () => {
  it('reports its state as a switch', () => {
    render(<ToggleSwitch checked label="Profile Pictures" onChange={() => {}} />);

    const control = screen.getByRole('switch', { name: 'Profile Pictures' });
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('reports the next value from one click', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ToggleSwitch checked label="Profile Pictures" onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Profile Pictures' }));
    expect(onChange).toHaveBeenCalledWith(false);

    rerender(<ToggleSwitch checked={false} label="Profile Pictures" onChange={onChange} />);
    expect(screen.getByRole('switch', { name: 'Profile Pictures' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('switch', { name: 'Profile Pictures' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('reports the mixed state of a switch that governs several choices', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} indeterminate label="Data Saver" onChange={onChange} />);

    const control = screen.getByRole('switch', { name: 'Data Saver' });
    expect(control.getAttribute('aria-checked')).toBe('mixed');

    // The mixed state is "partly on", so the next click turns the rest on.
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
