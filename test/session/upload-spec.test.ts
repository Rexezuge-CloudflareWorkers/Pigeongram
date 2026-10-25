import { describe, expect, it } from 'vitest';
import { parseUploadGroupSpec, parseUploadSpec } from '../../packages/backend-services/src/session/upload-spec';

/**
 * The album manifest is the one untrusted, structured part of an upload: it
 * decides how the concatenated body is split and what mtcute sends. These
 * cases pin the decode, the shape limits and the media-class rule.
 */

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function request(query: string, body = 'abcdef', headers: Record<string, string> = {}): { url: URL; request: Request } {
  const url = new URL(`https://session-engine.internal/user/upload-group?${query}`);
  return { url, request: new Request(url, { method: 'POST', body, headers }) };
}

const env = { UPLOAD_MAX_BYTES: '100' } as unknown as CloudflareEnv;

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'document', size: 3, fileName: 'note.txt', mime: 'text/plain', ...overrides };
}

describe('parseUploadGroupSpec', () => {
  it('decodes an unpadded base64url manifest and keeps each item', () => {
    const { url, request: body } = request(`chatId=42&manifest=${encode([item(), item({ fileName: 'other.txt' })])}`);
    const spec = parseUploadGroupSpec(url, body, env);

    expect(spec.chatId).toBe(42);
    expect(spec.items).toEqual([
      { kind: 'document', size: 3, fileName: 'note.txt', mime: 'text/plain' },
      { kind: 'document', size: 3, fileName: 'other.txt', mime: 'text/plain' },
    ]);
  });

  it('accepts a padded base64 manifest as well', () => {
    const padded = Buffer.from(JSON.stringify([item(), item()])).toString('base64');
    const { url, request: body } = request(`chatId=1&manifest=${padded}`);
    const spec = parseUploadGroupSpec(url, body, env);

    expect(spec.items).toHaveLength(2);
  });

  it('keeps captions and optional coordinates', () => {
    const { url, request: body } = request(`chatId=-100&manifest=${encode([item(), item()])}&caption=Album&commentTo=9&replyTo=11`);
    const spec = parseUploadGroupSpec(url, body, env);

    expect(spec).toMatchObject({ chatId: -100, caption: 'Album', commentTo: 9, replyTo: 11 });
  });

  it('accepts visual media together but not a document mixed with one', () => {
    const visualMedia = [item({ kind: 'photo' }), item({ kind: 'video' }), item({ kind: 'animation' })];
    const visual = request(`chatId=1&manifest=${encode(visualMedia)}`);
    expect(() => parseUploadGroupSpec(visual.url, visual.request, env)).not.toThrow();

    const mixedMedia = [item({ kind: 'document' }), item({ kind: 'photo' })];
    const mixed = request(`chatId=1&manifest=${encode(mixedMedia)}`);
    expect(() => parseUploadGroupSpec(mixed.url, mixed.request, env)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('caps an album at the route and item limits', () => {
    const one = request(`chatId=1&manifest=${encode([item()])}`);
    expect(() => parseUploadGroupSpec(one.url, one.request, env)).toThrowError(expect.objectContaining({ status: 400 }));

    const eleven = Array.from({ length: 11 }, () => item({ size: 1 }));
    const capped = request(`chatId=1&manifest=${encode(eleven)}`);
    expect(() => parseUploadGroupSpec(capped.url, capped.request, env)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('rejects malformed manifests and item fields', () => {
    const cases: Array<string | unknown[]> = [
      '!!!',
      encode('not an array'),
      encode({}),
      encode([item(), item({ kind: 'sticker' })]),
      encode([item(), item({ size: 0 })]),
      encode([item(), item({ width: 'wide' })]),
      encode([item(), item({ fileName: 7 })]),
    ];
    for (const manifest of cases) {
      const value = typeof manifest === 'string' ? manifest : encode(manifest);
      const { url, request: body } = request(`chatId=1&manifest=${value}`);
      expect(() => parseUploadGroupSpec(url, body, env), String(manifest)).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });

  it('requires the manifest and validates the total against the upload cap', () => {
    const missing = request('chatId=1');
    expect(() => parseUploadGroupSpec(missing.url, missing.request, env)).toThrowError(expect.objectContaining({ status: 400 }));

    const capped = { UPLOAD_MAX_BYTES: '5' } as unknown as CloudflareEnv;
    const tooLarge = request(`chatId=1&manifest=${encode([item({ size: 3 }), item({ size: 3 })])}`);
    expect(() => parseUploadGroupSpec(tooLarge.url, tooLarge.request, capped)).toThrowError(expect.objectContaining({ status: 413 }));
  });

  it('rejects a body whose content-length disagrees with the manifest total', () => {
    const { url, request: body } = request(`chatId=1&manifest=${encode([item(), item()])}`, 'abcdef', {
      'content-length': '5',
    });
    expect(() => parseUploadGroupSpec(url, body, env)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('rejects a caption over the Telegram limit and unusable coordinates', () => {
    const longCaption = request(`chatId=1&manifest=${encode([item(), item()])}&caption=${'x'.repeat(1025)}`);
    expect(() => parseUploadGroupSpec(longCaption.url, longCaption.request, env)).toThrowError(expect.objectContaining({ status: 400 }));

    const badReply = request(`chatId=1&manifest=${encode([item(), item()])}&replyTo=0`);
    expect(() => parseUploadGroupSpec(badReply.url, badReply.request, env)).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe('parseUploadSpec random id', () => {
  function single(query: string): { url: URL; request: Request } {
    const url = new URL(`https://session-engine.internal/user/upload?${query}`);
    return { url, request: new Request(url, { method: 'POST', body: 'abcdef' }) };
  }

  it('keeps the client-chosen random id, so a retry is idempotent', () => {
    const { url, request: body } = single('chatId=1&kind=document&size=6&randomId=123456789');
    const spec = parseUploadSpec(url, body, env);

    expect(spec.randomId?.toString()).toBe('123456789');
  });

  it('rejects a random id that is not a positive 64-bit integer', () => {
    for (const randomId of ['nope', '0', '-1', '1.5', '9223372036854775808']) {
      const { url, request: body } = single(`chatId=1&kind=document&size=6&randomId=${randomId}`);
      expect(() => parseUploadSpec(url, body, env), randomId).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });
});
