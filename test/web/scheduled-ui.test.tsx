import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleSendButton } from '../../apps/web/src/components/ScheduleSendButton';
import { ScheduledMessagesDialog } from '../../apps/web/src/components/ScheduledMessagesDialog';
import type { MessageDto } from '../../apps/web/src/types';

function message(): MessageDto {
  return {
    id: 8,
    chatId: 2,
    groupedId: null,
    senderId: 2,
    senderName: null,
    senderPhoto: null,
    outgoing: true,
    date: 1_900_000_000_000,
    pinned: false,
    editDate: null,
    text: 'queued 8',
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

describe('ScheduleSendButton', () => {
  it('sends the trimmed draft with a chosen future time', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendButton draft="  hello  " onSchedule={onSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule message' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Send At'), { target: { value: '2099-01-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Later' }));
    expect(onSchedule).toHaveBeenCalledWith('hello', expect.any(Number));
    expect(onSchedule.mock.calls[0][1]).toBeGreaterThan(Date.now());
  });

  it('withholds the button for an empty draft', () => {
    render(<ScheduleSendButton draft="   " onSchedule={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Schedule message' })).toBeNull();
  });

  it('refuses a past time and closes without sending', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendButton draft="hello" onSchedule={onSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule message' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Send At'), { target: { value: '2000-01-01T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Later' }));
    expect(screen.getByText('Choose A Future Time.')).toBeDefined();
    expect(onSchedule).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ScheduledMessagesDialog', () => {
  it('offers the three writes a queued message accepts', () => {
    const queued = message();
    const sendNow = vi.fn();
    const remove = vi.fn();
    const edited = vi.fn();
    render(
      <ScheduledMessagesDialog
        controller={{
          isOpen: true,
          messages: [queued],
          loading: false,
          error: null,
          busyIds: new Set(),
          openList: () => {},
          close: () => {},
          apply: () => {},
          schedule: async () => {},
          sendNow,
          remove,
          edited,
        }}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Scheduled Messages')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send Now' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(sendNow).toHaveBeenCalledWith(queued);
    expect(remove).toHaveBeenCalledWith(queued);
  });

  it('hands an edit back to the composer and shows errors beside rows', () => {
    const queued = message();
    const editing = vi.fn();
    render(
      <ScheduledMessagesDialog
        controller={{
          isOpen: true,
          messages: [queued],
          loading: false,
          error: 'refused',
          busyIds: new Set(),
          openList: () => {},
          close: () => {},
          apply: () => {},
          schedule: async () => {},
          sendNow: async () => {},
          remove: async () => {},
          edited: editing,
        }}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('refused')).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Send Now' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    expect(editing).toHaveBeenCalledWith(queued);
  });

  it('disables the row actions while a write is in flight', () => {
    const queued = message();
    render(
      <ScheduledMessagesDialog
        controller={{
          isOpen: true,
          messages: [queued],
          loading: false,
          error: null,
          busyIds: new Set([queued.id]),
          openList: () => {},
          close: () => {},
          apply: () => {},
          schedule: async () => {},
          sendNow: async () => {},
          remove: async () => {},
          edited: () => {},
        }}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Send Now' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows an empty state', () => {
    render(
      <ScheduledMessagesDialog
        controller={{
          isOpen: true,
          messages: [],
          loading: false,
          error: null,
          busyIds: new Set(),
          openList: () => {},
          close: () => {},
          apply: () => {},
          schedule: async () => {},
          sendNow: async () => {},
          remove: async () => {},
          edited: () => {},
        }}
      />,
    );
    expect(screen.getByText('No Scheduled Messages.')).toBeDefined();
  });
});
