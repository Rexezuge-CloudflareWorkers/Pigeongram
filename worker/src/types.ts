/**
 * The JSON contract shared by the worker, the Pages proxy function and the SPA:
 * the DTOs the bridge carries. The RPC method shapes — `RpcMethod`, each
 * method's parameters and results — live in `rpc-types.ts`.
 *
 * The SPA keeps its own copy of these types (`pages/src/types.ts`) because it
 * is a separate build with its own tsconfig; keep the two in sync when the
 * contract changes.
 */

/**
Marked Telegram peer id: users are positive, chats negative, channels `-100…`.
*/
export type PeerId = number;

export interface MeDto {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  /**
  Opaque token identifying the current profile photo, or null. It changes
  when the photo changes and only exists to bust the `/user/avatar` cache.
  */
  photo: string | null;
}

export type ChatKind = 'user' | 'bot' | 'group' | 'supergroup' | 'channel';

/**
One entry of a chat's slash-command menu. Telegram carries the command
without its leading slash; the description is the text the bot registered.
*/
export interface BotCommandDto {
  command: string;
  description: string;
}

export interface ChatDto {
  id: PeerId;
  kind: ChatKind;
  title: string;
  username: string | null;
  /**
  Opaque token identifying the current profile photo, or null.
  */
  photo: string | null;
  /**
  Whether the account may post in this chat: broadcast channels are
  admin-only, and a member whose send permission was revoked counts as
  blocked too.
  */
  canSendMessages: boolean;
}

/**
Kinds of rich-text entity the bridge forwards. Mirrors mtcute's
`MessageEntityKind`; the SPA styles the ones it knows and falls back to plain
text for the rest.
*/
export type MessageEntityKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'pre'
  | 'blockquote'
  | 'text_link'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'text_mention'
  | 'emoji'
  | 'date_time'
  | 'bank_card'
  | 'ton_address'
  | 'diff_insert'
  | 'diff_delete'
  | 'diff_replace'
  | 'unknown';

/**
One formatting or link span inside a message text.

`offset`/`length` are UTF-16 code units — the same indexing JS strings use, so
the SPA slices `text` directly.
*/
export interface MessageEntityDto {
  offset: number;
  length: number;
  kind: MessageEntityKind;
  /**
  `text_link` only: where the span points.
  */
  url?: string;
  /**
  `pre` only: the code block's language, when known.
  */
  language?: string;
  /**
  `text_mention` only: the mentioned user's id.
  */
  userId?: PeerId;
}

/**
One reaction aggregate on a message.
*/
export interface MessageReactionDto {
  /**
  Unicode emoji (paid reactions are `⭐`), or `null` for a custom emoji.
  */
  emoji: string | null;
  /**
  Decimal document id of a custom emoji reaction, else `null`.
  */
  customEmojiId: string | null;
  count: number;
  /**
  Whether the current user is one of the reactors.
  */
  chosen: boolean;
}

/**
One answer of a poll message.

`voters` and `correct` are only known once Telegram has shared the poll's
results with this account (after answering a quiz, or when the poll does not
hide them); `null` means "not available yet", which is not the same as zero
voters.
*/
export interface MessagePollAnswerDto {
  text: string;
  voters: number | null;
  chosen: boolean;
  /**
  Quizzes only: whether this is the correct answer; null while unknown.
  */
  correct: boolean | null;
}

/**
A poll message.

Polls are media in MTProto, but they carry no file, so they ride beside
`media` instead of inside it. `id` is the decimal poll id Telegram uses to
recognise the poll across updates.
*/
export interface MessagePollDto {
  /**
  Decimal string of Telegram's 64-bit poll id.
  */
  id: string;
  question: string;
  answers: MessagePollAnswerDto[];
  /**
  Total number of voters, when the results are known.
  */
  totalVoters: number | null;
  closed: boolean;
  quiz: boolean;
  /**
  Whether the poll accepts several answers at once.
  */
  multiple: boolean;
  /**
  Whether retracting (or changing) a vote is disabled.
  */
  revotingDisabled: boolean;
  /**
  Whether the results stay hidden until the poll closes.
  */
  hideResultsUntilClose: boolean;
  /**
  Quiz only: the explanation shown after answering, when Telegram sent one.
  */
  solution: string | null;
}

/**
Telegram's requested emphasis for an inline-keyboard button.
*/
export type MessageButtonStyle = 'primary' | 'danger' | 'success';

/**
One button of a message's inline keyboard.

The `kind` says what a press does. Callback buttons carry their opaque payload
as base64 (JSON has no byte string); URL, web view and copy buttons carry what
they open or place on the clipboard. The remaining kinds are carried so the UI
can show them as disabled instead of silently dropping them.
*/
export type MessageButtonDto = {
  text: string;
  style: MessageButtonStyle | null;
} & (
  | {
      kind: 'callback';
      /**
      Base64 of the button's callback payload, exactly as Telegram sent it.
      */
      data: string;
      /**
      Whether Telegram asks for the account's 2FA password before forwarding
      the press.
      */
      requiresPassword: boolean;
    }
  | { kind: 'url'; url: string }
  | { kind: 'webview'; url: string }
  | { kind: 'copy'; copyText: string }
  | { kind: 'switch_inline'; query: string; samePeer: boolean }
  | { kind: 'url_auth'; url: string }
  | { kind: 'user_profile'; userId: PeerId }
  | { kind: 'game' }
  | { kind: 'pay' }
  | { kind: 'disabled' }
);

/**
A message's inline keyboard: button rows in Telegram's order. Reply keyboards
(and force-reply/hide markups) are not carried yet.
*/
export interface MessageMarkupDto {
  rows: MessageButtonDto[][];
}

/**
The message a message replies to, mapped from Telegram's reply header.

Same-chat headers carry only the message id, so the SPA resolves the sender
and snippet from the loaded thread; cross-chat headers carry the sender, date
and (sometimes) a media descriptor, but their text usually only exists when
the reply quotes a fragment explicitly.
*/
export interface MessageReplyDto {
  /**
  Where the replied-to message lives.
  */
  origin: 'same_chat' | 'other_chat' | 'private';
  /**
  Id of the replied-to message in its chat; null for private-thread replies.
  */
  messageId: number | null;
  /**
  Marked id of the chat the replied-to message lives in (cross-chat replies only).
  */
  chatId: PeerId | null;
  /**
  The replied-to message's sender name, when the header names one; null for
  same-chat replies.
  */
  senderName: string | null;
  /**
  Unix milliseconds of the replied-to message, when the header carries it.
  */
  date: number | null;
  /**
  Explicit quote text, or the text the header carried; empty when neither is present.
  */
  text: string;
  /**
  Rich-text spans of `text` (empty when the reply has none).
  */
  entities: MessageEntityDto[];
  /**
  Kind of the replied-to message's media, when the header embeds it (cross-chat replies).
  */
  mediaKind: MessageMediaKind | null;
  /**
  Whether the reply quotes a fragment of the replied-to message.
  */
  quote: boolean;
}

/**
Channel posts keep their replies in the channel's linked discussion group;
Telegram's `replies` header is the post's pointer into that group.
*/
export interface MessageCommentsDto {
  /**
  Whether the post has a comments section (telegram's `comments` flag).
  */
  hasComments: boolean;
  /**
  Total number of comments in the thread.
  */
  count: number;
  /**
  Marked id of the linked discussion group, when the post names one.
  */
  discussionChatId: PeerId | null;
}

/**
Where a forwarded message came from, mapped from Telegram's forward header.

`senderId`/`senderName` are who Telegram credits as the origin: a user, a
channel, or a hidden sender whose name the header carries instead of an id.
`fromChatId`/`fromMessageId` point at the original message for saved-messages
forwards and channel posts.
*/
export interface MessageForwardDto {
  /**
  Marked id of the original sender (a user or a channel); null when the header
  hides it or names no id.
  */
  senderId: PeerId | null;
  /**
  The origin's display name for the "Forwarded from …" header; a hidden
  forward's chosen name, when the header carries one.
  */
  senderName: string | null;
  /**
  The origin's public username, when it has one; lets the SPA hand an origin
  outside its loaded dialogs to the installed app by username.
  */
  senderUsername: string | null;
  /**
  Unix milliseconds of the original message's date.
  */
  date: number;
  /**
  Marked id of the chat the original message lived in (saved-messages
  forwards only); null otherwise.
  */
  fromChatId: PeerId | null;
  /**
  Id of the original message in its source chat, when the header carries it.
  */
  fromMessageId: number | null;
  /**
  The original channel post's author signature, when set.
  */
  signature: string | null;
}

export interface MessageDto {
  id: number;
  chatId: PeerId;
  /**
  Album membership: messages sharing a non-null `groupedId` are one album and
  render as one bubble. Decimal string of Telegram's 64-bit group id.
  */
  groupedId: string | null;
  senderId: PeerId | null;
  senderName: string | null;
  outgoing: boolean;
  /**
  Unix milliseconds.
  */
  date: number;
  /**
  The message's text or media caption. Service messages carry no text of
  their own; the bridge fills this with the label the UI renders (currently
  the auto-delete timer change) and leaves it empty for other actions.
  */
  text: string;
  /**
  Rich-text spans of `text` (empty when the message has none).
  */
  entities: MessageEntityDto[];
  /**
  Reaction aggregates, most relevant first (empty when the message has none).
  */
  reactions: MessageReactionDto[];
  service: boolean;
  /**
  The message's downloadable media, or null for text/service messages and
  non-file media such as polls.
  */
  media: MessageMediaDto | null;
  /**
  The message's poll, or null when it is not a poll message.
  */
  poll: MessagePollDto | null;
  /**
  The message's inline keyboard, or null when it has none.
  */
  markup: MessageMarkupDto | null;
  /**
  The message this one replies to, or null for a plain message.
  */
  reply: MessageReplyDto | null;
  /**
  Where this message was forwarded from, or null for an original message.
  */
  forward: MessageForwardDto | null;
  /**
  Channel-post view count, or null when Telegram reports none: the message
  does not live in a channel, or the post is too fresh to have been counted.
  */
  views: number | null;
  /**
  Channel-post comments metadata, or null for messages without a thread.
  */
  comments: MessageCommentsDto | null;
}

/**
Kinds of user-visible media the bridge carries. `animation` is Telegram's
GIF-style silent video.
*/
export type MessageMediaKind = 'photo' | 'video' | 'animation' | 'audio' | 'voice' | 'sticker' | 'document';

export interface MessageMediaDto {
  kind: MessageMediaKind;
  /**
  Original file name for documents; null for photos.
  */
  fileName: string | null;
  /**
  MIME type as sent by the uploader, when known.
  */
  mime: string | null;
  /**
  Size in bytes, when known.
  */
  size: number | null;
  width: number | null;
  height: number | null;
  /**
  Duration in seconds for videos/audio/voice.
  */
  duration: number | null;
}

/**
Media kinds `POST /user/upload` accepts. The SPA maps the file's MIME onto one
of these; the engine never guesses from bytes.
*/
export type UploadKind = 'photo' | 'video' | 'animation' | 'document';

export interface DialogDto {
  chat: ChatDto;
  lastMessage: MessageDto | null;
  unread: number;
  /**
  Id of the last read incoming message; incoming messages after it are the
  unread ones. The SPA opens a chat at this watermark instead of the bottom.
  */
  readInboxMaxId: number;
  /**
  Id of the last outgoing message the peer has read. The SPA shows a single
  check for sent messages and a double check up to this watermark.
  */
  readOutboxMaxId: number;
  pinned: boolean;
  muted: boolean;
}

/**
Updates pushed over the `/user/updates` WebSocket.
*/
export type UpdateEvent =
  | { type: 'new_message'; message: MessageDto }
  | { type: 'edit_message'; message: MessageDto }
  | { type: 'reactions'; chatId: PeerId; messageId: number; reactions: MessageReactionDto[] }
  | { type: 'views'; chatId: PeerId; messageId: number; views: number }
  | {
      type: 'poll';
      /**
      Marked id of the chat holding the poll, when the update names one.
      */
      chatId: PeerId | null;
      /**
      Id of the message holding the poll, when the update names one.
      */
      messageId: number | null;
      /**
      Decimal string of the poll id: a short update names neither the chat nor
      the message, so this is what identifies the poll in the SPA.
      */
      pollId: string;
      /**
      The updated poll, or null for a short update that only says "recheck
      this poll" — the SPA refetches it with `getPollResults` then.
      */
      poll: MessagePollDto | null;
    }
  | {
      type: 'read';
      chatId: PeerId;
      maxId: number;
      /**
      Remaining unread count; only meaningful for inbox reads.
      */
      unread: number;
      /**
      Whether the account's own inbox was read (as opposed to the peer reading
      the account's messages); only inbox reads advance `readInboxMaxId`.
      */
      inbox: boolean;
    };

/**
Messages the SPA sends over the updates socket.
*/
export type ClientSocketMessage = { type: 'hello' } | { type: 'ping' };

/**
Messages the session engine sends over the updates socket.
*/
export type ServerSocketMessage =
  { type: 'ready' } | { type: 'pong' } | { type: 'error'; message: string } | { type: 'update'; update: UpdateEvent };

/**
 * Login phases of the session engine.
 *
 * `scanned` is the window between the phone approving the QR code and the
 * server either completing the login or asking for the 2FA password.
 * `code` is the phone-number flow: a login code was sent and is awaited.
 */
export type LoginPhase = 'unauthorized' | 'qr' | 'scanned' | 'code' | 'password' | 'authorized' | 'error';

export interface EngineStateDto {
  phase: LoginPhase;
  authorized: boolean;
  me: MeDto | null;
  /**
  Present while `phase` is `qr`/`scanned`.
  */
  qrUrl?: string;
  /**
  Unix milliseconds at which `qrUrl` stops being valid.
  */
  qrExpires?: number;
  /**
  The phone number the `code`/`password` phases belong to.
  */
  phone?: string;
  /**
  How the login code was delivered on `phase: 'code'` — `app`, `sms`, `call`, …
  */
  codeType?: string;
  /**
  Set after the server rejected a login code.
  */
  codeInvalid?: boolean;
  /**
  Set after the server rejected a 2FA password.
  */
  passwordInvalid?: boolean;
  /**
  Present when `phase` is `error`.
  */
  error?: string;
}
