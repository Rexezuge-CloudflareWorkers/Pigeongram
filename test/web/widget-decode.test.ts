import { Blob as NodeBlob } from 'node:buffer';
import { DecompressionStream } from 'node:stream/web';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateWidgetPayload } from '../../apps/web/src/widget-decode';

/**
Widget HTML is a zlib (RFC 1950) stream, not gzip or raw deflate. The
browser's `DecompressionStream('deflate')` is the inflater; where the API is
missing the caller shows the fallback card instead of raw bytes.
*/

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inflateWidgetPayload', () => {
  it('inflates a zlib stream into the mini-HTML document', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('DecompressionStream', DecompressionStream);
    const html = '<html><body><p style="color:red">Hello</p></body></html>';
    expect(await inflateWidgetPayload(deflateSync(html).toString('base64'))).toBe(html);
  });

  it('rejects a payload that is not base64', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('DecompressionStream', DecompressionStream);
    await expect(inflateWidgetPayload('not base64')).rejects.toThrow();
  });

  it('rejects when the browser has no deflate stream', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(inflateWidgetPayload('eJwBAgM=')).rejects.toThrow('Widget payload cannot be inflated');
  });
});
