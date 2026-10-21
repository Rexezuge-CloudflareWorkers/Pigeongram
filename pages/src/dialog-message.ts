import type { DialogMessageDto, MessageDto } from './types';

/**
The chat list's view of a message.

The list renders a preview, a timestamp and a media or poll label; the rest
of a message — its entities, reactions, inline markup and nested reply quote
— belongs to the thread. The engine trims the dialogs it sends, and the live
updates the socket pushes are trimmed the same way here, so both paths end
up with the same shape.
*/
export function toDialogMessage(message: MessageDto): DialogMessageDto {
  return {
    id: message.id,
    date: message.date,
    text: message.text,
    media: message.media,
    poll: message.poll,
    outgoing: message.outgoing,
    service: message.service,
  };
}
