import type { BotCommandDto, ChatDto, MessageDto } from '../types';
import type { UploadRequest } from '../upload';
import { Composer } from './Composer';

/**
 * The bottom of the thread: the composer, the Join action for a preview, or
 * the notice that explains why the account cannot post here.
 *
 * Split from `ThreadView.tsx` so the view keeps the scroll and read logic
 * while this one decides which of the three takes the composer's place.
 */

interface ThreadFooterProps {
  chat: ChatDto;
  /**
   * The open chat as a public preview, when the account has not joined it.
   */
  preview: { joining: boolean; requested: boolean } | null;
  onJoin: () => void;
  replyTarget: MessageDto | null;
  botCommands: readonly BotCommandDto[];
  onCancelReply: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
}

export function ThreadFooter({ chat, preview, onJoin, replyTarget, botCommands, onCancelReply, onSend, onAttach }: ThreadFooterProps) {
  if (preview !== null) {
    return (
      <div className="composer composer-notice flex items-center justify-between gap-3">
        <span>You are previewing this chat. Join it to send messages.</span>
        <button
          type="button"
          className="shrink-0 rounded-full bg-accent px-4 py-2 font-semibold text-[#0b1a1a] transition-colors hover:bg-accent/90 focus-visible:bg-accent/90 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
          onClick={onJoin}
          disabled={preview.joining || preview.requested}
        >
          {preview.joining ? 'Joining…' : preview.requested ? 'Request sent' : 'Join'}
        </button>
      </div>
    );
  }
  if (!chat.canSendMessages) {
    return <p className="composer composer-notice">{sendBlockedNotice(chat)}</p>;
  }
  return (
    // A per-chat instance keeps a draft and an open command menu from leaking
    // into the next thread.
    <Composer
      key={chat.id}
      placeholder="Message"
      replyTarget={replyTarget}
      botCommands={botCommands}
      onCancelReply={onCancelReply}
      onSend={onSend}
      onAttach={onAttach}
    />
  );
}

/**
The read-only notice shown in place of the composer: a broadcast channel
explains itself, everything else was restricted by the chat's admins.
*/
function sendBlockedNotice(chat: ChatDto): string {
  return chat.kind === 'channel'
    ? 'Only admins can post in this channel.'
    : 'The admins of this chat have restricted your ability to send messages.';
}
