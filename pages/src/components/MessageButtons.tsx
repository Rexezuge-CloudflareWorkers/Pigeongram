import { miniAppDeepLink, launchTelegramApp } from '../links';
import { useTelegramLinkHandler } from '../telegram-links';
import type { MessageButtonDto, MessageDto, MessageMarkupDto } from '../types';
import { Spinner } from './Spinner';

/**
A message's inline keyboard: Telegram's rows of buttons, rendered under the
bubble.

Callback and copy buttons call the controller; URL buttons reuse the message
link router, so a `t.me` chat opens in the thread while ordinary links keep
their new-tab behavior. Web-view buttons are Mini Apps: a Telegram-hosted link
is handed to the installed app (a browser tab cannot inject the signed
`initData` a Mini App needs), and anything else opens as a normal link.
*/

interface MessageButtonsProps {
  message: MessageDto;
  markup: MessageMarkupDto;
  /**
  Whether a callback press on this message is in flight.
  */
  pressing?: boolean;
  /**
  Runs a callback or copy button. Absent for views that do not press.
  */
  onPress?: (message: MessageDto, button: MessageButtonDto) => void;
}

export function MessageButtons({ message, markup, pressing = false, onPress }: MessageButtonsProps) {
  return (
    <div className="buttons">
      {markup.rows.map((row, rowIndex) => (
        <div className="buttons-row" key={rowIndex}>
          {row.map((button, buttonIndex) => (
            <MessageButton
              key={`${String(rowIndex)}:${String(buttonIndex)}`}
              message={message}
              button={button}
              pressing={pressing}
              onPress={onPress}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MessageButton({
  message,
  button,
  pressing,
  onPress,
}: {
  message: MessageDto;
  button: MessageButtonDto;
  pressing: boolean;
  onPress?: (message: MessageDto, button: MessageButtonDto) => void;
}) {
  const handleLink = useTelegramLinkHandler();
  const className = `button${button.style === null ? '' : ` ${button.style}`}`;

  if (button.kind === 'url') {
    return (
      <a
        className={className}
        href={button.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (handleLink?.(button.url)) event.preventDefault();
        }}
      >
        {button.text}
      </a>
    );
  }

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

  const actionable = button.kind === 'callback' || button.kind === 'copy';
  const disabledReason = buttonDisabledReason(button, actionable, onPress !== undefined, pressing);
  return (
    <button
      type="button"
      className={className}
      disabled={disabledReason !== null}
      title={disabledReason ?? undefined}
      aria-busy={pressing && button.kind === 'callback'}
      onClick={() => onPress?.(message, button)}
    >
      {button.text}
      {pressing && button.kind === 'callback' ? <Spinner inline size={12} color="currentColor" /> : null}
    </button>
  );
}

function buttonDisabledReason(button: MessageButtonDto, actionable: boolean, hasHandler: boolean, pressing: boolean): string | null {
  if (button.kind === 'callback' && button.requiresPassword) {
    return 'This button needs your Telegram password; press it in the native app.';
  }
  if (pressing && button.kind === 'callback') return 'Sending…';
  if (!actionable) return unsupportedReason(button.kind);
  if (!hasHandler) return 'Buttons are not available in this view.';
  return null;
}

function unsupportedReason(kind: MessageButtonDto['kind']): string {
  switch (kind) {
    case 'game': {
      return 'Telegram games need the native app.';
    }
    case 'pay': {
      return 'Telegram payments need the native app.';
    }
    case 'switch_inline': {
      return 'Inline mode is not supported in this client.';
    }
    case 'url_auth': {
      return 'Telegram login buttons need the native app.';
    }
    case 'user_profile': {
      return 'Profiles are not supported in this client.';
    }
    case 'disabled': {
      return 'This button is disabled by the bot.';
    }
    case 'callback':
    case 'url':
    case 'webview':
    case 'copy': {
      return 'This button is not supported in this client.';
    }
  }
}
