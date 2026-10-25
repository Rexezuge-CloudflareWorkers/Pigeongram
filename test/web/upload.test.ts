import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadGroupInput, UploadInput } from '../../apps/web/src/api';
import { canGroupUploads, mediaKind, prepareUpload, previewMime, sendUploadBatch } from '../../apps/web/src/upload';

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

describe('prepareUpload', () => {
  it('leaves a JPEG photo and a plain document alone', async () => {
    const jpeg = file('a.jpg', 'image/jpeg');
    await expect(prepareUpload(jpeg)).resolves.toMatchObject({ kind: 'photo', body: jpeg, fileName: 'a.jpg', mime: 'image/jpeg' });

    const text = file('a.txt', 'text/plain');
    await expect(prepareUpload(text)).resolves.toMatchObject({ kind: 'document', body: text, fileName: 'a.txt', mime: 'text/plain' });
  });

  it('names an unnamed file and gives an unknown type a generic MIME', async () => {
    const nameless = new File(['abc'], '');
    await expect(prepareUpload(nameless)).resolves.toMatchObject({ fileName: 'file', mime: 'application/octet-stream' });
  });

  it('converts a decodable image to JPEG', async () => {
    const bitmap = { width: 2, height: 3, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(jpeg));

    const prepared = await prepareUpload(file('holiday.png', 'image/png'));

    expect(prepared).toMatchObject({ kind: 'photo', body: jpeg, fileName: 'holiday.jpg', mime: 'image/jpeg' });
    expect(bitmap.close).toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it('falls back to a document when the image cannot be decoded, drawn or encoded', async () => {
    const encoded = file('encoded.png', 'image/png');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(prepareUpload(encoded)).resolves.toMatchObject({ kind: 'document', fileName: 'encoded.png' });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported');
      }),
    );
    await expect(prepareUpload(file('broken.png', 'image/png'))).resolves.toMatchObject({ kind: 'document' });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: () => {}, drawImage: () => {} } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    await expect(prepareUpload(file('empty.png', 'image/png'))).resolves.toMatchObject({ kind: 'document', fileName: 'empty.png' });
  });

  it('reads a video duration and size when the browser reports them', async () => {
    const metadata = videoElement();
    useVideo(metadata.element);

    const pending = prepareUpload(file('clip.mp4', 'video/mp4'));
    metadata.fire('loadedmetadata');

    await expect(pending).resolves.toMatchObject({ kind: 'video', width: 640, height: 360, duration: 12 });
    expect(metadata.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('defaults an unusable duration instead of sending a non-integer', async () => {
    const metadata = videoElement(Infinity);
    useVideo(metadata.element);

    const pending = prepareUpload(file('stream.mp4', 'video/mp4'));
    metadata.fire('loadedmetadata');

    await expect(pending).resolves.toMatchObject({ duration: 1 });
  });

  it('sends a video without metadata when the browser cannot read it, errors or times out', async () => {
    const failed = videoElement();
    useVideo(failed.element);
    const errored = prepareUpload(file('bad.mp4', 'video/mp4'));
    failed.fire('error');
    await expect(errored).resolves.toMatchObject({ kind: 'video' });
    await expect(errored).resolves.not.toHaveProperty('width');

    vi.useFakeTimers();
    const timedOut = prepareUpload(file('slow.mp4', 'video/mp4'));
    await vi.advanceTimersByTimeAsync(5000);
    await expect(timedOut).resolves.toMatchObject({ kind: 'video' });
    vi.useRealTimers();
  });
});

describe('sendUploadBatch corners', () => {
  it('does nothing for an empty selection', async () => {
    const sent = vi.fn();
    await sendUploadBatch({ chatId: 10 }, { files: [], caption: '', grouped: true }, () => {}, sent);
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.uploadGroup).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });

  it('falls back to separate messages when the prepared kinds cannot form an album', async () => {
    const failed = videoElement();
    useVideo(failed.element);
    api.uploadFile.mockResolvedValue({ message: { id: 1 } });

    const pending = sendUploadBatch(
      { chatId: 10 },
      { files: [file('clip.mp4', 'video/mp4'), file('note.txt', 'text/plain')], caption: '', grouped: true },
      () => {},
      () => {},
    );
    failed.fire('error');
    await pending;

    expect(api.uploadGroup).not.toHaveBeenCalled();
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
  });

  it('falls back when a grouped selection is beyond the album limit', async () => {
    api.uploadFile.mockResolvedValue({ message: { id: 1 } });
    const files = Array.from({ length: 11 }, (_, index) => file(`${index}.txt`, 'text/plain'));

    await sendUploadBatch(
      { chatId: 10 },
      { files, caption: '', grouped: true },
      () => {},
      () => {},
    );

    expect(api.uploadGroup).not.toHaveBeenCalled();
    expect(api.uploadFile).toHaveBeenCalledTimes(11);
  });

  it('carries a random id through a single-file retry', async () => {
    api.uploadFile.mockResolvedValue({ message: { id: 1 } });

    await sendUploadBatch(
      { chatId: 10 },
      { files: [file('a.txt', 'text/plain')], caption: 'Note', grouped: false },
      () => {},
      () => {},
      ['12345'],
    );

    expect(api.uploadFile.mock.calls[0]?.[0]).toMatchObject({ caption: 'Note', randomId: '12345' });
  });
});

/**
A fake video element whose events the test can fire. The uploader only reads
the metadata, so the shape is enough.
*/
function videoElement(duration = 12.4): {
  element: HTMLVideoElement;
  fire: (type: string) => void;
  removeAttribute: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Array<() => void>>();
  const removeAttribute = vi.fn();
  const element = {
    preload: '',
    src: '',
    videoWidth: 640,
    videoHeight: 360,
    duration,
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeAttribute,
  } as unknown as HTMLVideoElement;
  return {
    element,
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    removeAttribute,
  };
}

function useVideo(element: HTMLVideoElement): void {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) =>
    tag === 'video' ? element : create(tag, options),
  );
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:video'), revokeObjectURL: vi.fn() });
}
