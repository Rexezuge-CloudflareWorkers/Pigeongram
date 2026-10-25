import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadGroupInput, UploadInput } from '../../apps/web/src/api';
import { canGroupUploads, mediaKind, previewMime, sendUploadBatch } from '../../apps/web/src/upload';

const api = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  uploadGroup: vi.fn(),
}));

vi.mock('../../apps/web/src/api', () => api);

afterEach(() => {
  api.uploadFile.mockReset();
  api.uploadGroup.mockReset();
});

function file(name: string, type: string, body = 'abc'): File {
  return new File([body], name, { type });
}

describe('mediaKind', () => {
  it('maps browser MIME types onto the bridge kinds', () => {
    expect(mediaKind(file('a.png', 'image/png'))).toBe('photo');
    expect(mediaKind(file('a.gif', 'image/gif'))).toBe('animation');
    expect(mediaKind(file('a.mp4', 'video/mp4'))).toBe('video');
    expect(mediaKind(file('a.pdf', 'application/pdf'))).toBe('document');
    // SVG is not something `inputMediaUploadedPhoto` accepts.
    expect(mediaKind(file('a.svg', 'image/svg+xml'))).toBe('document');
  });
});

describe('previewMime', () => {
  it('allows raster images only', () => {
    expect(previewMime(file('a.png', 'image/png'))).toBe('image/png');
    expect(previewMime(file('a.gif', 'image/gif'))).toBe('image/gif');
    expect(previewMime(file('a.JPG', 'image/jpeg'))).toBe('image/jpeg');
    // SVG can carry script, and nothing else is an image at all.
    expect(previewMime(file('a.svg', 'image/svg+xml'))).toBeNull();
    expect(previewMime(file('a.html', 'text/html'))).toBeNull();
    expect(previewMime(file('a.pdf', 'application/pdf'))).toBeNull();
    expect(previewMime(file('a.bin', ''))).toBeNull();
  });
});

describe('canGroupUploads', () => {
  it('allows visual mixes and document-only selections', () => {
    expect(canGroupUploads([file('a.png', 'image/png'), file('b.mp4', 'video/mp4'), file('c.gif', 'image/gif')])).toBe(true);
    expect(canGroupUploads([file('a.pdf', 'application/pdf'), file('b.txt', 'text/plain')])).toBe(true);
  });

  it('rejects single files, documents mixed with visuals, and over-limit selections', () => {
    expect(canGroupUploads([file('a.pdf', 'application/pdf')])).toBe(false);
    expect(canGroupUploads([file('a.pdf', 'application/pdf'), file('b.png', 'image/png')])).toBe(false);
    expect(canGroupUploads(Array.from({ length: 11 }, (_, index) => file(`${index}.pdf`, 'application/pdf')))).toBe(false);
  });
});

describe('sendUploadBatch', () => {
  it('sends a grouped selection as one album with concatenated bytes', async () => {
    api.uploadGroup.mockImplementation(async (_input: UploadGroupInput, _body: Blob, onProgress?: (fraction: number) => void) => {
      onProgress?.(0.5);
      return { messages: [{ id: 5 }, { id: 6 }] };
    });
    const progress = vi.fn();
    const sent: number[] = [];

    await sendUploadBatch(
      { chatId: 10, commentTo: 99, replyTo: 7 },
      {
        files: [file('a.txt', 'text/plain', 'abc'), file('b.txt', 'text/plain', 'defg')],
        caption: 'Album',
        replyTo: 7,
        grouped: true,
      },
      progress,
      (message) => sent.push(message.id),
    );

    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.uploadGroup).toHaveBeenCalledTimes(1);
    const [input, body] = api.uploadGroup.mock.calls[0] as [UploadGroupInput, Blob];
    expect(input).toMatchObject({ chatId: 10, commentTo: 99, replyTo: 7, caption: 'Album' });
    expect(input.items).toEqual([
      { kind: 'document', fileName: 'a.txt', mime: 'text/plain', size: 3 },
      { kind: 'document', fileName: 'b.txt', mime: 'text/plain', size: 4 },
    ]);
    await expect(body.text()).resolves.toBe('abcdefg');
    expect(progress.mock.calls).toEqual([[0.5]]);
    expect(sent).toEqual([5, 6]);
  });

  it('sends an ungrouped selection sequentially, captioning only the first', async () => {
    let nextId = 1;
    api.uploadFile.mockImplementation(async (_input: UploadInput, _body: Blob, onProgress?: (fraction: number) => void) => {
      onProgress?.(0.5);
      return { message: { id: nextId++ } };
    });
    const progress = vi.fn();
    const sent: number[] = [];

    await sendUploadBatch(
      { chatId: 10 },
      {
        files: [file('a.txt', 'text/plain'), file('b.txt', 'text/plain')],
        caption: 'First only',
        grouped: false,
      },
      progress,
      (message) => sent.push(message.id),
    );

    expect(api.uploadGroup).not.toHaveBeenCalled();
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    const calls = api.uploadFile.mock.calls as Array<[UploadInput, Blob, (fraction: number) => void]>;
    expect(calls[0]?.[0]).toMatchObject({ chatId: 10, caption: 'First only', kind: 'document' });
    expect(calls[1]?.[0]).not.toHaveProperty('caption');
    expect(progress.mock.calls).toEqual([[0.25], [0.75]]);
    expect(sent).toEqual([1, 2]);
  });
});
