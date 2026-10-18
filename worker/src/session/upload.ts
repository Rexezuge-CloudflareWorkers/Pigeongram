import type { InputMediaLike } from '@mtcute/core';
import { InputMedia } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { MessageDto, UploadKind } from '../types';
import { toMessageDto } from './dto';

/**
 * Outgoing media: `POST /api/upload` streams the browser's request body
 * straight into mtcute, which chunks it into MTProto upload parts on the
 * `upload` connection pool — the same transport the session already uses.
 */

export interface UploadSpec {
  chatId: number;
  kind: UploadKind;
  caption?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Sends a file uploaded through `POST /api/upload` and maps the sent message
 * back into the bridge DTO.
 *
 * The kind is explicit because mtcute's `InputMedia.auto` sends newly
 * uploaded photos as documents; `fileSize` matters because mtcute buffers a
 * photo's whole stream when the size is unknown (128 MB isolate budget).
 */
export async function sendUploadedMedia(
  client: TelegramClient,
  spec: UploadSpec,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<MessageDto> {
  const message = await client.sendMedia(spec.chatId, buildInputMedia(spec, body), {
    ...(spec.caption !== undefined && { caption: spec.caption }),
    ...(signal !== undefined && { abortSignal: signal }),
  });
  return toMessageDto(message);
}

function buildInputMedia(spec: UploadSpec, body: ReadableStream<Uint8Array>): InputMediaLike {
  const params = {
    fileName: spec.fileName,
    fileMime: spec.mime,
    fileSize: spec.size,
  };
  switch (spec.kind) {
    case 'photo': {
      return InputMedia.photo(body, params);
    }
    case 'video': {
      return InputMedia.video(body, {
        ...params,
        supportsStreaming: true,
        width: spec.width,
        height: spec.height,
        duration: spec.duration,
      });
    }
    case 'animation': {
      return InputMedia.animation(body, params);
    }
    default: {
      return InputMedia.document(body, params);
    }
  }
}
