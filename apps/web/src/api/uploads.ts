import type { PeerId } from '../types';

/**
 * The upload and media-URL half of the bridge. Uploads are raw-body requests
 * (the file never goes through JSON), and the media routes are plain URLs the
 * browser fetches with its own Access cookie: neither can ride `rpc`.
 */

export type { UploadGroupInput, UploadGroupItem, UploadInput } from '../upload-api';
export { uploadFile, uploadGroup } from '../upload-api';

export function fileUrl(chatId: PeerId, messageId: number, options: { thumb?: boolean } = {}): string {
  const params = new URLSearchParams({ chatId: String(chatId), messageId: String(messageId) });
  if (options.thumb) params.set('thumb', '1');
  return `/user/file?${params.toString()}`;
}

export function avatarUrl(chatId: PeerId, version: string, size: 'small' | 'big' = 'small'): string {
  const params = new URLSearchParams({ chatId: String(chatId), size, v: version });
  return `/user/avatar?${params.toString()}`;
}
