import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatDay, formatListStamp, formatTime, initials, isSameDay, previewOf } from '../../pages/src/format';
import {
  applyEditedMessage,
  applyNewMessage,
  applyOutboxReadUpdate,
  applyPollUpdate,
  applyReactionUpdate,
  applyReadThrough,
  applyReadUpdate,
  applyUserStatus,
  applyViewsUpdate,
  findChatTitle,
  findPollMessage,
  mergeMessages,
  reactionKey,
  replaceMessage,
  toggleReaction,
  updateCommentsPoll,
  updateThread,
  updateThreadPoll,
} from '../../pages/src/state';
import { firstUnread, readWatermark } from '../../pages/src/reading';
import type { ChatDto, DialogDto, DialogMessageDto, MessageDto, MessageMediaDto, MessagePollDto } from '../../pages/src/types';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

const PHOTO: MessageMediaDto = {
  kind: 'photo',
  fileName: null,
  mime: null,
  size: 1000,
  width: 320,
  height: 240,
  duration: null,
};

const POLL: MessagePollDto = {
  id: '1234567890',
  question: 'Tea or coffee?',
  answers: [
    { text: 'Tea', voters: 1, chosen: false, correct: null },
    { text: 'Coffee', voters: 2, chosen: false, correct: null },
  ],
  totalVoters: 3,
  closed: false,
  quiz: false,
  multiple: false,
  revotingDisabled: false,
  hideResultsUntilClose: false,
  solution: null,
};

function message(overrides: Partial<MessageDto> & { id: number; chatId: number }): MessageDto {
  return {
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: NOW,
    text: `message ${overrides.id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    poll: null,
    markup: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
    ...overrides,
  };
}

function chat(id: number): ChatDto {
  return { id, kind: 'user', title: `Chat ${id}`, username: null, photo: null, canSendMessages: true, presence: null };
}

function dialog(id: number, overrides: Partial<DialogDto> = {}): DialogDto {
  return {
    chat: chat(id),
    lastMessage: null,
    unread: 0,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    pinned: false,
    muted: false,
    archived: false,
    ...overrides,
  };
}

/**
The chat list's view of a message: the list renders a preview, not a thread.
*/
function dialogMessage(source: MessageDto): DialogMessageDto {
  return {
    id: source.id,
    date: source.date,
    text: source.text,
    media: source.media,
    poll: source.poll,
    outgoing: source.outgoing,
    service: source.service,
    groupedId: source.groupedId,
  };
}

describe('chat-list state', () => {
  it('ignores messages for chats the list does not know', () => {
    const dialogs = [dialog(1), dialog(2)];
    expect(applyNewMessage(dialogs, message({ id: 1, chatId: 99 }), null)).toBe(dialogs);
  });

  it('moves a chat to the top of the unpinned block and bumps unread', () => {
    const dialogs = [dialog(1, { pinned: true }), dialog(2), dialog(3)];
    const incoming = message({ id: 5, chatId: 3, text: 'third!' });
    const next = applyNewMessage(dialogs, incoming, null);
    expect(next.map((entry) => entry.chat.id)).toEqual([1, 3, 2]);
    expect(next[1].unread).toBe(1);
    // The list keeps a preview of the message, not the whole message.
    expect(next[1].lastMessage).toEqual(dialogMessage(incoming));
  });

  it('counts an album once, however many of its members arrive', () => {
    const dialogs = [dialog(1)];

    const first = applyNewMessage(dialogs, message({ id: 5, chatId: 1, groupedId: '77' }), null);
    expect(first[0].unread).toBe(1);

    // The next member continues the album the badge already counts.
    const second = applyNewMessage(first, message({ id: 6, chatId: 1, groupedId: '77' }), null);
    expect(second[0].unread).toBe(1);

    // A message of its own is a message of its own.
    const plain = applyNewMessage(second, message({ id: 7, chatId: 1 }), null);
    expect(plain[0].unread).toBe(2);
  });

  it('ignores a message the dialog already counted', () => {
    const known = dialog(1, {
      unread: 2,
      readInboxMaxId: 9,
      lastMessage: dialogMessage(message({ id: 10, chatId: 1 })),
    });
    const dialogs = [known];

    // The engine's catch-up replays the messages a reconnect missed, and the
    // chat-list read that booted the screen already counted them. Folding them
    // again would inflate the badge and rewind the preview.
    expect(applyNewMessage(dialogs, message({ id: 9, chatId: 1 }), null)).toBe(dialogs);
    expect(applyNewMessage(dialogs, message({ id: 10, chatId: 1 }), null)).toBe(dialogs);

    // The read watermark is just as final when the preview is behind it.
    const read = dialog(2, { readInboxMaxId: 12 });
    expect(applyNewMessage([read], message({ id: 11, chatId: 2 }), null)).toEqual([read]);

    // A pending send is synthetic: its negative id is not a server id, so the
    // optimistic preview still lands.
    const pending = applyNewMessage(dialogs, message({ id: -1, chatId: 1, outgoing: true, text: 'sending' }), null);
    expect(pending[0].lastMessage?.text).toBe('sending');

    // A genuinely newer message still bumps and previews.
    const next = applyNewMessage(dialogs, message({ id: 11, chatId: 1, text: 'new' }), null);
    expect(next[0].unread).toBe(3);
    expect(next[0].lastMessage?.text).toBe('new');
  });

  it('keeps pinned chats in place and does not bump the open chat or outgoing messages', () => {
    const dialogs = [dialog(1, { pinned: true, unread: 2 }), dialog(2)];
    const pinned = applyNewMessage(dialogs, message({ id: 6, chatId: 1 }), null);
    expect(pinned[0].chat.id).toBe(1);
    expect(pinned[0].unread).toBe(3);

    const active = applyNewMessage(dialogs, message({ id: 7, chatId: 2 }), 2);
    expect(active[1].unread).toBe(0);

    const outgoing = applyNewMessage(dialogs, message({ id: 8, chatId: 2, outgoing: true }), null);
    expect(outgoing[1].unread).toBe(0);
  });

  it('applies read updates and edited last messages', () => {
    const dialogs = [dialog(1, { unread: 5 }), dialog(2)];
    const read = applyReadUpdate(dialogs, 1, 0, 7);
    expect(read[0].unread).toBe(0);
    expect(read[0].readInboxMaxId).toBe(7);
    // A stale read update must not rewind the watermark reading stopped at.
    expect(applyReadUpdate(read, 1, 4, 3)[0].readInboxMaxId).toBe(7);

    const withLast = dialogs.map((entry) =>
      entry.chat.id === 1 ? { ...entry, lastMessage: dialogMessage(message({ id: 9, chatId: 1 })) } : entry,
    );
    const edited = applyEditedMessage(withLast, message({ id: 9, chatId: 1, text: 'edited' }));
    expect(edited[0].lastMessage?.text).toBe('edited');
    expect(edited[1].lastMessage).toBeNull();
  });

  it('advances the outbox watermark from the peer reading, never rewinding it', () => {
    const dialogs = [dialog(1), dialog(2)];
    const read = applyOutboxReadUpdate(dialogs, 1, 7);
    expect(read[0].readOutboxMaxId).toBe(7);
    expect(read[1]).toBe(dialogs[1]);
    // A stale update leaves the watermark where it was.
    expect(applyOutboxReadUpdate(read, 1, 3)[0]).toBe(read[0]);
  });

  it('advances the watermark through what the viewport read, incoming only', () => {
    const dialogs = [dialog(1, { unread: 3, readInboxMaxId: 6 }), dialog(2, { unread: 1 })];
    const messages = [
      message({ id: 7, chatId: 1 }),
      message({ id: 8, chatId: 1, outgoing: true }),
      message({ id: 9, chatId: 1 }),
      message({ id: 10, chatId: 1 }),
    ];

    const through9 = applyReadThrough(dialogs, 1, 9, messages);
    expect(through9[0]).toMatchObject({ readInboxMaxId: 9, unread: 1 });
    expect(through9[1]).toBe(dialogs[1]);

    // Reading on clears the badge; the outgoing message in between counts for
    // nothing.
    expect(applyReadThrough(through9, 1, 10, messages)[0]).toMatchObject({ readInboxMaxId: 10, unread: 0 });
    // A watermark behind the dialog's own leaves it untouched.
    expect(applyReadThrough(through9, 1, 7, messages)[0]).toBe(through9[0]);
  });

  it('reads an album as the one unread message it is', () => {
    // The server counts an album once, so the badge holds one for it.
    const dialogs = [dialog(1, { unread: 1, readInboxMaxId: 6 })];
    const album = [
      message({ id: 7, chatId: 1, groupedId: '77' }),
      message({ id: 8, chatId: 1, groupedId: '77' }),
      message({ id: 9, chatId: 1, groupedId: '77' }),
    ];

    expect(applyReadThrough(dialogs, 1, 9, album)[0]).toMatchObject({ readInboxMaxId: 9, unread: 0 });
  });

  it('counts an album and a plain message as two unread messages', () => {
    const dialogs = [dialog(1, { unread: 2, readInboxMaxId: 6 })];
    const messages = [
      message({ id: 7, chatId: 1, groupedId: '77' }),
      message({ id: 8, chatId: 1, groupedId: '77' }),
      message({ id: 9, chatId: 1 }),
    ];

    expect(applyReadThrough(dialogs, 1, 9, messages)[0]).toMatchObject({ readInboxMaxId: 9, unread: 0 });
  });

  it('finds chat titles by id', () => {
    expect(findChatTitle([dialog(4)], 4)).toBe('Chat 4');
    expect(findChatTitle([dialog(4)], 5)).toBeNull();
  });

  it('folds a presence change into the row of that peer', () => {
    const dialogs = [dialog(1), dialog(2)];
    const online = applyUserStatus(dialogs, 2, { status: 'online', lastSeenAt: null });
    expect(online[1].chat.presence).toEqual({ status: 'online', lastSeenAt: null });
    expect(online[0]).toBe(dialogs[0]);

    const offline = applyUserStatus(online, 2, { status: 'offline', lastSeenAt: 1_700_000_000_000 });
    expect(offline[1].chat.presence).toEqual({ status: 'offline', lastSeenAt: 1_700_000_000_000 });
  });
});

describe('thread state', () => {
  it('merges batches by id, oldest first, with incoming values winning', () => {
    const existing = [message({ id: 2, chatId: 1, text: 'two' }), message({ id: 3, chatId: 1, text: 'three' })];
    const incoming = [message({ id: 1, chatId: 1, text: 'one' }), message({ id: 3, chatId: 1, text: 'three (edited)' })];
    expect(mergeMessages(existing, incoming).map((entry) => [entry.id, entry.text])).toEqual([
      [1, 'one'],
      [2, 'two'],
      [3, 'three (edited)'],
    ]);
  });

  it('replaces messages in place and appends unknown ones', () => {
    const messages = [message({ id: 1, chatId: 1 }), message({ id: 2, chatId: 1 })];
    const replaced = replaceMessage(messages, message({ id: 2, chatId: 1, text: 'new' }));
    expect(replaced[1].text).toBe('new');
    expect(replaced.length).toBe(2);
    expect(replaceMessage(messages, message({ id: 3, chatId: 1 })).length).toBe(3);
  });

  it('applies thread updates only while the thread belongs to the chat', () => {
    const thread = {
      chat: chat(1),
      messages: [message({ id: 1, chatId: 1 })],
      readInboxMaxId: 5,
      readOutboxMaxId: 3,
      unreadDividerId: 2,
      focusMessageId: null,
      hasMoreOlder: true,
      windowEndId: 1,
      latestMessageId: 1,
    };
    const foreign = updateThread(thread, 2, () => [message({ id: 2, chatId: 2 })]);
    expect(foreign).toBe(thread);

    const next = updateThread(thread, 1, (messages) => mergeMessages(messages, [message({ id: 2, chatId: 1 })]));
    expect(next?.messages.map((entry) => entry.id)).toEqual([1, 2]);
    // The thread's read watermark rides along with its messages.
    expect(next?.readInboxMaxId).toBe(5);
    // The divider marks where reading stopped on open and never moves.
    expect(next?.unreadDividerId).toBe(2);
  });

  it('keeps the thread value when nothing changes or no thread is open', () => {
    const thread = {
      chat: chat(1),
      messages: [message({ id: 1, chatId: 1 })],
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      unreadDividerId: null,
      focusMessageId: null,
      hasMoreOlder: true,
      windowEndId: 1,
      latestMessageId: 1,
    };
    expect(updateThread(thread, 1, (messages) => messages)).toBe(thread);
    expect(updateThread(null, 1, (messages) => messages)).toBeNull();
  });
});

describe('reaction state', () => {
  it('identifies reactions by emoji or custom document id', () => {
    expect(reactionKey({ emoji: '👍', customEmojiId: null, count: 1, chosen: false })).toBe('👍');
    expect(reactionKey({ emoji: null, customEmojiId: '42', count: 1, chosen: false })).toBe('custom:42');
  });

  it('applies reaction updates only to the matching loaded message', () => {
    const messages = [message({ id: 1, chatId: 1 }), message({ id: 2, chatId: 1 }), message({ id: 1, chatId: 2 })];
    const reactions = [{ emoji: '🔥', customEmojiId: null, count: 2, chosen: false }];
    const next = applyReactionUpdate(messages, 1, 1, reactions);
    expect(next[0].reactions).toBe(reactions);
    expect(next[1].reactions).toEqual([]);
    expect(next[2].reactions).toEqual([]);
  });

  it('toggles a reaction on, clearing the previously chosen one', () => {
    const thumbs = { emoji: '👍', customEmojiId: null, count: 1, chosen: false };
    const fire = { emoji: '🔥', customEmojiId: null, count: 2, chosen: true };
    expect(toggleReaction([thumbs, fire], thumbs)).toEqual([
      { emoji: '👍', customEmojiId: null, count: 2, chosen: true },
      { emoji: '🔥', customEmojiId: null, count: 1, chosen: false },
    ]);
  });

  it('toggles a reaction off and drops aggregates that reach zero', () => {
    const chosen = { emoji: '👍', customEmojiId: null, count: 2, chosen: true };
    expect(toggleReaction([chosen], chosen)).toEqual([{ emoji: '👍', customEmojiId: null, count: 1, chosen: false }]);

    const last = { emoji: '👍', customEmojiId: null, count: 1, chosen: true };
    expect(toggleReaction([last], last)).toEqual([]);
  });

  it('adds a reaction that is not in the list yet', () => {
    expect(toggleReaction([], { emoji: '❤', customEmojiId: null, count: 0, chosen: false })).toEqual([
      { emoji: '❤', customEmojiId: null, count: 1, chosen: true },
    ]);
  });
});

describe('view state', () => {
  it('replaces the count of the matching loaded message only', () => {
    const messages = [message({ id: 1, chatId: 1 }), message({ id: 2, chatId: 1 }), message({ id: 1, chatId: 2 })];
    const next = applyViewsUpdate(messages, 1, 1, 1234);
    expect(next[0].views).toBe(1234);
    expect(next[1].views).toBeNull();
    // The same id in another chat is a different message.
    expect(next[2].views).toBeNull();
  });

  it('leaves the list alone when the message is not loaded', () => {
    const messages = [message({ id: 1, chatId: 1 })];
    expect(applyViewsUpdate(messages, 1, 999, 5)[0].views).toBeNull();
  });
});

describe('poll state', () => {
  it('finds the loaded message by its named ids, then by poll id', () => {
    const messages = [message({ id: 4, chatId: 1 }), message({ id: 5, chatId: 1, poll: POLL })];
    expect(findPollMessage(messages, { chatId: 1, messageId: 5, pollId: POLL.id })).toBe(messages[1]);
    // An update naming an unloaded message falls back to the poll id, which is
    // unique across chats; a poll that is nowhere loaded has no message.
    expect(findPollMessage(messages, { chatId: 1, messageId: 999, pollId: POLL.id })).toBe(messages[1]);
    expect(findPollMessage(messages, { chatId: null, messageId: null, pollId: 'other' })).toBeNull();
  });

  it('replaces one message poll and leaves the rest of the list alone', () => {
    const messages = [message({ id: 5, chatId: 1, poll: POLL }), message({ id: 6, chatId: 1 })];
    const fresh = { ...POLL, totalVoters: 9 };
    const next = applyPollUpdate(messages, { chatId: 1, messageId: 5, pollId: POLL.id }, fresh);
    expect(next[0].poll).toBe(fresh);
    expect(next[1]).toBe(messages[1]);
    expect(applyPollUpdate(messages, { chatId: null, messageId: null, pollId: 'other' }, fresh)).toBe(messages);
  });

  it('folds a poll update into the open thread only when it belongs there', () => {
    const thread = {
      chat: chat(1),
      messages: [message({ id: 5, chatId: 1, poll: POLL })],
      readInboxMaxId: 2,
      readOutboxMaxId: 0,
      unreadDividerId: null,
      focusMessageId: null,
      hasMoreOlder: true,
      windowEndId: 5,
      latestMessageId: 5,
    };
    const fresh = { ...POLL, totalVoters: 9 };
    const named = updateThreadPoll(thread, { chatId: 1, messageId: 5, pollId: POLL.id }, fresh);
    expect(named?.messages[0].poll).toBe(fresh);
    // A short update — and one for a poll somewhere else — is decided by the
    // poll id alone.
    expect(updateThreadPoll(thread, { chatId: null, messageId: null, pollId: POLL.id }, fresh)?.messages[0].poll).toBe(fresh);
    expect(updateThreadPoll(thread, { chatId: null, messageId: null, pollId: 'other' }, fresh)).toBe(thread);
    expect(updateThreadPoll(null, { chatId: null, messageId: null, pollId: POLL.id }, fresh)).toBeNull();
  });

  it('folds a poll update into the pinned post or a loaded comment', () => {
    const post = message({ id: 7, chatId: -100, poll: POLL });
    const comment = message({ id: 8, chatId: -200, poll: { ...POLL, id: 'comment-poll' } });
    const thread = {
      chat: chat(-100),
      post,
      discussionChatId: -200,
      discussionMessageId: 10,
      comments: [comment],
      count: 1,
      nextOffset: null,
    };
    const fresh = { ...POLL, totalVoters: 9 };

    const onPost = updateCommentsPoll(thread, { chatId: -100, messageId: 7, pollId: POLL.id }, fresh);
    expect(onPost?.post.poll).toBe(fresh);
    expect(onPost?.comments[0]).toBe(comment);

    const onComment = updateCommentsPoll(thread, { chatId: null, messageId: null, pollId: 'comment-poll' }, fresh);
    expect(onComment?.comments[0].poll).toBe(fresh);
    expect(onComment?.post).toBe(post);

    expect(updateCommentsPoll(thread, { chatId: null, messageId: null, pollId: 'other' }, fresh)).toBe(thread);
    expect(updateCommentsPoll(null, { chatId: null, messageId: null, pollId: POLL.id }, fresh)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('formats times of day', () => {
    expect(formatTime(NOW)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats chat-list stamps', () => {
    expect(formatListStamp(NOW - 10_000, NOW)).toBe('now');
    expect(formatListStamp(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(formatListStamp(NOW - 3 * 3_600_000, NOW)).toBe('3h');
    const old = formatListStamp(NOW - 5 * 86_400_000, NOW);
    expect(old).not.toMatch(/^\d+[mh]$/);
    expect(old.length).toBeGreaterThan(0);
  });

  it('labels days relative to today', () => {
    expect(formatDay(NOW, NOW)).toBe('Today');
    expect(formatDay(NOW - 86_400_000, NOW)).toBe('Yesterday');
    expect(formatDay(NOW - 10 * 86_400_000, NOW).length).toBeGreaterThan(0);
    expect(isSameDay(NOW, NOW + 3_600_000)).toBe(true);
    expect(isSameDay(NOW, NOW + 86_400_000)).toBe(false);
  });

  it('derives initials and previews', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Telegram')).toBe('T');
    expect(initials(' '.repeat(3))).toBe('?');
    expect(previewOf('hello', null)).toBe('hello');
    expect(previewOf('caption', PHOTO)).toBe('caption');
    expect(previewOf('', PHOTO)).toBe('Photo');
    expect(previewOf('', { ...PHOTO, kind: 'voice' })).toBe('Voice message');
    expect(previewOf('', null, POLL)).toBe('Poll: Tea or coffee?');
    expect(previewOf('', null)).toBe('—');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1024 * 1024 * 1024).length).toBeGreaterThan(0);
  });

  it('formats counts compactly for counters such as views', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1234)).toBe('1.2K');
    expect(formatCount(12_345)).toBe('12.3K');
    expect(formatCount(123_456)).toBe('123K');
    // Rounding up must promote the unit instead of yielding `1000K`.
    expect(formatCount(999_499)).toBe('999K');
    expect(formatCount(999_500)).toBe('1M');
    expect(formatCount(1_234_567)).toBe('1.2M');
  });
});

describe('unread reading', () => {
  const thread = [
    message({ id: 6, chatId: 1 }),
    message({ id: 7, chatId: 1, outgoing: true }),
    message({ id: 8, chatId: 1 }),
    message({ id: 9, chatId: 1 }),
  ];

  it('anchors on the first incoming message after the watermark', () => {
    expect(firstUnread(thread, 6)?.id).toBe(8);
    expect(firstUnread(thread, 8)?.id).toBe(9);
    expect(firstUnread(thread, 9)).toBeNull();
    expect(firstUnread([], 0)).toBeNull();
  });

  it('measures the read watermark from the visible ids or the bottom', () => {
    expect(readWatermark(thread, new Set([6]), false)).toBe(6);
    // Outgoing messages never carry the watermark; the highest visible
    // incoming one does.
    expect(readWatermark(thread, new Set([6, 7, 8]), false)).toBe(8);
    expect(readWatermark(thread, new Set(), false)).toBeNull();
    // Pinned to the bottom, everything is on screen.
    expect(readWatermark(thread, new Set(), true)).toBe(9);
    expect(readWatermark([], new Set(), true)).toBeNull();
  });
});
