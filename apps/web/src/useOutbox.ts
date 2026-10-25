import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PendingMessage } from './outbox';
import { localPreviewUrl, pendingMedia, randomMessageId, revokePreview } from './outbox';
import type { MessageDto, PeerId } from './types';
import type { UploadRequest } from './upload';

/**
 * The outbox behind optimistic sends. A message appears in the thread and the
 * chat list the moment it is enqueued; this hook owns the bridge round trip,
 * per-upload progress, retries and URL cleanup, and never blocks the composer.
 *
 * Text sends are chained per chat so rapid messages keep submission order;
 * uploads run independently, so a large file never delays the next text.
 */

export type PendingBody = { kind: 'text'; text: string; replyTo?: number } | { kind: 'file'; request: UploadRequest };

/**
 * Performs the bridge call for one pending entry. The outbox has already
 * picked the body and generated the random ids; a file batch carries one id
 * per file, so a retry of a single-file send cannot duplicate it.
 */
export type DeliverPending = (
  body: PendingBody,
  randomIds: readonly string[],
  onProgress: (fraction: number) => void,
) => Promise<MessageDto[]>;

interface PendingJob {
  entry: PendingMessage;
  /**
   * The files of an upload entry, kept for the retry.
   */
  request: UploadRequest | null;
  /**
   * The client-chosen Telegram random ids: one for a text message, one per
   * file for an upload.
   */
  randomIds: string[];
  deliver: DeliverPending;
  onSettled: (messages: MessageDto[]) => void;
}

interface EnqueueBase {
  chatId: PeerId;
  scope: string;
  replyTo?: number;
  replyPreview?: MessageDto | null;
  deliver: DeliverPending;
  onSettled: (messages: MessageDto[]) => void;
}

export interface EnqueueTextInput extends EnqueueBase {
  text: string;
}

export interface EnqueueFileInput extends EnqueueBase {
  request: UploadRequest;
}

export interface UseOutboxOptions {
  /**
   * Reports a failed send to the global toast; the pending row keeps the
   * failure and the Retry affordance either way.
   */
  onError: (failure: unknown) => void;
}

export interface OutboxController {
  pending: readonly PendingMessage[];
  send: (input: EnqueueTextInput) => void;
  attach: (input: EnqueueFileInput) => void;
  retry: (key: string) => void;
  discard: (key: string) => void;
  clear: () => void;
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useOutbox({ onError }: UseOutboxOptions): OutboxController {
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const sequence = useRef(0);
  const jobs = useRef(new Map<string, PendingJob>());
  const running = useRef(new Set<string>());
  // One chain of text sends per chat. Failed sends settle their own chain link,
  // so a failure never blocks the next message.
  const chains = useRef(new Map<PeerId, Promise<void>>());
  // `clear` (sign-out) invalidates in-flight work; late answers are ignored.
  const generation = useRef(0);
  const reportError = useRef(onError);

  useEffect(() => {
    reportError.current = onError;
  }, [onError]);

  const update = useCallback((key: string, patch: Partial<PendingMessage>): void => {
    setPending((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }, []);

  const settle = useCallback((key: string, messages: MessageDto[]): void => {
    const job = jobs.current.get(key);
    if (!job) return;
    jobs.current.delete(key);
    revokePreview(job.entry.previewUrl);
    setPending((current) => current.filter((entry) => entry.key !== key));
    if (messages.length > 0) job.onSettled(messages);
  }, []);

  const fail = useCallback(
    (key: string, failure: unknown): void => {
      if (!jobs.current.has(key)) return;
      update(key, { status: 'failed', progress: null, failure: failureText(failure) });
      reportError.current(failure);
    },
    [update],
  );

  const execute = useCallback(
    async (key: string): Promise<void> => {
      if (running.current.has(key)) return;
      const job = jobs.current.get(key);
      if (!job) return;
      running.current.add(key);
      const runGeneration = generation.current;
      try {
        let body: PendingBody;
        if (job.request === null) {
          update(key, { status: 'sending', failure: null, progress: null });
          body = {
            kind: 'text',
            text: job.entry.text,
            ...(job.entry.replyTo !== null && { replyTo: job.entry.replyTo }),
          };
        } else {
          update(key, { status: 'uploading', progress: null, failure: null });
          body = { kind: 'file', request: job.request };
        }
        const messages = await job.deliver(body, job.randomIds, (fraction) => {
          if (runGeneration === generation.current) update(key, { progress: fraction });
        });
        if (runGeneration !== generation.current) return;
        settle(key, messages);
      } catch (failure) {
        if (runGeneration !== generation.current) return;
        fail(key, failure);
      } finally {
        running.current.delete(key);
      }
    },
    [fail, settle, update],
  );

  const chain = useCallback((chatId: PeerId, run: () => Promise<void>): void => {
    const previous = chains.current.get(chatId) ?? Promise.resolve();
    // `run` never rejects: a failed send settles its own link, so the next
    // message in the chat is not blocked by it.
    const next = previous.then(run).finally(() => {
      if (chains.current.get(chatId) === next) chains.current.delete(chatId);
    });
    chains.current.set(chatId, next);
  }, []);

  const add = useCallback(
    (entry: PendingMessage, job: PendingJob, ordered: boolean): void => {
      jobs.current.set(entry.key, job);
      setPending((current) => [...current, entry]);
      if (ordered) chain(entry.chatId, () => execute(entry.key));
      else void execute(entry.key);
    },
    [chain, execute],
  );

  const send = useCallback(
    (input: EnqueueTextInput): void => {
      sequence.current += 1;
      const randomId = randomMessageId();
      const entry: PendingMessage = {
        key: `pending-${String(sequence.current)}`,
        sequence: sequence.current,
        randomId,
        chatId: input.chatId,
        scope: input.scope,
        kind: 'text',
        text: input.text,
        fileCount: 0,
        replyTo: input.replyTo ?? null,
        replyPreview: input.replyPreview ?? null,
        media: null,
        previewUrl: null,
        createdAt: Date.now(),
        status: 'sending',
        progress: null,
        failure: null,
      };
      add(entry, { entry, request: null, randomIds: [randomId], deliver: input.deliver, onSettled: input.onSettled }, true);
    },
    [add],
  );

  const attach = useCallback(
    (input: EnqueueFileInput): void => {
      sequence.current += 1;
      const files = input.request.files;
      const first = files[0];
      if (!first) return;
      // One random id per file: a retry of a single-file send reuses it, so
      // Telegram drops the duplicate if the first attempt actually landed. An
      // album has no client-chosen id (Telegram picks the group's), so a
      // retried album is a new album.
      const randomIds = files.map(() => randomMessageId());
      const entry: PendingMessage = {
        key: `pending-${String(sequence.current)}`,
        sequence: sequence.current,
        randomId: randomIds[0] ?? randomMessageId(),
        chatId: input.chatId,
        scope: input.scope,
        kind: 'file',
        text: input.request.caption,
        fileCount: files.length,
        replyTo: input.request.replyTo ?? null,
        replyPreview: input.replyPreview ?? null,
        media: pendingMedia(first),
        previewUrl: localPreviewUrl(first),
        createdAt: Date.now(),
        status: 'preparing',
        progress: null,
        failure: null,
      };
      add(entry, { entry, request: input.request, randomIds, deliver: input.deliver, onSettled: input.onSettled }, false);
    },
    [add],
  );

  const retry = useCallback(
    (key: string): void => {
      const job = jobs.current.get(key);
      if (!job) return;
      update(key, { status: job.request === null ? 'sending' : 'uploading', progress: null, failure: null });
      if (job.request === null) chain(job.entry.chatId, () => execute(key));
      else void execute(key);
    },
    [chain, execute, update],
  );

  const discard = useCallback((key: string): void => {
    const job = jobs.current.get(key);
    if (!job) return;
    jobs.current.delete(key);
    revokePreview(job.entry.previewUrl);
    setPending((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const clear = useCallback((): void => {
    generation.current += 1;
    for (const job of jobs.current.values()) revokePreview(job.entry.previewUrl);
    jobs.current.clear();
    running.current.clear();
    chains.current.clear();
    setPending([]);
  }, []);

  // A real unmount (sign-out renders the login screen without remounting App)
  // releases the local previews still held by in-flight entries.
  useEffect(
    () => () => {
      generation.current += 1;
      for (const job of jobs.current.values()) revokePreview(job.entry.previewUrl);
      jobs.current.clear();
    },
    [],
  );

  return useMemo(() => ({ pending, send, attach, retry, discard, clear }), [pending, send, attach, retry, discard, clear]);
}
