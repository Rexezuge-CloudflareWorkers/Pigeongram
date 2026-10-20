import type { InputMediaLike } from '@mtcute/core';
import { InputMedia } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { MessageDto, UploadKind } from '../types';
import { requireCommentPost, requireDiscussion } from './comments';
import { toMessageDto } from './dto';

/**
 * Outgoing media: `POST /user/upload` streams the browser's request body
 * straight into mtcute, which chunks it into MTProto upload parts on the
 * `upload` connection pool — the same transport the session already uses.
 */

export interface UploadSpec {
  chatId: number;
  kind: UploadKind;
  caption?: string;
  /**
  Id of the channel post being commented on, when the upload is a comment.
  */
  commentTo?: number;
  /**
  Id of the message being replied to: a comment in the thread when `commentTo`
  is set, otherwise a message in `chatId`.
  */
  replyTo?: number;
  fileName?: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Sends a file uploaded through `POST /user/upload` and maps the sent message
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
  const media = buildInputMedia(spec, body);
  const params = {
    ...(spec.caption !== undefined && { caption: spec.caption }),
    ...(signal !== undefined && { abortSignal: signal }),
  };

  if (spec.commentTo !== undefined) {
    const post = await requireCommentPost(client, spec.chatId, spec.commentTo);
    if (spec.replyTo === undefined) {
      // `commentMedia` resolves the thread itself and covers the
      // first-comment case Telegram accepts through the channel.
      return toMessageDto(await client.commentMedia(post, media, params));
    }
    const discussion = await requireDiscussion(client, spec.chatId, spec.commentTo);
    return toMessageDto(await client.sendMedia(discussion.peer, media, { ...params, replyTo: spec.replyTo }));
  }

  const message = await client.sendMedia(spec.chatId, media, {
    ...params,
    ...(spec.replyTo !== undefined && { replyTo: spec.replyTo }),
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
