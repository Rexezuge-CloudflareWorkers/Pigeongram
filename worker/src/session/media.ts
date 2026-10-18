import type { TelegramClient } from '@mtcute/core/client.js';
import { EngineError } from './errors';

/**
 * Streams a message's photo through `client.downloadAsIterable`.
 *
 * The photo's `file_reference` and DC are resolved at request time from the
 * message itself, so the SPA never has to carry file locations around.
 */
export async function streamPhoto(client: TelegramClient, chatId: number, messageId: number): Promise<ReadableStream<Uint8Array>> {
  const [message] = await client.getMessages(chatId, [messageId]);
  if (!message) throw new EngineError('Message not found', 404);
  const media = message.media;
  if (!media || media.type !== 'photo') {
    throw new EngineError('Message has no downloadable photo', 400);
  }
  const iterator = client.downloadAsIterable(media);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}
