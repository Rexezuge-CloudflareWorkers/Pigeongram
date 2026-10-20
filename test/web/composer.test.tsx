import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../pages/src/components/Composer';
import type { BotCommandDto } from '../../pages/src/types';

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
      sending={false}
      uploading={false}
      uploadProgress={null}
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
  it('opens the full menu from the slash button and inserts a picked command', () => {
    const { onSend } = renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Bot commands' }));
    const menu = screen.getByRole('listbox', { name: 'Bot commands' });
    expect(within(menu).getAllByRole('option')).toHaveLength(3);

    fireEvent.click(within(menu).getByRole('option', { name: /\/help/ }));

    expect(textarea().value).toBe('/help ');
    expect(textarea()).toBe(document.activeElement);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters while typing and picks the highlighted command with the keyboard', () => {
    const { onSend } = renderComposer();

    fireEvent.change(textarea(), { target: { value: '/hel' } });
    const menu = screen.getByRole('listbox', { name: 'Bot commands' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['/helpShow help', '/helloSay hello']);

    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    expect(textarea().value).toBe('/hello ');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('sends an already exact command on Enter instead of completing it again', async () => {
    const { onSend } = renderComposer();

    fireEvent.change(textarea(), { target: { value: '/start' } });
    expect(screen.getByRole('listbox', { name: 'Bot commands' })).toBeDefined();

    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('/start', undefined);
    });
  });

  it('closes the menu with Escape and hides the button without commands', () => {
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Bot commands' }));
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    cleanup();
    renderComposer([]);
    expect(screen.queryByRole('button', { name: 'Bot commands' })).toBeNull();
  });
});
