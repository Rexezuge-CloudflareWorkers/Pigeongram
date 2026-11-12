import { initials } from '../format';
import type { ChatInvitePreviewDto } from '../types';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * The card a private invite link opens: what Telegram knows about a chat the
 * account is not in yet, and the one write that changes that.
 *
 * Telegram's `chatInvite` carries a title, a kind, a member count and an
 * approval flag, but no peer — so there is nothing to open until the join
 * succeeds. The card is the reader's decision, and the shared `Dialog` owns the
 * modal behaviours; this adds only the chat's face and the two actions.
 */

interface InviteDialogProps {
  preview: ChatInvitePreviewDto;
  /**
   * A join is in flight; both actions are disabled while it runs.
   */
  joining: boolean;
  /**
   * Telegram took the join request and an admin has to approve it. The card
   * stays up so the reader can see why Join will not move.
   */
  requested: boolean;
  onJoin: () => void;
  onClose: () => void;
  /**
   * Whether the card is animating out; forwarded to the shared Dialog.
   */
  exiting?: boolean;
}

const KIND_LABEL: Record<ChatInvitePreviewDto['kind'], string> = {
  group: 'Group',
  supergroup: 'Supergroup',
  channel: 'Channel',
};

export function InviteDialog({ preview, joining, requested, onJoin, onClose, exiting = false }: InviteDialogProps) {
  const busy = joining || requested;
  return (
    <Dialog
      title="Join Chat"
      onClose={onClose}
      busy={busy}
      initialFocus="cancel"
      exiting={exiting}
      actions={
        <>
          <span data-dialog-cancel className="contents">
            <Button tone="primary" variant="text" className="min-w-[88px]" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </span>
          <Button tone="accent" className="min-w-[88px]" disabled={busy} onClick={onJoin}>
            {joining ? 'Joining…' : requested ? 'Request Sent' : 'Join'}
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
            {KIND_LABEL[preview.kind]} · {preview.memberCount.toLocaleString()} Members
          </p>
        </div>
        {preview.about === null ? null : <p className="text-sm text-muted">{preview.about}</p>}
        {preview.withApproval ? <p className="text-sm text-muted">An Admin Has To Approve Your Join Request.</p> : null}
        {requested ? <p className="text-sm text-muted">Your Join Request Was Sent.</p> : null}
      </div>
    </Dialog>
  );
}
