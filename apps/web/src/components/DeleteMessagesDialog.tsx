import { useTranslation } from 'react-i18next';
import type { MessageDeletion } from '../useMessageDelete';
import { ConfirmDialog } from './ConfirmDialog';
import { Presence } from './Presence';

interface DeleteMessagesDialogProps {
  /**
  The delete flow of whichever controller is on screen.
  */
  deletion: MessageDeletion;
}

/**
The confirmation a delete passes through, shared by the thread and the comments
screen.
A deletion is for everyone, on every device and in the account's own clients,
so it is asked before it is sent. The group is a display group: a single message
or an album and all of its members, which is what the reader picked.
*/
export function DeleteMessagesDialog({ deletion }: DeleteMessagesDialogProps) {
  const { t } = useTranslation();
  const { messages } = deletion;
  const count = messages?.length ?? 0;
  return (
    <Presence visible={messages !== null}>
      {messages === null ? null : (
        <ConfirmDialog
          title={count === 1 ? t('dialogs.deleteMessage', 'Delete Message') : t('dialogs.deleteMessages', 'Delete Messages')}
          message={
            count === 1
              ? t('dialogs.deleteOneBody', 'This Message Will Be Deleted For Everyone.')
              : t('dialogs.deleteManyBody', 'These {{count}} Messages Will Be Deleted For Everyone.', { count })
          }
          confirmLabel={t('common.delete', 'Delete')}
          onConfirm={deletion.confirm}
          onCancel={deletion.cancel}
        />
      )}
    </Presence>
  );
}
