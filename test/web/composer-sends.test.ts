import { describe, expect, it, vi } from 'vitest';
import { composerSends } from '../../apps/web/src/composer-sends';

/**
 * The view's send wrappers: every one clears the open reply target before it
 * hands the send on, so a second message never carries the previous reply.
 */

describe('composerSends', () => {
  function harness() {
    const clearReply = vi.fn();
    const onSend = vi.fn(async () => {});
    const onAttach = vi.fn(async () => {});
    const onSendSticker = vi.fn(async () => {});
    const onPressReplyKeyboard = vi.fn();
    const sends = composerSends({ clearReply, onSend, onAttach, onSendSticker, onPressReplyKeyboard });
    return { sends, clearReply, onSend, onAttach, onSendSticker, onPressReplyKeyboard };
  }

  it('clears the reply target before a text send', async () => {
    const { sends, clearReply, onSend } = harness();
    await sends.send('hello', 3);
    expect(clearReply).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith('hello', 3);
  });

  it('clears the reply target before an attachment', async () => {
    const { sends, clearReply, onAttach } = harness();
    const request = { files: [], caption: '', grouped: false, sendAsFile: false };
    await sends.attach(request);
    expect(clearReply).toHaveBeenCalled();
    expect(onAttach).toHaveBeenCalledWith(request);
  });

  it('clears the reply target before a sticker', async () => {
    const { sends, clearReply, onSendSticker } = harness();
    const sticker = { id: '1', emoji: '🙂', kind: 'static' as const, width: 512, height: 512, version: 'v1' };
    await sends.sendSticker(sticker, { id: '10', accessHash: '100' }, 4);
    expect(clearReply).toHaveBeenCalled();
    expect(onSendSticker).toHaveBeenCalledWith(sticker, { id: '10', accessHash: '100' }, 4);
  });

  it('clears the reply target before a reply-keyboard send', () => {
    const { sends, clearReply, onPressReplyKeyboard } = harness();
    sends.pressReplyKeyboard({ kind: 'text', text: 'Yes', style: null }, 5);
    expect(clearReply).toHaveBeenCalled();
    expect(onPressReplyKeyboard).toHaveBeenCalledWith({ kind: 'text', text: 'Yes', style: null }, 5);
  });
});
