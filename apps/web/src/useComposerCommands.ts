import type { RefObject } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { filterCommands, slashQuery } from './composer-commands';
import type { BotCommandDto, MessageDto } from './types';

/**
The composer's slash-command menu: the open state, which command is
highlighted, the keyboard moves over it and the two ways a command leaves the
menu (sent at once, or completed into the draft with Tab).

It lives apart from the composer because it is a self-contained interaction
with its own document listeners and caret handling; the composer only binds
its results to the text box and the menu.
*/

const NO_COMMANDS: readonly BotCommandDto[] = [];

interface UseComposerCommandsOptions {
  commands: readonly BotCommandDto[];
  draft: string;
  setDraft: (value: string) => void;
  editTarget: MessageDto | null;
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Sends the highlighted command. The composer owns the send path, so a picked
   * command is cleared exactly like any other submission.
   */
  onSend: (text: string) => void;
}

interface ComposerCommands {
  listId: string;
  setMenuOpen: (open: boolean) => void;
  matches: readonly BotCommandDto[];
  active: number;
  setActiveCommand: (index: number) => void;
  showMenu: boolean;
  changeDraft: (value: string) => void;
  toggleMenu: () => void;
  moveActive: (delta: number) => void;
  pick: (command: BotCommandDto) => void;
  complete: (command: BotCommandDto) => void;
}

export function useComposerCommands({
  commands,
  draft,
  setDraft,
  editTarget,
  formRef,
  textareaRef,
  onSend,
}: UseComposerCommandsOptions): ComposerCommands {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  // Set after a command is inserted, so the caret lands after it once React
  // has committed the new draft.
  const caretAfterPick = useRef<number | null>(null);
  const listId = useId();

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
  }, [menuOpen, formRef, textareaRef]);

  useLayoutEffect(() => {
    const caret = caretAfterPick.current;
    if (caret === null) return;
    caretAfterPick.current = null;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft, textareaRef]);

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
    onSend(`/${command.command}`);
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

  return {
    listId,
    setMenuOpen,
    matches,
    active,
    setActiveCommand,
    showMenu,
    changeDraft,
    toggleMenu,
    moveActive,
    pick,
    complete,
  };
}
