import { useRef, useState } from 'react';
import type { MessageDto } from '../types';
import { ComposerReply } from './ReplyQuote';

/**
The message box shared by the thread and the comments view: draft, attach,
reply banner, busy state and upload progress. The caller owns the reply target
and clears it once a send succeeds, so the banner survives a failed attempt.
*/

interface ComposerProps {
  placeholder: string;
  sending: boolean;
  uploading: boolean;
  uploadProgress: number | null;
  /**
  The message being replied to, or null when the composer is not replying.
  */
  replyTarget: MessageDto | null;
  onCancelReply: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (file: File, caption: string, replyTo?: number) => Promise<void>;
}

export function Composer({ placeholder, sending, uploading, uploadProgress, replyTarget, onCancelReply, onSend, onAttach }: ComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const busy = sending || uploading;

  const submit = (): void => {
    const text = draft.trim();
    if (!text || busy) return;
    const replyTo = replyTarget?.id;
    setDraft('');
    void onSend(text, replyTo).catch(() => setDraft(text));
  };

  const attach = (file: File | undefined): void => {
    if (!file || busy) return;
    // Whatever is in the box rides along as the caption, Telegram-style.
    const caption = draft.trim();
    const replyTo = replyTarget?.id;
    void onAttach(file, caption, replyTo)
      .then(() => setDraft((current) => (current === caption ? '' : current)))
      .catch(() => {
        // The caption stays in the box so the upload can be retried.
      });
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {replyTarget ? <ComposerReply message={replyTarget} onCancel={onCancelReply} /> : null}
      <input
        ref={fileRef}
        type="file"
        className="attach-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          attach(file);
        }}
      />
      <button
        type="button"
        className="attach"
        disabled={busy}
        aria-label="Attach a file"
        title="Attach a file"
        onClick={() => fileRef.current?.click()}
      >
        📎
      </button>
      <textarea
        value={draft}
        rows={1}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && replyTarget) {
            event.preventDefault();
            onCancelReply();
            return;
          }
          if (event.key !== 'Enter' || event.shiftKey) {
            return;
          }

          event.preventDefault();
          submit();
        }}
      />
      {uploading ? <span className="upload-status">{uploadStatus(uploadProgress)}</span> : null}
      <button type="submit" disabled={busy || draft.trim().length === 0}>
        {sending ? '…' : 'Send'}
      </button>
    </form>
  );
}

function uploadStatus(progress: number | null): string {
  if (progress === null || progress >= 1) return 'Sending…';
  return `Uploading ${Math.round(progress * 100)}%`;
}
