/**
 * The SPA's copy of the JSON contract the bridge carries: the DTOs of
 * `@pigeongram/shared`'s `types.ts`.
 *
 * The SPA is a separate build with its own tsconfig and ships no backend
 * package, so the contract is mirrored here by hand. Keep the two files in
 * sync when the contract changes; `apps/web/src/call-types.ts` is mirrored
 * the same way.
 */

import type { CallDto } from './call-types';

export type { CallDto, CallConnectionDto, CallProtocolDto, CallState } from './call-types';

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
A peer's presence. Only a person has one — a bot, a group and a channel never
do, and Telegram hides the state of people who keep their last seen to
themselves.
*/
export type PresenceStatus = 'online' | 'offline' | 'recently' | 'within_week' | 'within_month';

export interface PresenceDto {
  status: PresenceStatus;
  /**
  Unix milliseconds of the last sighting. Only meaningful for `offline`,
  where Telegram reports the exact time; the coarser states say only "some
  time ago".
  */
  lastSeenAt: number | null;
}

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
  /**
  The peer's presence, or null when it has none (a bot, a group, a channel)
  or when Telegram did not tell us.
  */
  presence: PresenceDto | null;
}

/**
A peer's profile: what the chat list does not carry.

The chat summary is a line in a list; the profile is the peer itself. A
person brings a bio, a group or a channel brings a description and a member
count, so the fields only one of them has are null for the other.
*/
export interface ProfileDto {
  id: PeerId;
  kind: ChatKind;
  /**
  The display name: a person's name, a chat's title.
  */
  title: string;
  username: string | null;
  /**
  The "about" text: a person's bio, a group's or channel's description.
  */
  about: string | null;
  /**
  Opaque token identifying the current profile photo, or null. It changes
  when the photo changes and only exists to bust the `/user/avatar` cache.
  */
  photo: string | null;
  /**
  How many members a group or a channel has; null for a person, and for a
  basic group, which Telegram does not count.
  */
  membersCount: number | null;
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
and snippet from the loaded thread; the engine fills them in when the original
sits outside the page it just read. Cross-chat headers carry the sender, date
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
  The replied-to message's sender name, when known: named by a cross-chat
  header, or read from an original outside the loaded page.
  */
  senderName: string | null;
  /**
  Whether the replied-to message was sent by this account. The reply header
  itself never says; a resolved original fills the real value, so an own quote
  can say "You".
  */
  outgoing: boolean;
  /**
  Unix milliseconds of the replied-to message, when known.
  */
  date: number | null;
  /**
  Explicit quote text, the text the header carried, or the resolved original's
  text; empty when none is present.
  */
  text: string;
  /**
  Rich-text spans of `text` (empty when the reply has none).
  */
  entities: MessageEntityDto[];
  /**
  Kind of the replied-to message's media, when known: embedded by a cross-chat
  header, or read from an original outside the loaded page.
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
  /**
  Opaque token identifying the sender's current profile photo, or null. It
  changes when the photo changes and only exists to bust the `/user/avatar`
  cache.
  */
  senderPhoto: string | null;
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
  non-file media such as polls and link previews (which ride in `webPage`).
  */
  media: MessageMediaDto | null;
  /**
  The message's link preview (Telegram's `messageMediaWebPage`), or null when
  it has none. The preview's photo is served through `/user/file`, like any
  other media.
  */
  webPage: MessageWebPageDto | null;
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
A link preview: the page Telegram resolved for a URL in a message.

The card is Telegram's own copy of the page — the browser never fetches the
page or its image, so opening a chat leaks nothing to the linked site until the
card is opened. `photo` is the preview image; its `id` is only the
cache-busting token for `/user/file`.
*/
export interface MessageWebPageDto {
  /**
  The page URL the card opens; only `http(s)` URLs are carried.
  */
  url: string;
  /**
  The shortened URL Telegram displays, e.g. `example.com/article`.
  */
  displayUrl: string;
  /**
  The site's name (`og:site_name` or the domain), when Telegram sent one.
  */
  siteName: string | null;
  /**
  The page title (`og:title` or `<title>`), when Telegram resolved one.
  */
  title: string | null;
  /**
  The page description, or the author Telegram supplies as its fallback.
  */
  description: string | null;
  /**
  Telegram's layout hint: `small` keeps the thumbnail beside the text,
  `large` puts it above; `default` leaves it to the client.
  */
  displaySize: 'small' | 'large' | 'default';
  /**
  The preview photo's dimensions and cache-busting id, or null when the page
  has no photo (or only a stripped thumbnail).
  */
  photo: {
    /**
    The photo's Telegram id; `/user/file` ignores it and it only changes the
    browser's cache key when the preview photo changes.
    */
    id: string;
    width: number;
    height: number;
  } | null;
}

/**
Media kinds `POST /user/upload` accepts. The SPA maps the file's MIME onto one
of these; the engine never guesses from bytes.
*/
export type UploadKind = 'photo' | 'video' | 'animation' | 'document';

export interface DialogDto {
  chat: ChatDto;
  lastMessage: DialogMessageDto | null;
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
  /**
   * Whether the chat sits in the account's archive — Telegram's peer folder 1.
   * The main list holds the chats in folder 0, and the archive the ones in
   * folder 1; a chat is in exactly one of them.
   */
  archived: boolean;
}

/**
The chat list's view of a dialog's last message.

A trimmed {@link MessageDto}: the list renders a preview, a timestamp and a
media or poll label, and nothing else. Carrying the full message would put
every dialog's entities, reactions, inline markup and nested reply quote into
the chat-list payload — for a hundred dialogs, that is the bulk of the
response and the bulk of the browser's parse.
*/
export interface DialogMessageDto {
  id: number;
  /**
  Unix milliseconds.
  */
  date: number;
  text: string;
  media: MessageMediaDto | null;
  poll: MessagePollDto | null;
  outgoing: boolean;
  service: boolean;
  /**
   * Album membership: messages sharing a non-null `groupedId` are one album
   * and count once towards the unread badge. Decimal string of Telegram's
   * 64-bit group id.
   */
  groupedId: string | null;
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
    }
  | {
      type: 'user_status';
      /**
      The user's plain id, which is also the marked peer id of a user chat.
      */
      userId: PeerId;
      /**
      The new presence, or null when the status carries no state the UI can
      show (Telegram's "unknown" status).
      */
      presence: PresenceDto | null;
    }
  | {
      type: 'call';
      /**
      The call, and where it stands.
      */
      call: CallDto;
    }
  | {
      type: 'call_signaling';
      /**
      The call the packet belongs to, as its decimal id.
      */
      callId: string;
      /**
      The opaque packet, base64. It belongs to the two peers: the engine
      relays it without reading it.
      */
      data: string;
    };

/**
Messages the SPA sends over the updates socket.
*/
export type ClientSocketMessage =
  | { type: 'hello' }
  | { type: 'ping' }
  | {
      type: 'call_signaling';
      /**
      The call the packet belongs to, as its decimal id.
      */
      callId: string;
      /**
      The opaque packet, base64.
      */
      data: string;
    };

/**
Messages the session engine sends over the updates socket.
*/
export type ServerSocketMessage =
  | { type: 'ready' }
  | { type: 'pong' }
  | {
      type: 'error';
      /**
      A sentence the app shows as it arrived: the engine never puts a raw
      exception message in this frame.
      */
      message: string;
      /**
      The engine's coarse error code, when the failure carried one.
      */
      code?: string;
    }
  | { type: 'update'; update: UpdateEvent };

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

/**
 * The RPC half of the contract: the method names exposed over `POST /user/rpc`,
 * their parameters and their results. Kept beside the DTOs above because the SPA
 * mirrors both in this one allowlisted contract file.
 */

export interface RpcRequestDto {
  method: string;
  params?: Record<string, unknown>;
}

/**
Methods exposed over `POST /user/rpc`.
*/
export type RpcMethod =
  | 'getMe'
  | 'getDialogs'
  | 'getHistory'
  | 'sendMessage'
  | 'forwardMessages'
  | 'readHistory'
  | 'searchMessages'
  | 'searchGlobal'
  | 'sendReaction'
  | 'sendVote'
  | 'pressCallbackButton'
  | 'getPollResults'
  | 'getComments'
  | 'sendComment'
  | 'getBotCommands'
  | 'setArchived'
  | 'getProfile'
  | 'resolveChat'
  | 'joinChat'
  | 'getCallDhConfig'
  | 'requestCall'
  | 'receivedCall'
  | 'acceptCall'
  | 'confirmCall'
  | 'discardCall'
  | 'rateCall'
  // The meta-method: several reads in one request.
  | 'batch';

/**
The methods a `batch` call may carry.

Deliberately the read-only half of {@link RpcMethod}: a batch runs its calls
concurrently, so a write in it would have no defined completion order, and
Telegram's own ordering guarantees matter more than the round trip saved.
`readHistory` is excluded for the same reason it stays a single call — it
mutates the account's read watermark. `setArchived` is excluded because it
moves a chat between the chat list and the archive.
*/
export type BatchableRpcMethod =
  | 'getMe'
  | 'getDialogs'
  | 'getHistory'
  | 'searchMessages'
  | 'searchGlobal'
  | 'getPollResults'
  | 'getComments'
  | 'getBotCommands'
  | 'getProfile'
  | 'resolveChat';

/**
One call inside a `batch`.
*/
export interface RpcBatchCall {
  method: BatchableRpcMethod;
  params?: Record<string, unknown>;
}

/**
The outcome of one call inside a `batch`.

A failed call is reported on its own, so one broken read (a post without a
comments section) never takes the reads beside it down with it.
*/
export interface RpcBatchOutcome {
  ok: boolean;
  /**
  The call's result, when it succeeded.
  */
  result?: unknown;
  /**
  The failure's message, when it failed.
  */
  error?: string;
}

export interface GetDialogsParams {
  limit?: number;
  /**
   * Reads the archive instead of the chat list: `true` returns the chats in
   * Telegram's archive (the peer folder 1), `false` (the default) the main
   * list. The two are separate reads — one limit would otherwise cost the
   * main list the chats the archive holds.
   */
  archived?: boolean;
}

/**
Moves a chat into the archive, or back out of it.
*/
export interface SetArchivedParams {
  chatId: PeerId;
  /**
   * `true` archives the chat, `false` brings it back into the main list.
   */
  archived: boolean;
}

export interface GetHistoryParams {
  chatId: PeerId;
  limit?: number;
  /**
   * Pagination cursor: return messages older than this message. `offsetDate`
   * comes along from the oldest loaded message; a link jump knows only the
   * post's id, and an omitted date reads as 0. The UI de-duplicates by id
   * anyway.
   */
  offsetId?: number;
  offsetDate?: number;
  /**
   * Skips `addOffset` messages from `offsetId` before reading (negative is
   * towards newer messages), so a linked post can land mid-page: the SPA asks
   * for a page around it instead of everything older than it.
   */
  addOffset?: number;
  /**
   * The message the window has to hold: a linked post the reader jumped to.
   * The engine reads around it and, when the first read missed it (a deleted
   * post, or one past the end of the history), reads the page that ends at it
   * instead — the fallback the SPA used to spend a second round trip on.
   */
  anchorId?: number;
}

export interface SendMessageParams {
  chatId: PeerId;
  text: string;
  /**
   * Id of the message to reply to, in the same chat.
   */
  replyTo?: number;
  /**
   * Client-chosen Telegram `random_id` as a positive decimal 64-bit integer.
   * A retry reuses it so an accepted send is not duplicated.
   */
  randomId?: string;
}

export interface ForwardMessagesParams {
  /**
   * The source chat the messages belong to.
   */
  chatId: PeerId;
  /**
   * The destination chat; the account must be allowed to post there.
   */
  toChatId: PeerId;
  /**
   * Ids of the messages to forward, in the source chat. An album forwards as
   * its members; Telegram caps a forward at 100 messages.
   */
  messageIds: number[];
}

export interface ReadHistoryParams {
  chatId: PeerId;
  /**
  Read only up to this message id; omitted reads the whole history. The SPA
  passes what the user actually scrolled through.
  */
  maxId?: number;
}

export interface SearchMessagesParams {
  chatId: PeerId;
  query: string;
  limit?: number;
  /**
   * Pagination cursor: return messages older than this message id, as answered
   * by the previous page's `nextOffsetId`.
   */
  offsetId?: number;
}

export interface SendReactionParams {
  chatId: PeerId;
  messageId: number;
  /**
   * Unicode emoji to set, e.g. `👍`. Mutually exclusive with `customEmojiId`.
   */
  emoji?: string | null;
  /**
   * Decimal document id of a custom emoji to set.
   */
  customEmojiId?: string | null;
}

export interface SendVoteParams {
  chatId: PeerId;
  messageId: number;
  /**
  Indexes of the selected answers, in the order the message carries them;
  `null`/omitted retracts the current vote. Telegram caps a poll at ten
  answers, which is also what the bridge accepts.
  */
  options?: number[] | null;
}

export interface PressCallbackButtonParams {
  chatId: PeerId;
  messageId: number;
  /**
  Base64 of the button's callback payload, exactly as `MessageButtonDto.data`
  carried it.
  */
  data: string;
}

export interface GetPollResultsParams {
  chatId: PeerId;
  messageId: number;
}

export interface GetCommentsParams {
  /**
   * The channel the post belongs to.
   */
  chatId: PeerId;
  /**
   * Id of the channel post whose thread is being read.
   */
  messageId: number;
  limit?: number;
  /**
   * Pagination cursor for older comments: the oldest loaded comment's id and
   * unix-seconds date. Both come together or not at all.
   */
  offsetId?: number;
  offsetDate?: number;
}

export interface SendCommentParams {
  /**
   * The channel the post belongs to.
   */
  chatId: PeerId;
  /**
   * Id of the channel post being commented on.
   */
  messageId: number;
  text: string;
  /**
   * Id of the comment being replied to inside the thread; omitted for a
   * top-level comment.
   */
  replyTo?: number;
  /**
   * Client-chosen Telegram `random_id`, reused by a retry so an accepted
   * comment is not duplicated.
   */
  randomId?: string;
}

export interface GetBotCommandsParams {
  chatId: PeerId;
  /**
   * A channel post whose comment thread is the target: the commands belong to
   * the linked discussion group the engine resolves for the post, not to
   * `chatId`. Omitted for a chat's own menu.
   */
  messageId?: number;
}

export interface GetProfileParams {
  /**
   * The marked peer id whose profile is read.
   */
  chatId: PeerId;
}

/**
 * The chat a link or a forward names, exactly one of a public username and a
 * marked peer id.
 *
 * A username is the durable address: the engine's peer cache is memory-only,
 * so after a restart a bare marked id may carry no access hash while the
 * username resolves again.
 */
export interface ResolveChatParams {
  username?: string;
  chatId?: PeerId;
}

/**
 * A chat the bridge resolved for a link: its DTO and whether the account is in
 * it. A public channel or supergroup the account has not joined is readable
 * but a preview — the SPA offers Join rather than a composer that would fail.
 */
export interface ResolveChatResult {
  chat: ChatDto;
  member: boolean;
}

export interface JoinChatParams {
  username?: string;
  chatId?: PeerId;
}

export interface JoinChatResult {
  /**
   * `joined` means the account is in the chat now (or already was);
   * `request_sent` that an admin has to approve the request; `webview` that a
   * guard bot wants its web view opened before the join can finish.
   */
  status: 'joined' | 'request_sent' | 'webview';
  /**
   * The chat as Telegram returned it after a successful join; null when
   * Telegram returned no chat (a pending request or a guard bot).
   */
  chat: ChatDto | null;
}

export interface GetMeResult {
  me: MeDto;
}

export interface GetDialogsResult {
  dialogs: DialogDto[];
}

/**
The state a chat was left in: `true` when it is in the archive.
*/
export interface SetArchivedResult {
  chatId: PeerId;
  archived: boolean;
}

export interface GetHistoryResult {
  messages: MessageDto[];
}

export interface SendMessageResult {
  message: MessageDto;
}

export interface SendUploadGroupResult {
  /**
   * The album's messages, oldest first, as Telegram returned them.
   */
  messages: MessageDto[];
}

export interface ForwardMessagesResult {
  /**
   * The forwarded copies, as Telegram returned them in the destination chat.
   */
  messages: MessageDto[];
}

export interface SendReactionResult {
  /**
   * The reacted message, when Telegram returned it; `null` otherwise.
   */
  message: MessageDto | null;
}

export interface SearchMessagesResult {
  /**
   * The page, newest first — Telegram's own order for a search.
   */
  messages: MessageDto[];
  /**
   * The cursor for the next, older page; absent when the last page is loaded.
   */
  nextOffsetId?: number;
}

/**
 * Where the next global-search page starts.
 *
 * Telegram paginates `messages.searchGlobal` by a rate, the peer of the last
 * message and that message's id. The peer is sent as a marked id and resolved
 * server-side, so no access hash crosses the bridge.
 */
export interface SearchGlobalCursor {
  rate: number;
  chatId: PeerId;
  messageId: number;
}

export interface SearchGlobalParams {
  query: string;
  limit?: number;
  /**
   * The previous page's `next` cursor. Omitted for the first page.
   */
  offset?: SearchGlobalCursor;
}

export interface SearchGlobalResult {
  /**
   * The page, newest first — Telegram's own order for a global search.
   */
  messages: MessageDto[];
  /**
   * The distinct chats the page's messages belong to, so a result can be
   * rendered and opened even when its chat is not in the loaded chat list.
   */
  chats: ChatDto[];
  /**
   * The cursor for the next, older page; absent when the last page is loaded.
   */
  next?: SearchGlobalCursor;
}

export interface SendVoteResult {
  /**
  The poll as Telegram answered the vote: the caller's selection plus the
  counts that were visible to this account.
  */
  poll: MessagePollDto;
}

export interface PressCallbackButtonResult {
  /**
  The text the bot answered with, for a toast or alarm; null when it answered
  silently.
  */
  text: string | null;
  /**
  Whether Telegram asked for a blocking alert instead of a toast.
  */
  alert: boolean;
  /**
  A URL the bot asked the client to open, or null.
  */
  url: string | null;
}

export interface GetPollResultsResult {
  poll: MessagePollDto;
}

export interface GetCommentsResult {
  /**
   * Comments of one thread window, oldest first.
   */
  comments: MessageDto[];
  /**
   * Total number of comments in the thread.
   */
  count: number;
  /**
   * Marked id of the linked discussion group; null when the thread does not
   * exist yet (no comment was ever posted).
   */
  discussionChatId: PeerId | null;
  /**
   * Id of the thread's root message in the discussion group; null when the
   * thread does not exist yet.
   */
  discussionMessageId: number | null;
  /**
   * Slash commands of the linked discussion group; empty while the thread does
   * not exist yet. The comments composer posts into that group.
   */
  commands: BotCommandDto[];
  /**
   * Pagination cursor for older comments; absent when the oldest comment is
   * loaded.
   */
  nextOffsetId?: number;
  nextOffsetDate?: number;
}

export interface SendCommentResult {
  message: MessageDto;
}

export interface GetBotCommandsResult {
  /** Telegram's commands in its order, de-duplicated by name for a group. */
  commands: BotCommandDto[];
  /** The empty-chat text: a bot's description or a chat's about; null when none. */
  description: string | null;
}

export interface GetProfileResult {
  profile: ProfileDto;
}
