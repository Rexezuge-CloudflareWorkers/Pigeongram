import type { ActiveReplyKeyboard } from '../reply-keyboard';
import type { BotCommandDto, ChatDto, MessageDto, MessageReplyKeyboardButtonDto } from '../types';
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
  /**
   * The message being edited, or null when the composer is composing a new
   * message. The footer hands it to the composer with the reply target.
   */
  editTarget: MessageDto | null;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => Promise<void>;
  replyTarget: MessageDto | null;
  botCommands: readonly BotCommandDto[];
  /**
   * The chat's active reply keyboard, or null when it shows none. A keyboard
   * only makes sense where the composer does, so it rides here.
   */
  replyKeyboard: ActiveReplyKeyboard | null;
  onCancelReply: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
  /**
   * Presses a reply keyboard button. The reply target rides along, so a
   * keyboard send matches a typed one.
   */
  onPressReplyKeyboard: (button: MessageReplyKeyboardButtonDto, replyTo?: number) => void;
}

export function ThreadFooter({
  chat,
  preview,
  onJoin,
  editTarget,
  onCancelEdit,
  onSaveEdit,
  replyTarget,
  botCommands,
  replyKeyboard,
  onCancelReply,
  onSend,
  onAttach,
  onPressReplyKeyboard,
}: ThreadFooterProps) {
  if (preview !== null) {
    return (
      <div className="composer composer-notice flex items-center justify-between gap-3">
        <span>You Are Previewing This Chat. Join It To Send Messages.</span>
        <button
          type="button"
          className="shrink-0 rounded-full bg-accent px-4 py-2 font-semibold text-[#0b1a1a] transition-colors hover:bg-accent/90 focus-visible:bg-accent/90 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
          onClick={onJoin}
          disabled={preview.joining || preview.requested}
        >
          {preview.joining ? 'Joining…' : preview.requested ? 'Request Sent' : 'Join'}
        </button>
      </div>
    );
  }
  if (!chat.canSendMessages) {
    return <p className="composer composer-notice">{sendBlockedNotice(chat)}</p>;
  }
  return (
    <>
      {/*
      A per-chat instance keeps a draft and an open command menu from leaking
      into the next thread.
      */}
      <Composer
        key={chat.id}
        placeholder={replyKeyboard?.keyboard.placeholder ?? 'Message'}
        editTarget={editTarget}
        replyTarget={replyTarget}
        botCommands={botCommands}
        replyKeyboard={replyKeyboard}
        onCancelReply={onCancelReply}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onSend={onSend}
        onAttach={onAttach}
        onPressReplyKeyboard={onPressReplyKeyboard}
      />
    </>
  );
}

/**
The read-only notice shown in place of the composer: a broadcast channel
explains itself, everything else was restricted by the chat's admins.
*/
function sendBlockedNotice(chat: ChatDto): string {
  return chat.kind === 'channel'
    ? 'Only Admins Can Post In This Channel.'
    : 'The Admins Of This Chat Have Restricted Your Ability To Send Messages.';
}
