import { afterEach, describe, expect, it, vi } from 'vitest';
import { readClipboard, writeClipboard } from '../../apps/web/src/clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

/**
 * jsdom does not implement `document.execCommand`, so the fallback needs the
 * method defined before it can be spied on.
 */
function installExecCommand(copy: () => boolean): ReturnType<typeof vi.fn> {
  const spy = vi.fn(copy);
  Object.defineProperty(document, 'execCommand', { value: spy, configurable: true });
  return spy;
}

function image(name = 'image.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

function clipboard(files: File[], text = ''): DataTransfer {
  return {
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    files,
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as unknown as DataTransfer;
}

describe('readClipboard', () => {
  it('reads the files and the text of a paste', () => {
    const file = image();
    expect(readClipboard(clipboard([file], 'caption'))).toEqual({ files: [file], text: 'caption' });
  });

  it('ignores the string items of a plain text paste', () => {
    const data = {
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      files: [],
      getData: () => 'hello',
    } as unknown as DataTransfer;
    expect(readClipboard(data)).toEqual({ files: [], text: 'hello' });
  });

  it('falls back to the file list when the item list is empty', () => {
    const file = image();
    const data = { items: [], files: [file], getData: () => '' } as unknown as DataTransfer;
    expect(readClipboard(data).files).toEqual([file]);
  });

  it('answers an empty paste for a missing clipboard', () => {
    expect(readClipboard(null)).toEqual({ files: [], text: '' });
  });

  it('survives a clipboard that cannot be read', () => {
    const data = {
      items: [],
      files: [],
      getData: () => {
        throw new Error('no clipboard');
      },
    } as unknown as DataTransfer;
    expect(readClipboard(data)).toEqual({ files: [], text: '' });
  });
});

function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('writeClipboard', () => {
  it('writes through the asynchronous clipboard API when it is available', async () => {
    const writeText = vi.fn(async () => {});
    installClipboard(writeText);

    await writeClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a selection when the clipboard API refuses', async () => {
    installClipboard(async () => {
      throw new Error('denied');
    });
    const copy = installExecCommand(() => true);

    await writeClipboard('hello');

    expect(copy).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a clipboard that takes neither path', async () => {
    installClipboard(async () => {
      throw new Error('denied');
    });
    installExecCommand(() => false);

    await expect(writeClipboard('hello')).rejects.toThrow('The clipboard is not available');
  });

  it('treats a selection that throws as unavailable', async () => {
    installClipboard(async () => {
      throw new Error('denied');
    });
    installExecCommand(() => {
      throw new Error('no execCommand');
    });

    await expect(writeClipboard('hello')).rejects.toThrow('The clipboard is not available');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
