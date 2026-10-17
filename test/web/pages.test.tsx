import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@telegram-web-client/pages';

describe('App (scaffold stub)', () => {
  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Telegram Web Client' })).toBeDefined();
  });
});
