import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingMessageRow } from '../../apps/web/src/components/PendingMessageRow';
import type { PendingMessage } from '../../apps/web/src/outbox';
import type { MessageDto, MessageMediaDto } from '../../apps/web/src/types';

/**
 * The optimistic bubble: one row per send in flight, reading its status and
 * its local preview from the outbox entry rather than from Telegram.
 */

function entry(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    key: 'k1',
    sequence: 1,
    randomId: '42',
    chatId: 10,
    scope: '10',
    kind: 'text',
    text: 'Hello',
    fileCount: 0,
    replyTo: null,
    replyPreview: null,
    media: null,
    previewUrl: null,
    createdAt: 1_700_000_000_000,
    status: 'sending',
    progress: null,
    failure: null,
    ...overrides,
  };
}

function media(overrides: Partial<MessageMediaDto> = {}): MessageMediaDto {
  return {
    kind: 'photo',
    fileName: 'holiday.jpg',
    mime: 'image/jpeg',
    size: 2048,
    width: 320,
    height: 240,
    duration: null,
    ...overrides,
  };
}

function preview(text = 'Earlier'): MessageDto {
  return {
    id: 9,
    chatId: 10,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

function renderRow(
  overrides: Partial<PendingMessage> = {},
  handlers: { retry?: (key: string) => void; discard?: (key: string) => void } = {},
) {
  const onRetry = vi.fn(handlers.retry);
  const onDiscard = vi.fn(handlers.discard);
  const view = render(<PendingMessageRow entry={entry(overrides)} onRetry={onRetry} onDiscard={onDiscard} />);
  return { ...view, onRetry, onDiscard };
}

afterEach(cleanup);

describe('PendingMessageRow', () => {
  it('shows a sending bubble with its text and status', () => {
    renderRow();

    expect(screen.getByText('Hello')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Sending…');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('labels each status the outbox reports', () => {
    renderRow({ status: 'preparing' });
    expect(screen.getByRole('status').textContent).toContain('Preparing…');

    cleanup();
    renderRow({ status: 'uploading', progress: null });
    expect(screen.getByRole('status').textContent).toContain('Uploading…');

    cleanup();
    renderRow({ status: 'uploading', progress: 0.42 });
    expect(screen.getByRole('status').textContent).toContain('Uploading 42%');

    cleanup();
    renderRow({ status: 'uploading', progress: 1 });
    expect(screen.getByRole('status').textContent).toContain('Uploading…');
  });

  it('offers retry and discard only after a failure, with the reason', () => {
    const { onRetry, onDiscard } = renderRow({ status: 'failed', failure: 'Network down' });

    expect(screen.getByRole('status').textContent).toContain('Not sent');
    expect(screen.getByTitle('Network down')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onRetry).toHaveBeenCalledWith('k1');
    expect(onDiscard).toHaveBeenCalledWith('k1');
  });

  it('leaves the reason out when the outbox did not record one', () => {
    renderRow({ status: 'failed' });

    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    expect(document.querySelector('.pending-failure')).toBeNull();
  });

  it('quotes the message the send replies to', () => {
    renderRow({ replyTo: 9, replyPreview: preview('Earlier question') });

    expect(screen.getByText('Earlier question')).not.toBeNull();
  });

  it('previews a local photo and falls back to a file when it cannot load', () => {
    const { container } = renderRow({ media: media(), previewUrl: 'blob:photo' });

    const image = container.querySelector('img.photo') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('blob:photo');
    expect(image.getAttribute('alt')).toBe('holiday.jpg');

    fireEvent.error(image);
    expect(container.querySelector('.pending-file')).not.toBeNull();
    expect(screen.getByText(/holiday\.jpg/)).not.toBeNull();
    expect(screen.getByText('· 2.0 KB', { exact: false })).not.toBeNull();
  });

  it('previews a video with controls and an animation with autoplay', () => {
    const video = renderRow({ media: media({ kind: 'video', fileName: 'clip.mp4' }), previewUrl: 'blob:clip' });
    const player = video.container.querySelector('video.video') as HTMLVideoElement;
    expect(player.hasAttribute('controls')).toBe(true);
    expect(player.getAttribute('src')).toBe('blob:clip');

    cleanup();
    const animation = renderRow({ media: media({ kind: 'animation', fileName: 'loop.gif' }), previewUrl: 'blob:loop' });
    const loop = animation.container.querySelector('video.video') as HTMLVideoElement;
    expect(loop.hasAttribute('autoplay')).toBe(true);
    expect(loop.hasAttribute('loop')).toBe(true);
    expect(loop.hasAttribute('controls')).toBe(false);
  });

  it('describes every file-only kind without a preview', () => {
    for (const kind of ['document', 'audio', 'voice'] as const) {
      cleanup();
      const { container } = renderRow({
        media: media({ kind, fileName: `${kind}.bin`, size: 1024 }),
        previewUrl: 'blob:file',
        fileCount: 2,
      });
      expect(container.querySelector('.pending-file')).not.toBeNull();
      expect(screen.getByText(new RegExp(String.raw`${kind}\.bin`))).not.toBeNull();
      expect(screen.getByText(/2 files/)).not.toBeNull();
    }
  });

  it('uses a fallback name and no size when the file has neither', () => {
    const { container } = renderRow({
      media: media({ kind: 'document', fileName: null, size: null }),
      previewUrl: null,
    });

    expect(container.querySelector('.pending-file')?.textContent).toContain('File');
    expect(container.querySelector('.pending-file')?.textContent).not.toContain('·');
  });
});
