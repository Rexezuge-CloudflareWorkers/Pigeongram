import { useTranslation } from 'react-i18next';
import { initials } from '../format';
import type { ChatInvitePreviewDto } from '../types';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
The card a private invite link opens: what Telegram knows about a chat the
account is not in yet, and the one write that changes that.

Telegram's `chatInvite` carries a title, a kind, a member count and an
approval flag, but no peer — so there is nothing to open until the join
succeeds. The card is the reader's decision, and the shared `Dialog` owns the
modal behaviours; this adds only the chat's face and the two actions.
*/

interface InviteDialogProps {
  preview: ChatInvitePreviewDto;
  /**
  A join is in flight; both actions are disabled while it runs.
  */
  joining: boolean;
  /**
  Telegram took the join request and an admin has to approve it. The card
  stays up so the reader can see why Join will not move.
  */
  requested: boolean;
  onJoin: () => void;
  onClose: () => void;
  /**
  Whether the card is animating out; forwarded to the shared Dialog.
  */
  exiting?: boolean;
}

const KIND_KEY: Record<ChatInvitePreviewDto['kind'], [string, string]> = {
  group: ['chats.kindGroup', 'Group'],
  supergroup: ['chats.kindSupergroup', 'Supergroup'],
  channel: ['chats.kindChannel', 'Channel'],
};

export function InviteDialog({ preview, joining, requested, onJoin, onClose, exiting = false }: InviteDialogProps) {
  const { t } = useTranslation();
  const busy = joining || requested;
  const [kindKey, kindText] = KIND_KEY[preview.kind];
  return (
    <Dialog
      title={t('invite.title', 'Join Chat')}
      onClose={onClose}
      busy={busy}
      initialFocus="cancel"
      exiting={exiting}
      actions={
        <>
          <span data-dialog-cancel className="contents">
            <Button tone="primary" variant="text" className="min-w-[88px]" disabled={busy} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </span>
          <Button tone="accent" className="min-w-[88px]" disabled={busy} onClick={onJoin}>
            {joining ? t('common.joining', 'Joining…') : requested ? t('common.requestSent', 'Request Sent') : t('common.join', 'Join')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className="avatar size-20 text-2xl">
          {initials(preview.title)}
        </span>
        <div>
          <p className="text-base font-medium">{preview.title}</p>
          <p className="text-sm text-muted">
            {t(kindKey, kindText)} · {t('invite.memberCount', '{{count, number}} Members', { count: preview.memberCount })}
          </p>
        </div>
        {preview.about === null ? null : <p className="text-sm text-muted">{preview.about}</p>}
        {preview.withApproval ? (
          <p className="text-sm text-muted">{t('invite.approval', 'An Admin Has To Approve Your Join Request.')}</p>
        ) : null}
        {requested ? <p className="text-sm text-muted">{t('invite.requestSent', 'Your Join Request Was Sent.')}</p> : null}
      </div>
    </Dialog>
  );
}
