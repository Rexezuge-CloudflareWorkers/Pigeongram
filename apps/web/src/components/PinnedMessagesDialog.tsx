import { useTranslation } from 'react-i18next';
import { formatListStamp, previewOf } from '../format';
import type { PinnedMessagesController } from '../usePinnedMessages';
import type { ChatDto, MessageDto } from '../types';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Spinner } from './Spinner';

/**
The chat's pinned messages, newest first, in a card beside the thread.

The banner opens it; each row jumps to its post through the thread's own
linked-post route, even when the message sits outside the loaded window. The
list is its own read and pages with Telegram's cursor, so a chat with many
pins costs only the page the reader asked for.
*/

interface PinnedMessagesDialogProps {
  chat: ChatDto;
  controller: PinnedMessagesController;
  onOpenPost: (messageId: number) => void;
}

function senderOf(message: MessageDto, chat: ChatDto, you: string): string {
  if (message.outgoing) return you;
  return message.senderName ?? chat.title;
}

export function PinnedMessagesDialog({ chat, controller, onOpenPost }: PinnedMessagesDialogProps) {
  const { t } = useTranslation();
  const { isOpen, messages, loading, loadingOlder, error, hasMore, close, loadOlder } = controller;
  if (!isOpen) return null;
  const open = (message: MessageDto): void => {
    close();
    onOpenPost(message.id);
  };
  return (
    <Dialog
      title={t('thread.pinnedMessagesTitle', 'Pinned Messages')}
      className="max-w-[520px]"
      onClose={close}
      actions={
        <Button variant="text" onClick={close} data-dialog-cancel>
          {t('common.close', 'Close')}
        </Button>
      }
    >
      {loading && messages.length === 0 ? <Spinner inline size={16} label={t('thread.loadingPinned', 'Loading Pinned Messages…')} /> : null}
      {error !== null && messages.length === 0 ? <p className="text-error">{error}</p> : null}
      {!loading && error === null && messages.length === 0 ? <p>{t('thread.noPinned', 'No Pinned Messages.')}</p> : null}
      {messages.length > 0 ? (
        <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
          {messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => open(message)}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-on-surface">{senderOf(message, chat, t('thread.you', 'You'))}</span>
                  <span className="shrink-0 text-xs text-on-surface-variant">{formatListStamp(message.date)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-on-surface-variant">
                  {previewOf(message.text, message.media, message.poll)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hasMore ? (
        <div className="mt-3 flex justify-center">
          <Button variant="text" disabled={loadingOlder} aria-busy={loadingOlder} onClick={loadOlder}>
            {loadingOlder ? (
              <Spinner inline size={14} label={t('common.loading', 'Loading…')} />
            ) : (
              t('thread.loadOlderPinned', 'Load Older Pinned Messages')
            )}
          </Button>
        </div>
      ) : null}
      {error !== null && messages.length > 0 ? <p className="mt-3 text-sm text-error">{error}</p> : null}
    </Dialog>
  );
}
