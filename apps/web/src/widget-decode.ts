import { fromBase64 } from './calls/base64';

/**
Inflates a widget's payload into its mini-HTML document.

Telegram sends the document as a zlib stream (RFC 1950), not gzip or raw
deflate, and enforces the compressed/uncompressed limits on the server, so
this side adds no size checks of its own. `DecompressionStream('deflate')`
is the browser's RFC 1950 inflater; where it is missing the caller falls
back to the labelled card instead of trying to render raw bytes.
*/
export async function inflateWidgetPayload(base64: string): Promise<string> {
  const bytes = fromBase64(base64);
  if (bytes === null || typeof DecompressionStream === 'undefined') {
    throw new Error('Widget payload cannot be inflated');
  }
  // Copy into a fresh ArrayBuffer: a wallet-backed Uint8Array is not a valid
  // BlobPart under the DOM's ArrayBuffer-generic types.
  const inflated = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return await new Response(inflated).text();
}
