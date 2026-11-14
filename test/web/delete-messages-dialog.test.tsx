import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteMessagesDialog } from '../../apps/web/src/components/DeleteMessagesDialog';
import type { MessageDeletion } from '../../apps/web/src/useMessageDelete';
import type { MessageDto } from '../../apps/web/src/types';

afterEach(cleanup);

function message(id: number): MessageDto {
  return {
    id,
    chatId: 1,
    groupedId: null,
    senderId: 1,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: true,
    date: 1_700_000_000_000,
    editDate: null,
    text: `message ${id}`,
    entities: [],
    reactions: [],
    service: false,
    media: null,
    webPage: null,
    poll: null,
    markup: null,
    replyKeyboard: null,
    reply: null,
    forward: null,
    views: null,
    comments: null,
  };
}

function deletion(messages: readonly MessageDto[] | null, overrides: Partial<MessageDeletion> = {}): MessageDeletion {
  return {
    messages,
    request: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    ...overrides,
  };
}

describe('DeleteMessagesDialog', () => {
  it('stays closed while nothing is confirmed', () => {
    render(<DeleteMessagesDialog deletion={deletion(null)} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names a single message and deletes it on confirm', () => {
    const flow = deletion([message(10)]);
    render(<DeleteMessagesDialog deletion={flow} />);

    expect(screen.getByText('Delete Message')).not.toBeNull();
    expect(screen.getByText('This Message Will Be Deleted For Everyone.')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(flow.confirm).toHaveBeenCalledTimes(1);
  });

  it('counts the display group and closes on cancel', () => {
    const flow = deletion([message(10), message(11)]);
    render(<DeleteMessagesDialog deletion={flow} />);

    expect(screen.getByText('Delete Messages')).not.toBeNull();
    expect(screen.getByText('These 2 Messages Will Be Deleted For Everyone.')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(flow.cancel).toHaveBeenCalledTimes(1);
  });
});
