import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../apps/web/src/components/Composer';
import type { BotCommandDto, MessageDto } from '../../apps/web/src/types';

afterEach(cleanup);

const COMMANDS: BotCommandDto[] = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help' },
  { command: 'hello', description: 'Say hello' },
];

function editingMessage(text = 'First draft'): MessageDto {
  return {
    id: 7,
    chatId: 1,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: true,
    date: 1_700_000_000_000,
    editDate: null,
    text,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

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

describe('Composer edit mode', () => {
  function renderEditing(options: { target?: MessageDto; save?: () => Promise<void> } = {}): {
    onSaveEdit: ReturnType<typeof vi.fn>;
    onCancelEdit: ReturnType<typeof vi.fn>;
    onSend: ReturnType<typeof vi.fn>;
  } {
    const onSaveEdit = vi.fn(options.save ?? (async () => {}));
    const onCancelEdit = vi.fn();
    const onSend = vi.fn(async () => {});
    render(
      <Composer
        placeholder="Message"
        editTarget={options.target ?? editingMessage()}
        replyTarget={null}
        onCancelReply={() => {}}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onSend={onSend}
        onAttach={async () => {}}
      />,
    );
    return { onSaveEdit, onCancelEdit, onSend };
  }

  it('pre-fills the message and saves it instead of sending', async () => {
    const { onSaveEdit, onSend } = renderEditing();

    const box = screen.getByPlaceholderText('Edit Message') as HTMLTextAreaElement;
    expect(box.value).toBe('First draft');
    expect(box).toBe(document.activeElement);
    expect(screen.getByText('Editing Message')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Attach Files' })).toBeNull();

    fireEvent.change(box, { target: { value: 'Second draft' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => {
      expect(onSaveEdit).toHaveBeenCalledWith('Second draft');
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the draft when the save is refused', async () => {
    const { onSaveEdit } = renderEditing({
      save: async () => {
        throw new Error('refused');
      },
    });

    const box = screen.getByPlaceholderText('Edit Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Second draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaveEdit).toHaveBeenCalledWith('Second draft');
    });
    expect(box.value).toBe('Second draft');
  });

  it('cancels with Escape and never sends', () => {
    const { onCancelEdit, onSend } = renderEditing();

    fireEvent.keyDown(screen.getByPlaceholderText('Edit Message'), { key: 'Escape' });

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
