/**
 * The placeholder of a thread with no loaded messages.
 *
 * Telegram introduces an empty chat with its description — a bot's own
 * description, or a group's — so that text takes the place of the generic
 * prompt. A public preview keeps the plain prompt: there is no conversation to
 * say hello to, and joining is what starts one.
 */

interface ThreadEmptyProps {
  /**
   * The text Telegram shows in an empty chat, or null when the chat has none.
   */
  description: string | null;
  /**
   * Whether the open chat is a public preview the account has not joined.
   */
  preview: boolean;
}

export function ThreadEmpty({ description, preview }: ThreadEmptyProps) {
  const text = description?.trim() ? description : null;
  if (text !== null) {
    return <p className="muted pad max-w-[46ch] self-center break-words whitespace-pre-wrap text-center text-[15px] leading-6">{text}</p>;
  }
  return <p className="muted pad">{preview ? 'No messages yet.' : 'No messages yet — say hello.'}</p>;
}
