import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../apps/web/src/components/Composer';

afterEach(cleanup);

function image(name = 'image.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

/**
 * The clipboard of a paste. jsdom has no `DataTransfer`, so the stub is what
 * the composer reads: the item list, the file list and the plain text.
 */
function clipboard(files: File[], text = ''): unknown {
  return {
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    files,
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  };
}

function renderComposer(): { onAttach: ReturnType<typeof vi.fn> } {
  const onAttach = vi.fn(async () => {
    // The test observes the call.
  });
  render(
    <Composer
      placeholder="Message"
      replyTarget={null}
      onCancelReply={() => {
        // Not exercised here.
      }}
      onSend={async () => {
        // Not exercised here.
      }}
      onAttach={onAttach}
    />,
  );
  return { onAttach };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Message') as HTMLTextAreaElement;
}

describe('Composer paste uploads', () => {
  it('opens the review dialog with the pasted image', async () => {
    renderComposer();

    fireEvent.paste(textarea(), { clipboardData: clipboard([image()]) });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 10')).toBeDefined();
  });

  it('sends the pasted image with the draft as the caption', async () => {
    const { onAttach } = renderComposer();
    const file = image();
    fireEvent.change(textarea(), { target: { value: 'Look at this' } });

    fireEvent.paste(textarea(), { clipboardData: clipboard([file]) });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({
        files: [file],
        caption: 'Look at this',
        replyTo: undefined,
        grouped: false,
      });
    });
  });

  it('groups several pasted images into one album', async () => {
    const { onAttach } = renderComposer();
    const first = image('a.png');
    const second = image('b.png');

    fireEvent.paste(textarea(), { clipboardData: clipboard([first, second]) });

    const dialog = await screen.findByRole('dialog');
    const checkbox = within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send album (2)' }));

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ files: [first, second], grouped: true }));
    });
  });

  it('leaves a text paste to the browser', () => {
    const { onAttach } = renderComposer();
    const event = createEvent.paste(textarea(), { clipboardData: clipboard([], 'hello') });
    fireEvent(textarea(), event);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('ignores a clipboard that carries text and an image together', () => {
    const { onAttach } = renderComposer();

    fireEvent.paste(textarea(), { clipboardData: clipboard([image()], 'B12') });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('keeps the draft when the pasted upload is cancelled', async () => {
    const { onAttach } = renderComposer();
    fireEvent.change(textarea(), { target: { value: 'Still typing' } });

    fireEvent.paste(textarea(), { clipboardData: clipboard([image()]) });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(textarea().value).toBe('Still typing');
    expect(onAttach).not.toHaveBeenCalled();
  });
});
