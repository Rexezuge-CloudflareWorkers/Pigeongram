import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { readClipboard } from '../clipboard';
import type { BotCommandDto, MessageDto } from '../types';
import type { UploadRequest } from '../upload';
import { Icon } from './Icon';
import { ComposerReply } from './ReplyQuote';
import { UploadDialog } from './UploadDialog';

/**
The message box shared by the thread and the comments view: draft, attach,
reply banner and bot command menu. Sends are optimistic: submitting clears the
box and refocuses it immediately, while the outbox owns the bridge round trip,
progress and retries. The caller still owns the reply target and clears it as
soon as the send is enqueued.
*/

const NO_COMMANDS: readonly BotCommandDto[] = [];

interface ComposerProps {
  placeholder: string;
  /**
  The message being replied to, or null when the composer is not replying.
  */
  replyTarget: MessageDto | null;
  /**
  The slash-command menu for the open chat; empty hides it.
  */
  botCommands?: readonly BotCommandDto[];
  onCancelReply: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
}

export function Composer({ placeholder, replyTarget, botCommands, onCancelReply, onSend, onAttach }: ComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Set after a command is inserted, so the caret lands after it once React
  // has committed the new draft.
  const caretAfterPick = useRef<number | null>(null);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const listId = useId();
  const commands = botCommands ?? NO_COMMANDS;

  const query = menuOpen ? (slashQuery(draft) ?? '') : '';
  const matches = menuOpen ? filterCommands(commands, query) : NO_COMMANDS;
  const active = matches.length === 0 ? 0 : Math.min(activeCommand, matches.length - 1);
  const showMenu = menuOpen && matches.length > 0;

  // Clicking outside the composer dismisses the menu without stealing the
  // click from whatever the user aimed at.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (!formRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useLayoutEffect(() => {
    const caret = caretAfterPick.current;
    if (caret === null) return;
    caretAfterPick.current = null;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    const replyTo = replyTarget?.id;
    setMenuOpen(false);
    setDraft('');
    textareaRef.current?.focus();
    // The outbox owns failures: the pending bubble keeps the text and offers
    // Retry, so restoring the draft here would duplicate the message.
    void Promise.resolve(onSend(text, replyTo)).catch(() => {});
  };

  const attach = (files: File[], grouped: boolean): void => {
    if (files.length === 0) return;
    setPendingFiles(null);
    // Whatever is in the box rides along as the caption, Telegram-style; the
    // pending row keeps it if the upload fails.
    const caption = draft.trim();
    const replyTo = replyTarget?.id;
    setMenuOpen(false);
    setDraft('');
    textareaRef.current?.focus();
    void Promise.resolve(onAttach({ files, caption, replyTo, grouped })).catch(() => {});
  };

  const changeDraft = (value: string): void => {
    setDraft(value);
    if (slashQuery(value) === null) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(true);
    setActiveCommand(0);
  };

  const toggleMenu = (): void => {
    setMenuOpen((open) => !open);
    setActiveCommand(0);
    textareaRef.current?.focus();
  };

  const moveActive = (delta: number): void => {
    if (matches.length === 0) return;
    setActiveCommand((current) => {
      const start = Math.min(current, matches.length - 1);
      return (start + delta + matches.length) % matches.length;
    });
  };

  const pick = (command: BotCommandDto): void => {
    const inserted = `/${command.command} `;
    const element = textareaRef.current;
    if (slashQuery(draft) !== null || element === null) {
      // Completing a typed prefix replaces it; a composer without a textarea
      // (only in tests) appends.
      const base = slashQuery(draft) === null ? draft : '';
      const separator = base.length > 0 && !/\s$/.test(base) ? ' ' : '';
      const next = `${base}${separator}${inserted}`;
      setDraft(next);
      caretAfterPick.current = next.length;
    } else {
      const start = element.selectionStart ?? draft.length;
      const end = element.selectionEnd ?? start;
      const before = draft.slice(0, start);
      const separator = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
      const next = `${before}${separator}${inserted}${draft.slice(end)}`;
      setDraft(next);
      caretAfterPick.current = (before + separator + inserted).length;
    }
    setMenuOpen(false);
  };

  return (
    <>
      <form
        ref={formRef}
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onPaste={(event) => {
          // A paste is an upload the user never made explicit with the file
          // picker: the browser hands over whatever the source app put on the
          // clipboard. Only a clipboard without text is taken over — a cell
          // copied from a spreadsheet arrives as text *and* an image of the
          // cell, and there the text is what was meant to be pasted.
          const { files, text } = readClipboard(event.clipboardData);
          if (files.length === 0 || text.trim().length > 0) return;
          event.preventDefault();
          setPendingFiles(files);
        }}
      >
        {replyTarget ? <ComposerReply message={replyTarget} onCancel={onCancelReply} /> : null}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="attach-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) setPendingFiles(files);
          }}
        />
        {commands.length > 0 ? (
          <button
            type="button"
            className="slash"
            aria-label="Bot commands"
            title="Bot commands"
            aria-haspopup="listbox"
            aria-expanded={showMenu}
            aria-controls={showMenu ? listId : undefined}
            onClick={toggleMenu}
          >
            <Icon name="slash" size={18} />
          </button>
        ) : null}
        <button type="button" className="attach" aria-label="Attach files" title="Attach files" onClick={() => fileRef.current?.click()}>
          <Icon name="attach" size={18} />
        </button>
        {showMenu ? (
          <div className="command-menu" id={listId} role="listbox" aria-label="Bot commands">
            {matches.map((command, index) => (
              <button
                key={command.command}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveCommand(index)}
                onClick={() => pick(command)}
              >
                <span className="command-name">/{command.command}</span>
                {command.description ? <span className="command-description">{command.description}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls={showMenu ? listId : undefined}
          aria-activedescendant={showMenu ? `${listId}-${active}` : undefined}
          onChange={(event) => changeDraft(event.target.value)}
          onKeyDown={(event) => {
            if (showMenu) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActive(1);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActive(-1);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
                return;
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                const command = matches[active];
                // A fully typed command is ready to send; a prefix is completed.
                const exact = command !== undefined && draft === `/${command.command}`;
                if (event.key === 'Tab' || !exact) {
                  event.preventDefault();
                  if (command) pick(command);
                  return;
                }
              }
            }
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
        <button type="submit" aria-label="Send" title="Send" disabled={draft.trim().length === 0}>
          <Icon name="send" size={18} />
        </button>
      </form>
      {pendingFiles ? <UploadDialog initialFiles={pendingFiles} onCancel={() => setPendingFiles(null)} onSend={attach} /> : null}
    </>
  );
}

/**
The filter text when the draft is a bare slash prefix, or null when it is
anything else. Commands are only recognized at the start of a message, so a
slash in running text does not open the menu.
*/
function slashQuery(text: string): string | null {
  const match = /^\/(\w*)$/.exec(text);
  return match === null ? null : match[1];
}

function filterCommands(commands: readonly BotCommandDto[], query: string): readonly BotCommandDto[] {
  if (query === '') return commands;
  const needle = query.toLowerCase();
  return commands.filter((command) => command.command.toLowerCase().startsWith(needle));
}
