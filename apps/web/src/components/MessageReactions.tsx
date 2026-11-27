import { useTranslation } from 'react-i18next';
import { reactionKey } from '../state';
import type { MessageDto, MessageReactionDto } from '../types';

/**
The reaction chips under a message bubble. Views that cannot react render the
chips as a static pair (emoji and count); the others make each one a toggle,
and the chip the last tap adopted carries the burst marker until it fades.

Kept beside the row so the row stays under the god-file cap.
*/
export function MessageReactions({
  message,
  reacting,
  onReact,
  burstKey,
  burst,
}: {
  message: MessageDto;
  reacting: boolean;
  onReact?: (message: MessageDto, reaction: MessageReactionDto) => void;
  /**
  The reaction whose chip is bursting, or null.
  */
  burstKey: string | null;
  burst: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="reactions">
      {message.reactions.map((reaction) => {
        const title = reaction.emoji ?? t('a11y.customEmoji', 'Custom emoji');
        const emoji = <span className="reaction-emoji">{reaction.emoji ?? '◻'}</span>;
        const count = <span className="reaction-count">{reaction.count}</span>;
        if (!onReact) {
          return (
            <span key={reactionKey(reaction)} className={`reaction is-static${reaction.chosen ? ' chosen' : ''}`} title={title}>
              {emoji}
              {count}
            </span>
          );
        }
        return (
          <button
            key={reactionKey(reaction)}
            type="button"
            className={`reaction${reaction.chosen ? ' chosen' : ''}${burstKey === reactionKey(reaction) ? ' burst' : ''}`}
            disabled={reacting}
            title={title}
            aria-label={t('thread.reactLabel', 'React {{title}} ({{count}})', { title, count: reaction.count })}
            aria-pressed={reaction.chosen}
            onClick={() => {
              if (!reaction.chosen) burst(reactionKey(reaction));
              onReact(message, reaction);
            }}
          >
            {emoji}
            {count}
          </button>
        );
      })}
    </div>
  );
}
