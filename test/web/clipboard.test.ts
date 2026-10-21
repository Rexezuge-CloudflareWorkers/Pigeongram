import { describe, expect, it } from 'vitest';
import { readClipboard } from '../../pages/src/clipboard';

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
