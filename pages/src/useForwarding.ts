import { useCallback, useState } from 'react';
import { forwardMessages } from './api';
import type { DialogDto, MessageDto, UpdateEvent } from './types';

/**
The forward controller: the display group waiting for a destination, and the
request that moves it. Kept beside the thread rather than inside it because a
forward has two homes — the destination dialog (through `onSent`) and the open
thread (through `onApplyUpdate`) — while the source thread does not change.

Failures are rethrown for the picker to render inline; the target stays set so
the user can pick another destination or retry.
*/

export interface ForwardController {
  /**
  The display group waiting for a destination, or null while the picker is
  closed.
  */
  target: readonly MessageDto[] | null;
  open: (messages: readonly MessageDto[]) => void;
  close: () => void;
  forward: (dialog: DialogDto) => Promise<void>;
}

export function useForwarding(
  onSent: (message: MessageDto) => void,
  onApplyUpdate: (update: UpdateEvent) => void,
  onNotice: (text: string) => void,
): ForwardController {
  const [target, setTarget] = useState<readonly MessageDto[] | null>(null);

  const open = useCallback((messages: readonly MessageDto[]): void => {
    setTarget(messages);
  }, []);

  const close = useCallback((): void => {
    setTarget(null);
  }, []);

  const forward = useCallback(
    async (dialog: DialogDto): Promise<void> => {
      const source = target?.[0]?.chatId;
      if (target === null || source === undefined) return;
      const result = await forwardMessages(
        source,
        target.map((message) => message.id),
        dialog.chat.id,
      );
      // The thread applies only what belongs to the open chat, so a forward to
      // another dialog cannot leak its copies into the source.
      for (const message of result.messages) {
        onSent(message);
        onApplyUpdate({ type: 'new_message', message });
      }
      setTarget(null);
      onNotice(`Forwarded to ${dialog.chat.title}`);
    },
    [target, onSent, onApplyUpdate, onNotice],
  );

  return { target, open, close, forward };
}
