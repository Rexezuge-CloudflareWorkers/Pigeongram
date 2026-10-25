import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagePoll } from '../../apps/web/src/components/Poll';
import type { MessageDto, MessagePollDto } from '../../apps/web/src/types';

/**
 * The poll bubble. A vote replaces the whole selection, so each tap's payload
 * is the contract the engine receives; the rest is the results rendering.
 */

function message(): MessageDto {
  return {
    id: 5,
    chatId: 10,
    groupedId: null,
    senderId: 2,
    senderName: 'Ada',
    senderPhoto: null,
    outgoing: false,
    date: 1_700_000_000_000,
    text: '',
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
  };
}

function poll(overrides: Partial<MessagePollDto> = {}): MessagePollDto {
  return {
    id: '1',
    question: 'Tea or coffee?',
    answers: [
      { text: 'Tea', voters: 2, chosen: false, correct: null },
      { text: 'Coffee', voters: 1, chosen: false, correct: null },
    ],
    totalVoters: 3,
    closed: false,
    quiz: false,
    multiple: false,
    revotingDisabled: false,
    hideResultsUntilClose: false,
    solution: null,
    ...overrides,
  };
}

function renderPoll(
  value: MessagePollDto,
  options: { onVote?: (target: MessageDto, indexes: number[] | null) => void; voting?: boolean } = {},
) {
  const onVote = vi.fn(options.onVote);
  const view = render(
    <MessagePoll message={message()} poll={value} onVote={options.onVote === undefined ? undefined : onVote} voting={options.voting} />,
  );
  return { ...view, onVote };
}

afterEach(cleanup);

describe('MessagePoll', () => {
  it('renders the results with a bar and a percentage per answer', () => {
    const { container } = renderPoll(poll());

    expect(screen.getByText('Poll')).not.toBeNull();
    expect(screen.getByText('Tea or coffee?')).not.toBeNull();
    expect(screen.getByText('3 votes')).not.toBeNull();
    expect(screen.getAllByText('67%')).toHaveLength(1);
    expect(screen.getByText('33%')).not.toBeNull();
    const bars = [...container.querySelectorAll<HTMLElement>('.poll-bar')];
    expect(bars.map((bar) => bar.style.width)).toEqual(['67%', '33%']);
  });

  it('labels a quiz and a multiple-choice poll', () => {
    renderPoll(poll({ quiz: true, multiple: true }));

    expect(screen.getByText('Quiz · Multiple choice')).not.toBeNull();
  });

  it('marks the correct answer and nothing else after a plain poll vote', () => {
    renderPoll(
      poll({
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: true },
          { text: 'Coffee', voters: 1, chosen: false, correct: false },
        ],
      }),
    );

    expect(screen.getByTitle('Correct answer')).not.toBeNull();
    expect(screen.queryByTitle('Wrong answer')).toBeNull();
  });

  it('marks a wrong answer the account picked', () => {
    renderPoll(
      poll({
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: false },
          { text: 'Coffee', voters: 1, chosen: false, correct: true },
        ],
      }),
    );

    expect(screen.getByTitle('Wrong answer')).not.toBeNull();
    expect(screen.getByTitle('Correct answer')).not.toBeNull();
  });

  it('explains missing results, and says nothing when Telegram shared none', () => {
    renderPoll(
      poll({ totalVoters: null, answers: poll().answers.map((answer) => ({ ...answer, voters: null })), hideResultsUntilClose: true }),
    );
    expect(screen.getByText('Results hidden until the poll closes')).not.toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();

    cleanup();
    renderPoll(poll({ totalVoters: null, answers: poll().answers.map((answer) => ({ ...answer, voters: null })), closed: true }));
    expect(screen.getByText('Poll closed')).not.toBeNull();

    cleanup();
    renderPoll(poll({ totalVoters: null, answers: poll().answers.map((answer) => ({ ...answer, voters: null })) }));
    expect(document.querySelector('.poll-meta')).toBeNull();
  });

  it('says one vote in the singular and shows the solution', () => {
    renderPoll(
      poll({
        totalVoters: 1,
        answers: [
          { text: 'Tea', voters: 1, chosen: true, correct: true },
          { text: 'Coffee', voters: 0, chosen: false, correct: false },
        ],
        solution: 'Tea is the answer.',
      }),
    );

    expect(screen.getByText('1 vote')).not.toBeNull();
    expect(screen.getByText('Tea is the answer.')).not.toBeNull();
  });

  it('votes for a single answer and replaces the chosen one', () => {
    const { onVote } = renderPoll(poll(), { onVote: () => {} });

    fireEvent.click(screen.getByRole('button', { name: 'Vote for Tea (67%)' }));
    expect(onVote).toHaveBeenCalledWith(message(), [0]);
  });

  it('does not retract a single-choice vote by tapping it again', () => {
    const { onVote } = renderPoll(
      poll({
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: false, correct: null },
        ],
      }),
      { onVote: () => {} },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Vote for Tea (67%)' }));
    expect(onVote).not.toHaveBeenCalled();
  });

  it('adds, removes and retracts answers in a multiple-choice poll', () => {
    const { onVote } = renderPoll(
      poll({
        multiple: true,
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: false, correct: null },
        ],
      }),
      { onVote: () => {} },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Vote for Coffee (33%)' }));
    expect(onVote).toHaveBeenLastCalledWith(message(), [0, 1]);

    // The component still holds the old selection, so removing Tea leaves
    // nothing to send and the vote is retracted.
    fireEvent.click(screen.getByRole('button', { name: 'Vote for Tea (67%)' }));
    expect(onVote).toHaveBeenLastCalledWith(message(), null);
  });

  it('removes one of two chosen answers in a multiple-choice poll', () => {
    const { onVote } = renderPoll(
      poll({
        multiple: true,
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: true, correct: null },
        ],
      }),
      { onVote: () => {} },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Vote for Coffee (33%)' }));
    expect(onVote).toHaveBeenLastCalledWith(message(), [0]);
  });

  it('retracts the last answer of a multiple-choice poll', () => {
    const { onVote } = renderPoll(
      poll({
        multiple: true,
        answers: [
          { text: 'Tea', voters: 0, chosen: true, correct: null },
          { text: 'Coffee', voters: 0, chosen: false, correct: null },
        ],
      }),
      { onVote: () => {} },
    );

    fireEvent.click(screen.getByRole('button', { name: /Vote for Tea/ }));
    expect(onVote).toHaveBeenLastCalledWith(message(), null);

    fireEvent.click(screen.getByRole('button', { name: 'Retract vote' }));
    expect(onVote).toHaveBeenLastCalledWith(message(), null);
  });

  it('renders closed, locked and unvotable polls as static rows', () => {
    renderPoll(poll({ closed: true }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    cleanup();
    renderPoll(
      poll({
        revotingDisabled: true,
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: false, correct: null },
        ],
      }),
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    cleanup();
    renderPoll(poll());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('disables every action while a vote is in flight', () => {
    renderPoll(
      poll({
        answers: [
          { text: 'Tea', voters: 2, chosen: true, correct: null },
          { text: 'Coffee', voters: 1, chosen: false, correct: null },
        ],
      }),
      { onVote: () => {}, voting: true },
    );

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
