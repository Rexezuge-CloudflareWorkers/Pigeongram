import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { readClipboard } from '../clipboard';
import { filterCommands, slashQuery } from '../composer-commands';
import type { ActiveReplyKeyboard } from '../reply-keyboard';
import type { BotCommandDto, MessageDto, MessageReplyKeyboardButtonDto } from '../types';
import type { UploadRequest } from '../upload';
import { useEditDraft } from '../useEditDraft';
import { CommandMenu } from './CommandMenu';
import { Icon } from './Icon';
import { Presence } from './Presence';
import { ComposerEdit, ComposerReply } from './ReplyQuote';
import { ReplyKeyboard } from './ReplyKeyboard';
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
  The message being edited, or null when the composer is composing a new
  message. Telegram edits one message at a time, so the target is a single DTO;
  while it is set the composer pre-fills its text and submits the edit instead
  of a send.
  */
  editTarget?: MessageDto | null;
  /**
  The message being replied to, or null when the composer is not replying.
  */
  replyTarget: MessageDto | null;
  /**
  The slash-command menu for the open chat; empty hides it.
  */
  botCommands?: readonly BotCommandDto[];
  replyKeyboard?: ActiveReplyKeyboard | null;
  onCancelReply: () => void;
  /**
  Saves the edited message's text. The draft is kept until this resolves, so a
  refused edit loses nothing; the caller clears the target, and the composer
  clears its draft with it.
  */
  onSaveEdit?: (text: string) => Promise<void>;
  onCancelEdit?: () => void;
  onSend: (text: string, replyTo?: number) => Promise<void>;
  onAttach: (request: UploadRequest) => Promise<void>;
  onPressReplyKeyboard?: (button: MessageReplyKeyboardButtonDto, replyTo?: number) => void;
}

export function Composer({
  placeholder,
  editTarget = null,
  replyTarget,
  botCommands,
  replyKeyboard,
  onCancelReply,
  onSaveEdit,
  onCancelEdit,
  onSend,
  onAttach,
  onPressReplyKeyboard,
}: ComposerProps) {
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
  const [replyKeyboardCollapsed, setReplyKeyboardCollapsed] = useState(true);
  const listId = useId();
  const commands = botCommands ?? NO_COMMANDS;

  useEditDraft(editTarget, setDraft, setMenuOpen, textareaRef);

  const query = menuOpen ? (slashQuery(draft) ?? '') : '';
  const matches = menuOpen ? filterCommands(commands, query) : NO_COMMANDS;
  const active = matches.length === 0 ? 0 : Math.min(activeCommand, matches.length - 1);
  const showMenu = menuOpen && matches.length > 0 && editTarget === null;

  // Clicking outside the composer dismisses the menu without stealing the
  // click from whatever the user aimed at. Capture phase keeps a child's
  // stopPropagation from defeating the dismiss, and Escape is handled on the
  // document so it works wherever focus has landed.
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: Event): void => {
      if (!(event.target instanceof Node) || formRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      textareaRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside, { capture: true });
    document.addEventListener('click', outside, { capture: true });
    document.addEventListener('keydown', onEscape, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', outside, { capture: true });
      document.removeEventListener('click', outside, { capture: true });
      document.removeEventListener('keydown', onEscape, { capture: true });
    };
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

  const sendText = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const replyTo = replyTarget?.id;
    setMenuOpen(false);
    setDraft('');
    textareaRef.current?.focus();
    // The outbox owns failures: the pending bubble keeps the text and offers
    // Retry, so restoring the draft here would duplicate the message.
    void Promise.resolve(onSend(trimmed, replyTo)).catch(() => {});
  };

  const submit = (): void => {
    if (editTarget !== null) {
      const trimmed = draft.trim();
      if (!trimmed) return;
      setMenuOpen(false);
      // The draft stays until the caller clears the target: a refused edit
      // must not cost the reader their text.
      void Promise.resolve(onSaveEdit?.(trimmed)).catch(() => {});
      return;
    }
    sendText(draft);
  };

  const attach = (files: File[], grouped: boolean, sendAsFile: boolean): void => {
    if (files.length === 0) return;
    setPendingFiles(null);
    // Whatever is in the box rides along as the caption, Telegram-style; the
    // pending row keeps it if the upload fails.
    const caption = draft.trim();
    const replyTo = replyTarget?.id;
    setMenuOpen(false);
    setDraft('');
    textareaRef.current?.focus();
    void Promise.resolve(onAttach({ files, caption, replyTo, grouped, sendAsFile })).catch(() => {});
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

  /**
  Selecting a command sends it at once, as the official clients do; adding an
  argument is the `complete` path (Tab) instead. The composer is cleared like
  any other send, so a picked command never lingers as a draft.
  */
  const pick = (command: BotCommandDto): void => {
    sendText(`/${command.command}`);
  };

  /**
  Completes the highlighted command into the draft, for a command that takes an
  argument: the caret lands after the inserted text so typing continues there.
  */
  const complete = (command: BotCommandDto): void => {
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
      {replyKeyboard && !replyKeyboardCollapsed && onPressReplyKeyboard ? (
        <ReplyKeyboard keyboard={replyKeyboard} onPress={(button) => onPressReplyKeyboard(button, replyTarget?.id)} />
      ) : null}
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
        {editTarget === null ? (
          replyTarget ? (
            <ComposerReply message={replyTarget} onCancel={onCancelReply} />
          ) : null
        ) : (
          <ComposerEdit message={editTarget} onCancel={() => onCancelEdit?.()} />
        )}
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
        {commands.length > 0 && editTarget === null ? (
          <button
            type="button"
            className="slash"
            data-icon-only
            aria-label="Bot Commands"
            title="Bot Commands"
            aria-haspopup="listbox"
            aria-expanded={showMenu}
            aria-controls={showMenu ? listId : undefined}
            onClick={toggleMenu}
          >
            <Icon name="slash" size={18} />
          </button>
        ) : null}
        {editTarget === null ? (
          <button
            type="button"
            className="attach"
            data-icon-only
            aria-label="Attach Files"
            title="Attach Files"
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="attach" size={18} />
          </button>
        ) : null}
        {showMenu ? <CommandMenu id={listId} commands={matches} active={active} onActive={setActiveCommand} onPick={pick} /> : null}
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          placeholder={editTarget === null ? placeholder : 'Edit Message'}
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
              if (event.key === 'Tab') {
                const command = matches[active];
                if (command) {
                  event.preventDefault();
                  complete(command);
                }
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                // Selection is the action: the highlighted command is sent,
                // and an exactly typed command wins over the highlight.
                const command = matches.find((candidate) => draft === `/${candidate.command}`) ?? matches[active];
                if (command) {
                  event.preventDefault();
                  pick(command);
                  return;
                }
              }
            }
            if (event.key === 'Escape' && editTarget !== null) {
              event.preventDefault();
              onCancelEdit?.();
              return;
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
        {replyKeyboard ? (
          <button
            type="button"
            className="slash"
            data-icon-only
            aria-label={replyKeyboardCollapsed ? 'Show Bot Keyboard' : 'Hide Bot Keyboard'}
            title={replyKeyboardCollapsed ? 'Show Bot Keyboard' : 'Hide Bot Keyboard'}
            aria-expanded={!replyKeyboardCollapsed}
            onClick={() => setReplyKeyboardCollapsed((collapsed) => !collapsed)}
          >
            <Icon name={replyKeyboardCollapsed ? 'keyboard-arrow-up' : 'expand-more'} size={18} />
          </button>
        ) : null}
        <button
          type="submit"
          aria-label={editTarget === null ? 'Send' : 'Save'}
          title={editTarget === null ? 'Send' : 'Save'}
          data-icon-only
          className={`send-morph${editTarget === null && draft.trim().length === 0 ? ' is-mic' : ''}`}
          disabled={draft.trim().length === 0}
        >
          <Icon name={editTarget === null ? 'send' : 'check'} size={18} className="is-send" />
          <Icon name="mic" size={18} className="is-mic" />
        </button>
      </form>
      <Presence visible={pendingFiles !== null}>
        {pendingFiles ? <UploadDialog initialFiles={pendingFiles} onCancel={() => setPendingFiles(null)} onSend={attach} /> : null}
      </Presence>
    </>
  );
}
