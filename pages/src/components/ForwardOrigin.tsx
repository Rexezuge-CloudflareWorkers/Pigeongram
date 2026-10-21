import { useForwardOriginHandler } from '../telegram-links';
import type { MessageForwardDto } from '../types';

/**
 * The "Forwarded from …" line above a bubble's sender.
 *
 * Only the origin's name is a control: the arrow and the prefix stay text. A
 * hidden forward has no addressable origin, so its name stays text too.
 */
export function ForwardOrigin({ forward }: { forward: MessageForwardDto }) {
  const open = useForwardOriginHandler();
  const label = forward.senderName ?? 'a hidden user';
  const target = forward.senderId ?? forward.fromChatId;
  if (open === null || target === null) {
    return <span className="forward-origin">↗ Forwarded from {label}</span>;
  }
  return (
    <span className="forward-origin">
      ↗ Forwarded from{' '}
      <button
        type="button"
        className="forward-origin-link"
        title={`Open ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          open(forward);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {label}
      </button>
    </span>
  );
}
