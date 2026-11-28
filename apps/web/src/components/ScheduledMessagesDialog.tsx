import { useTranslation } from 'react-i18next';
import { formatDateTime, formatListStamp, previewOf } from '../format';
import type { ScheduledMessagesController } from '../useScheduledMessages';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Spinner } from './Spinner';

/**
The chat's scheduled queue, in the send order Telegram will use.

This is a plain overlay, like the pinned list: it is not a history layer, so
Back leaves the thread rather than closing the dialog. A row offers the three
writes that make sense for a message that has not been sent yet — send it now,
edit its text or time, or drop it — and nothing a live message would offer
there (reply, reactions, forwarding, read receipts).
*/

interface ScheduledMessagesDialogProps {
  controller: ScheduledMessagesController;
}

export function ScheduledMessagesDialog({ controller }: ScheduledMessagesDialogProps) {
  const { t } = useTranslation();
  const { isOpen, messages, loading, error, busyIds, close, sendNow, remove, edited } = controller;
  if (!isOpen) return null;
  return (
    <Dialog
      title={t('scheduled.title', 'Scheduled Messages')}
      className="max-w-[520px]"
      onClose={close}
      actions={
        <Button variant="text" onClick={close} data-dialog-cancel>
          {t('common.close', 'Close')}
        </Button>
      }
    >
      {loading && messages.length === 0 ? <Spinner inline size={16} label={t('scheduled.loading', 'Loading Scheduled Messages…')} /> : null}
      {error !== null && messages.length === 0 ? <p className="text-error">{error}</p> : null}
      {!loading && error === null && messages.length === 0 ? <p>{t('scheduled.empty', 'No Scheduled Messages.')}</p> : null}
      {messages.length > 0 ? (
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {messages.map((message) => {
            const busy = busyIds.has(message.id);
            return (
              <li key={message.id} className="rounded-lg bg-surface-container-low px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="shrink-0 text-xs text-on-surface-variant" title={formatDateTime(message.date)}>
                    {formatListStamp(message.date)}
                  </span>
                  <span className="truncate text-sm text-on-surface-variant">{previewOf(message.text, message.media, message.poll)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button variant="text" disabled={busy} onClick={() => void sendNow(message)}>
                    {t('scheduled.sendNow', 'Send Now')}
                  </Button>
                  <Button
                    variant="text"
                    disabled={busy}
                    onClick={() => {
                      close();
                      edited(message);
                    }}
                  >
                    {t('scheduled.edit', 'Edit')}
                  </Button>
                  <Button variant="text" tone="danger" disabled={busy} onClick={() => void remove(message)}>
                    {t('scheduled.delete', 'Delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error !== null && messages.length > 0 ? <p className="mt-3 text-sm text-error">{error}</p> : null}
    </Dialog>
  );
}
