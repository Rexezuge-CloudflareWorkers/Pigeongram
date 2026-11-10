import { launchTelegramApp, miniAppDeepLink } from '../links';
import type { ActiveReplyKeyboard } from '../reply-keyboard';
import type { MessageReplyKeyboardButtonDto } from '../types';

/**
The chat's reply keyboard: the custom keyboard a bot shows above the composer.

Text buttons send their text as a message, exactly as typing it would. A web
view button is a Mini App: a Telegram-hosted link is handed to the installed
app (a browser tab cannot inject the signed `initData` a Mini App needs), and
anything else opens as a normal link. The remaining kinds — a contact, a
location, a poll or a peer request — need Telegram's own UI and are shown
disabled instead of silently dropped.
*/

interface ReplyKeyboardProps {
  keyboard: ActiveReplyKeyboard;
  onPress: (button: MessageReplyKeyboardButtonDto) => void;
}

export function ReplyKeyboard({ keyboard, onPress }: ReplyKeyboardProps) {
  return (
    <div className="reply-keyboard flex flex-col gap-1.5 border-t border-line bg-panel px-3 py-2" role="group" aria-label="Bot keyboard">
      {keyboard.keyboard.rows.map((row, rowIndex) => (
        <div className="flex gap-1.5" key={rowIndex}>
          {row.map((button, buttonIndex) => (
            <ReplyKeyboardButton key={`${String(rowIndex)}:${String(buttonIndex)}`} button={button} onPress={onPress} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ReplyKeyboardButton({
  button,
  onPress,
}: {
  button: MessageReplyKeyboardButtonDto;
  onPress: (button: MessageReplyKeyboardButtonDto) => void;
}) {
  const className = replyButtonClass(button.style);

  if (button.kind === 'webview') {
    const deepLink = miniAppDeepLink(button.url);
    return (
      <a
        className={className}
        href={button.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (deepLink === null) return;
          event.preventDefault();
          launchTelegramApp(deepLink, button.url);
        }}
      >
        {button.text}
      </a>
    );
  }

  if (button.kind === 'text') {
    return (
      <button type="button" className={className} onClick={() => onPress(button)}>
        {button.text}
      </button>
    );
  }

  return (
    <button type="button" className={className} disabled title={unsupportedReason(button.kind)}>
      {button.text}
    </button>
  );
}

/**
The button's class list, with the requested emphasis folded in. The variant
classes are exclusive rather than layered, so no two background utilities
compete.
*/
function replyButtonClass(style: MessageReplyKeyboardButtonDto['style']): string {
  const base =
    'inline-flex min-w-0 flex-1 items-center justify-center break-words rounded-xs border px-3 py-2 text-center text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40';
  switch (style) {
    case 'primary': {
      return `${base} border-accent bg-accent font-semibold text-[#05070e] hover:brightness-110`;
    }
    case 'danger': {
      return `${base} border-error bg-error-container font-semibold text-on-error-container hover:brightness-110`;
    }
    case 'success': {
      return `${base} border-tertiary-container bg-tertiary-container font-semibold text-on-tertiary-container hover:brightness-110`;
    }
    default: {
      return `${base} border-line bg-panel-2 text-fg hover:bg-line`;
    }
  }
}

function unsupportedReason(kind: MessageReplyKeyboardButtonDto['kind']): string {
  switch (kind) {
    case 'request_phone': {
      return 'Sharing a phone number needs the native app.';
    }
    case 'request_geo': {
      return 'Sharing a location needs the native app.';
    }
    case 'request_poll': {
      return 'Creating a poll needs the native app.';
    }
    case 'request_peer': {
      return 'Choosing a chat needs the native app.';
    }
    default: {
      return 'This button is not supported in this client.';
    }
  }
}
