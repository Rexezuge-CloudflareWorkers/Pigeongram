import type { InputMediaLike, Message } from '@mtcute/core';
import { InputMedia } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { MessageDto } from '../types';
import { requireCommentPost, requireDiscussion, resolveDiscussion } from './comments';
import { toMessageDto } from './dto';
import { EngineError } from './errors';
import type { UploadGroupSpec, UploadMediaSpec, UploadSpec } from './upload-spec';

/**
 * Outgoing media: `POST /user/upload` streams the browser's request body
 * straight into mtcute, which chunks it into MTProto upload parts on the
 * `upload` connection pool — the same transport the session already uses.
 */

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
    ...(spec.randomId !== undefined && { randomId: spec.randomId }),
    ...(signal !== undefined && { abortSignal: signal }),
  };

  if (spec.commentTo !== undefined) {
    const post = await requireCommentPost(client, spec.chatId, spec.commentTo);
    if (spec.replyTo !== undefined) {
      const discussion = await requireDiscussion(client, spec.chatId, spec.commentTo);
      return toMessageDto(await client.sendMedia(discussion.peer, media, { ...params, replyTo: spec.replyTo }));
    }
    // A top-level comment replies to the thread root. mtcute's `commentMedia`
    // resolves that root itself but takes the first message of the
    // thread-start window, which is a comment (or an album member) once the
    // window carries more than the root. Without a thread yet, `commentMedia`
    // covers the first comment Telegram accepts through the channel.
    const discussion = await resolveDiscussion(client, spec.chatId, spec.commentTo);
    return discussion === null
      ? toMessageDto(await client.commentMedia(post, media, params))
      : toMessageDto(await client.sendMedia(discussion.peer, media, { ...params, replyTo: discussion.rootId }));
  }

  const message = await client.sendMedia(spec.chatId, media, {
    ...params,
    ...(spec.replyTo !== undefined && { replyTo: spec.replyTo }),
  });
  return toMessageDto(message);
}

/**
 * Sends a group uploaded through `POST /user/upload-group`: 2–10 files
 * concatenated in the request body and split back apart here, then handed to
 * `messages.sendMultiMedia` as one album. The first item carries the caption.
 *
 * `sendMediaGroup` normalises its medias strictly in array order, uploading
 * each stream to completion before starting the next; `UploadBodySplitter`
 * relies on that to reuse the one request-body reader.
 */
export async function sendUploadedMediaGroup(
  client: TelegramClient,
  spec: UploadGroupSpec,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<MessageDto[]> {
  const splitter = new UploadBodySplitter(body);
  const medias = spec.items.map((item, index) =>
    buildInputMedia(item, splitter.part(index, item.size), index === 0 ? spec.caption : undefined),
  );
  const params = {
    ...(signal !== undefined && { abortSignal: signal }),
  };

  try {
    let messages: Message[];
    if (spec.commentTo === undefined) {
      messages = await client.sendMediaGroup(spec.chatId, medias, {
        ...params,
        ...(spec.replyTo !== undefined && { replyTo: spec.replyTo }),
      });
    } else {
      const post = await requireCommentPost(client, spec.chatId, spec.commentTo);
      if (spec.replyTo === undefined) {
        // Same root rule as the single-file path above.
        const discussion = await resolveDiscussion(client, spec.chatId, spec.commentTo);
        messages =
          discussion === null
            ? await client.commentMediaGroup(post, medias, params)
            : await client.sendMediaGroup(discussion.peer, medias, { ...params, replyTo: discussion.rootId });
      } else {
        const discussion = await requireDiscussion(client, spec.chatId, spec.commentTo);
        messages = await client.sendMediaGroup(discussion.peer, medias, { ...params, replyTo: spec.replyTo });
      }
    }
    // Telegram lists the album's messages in update order; sorting keeps the
    // SPA's per-message folds (and the dialog's last message) deterministic.
    return messages.map(toMessageDto).sort((a, b) => a.id - b.id);
  } finally {
    splitter.dispose();
  }
}

function buildInputMedia(spec: UploadMediaSpec, body: ReadableStream<Uint8Array>, caption?: string): InputMediaLike {
  const params = {
    fileName: spec.fileName,
    fileMime: spec.mime,
    fileSize: spec.size,
    ...(caption !== undefined && { caption }),
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

/**
 * Splits one concatenated request body into the exact byte ranges the album
 * manifest declared.
 *
 * mtcute's group send consumes the medias in order and waits for each upload
 * to finish before opening the next stream, so one reader can serve every
 * part: a part may only start after the previous one closed. The check is
 * defensive — a future mtcute that uploads in parallel would otherwise
 * interleave two files into one corrupt upload.
 */
export class UploadBodySplitter {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #buffer: Uint8Array | null = null;
  #offset = 0;
  #nextIndex = 0;
  #completed = 0;
  #disposed = false;

  constructor(body: ReadableStream<Uint8Array>) {
    this.#reader = body.getReader();
  }

  part(index: number, size: number): ReadableStream<Uint8Array> {
    if (index !== this.#nextIndex) {
      throw new EngineError('Album item parts must be created in order', 400);
    }
    this.#nextIndex += 1;
    let claimed = false;
    let remaining = size;

    // `highWaterMark: 0` is load-bearing: with the default of 1, Web Streams
    // calls `pull` for every part as soon as it is constructed, so the later
    // parts would claim the shared reader before the earlier ones. Zero makes
    // a part pull only once its consumer actually reads it.
    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          try {
            if (!claimed) {
              if (this.#disposed) throw new EngineError('Upload body is no longer readable', 400);
              if (index !== this.#completed) throw new EngineError('Album item parts must be read in order', 400);
              claimed = true;
            }
            if (remaining === 0) {
              controller.close();
              return;
            }
            const chunk = await this.#nextChunk();
            if (chunk === null) {
              throw new EngineError('Upload body ended before every declared item was read', 400);
            }
            const available = chunk.length - this.#offset;
            const length = Math.min(available, remaining);
            controller.enqueue(chunk.subarray(this.#offset, this.#offset + length));
            this.#offset += length;
            remaining -= length;
            if (remaining === 0) {
              this.#completed = index + 1;
              controller.close();
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: () => {
          this.dispose();
        },
      },
      { highWaterMark: 0 },
    );
  }

  /**
   * Releases the request-body reader. Safe after a complete read and after a
   * failure; a half-read body must not keep workerd's pump alive.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    void this.#reader.cancel().catch(() => {
      // The stream may already be closed or errored.
    });
  }

  async #nextChunk(): Promise<Uint8Array | null> {
    for (;;) {
      if (this.#buffer !== null && this.#offset < this.#buffer.length) return this.#buffer;
      if (this.#disposed) return null;
      const { value, done } = await this.#reader.read();
      if (done) return null;
      if (value.length === 0) continue;
      this.#buffer = value;
      this.#offset = 0;
      return value;
    }
  }
}
