import { useCallback, useState } from 'react';
import { pressCallbackButton } from './api';
import { writeClipboard } from './clipboard';
import type { MessageButtonDto, MessageDto } from './types';

/**
The button half of a message controller: the message ids with a callback in
flight, and the action a press runs.

Callback buttons go through the bridge; copy buttons stay local. URL and web
view buttons are anchors in `MessageButtons`, so they never reach this hook.
*/

export interface MessageButtonController {
  /**
  Message ids with a callback press in flight; their callback buttons are
  disabled meanwhile.
  */
  pressingIds: ReadonlySet<number>;
  /**
  Runs a callback or copy button's action. Other kinds are the UI's business
  (anchors) or unsupported (disabled).
  */
  press: (message: MessageDto, button: MessageButtonDto) => void;
}

export function useMessageButtons(onNotice: (text: string) => void, onError: (failure: unknown) => void): MessageButtonController {
  const [pressingIds, setPressingIds] = useState<ReadonlySet<number>>(new Set());

  const press = useCallback(
    (message: MessageDto, button: MessageButtonDto): void => {
      if (button.kind === 'copy') {
        void writeClipboard(button.copyText)
          .then(() => onNotice('Copied to clipboard'))
          .catch(onError);
        return;
      }
      if (button.kind !== 'callback' || button.requiresPassword || pressingIds.has(message.id)) return;

      setPressingIds((current) => new Set(current).add(message.id));
      void pressCallbackButton(message.chatId, message.id, button.data)
        .then((answer) => {
          if (answer.url !== null && window.open(answer.url, '_blank', 'noopener,noreferrer') === null) {
            onNotice('The bot asked to open a link; allow pop-ups for this site.');
          }
          if (answer.text !== null && answer.text.length > 0) {
            if (answer.alert) alert(answer.text);
            else onNotice(answer.text);
          }
        })
        .catch(onError)
        .finally(() => {
          setPressingIds((current) => {
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        });
    },
    [pressingIds, onNotice, onError],
  );

  return { pressingIds, press };
}
