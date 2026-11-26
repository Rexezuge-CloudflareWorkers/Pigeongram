import { useState } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/**
The composer's clock: opens the schedule picker for the draft that is already
typed. The picker owns the chosen time; the composer owns the draft and clears
it through `onSchedule` when Telegram accepts the queue entry.
*/

interface ScheduleSendButtonProps {
  draft: string;
  onSchedule: (text: string, scheduleDate: number) => void;
}

function localInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultTime(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  return localInputValue(next);
}

export function ScheduleSendButton({ draft, onSchedule }: ScheduleSendButtonProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultTime);
  const [error, setError] = useState<string | null>(null);
  if (draft.trim().length === 0) return null;

  const confirm = (): void => {
    const scheduleDate = new Date(value).getTime();
    if (!Number.isFinite(scheduleDate) || scheduleDate <= Date.now()) {
      setError('Choose A Future Time.');
      return;
    }
    setError(null);
    setOpen(false);
    void Promise.resolve(onSchedule(draft.trim(), scheduleDate)).catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        className="attach"
        data-icon-only
        aria-label="Schedule message"
        title="Schedule Message"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setValue(defaultTime());
          setOpen(true);
        }}
      >
        <Icon name="schedule" size={18} />
      </button>
      {open ? (
        <Dialog
          title="Schedule Message"
          className="max-w-[420px]"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)} data-dialog-cancel>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={value.length === 0}>
                Send Later
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-2 text-sm">
            Send At
            <input
              type="datetime-local"
              className="rounded-lg border border-outline bg-surface px-3 py-2 text-on-surface"
              value={value}
              min={localInputValue(new Date())}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
          </label>
          {error === null ? null : (
            <p className="mt-2 text-sm text-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
