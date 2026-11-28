import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MessageDto, MessagePollDto } from '../types';
import { Icon } from './Icon';

/**
A poll message: the question, its answers, and whatever Telegram shared of the
results.

The thread hands in a vote handler and the answers become buttons; a poll
closed to changes (or a view that does not vote) shows the same rows inert. A
vote always sends the whole selection, because that is how Telegram replaces
one: single-choice taps swap the answer, multiple-choice taps add or remove it,
and taking the last answer back retracts the vote.
*/

interface MessagePollProps {
  message: MessageDto;
  poll: MessagePollDto;
  /**
  Sends a vote for the selected answer indexes, or null to retract the vote.
  */
  onVote?: (message: MessageDto, options: number[] | null) => void;
  /**
  Whether a vote is in flight; the answers are disabled meanwhile.
  */
  voting?: boolean;
}

export function MessagePoll({ message, poll, onVote, voting = false }: MessagePollProps) {
  const { t } = useTranslation();
  const chosen = chosenIndexes(poll);
  const results = poll.answers.some((answer) => answer.voters !== null);
  // Closed polls and votes that may no longer change render as plain rows.
  const interactive = onVote !== undefined && !poll.closed && !(poll.revotingDisabled && chosen.length > 0);
  const meta = metaText(t, poll, results);

  return (
    <div className="poll">
      <div className="poll-kind">
        {poll.quiz ? t('poll.quiz', 'Quiz') : t('poll.poll', 'Poll')}
        {poll.multiple ? t('poll.multipleChoice', ' · Multiple Choice') : ''}
      </div>
      <div className="poll-question">{poll.question}</div>
      {poll.answers.map((answer, index) => {
        const percent = results && poll.totalVoters ? Math.round(((answer.voters ?? 0) / poll.totalVoters) * 100) : null;
        const content = (
          <>
            {percent === null ? null : <span className="poll-bar" style={{ width: `${percent}%` }} aria-hidden="true" />}
            <span className="poll-answer-text">{answer.text}</span>
            {answer.correct === true ? (
              <span className="poll-mark correct" title={t('a11y.correctAnswer', 'Correct answer')}>
                <Icon name="check" size={12} />
              </span>
            ) : null}
            {answer.correct === false && answer.chosen ? (
              <span className="poll-mark wrong" title={t('a11y.wrongAnswer', 'Wrong answer')}>
                <Icon name="close" size={12} />
              </span>
            ) : null}
            {percent === null ? null : <span className="poll-percent">{percent}%</span>}
          </>
        );
        if (!interactive) {
          return (
            <div key={index} className={`poll-answer is-static${answer.chosen ? ' chosen' : ''}`}>
              {content}
            </div>
          );
        }
        return (
          <button
            key={index}
            type="button"
            className={`poll-answer${answer.chosen ? ' chosen' : ''}`}
            disabled={voting}
            aria-label={
              percent === null
                ? t('a11y.voteFor', 'Vote for {{answer}}', { answer: answer.text })
                : t('a11y.voteForPercent', 'Vote for {{answer}} ({{percent}}%)', { answer: answer.text, percent })
            }
            aria-pressed={answer.chosen}
            onClick={() => {
              const next = nextSelection(poll, index);
              // A single-choice tap on one's own answer keeps it; the meta
              // row's own action is what retracts a vote.
              if (next !== null || poll.multiple) onVote(message, next);
            }}
          >
            {content}
          </button>
        );
      })}
      {meta !== null || (interactive && chosen.length > 0) ? (
        <div className="poll-meta">
          <span>{meta}</span>
          {interactive && chosen.length > 0 ? (
            <button type="button" className="poll-retract" disabled={voting} onClick={() => onVote(message, null)}>
              {t('poll.retractVote', 'Retract Vote')}
            </button>
          ) : null}
        </div>
      ) : null}
      {poll.solution === null ? null : <div className="poll-solution">{poll.solution}</div>}
    </div>
  );
}

/**
The indexes of the answers this account picked.
*/
function chosenIndexes(poll: MessagePollDto): number[] {
  return poll.answers.flatMap((answer, index) => (answer.chosen ? index : []));
}

/**
The selection a tap on one answer sends: the tapped answer joins the chosen
ones (multiple choice) or replaces them (single choice), and in a
multiple-choice poll a tap on a chosen answer takes it back out.
*/
function nextSelection(poll: MessagePollDto, index: number): number[] | null {
  const chosen = chosenIndexes(poll);
  if (!chosen.includes(index)) return poll.multiple ? [...chosen, index] : [index];
  if (!poll.multiple) return null;
  const rest = chosen.filter((candidate) => candidate !== index);
  return rest.length > 0 ? rest : null;
}

/**
The meta line: the tally once the results are known, why they are missing when
the poll hides them, and nothing at all when Telegram simply has not shared
them with this account yet (a quiz before answering, typically).
*/
function metaText(t: TFunction, poll: MessagePollDto, results: boolean): string | null {
  if (results && poll.totalVoters !== null) {
    return t('poll.voteCount', '{{count, number}} Votes', { count: poll.totalVoters });
  }
  if (poll.closed) return t('poll.closed', 'Poll Closed');
  if (poll.hideResultsUntilClose) return t('poll.resultsHidden', 'Results Hidden Until The Poll Closes');
  return null;
}
