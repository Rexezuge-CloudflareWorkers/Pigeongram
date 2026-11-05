import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../apps/web/src/components/Composer';
import type { BotCommandDto } from '../../apps/web/src/types';

afterEach(cleanup);

const COMMANDS: BotCommandDto[] = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help' },
  { command: 'hello', description: 'Say hello' },
];

function renderComposer(commands: readonly BotCommandDto[] = COMMANDS): { onSend: ReturnType<typeof vi.fn> } {
  const onSend = vi.fn(async () => {
    // The test only observes the call.
  });
  render(
    <Composer
      placeholder="Message"
      replyTarget={null}
      botCommands={commands}
      onCancelReply={() => {
        // Not exercised here.
      }}
      onSend={onSend}
      onAttach={async () => {
        // Not exercised here.
      }}
    />,
  );
  return { onSend };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Message') as HTMLTextAreaElement;
}

describe('Composer bot commands', () => {
  it('opens the full menu from the slash button and sends a picked command', () => {
    const { onSend } = renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Bot Commands' }));
    const menu = screen.getByRole('listbox', { name: 'Bot Commands' });
    expect(within(menu).getAllByRole('option')).toHaveLength(3);

    fireEvent.click(within(menu).getByRole('option', { name: /\/help/ }));

    expect(onSend).toHaveBeenCalledWith('/help', undefined);
    expect(textarea().value).toBe('');
    expect(textarea()).toBe(document.activeElement);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters while typing and sends the highlighted command with Enter', () => {
    const { onSend } = renderComposer();

    fireEvent.change(textarea(), { target: { value: '/hel' } });
    const menu = screen.getByRole('listbox', { name: 'Bot Commands' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['/helpShow help', '/helloSay hello']);

    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('/hello', undefined);
    expect(textarea().value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('completes the highlighted command on Tab without sending it', () => {
    const { onSend } = renderComposer();

    fireEvent.change(textarea(), { target: { value: '/hel' } });
    fireEvent.keyDown(textarea(), { key: 'Tab' });

    expect(textarea().value).toBe('/help ');
    expect(textarea().selectionStart).toBe('/help '.length);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('sends an already exact command on Enter instead of completing it again', async () => {
    const { onSend } = renderComposer();

    fireEvent.change(textarea(), { target: { value: '/start' } });
    expect(screen.getByRole('listbox', { name: 'Bot Commands' })).toBeDefined();

    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('/start', undefined);
    });
    expect(textarea().value).toBe('');
  });

  it('closes the menu with Escape and hides the button without commands', () => {
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Bot Commands' }));
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    cleanup();
    renderComposer([]);
    expect(screen.queryByRole('button', { name: 'Bot Commands' })).toBeNull();
  });
});
