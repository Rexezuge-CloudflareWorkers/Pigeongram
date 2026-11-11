import type { IconName } from './components/Icon';
import type { MessageMediaKind } from './types';

/**
The glyph the chat list puts in front of a media preview, keyed by the media
kind.

A sticker has none on purpose: its preview already leads with Telegram's own
emoji, which is content rather than chrome, so a second glyph would only crowd
the line. An unsupported payload has nothing to draw either — its preview label
is the whole message.
*/
const MEDIA_ICONS: Record<MessageMediaKind, IconName | null> = {
  photo: 'image',
  video: 'video',
  animation: 'gif',
  audio: 'music',
  voice: 'mic',
  sticker: null,
  document: 'document',
  unsupported: null,
};

/**
The media kind's chat-list glyph, or null when the preview's text already says
everything (a sticker's emoji, an unsupported message's label).
*/
export function mediaIcon(kind: MessageMediaKind): IconName | null {
  return MEDIA_ICONS[kind];
}
