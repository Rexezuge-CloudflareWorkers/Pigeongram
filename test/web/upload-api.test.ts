import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadFile, uploadGroup } from '../../apps/web/src/upload-api';
import type { UploadGroupItem, UploadInput } from '../../apps/web/src/upload-api';

/**
 * The raw-body upload transport. `fetch` cannot report upload progress, so
 * the client is XHR; these tests drive a fake one through every event the
 * transport listens for.
 */

type Listener = (event: { lengthComputable?: boolean; loaded?: number; total?: number }) => void;

class FakeXhr {
  static readonly instances: FakeXhr[] = [];
  readonly uploadEvents = new Map<string, Listener[]>();
  readonly events = new Map<string, Listener[]>();
  readonly upload = {
    addEventListener: (type: string, listener: Listener): void => {
      this.uploadEvents.set(type, [...(this.uploadEvents.get(type) ?? []), listener]);
    },
  };
  readonly open = vi.fn();
  readonly send = vi.fn();
  status = 200;
  responseType = '';
  response: unknown = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.events.set(type, [...(this.events.get(type) ?? []), listener]);
  }

  emit(type: string): void {
    for (const listener of this.events.get(type) ?? []) listener({});
  }

  emitProgress(event: { lengthComputable: boolean; loaded: number; total: number }): void {
    for (const listener of this.uploadEvents.get('progress') ?? []) listener(event);
  }
}

const INPUT: UploadInput = {
  chatId: 10,
  kind: 'document',
  fileName: 'notes.txt',
  mime: 'text/plain',
  size: 3,
};

const ITEM: UploadGroupItem = { kind: 'document', fileName: 'notes.txt', mime: 'text/plain', size: 3 };

beforeEach(() => {
  FakeXhr.instances.length = 0;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uploadFile', () => {
  it('puts every optional coordinate in the query', () => {
    void uploadFile(
      {
        ...INPUT,
        caption: 'A note',
        commentTo: 99,
        replyTo: 7,
        width: 10,
        height: 20,
        duration: 4,
        randomId: '123',
      },
      new Blob(['abc']),
    );

    const xhr = FakeXhr.instances[0]!;
    expect(xhr.open).toHaveBeenCalledTimes(1);
    const path = xhr.open.mock.calls[0]?.[1] as string;
    const query = new URLSearchParams(path.split('?', 2)[1]);
    expect(query.get('chatId')).toBe('10');
    expect(query.get('kind')).toBe('document');
    expect(query.get('fileName')).toBe('notes.txt');
    expect(query.get('mime')).toBe('text/plain');
    expect(query.get('size')).toBe('3');
    expect(query.get('caption')).toBe('A note');
    expect(query.get('commentTo')).toBe('99');
    expect(query.get('replyTo')).toBe('7');
    expect(query.get('width')).toBe('10');
    expect(query.get('height')).toBe('20');
    expect(query.get('duration')).toBe('4');
    expect(query.get('randomId')).toBe('123');
    expect(xhr.upload).toBeDefined();
  });

  it('omits the optional coordinates that were not given', () => {
    void uploadFile(INPUT, new Blob(['abc']));

    const query = new URLSearchParams((FakeXhr.instances[0]!.open.mock.calls[0]?.[1] as string).split('?', 2)[1]);
    for (const key of ['caption', 'commentTo', 'replyTo', 'width', 'height', 'duration', 'randomId']) {
      expect(query.has(key)).toBe(false);
    }
  });

  it('reports progress only when the browser knows the total', async () => {
    const progress = vi.fn();
    const pending = uploadFile(INPUT, new Blob(['abc']), progress);
    const xhr = FakeXhr.instances[0]!;

    xhr.emitProgress({ lengthComputable: false, loaded: 1, total: 3 });
    xhr.emitProgress({ lengthComputable: true, loaded: 1, total: 0 });
    xhr.emitProgress({ lengthComputable: true, loaded: 2, total: 4 });
    xhr.emitProgress({ lengthComputable: true, loaded: 9, total: 4 });
    expect(progress.mock.calls).toEqual([[0.5], [1]]);

    xhr.response = { message: { id: 1 } };
    xhr.emit('load');
    await expect(pending).resolves.toEqual({ message: { id: 1 } });
  });

  it('does not touch the progress callback when none was given', async () => {
    const pending = uploadFile(INPUT, new Blob(['abc']));
    const xhr = FakeXhr.instances[0]!;
    expect(() => xhr.emitProgress({ lengthComputable: true, loaded: 1, total: 2 })).not.toThrow();
    xhr.response = { message: { id: 1 } };
    xhr.emit('load');
    await expect(pending).resolves.toEqual({ message: { id: 1 } });
  });

  it('turns a failed status into an ApiError with the server body', async () => {
    const pending = uploadFile(INPUT, new Blob(['abc']));
    const xhr = FakeXhr.instances[0]!;
    xhr.status = 413;
    xhr.response = { code: 'payload_too_large', error: 'Too large' };
    xhr.emit('load');

    await expect(pending).rejects.toMatchObject({ status: 413, code: 'payload_too_large', message: 'Too large' });
  });

  it('rejects on a network error and on an abort', async () => {
    const failed = uploadFile(INPUT, new Blob(['abc']));
    FakeXhr.instances[0]!.emit('error');
    await expect(failed).rejects.toMatchObject({ status: 0, message: expect.stringContaining('network') as string });

    const aborted = uploadFile(INPUT, new Blob(['abc']));
    FakeXhr.instances[1]!.emit('abort');
    await expect(aborted).rejects.toMatchObject({ status: 0, message: expect.stringContaining('cancelled') as string });
  });
});

describe('uploadGroup', () => {
  it('encodes the manifest and the optional coordinates', () => {
    void uploadGroup(
      { chatId: 10, items: [ITEM, { ...ITEM, fileName: 'two.txt', size: 4 }], caption: 'Both', commentTo: 5, replyTo: 6 },
      new Blob(['abcdefg']),
    );

    const query = new URLSearchParams((FakeXhr.instances[0]!.open.mock.calls[0]?.[1] as string).split('?', 2)[1]);
    const manifest = JSON.parse(Buffer.from(query.get('manifest')!, 'base64url').toString()) as UploadGroupItem[];
    expect(manifest).toEqual([ITEM, { ...ITEM, fileName: 'two.txt', size: 4 }]);
    expect(query.get('caption')).toBe('Both');
    expect(query.get('commentTo')).toBe('5');
    expect(query.get('replyTo')).toBe('6');
    expect(query.get('manifest')).not.toContain('=');
  });

  it('keeps an unbounded manifest free of the optional fields', () => {
    void uploadGroup({ chatId: 10, items: [ITEM] }, new Blob(['abc']));

    const query = new URLSearchParams((FakeXhr.instances[0]!.open.mock.calls[0]?.[1] as string).split('?', 2)[1]);
    expect(query.has('caption')).toBe(false);
    expect(query.has('commentTo')).toBe(false);
    expect(query.has('replyTo')).toBe(false);
  });
});
