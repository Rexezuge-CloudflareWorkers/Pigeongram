import { useRef, useState } from 'react';
import { readClipboard } from '../clipboard';
import type { RecordedVoice } from '../recorder';
import type { ActiveReplyKeyboard } from '../reply-keyboard';
import type { BotCommandDto, MessageDto, MessageReplyKeyboardButtonDto, StickerDto } from '../types';
import type { UploadRequest } from '../upload';
import { useComposerCommands } from '../useComposerCommands';
import { useEditDraft } from '../useEditDraft';
import { useComposerPicker } from '../useComposerPicker';
import { useVoiceRecorder } from '../useVoiceRecorder';
import { CommandMenu } from './CommandMenu';
import { Icon } from './Icon';
import { Presence } from './Presence';
import { ComposerEdit, ComposerReply } from './ReplyQuote';
import { ReplyKeyboard } from './ReplyKeyboard';
import { StickerPicker } from './StickerPicker';
import { UploadDialog } from './UploadDialog';
import { VoiceRecordingStrip } from './VoiceRecordingStrip';

/**
The message box shared by the thread and the comments view: draft, attach,
voice messages, reply banner and bot command menu. Sends are optimistic:
submitting clears the box and refocuses it immediately, while the outbox owns
the bridge round trip, progress and retries. The caller still owns the reply
target and clears it as soon as the send is enqueued.
*/

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
  /**
   * Sends a sticker from the picker. The composer supplies the open reply
   * target; the picker supplies the pack identity for the engine's fallback.
   * Absent means this composer offers no sticker tab (the comments screen posts
   * into a discussion group through a narrower path).
   */
  onSendSticker?: (sticker: StickerDto, set: { id: string; accessHash: string } | null, replyTo?: number) => Promise<void>;
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
  onSendSticker,
  onPressReplyKeyboard,
}: ComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [replyKeyboardCollapsed, setReplyKeyboardCollapsed] = useState(true);
  const [recordingError, setRecordingError] = useState<string | null>(null);
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

  const picker = useComposerPicker({
    textareaRef,
    draft,
    setDraft,
    ...(replyTarget !== null && { replyTargetId: replyTarget.id }),
    ...(onSendSticker !== undefined && { onSendSticker }),
    beforeSend: () => setMenuOpen(false),
  });

  const commands = useComposerCommands({
    commands: botCommands ?? [],
    draft,
    setDraft,
    editTarget,
    formRef,
    textareaRef,
    onSend: sendText,
  });
  const { setMenuOpen } = commands;

  const voice = useVoiceRecorder({ onRecorded: sendVoice, onError: setRecordingError });

  useEditDraft(editTarget, setDraft, setMenuOpen, textareaRef);

  const emptyDraft = draft.trim().length === 0;
  // With nothing typed and nothing being edited, the send button is the
  // microphone the official clients show: pressing it starts a voice message.
  const canRecord = editTarget === null && emptyDraft;

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

  /**
  Queues the recording the microphone just finished. It rides the file path
  exactly as an attachment does — the caption is the draft, the reply target
  is the open reply, and the outbox owns progress and retries — with the kind
  forced to `voice` and the measured duration along for the bubble.
  */
  function sendVoice(recorded: RecordedVoice): void {
    const caption = draft.trim();
    const replyTo = replyTarget?.id;
    setMenuOpen(false);
    setRecordingError(null);
    setDraft('');
    textareaRef.current?.focus();
    void Promise.resolve(
      onAttach({
        files: [recorded.file],
        caption,
        replyTo,
        grouped: false,
        sendAsFile: false,
        kind: 'voice',
        duration: recorded.duration,
      }),
    ).catch(() => {});
  }

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
        {recordingError === null ? null : (
          <p className="composer-error" role="alert">
            {recordingError}
          </p>
        )}
        {voice.state === 'idle' ? (
          <>
            {(botCommands?.length ?? 0) > 0 && editTarget === null ? (
              <button
                type="button"
                className="slash"
                data-icon-only
                aria-label="Bot Commands"
                title="Bot Commands"
                aria-haspopup="listbox"
                aria-expanded={commands.showMenu}
                aria-controls={commands.showMenu ? commands.listId : undefined}
                onClick={commands.toggleMenu}
              >
                <Icon name="slash" size={18} />
              </button>
            ) : null}
            {onSendSticker === undefined ? null : (
              <button
                type="button"
                className="attach"
                data-icon-only
                aria-label="Sticker and emoji picker"
                title="Stickers And Emoji"
                aria-haspopup="dialog"
                aria-expanded={picker.open}
                onClick={picker.toggle}
              >
                <Icon name="emoji" size={18} />
              </button>
            )}
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
            {commands.showMenu ? (
              <CommandMenu
                id={commands.listId}
                commands={commands.matches}
                active={commands.active}
                onActive={commands.setActiveCommand}
                onPick={commands.pick}
              />
            ) : null}
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              placeholder={editTarget === null ? placeholder : 'Edit Message'}
              aria-autocomplete="list"
              aria-expanded={commands.showMenu}
              aria-controls={commands.showMenu ? commands.listId : undefined}
              aria-activedescendant={commands.showMenu ? `${commands.listId}-${commands.active}` : undefined}
              onChange={(event) => commands.changeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (commands.showMenu) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    commands.moveActive(1);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    commands.moveActive(-1);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMenuOpen(false);
                    return;
                  }
                  if (event.key === 'Tab') {
                    const command = commands.matches[commands.active];
                    if (command) {
                      event.preventDefault();
                      commands.complete(command);
                    }
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    // Selection is the action: the highlighted command is sent,
                    // and an exactly typed command wins over the highlight.
                    const command =
                      commands.matches.find((candidate) => draft === `/${candidate.command}`) ?? commands.matches[commands.active];
                    if (command) {
                      event.preventDefault();
                      commands.pick(command);
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
              type={canRecord ? 'button' : 'submit'}
              aria-label={canRecord ? 'Record Voice Message' : editTarget === null ? 'Send' : 'Save'}
              title={canRecord ? 'Record Voice Message' : editTarget === null ? 'Send' : 'Save'}
              data-icon-only
              className={`send-morph${canRecord ? ' is-mic' : ''}`}
              disabled={editTarget !== null && emptyDraft}
              onClick={
                canRecord
                  ? () => {
                      setRecordingError(null);
                      voice.start();
                    }
                  : undefined
              }
            >
              <Icon name={editTarget === null ? 'send' : 'check'} size={18} className="is-send" />
              <Icon name="mic" size={18} className="is-mic" />
            </button>
          </>
        ) : (
          <VoiceRecordingStrip state={voice.state} seconds={voice.seconds} onCancel={voice.cancel} onStop={voice.stop} />
        )}
        {picker.open && onSendSticker !== undefined ? (
          <StickerPicker
            stickersEnabled={editTarget === null}
            onClose={picker.close}
            onPickEmoji={picker.insertEmoji}
            onSendSticker={picker.sendSticker}
          />
        ) : null}
      </form>
      <Presence visible={pendingFiles !== null}>
        {pendingFiles ? <UploadDialog initialFiles={pendingFiles} onCancel={() => setPendingFiles(null)} onSend={attach} /> : null}
      </Presence>
    </>
  );
}
