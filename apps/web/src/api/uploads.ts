import type { PeerId } from '../types';

/**
 * The upload and media-URL half of the bridge. Uploads are raw-body requests
 * (the file never goes through JSON), and the media routes are plain URLs the
 * browser fetches with its own Access cookie: neither can ride `rpc`.
 */

export type { UploadGroupInput, UploadGroupItem, UploadInput } from '../upload-api';
export { uploadFile, uploadGroup } from '../upload-api';

export function fileUrl(chatId: PeerId, messageId: number, options: { thumb?: boolean; version?: string } = {}): string {
  const params = new URLSearchParams({ chatId: String(chatId), messageId: String(messageId) });
  if (options.thumb) params.set('thumb', '1');
  // A cache-buster only: the route resolves the bytes from the message itself,
  // so a changed preview photo gets a new URL instead of a stale cache entry.
  if (options.version) params.set('v', options.version);
  return `/user/file?${params.toString()}`;
}

export function avatarUrl(chatId: PeerId, version: string, size: 'small' | 'big' = 'small'): string {
  const params = new URLSearchParams({ chatId: String(chatId), size, v: version });
  return `/user/avatar?${params.toString()}`;
}
