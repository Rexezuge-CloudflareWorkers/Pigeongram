import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../../pages/src/components/Composer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * jsdom has no object URLs, so the preview needs a stand-in. The stub keeps
 * the real constructor, so `new URL(...)` still behaves.
 */
class StubbedUrl extends URL {
  static createObjectURL(): string {
    return 'blob:preview';
  }

  static revokeObjectURL(): void {
    // The dialog hands the URL back when the row unmounts.
  }
}

function file(name: string, type = 'application/pdf', body = 'content'): File {
  return new File([body], name, { type });
}

function renderComposer(): { onAttach: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onAttach = vi.fn(async () => {
    // The test observes the call; resolving lets the composer clear its draft.
  });
  const { container } = render(
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
  return { onAttach, container };
}

function picker(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('attach input missing');
  return input;
}

function dialogInput(): HTMLInputElement {
  const dialog = screen.getByRole('dialog');
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('dialog file input missing');
  return input;
}

describe('Composer upload dialog', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', StubbedUrl);
  });

  it('previews a picked image and leaves a document without one', async () => {
    const { container } = renderComposer();
    fireEvent.change(picker(container), { target: { files: [file('a.png', 'image/png'), file('b.pdf')] } });

    const dialog = await screen.findByRole('dialog');
    const previews = dialog.querySelectorAll('img');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.getAttribute('src')).toBe('blob:preview');
  });

  it('reviews a multi-file selection and sends it as an album with the draft caption', async () => {
    const { onAttach, container } = renderComposer();
    fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'Summer' } });

    const first = file('a.png', 'image/png');
    const second = file('b.jpg', 'image/jpeg');
    fireEvent.change(picker(container), { target: { files: [first, second] } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 / 10')).toBeDefined();
    const checkbox = within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send album (2)' }));

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith({
        files: [first, second],
        caption: 'Summer',
        replyTo: undefined,
        grouped: true,
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removes a file and falls back to separate sends when fewer than two remain', async () => {
    const { onAttach, container } = renderComposer();
    const first = file('a.pdf');
    const second = file('b.pdf');
    fireEvent.change(picker(container), { target: { files: [first, second] } });

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove a.pdf' }));

    const checkbox = within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(within(dialog).getByText('1 / 10')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ files: [second], grouped: false }));
    });
  });

  it('caps the dialog at ten files and says that the rest can go in another batch', async () => {
    const { container } = renderComposer();
    const files = Array.from({ length: 11 }, (_, index) => file(`${index}.pdf`));

    fireEvent.change(picker(container), { target: { files } });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
    expect(within(dialog).getByText('10 / 10')).toBeDefined();
    expect(within(dialog).getByRole('status').textContent).toContain('Only 10 files');
    expect(within(dialog).getByRole('button', { name: 'Send album (10)' })).toBeDefined();
  });

  it('leaves the draft and reply target alone when the dialog is cancelled', () => {
    const { onAttach, container } = renderComposer();
    fireEvent.change(screen.getByPlaceholderText('Message'), { target: { value: 'Still typing' } });
    fireEvent.change(picker(container), { target: { files: [file('a.pdf')] } });

    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByPlaceholderText('Message') as HTMLTextAreaElement).value).toBe('Still typing');
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('appends a second pick inside the dialog and groups once the kinds agree', async () => {
    const { container } = renderComposer();
    const first = file('a.pdf');
    fireEvent.change(picker(container), { target: { files: [first] } });

    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement).checked).toBe(false);

    const second = file('b.pdf');
    fireEvent.change(dialogInput(), { target: { files: [second] } });

    expect(within(dialog).getByText('2 / 10')).toBeDefined();
    expect((within(dialog).getByRole('checkbox', { name: /Group Items/ }) as HTMLInputElement).checked).toBe(true);
  });
});
