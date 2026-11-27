import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BotCommandDto } from '../types';
import { CommandMenu } from './CommandMenu';
import { Icon } from './Icon';

/**
The composer's left-hand actions: the slash-command menu, the sticker and emoji
picker, the attach button and the schedule button.

Split from `Composer.tsx` so that file keeps the draft, the keyboard handling
and the send button — the parts whose state is shared — while these buttons are
a render of what the caller allows. Each one is offered only when its callback
exists, so a composer without stickers (the comments screen) draws none.
*/
interface ComposerActionsProps {
  commands: {
    showMenu: boolean;
    listId: string;
    toggleMenu: () => void;
    matches: readonly BotCommandDto[];
    active: number;
    setActiveCommand: (index: number) => void;
    pick: (command: BotCommandDto) => void;
  };
  /**
  Whether the slash-command button is offered (bot commands, not editing).
  */
  showCommands: boolean;
  /**
  Whether the sticker picker button is offered (the caller sends stickers).
  */
  showSticker: boolean;
  /**
  Whether the attach button is offered (not editing).
  */
  showAttach: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onAttach: () => void;
  /**
  The schedule affordance, when the caller can schedule and is not editing.
  */
  schedule?: ReactNode;
}

export function ComposerActions({
  commands,
  showCommands,
  showSticker,
  showAttach,
  pickerOpen,
  onTogglePicker,
  onAttach,
  schedule,
}: ComposerActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      {showCommands ? (
        <button
          type="button"
          className="slash"
          data-icon-only
          aria-label={t('a11y.botCommands', 'Bot Commands')}
          title={t('composer.botCommands', 'Bot Commands')}
          aria-haspopup="listbox"
          aria-expanded={commands.showMenu}
          aria-controls={commands.showMenu ? commands.listId : undefined}
          onClick={commands.toggleMenu}
        >
          <Icon name="slash" size={18} />
        </button>
      ) : null}
      {showSticker ? (
        <button
          type="button"
          className="attach"
          data-icon-only
          aria-label={t('a11y.stickerAndEmojiPicker', 'Sticker and emoji picker')}
          title={t('a11y.stickersAndEmoji', 'Stickers And Emoji')}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          onClick={onTogglePicker}
        >
          <Icon name="emoji" size={18} />
        </button>
      ) : null}
      {showAttach ? (
        <button
          type="button"
          className="attach"
          data-icon-only
          aria-label={t('composer.attachFiles', 'Attach Files')}
          title={t('composer.attachFiles', 'Attach Files')}
          onClick={onAttach}
        >
          <Icon name="attach" size={18} />
        </button>
      ) : null}
      {schedule}
      {commands.showMenu ? (
        <CommandMenu
          id={commands.listId}
          commands={commands.matches}
          active={commands.active}
          onActive={commands.setActiveCommand}
          onPick={commands.pick}
        />
      ) : null}
    </>
  );
}
