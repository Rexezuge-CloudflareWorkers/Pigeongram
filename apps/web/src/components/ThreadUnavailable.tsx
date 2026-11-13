import { Icon } from './Icon';

/**
 * The thread of a chat Telegram no longer offers to this account.
 *
 * The engine answers a chat the account left, or one that was deleted, with
 * `not_found`, and retrying that read cannot bring it back. So the pane says
 * what happened and offers the one action that works — leaving it — instead of
 * an empty thread and a composer whose sends would all fail.
 */
interface ThreadUnavailableProps {
  onBack: () => void;
}

export function ThreadUnavailable({ onBack }: ThreadUnavailableProps) {
  return (
    <section className="thread empty" aria-labelledby="thread-unavailable-title">
      <span className="thread-empty-mark" aria-hidden="true">
        <Icon name="info" size={44} />
      </span>
      <h2 className="thread-empty-title" id="thread-unavailable-title">
        This Chat Is No Longer Available
      </h2>
      <p className="muted thread-empty-hint max-w-[46ch] text-center">
        Telegram Does Not Offer This Chat To Your Account Anymore. It May Have Been Deleted, Or Your Account May Have Left It.
      </p>
      <button type="button" className="ghost" onClick={onBack}>
        Back To Chats
      </button>
    </section>
  );
}
