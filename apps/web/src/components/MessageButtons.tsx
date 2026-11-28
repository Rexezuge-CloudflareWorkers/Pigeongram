import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { miniAppDeepLink, launchTelegramApp } from '../links';
import { safeHref } from '../safe-url';
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
  const { t } = useTranslation();
  const handleLink = useTelegramLinkHandler();
  const className = `button${button.style === null ? '' : ` ${button.style}`}`;
  // The bot chose this URL. An unsafe scheme becomes an inert label rather
  // than a live anchor; the button's text is still shown to the reader.
  const href = button.kind === 'url' || button.kind === 'webview' ? safeHref(button.url) : null;

  if (button.kind === 'url') {
    if (href === null) return <span className={className}>{button.text}</span>;
    return (
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (handleLink?.(href)) event.preventDefault();
        }}
      >
        {button.text}
      </a>
    );
  }

  if (button.kind === 'webview') {
    if (href === null) return <span className={className}>{button.text}</span>;
    const deepLink = miniAppDeepLink(href);
    return (
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (deepLink === null) return;
          event.preventDefault();
          launchTelegramApp(deepLink, href);
        }}
      >
        {button.text}
      </a>
    );
  }

  const actionable = button.kind === 'callback' || button.kind === 'copy';
  const disabledReason = buttonDisabledReason(t, button, actionable, onPress !== undefined, pressing);
  const disabled = disabledReason !== null;
  const reasonId = disabled ? `message-button-reason-${button.text}` : undefined;
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={disabledReason ?? undefined}
        aria-busy={pressing && button.kind === 'callback'}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={() => onPress?.(message, button)}
      >
        {button.text}
        {pressing && button.kind === 'callback' ? <Spinner inline size={12} color="currentColor" /> : null}
      </button>
      {/* The disabled reason is announced via `aria-describedby`, not folded
          into the button's name: the visible label stays the short verb, and
          assistive tech reads the explanation in place. */}
      {disabled && disabledReason ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}

function buttonDisabledReason(
  t: TFunction,
  button: MessageButtonDto,
  actionable: boolean,
  hasHandler: boolean,
  pressing: boolean,
): string | null {
  if (button.kind === 'callback' && button.requiresPassword) {
    return t('a11y.buttonNeedsPassword', 'This button needs your Telegram password; press it in the native app.');
  }
  if (pressing && button.kind === 'callback') return t('a11y.buttonSending', 'Sending…');
  if (!actionable) return unsupportedReason(t, button.kind);
  if (!hasHandler) return t('a11y.buttonsUnavailable', 'Buttons are not available in this view.');
  return null;
}

function unsupportedReason(t: TFunction, kind: MessageButtonDto['kind']): string {
  switch (kind) {
    case 'game': {
      return t('a11y.gameNeedsApp', 'Telegram games need the native app.');
    }
    case 'pay': {
      return t('a11y.paymentNeedsApp', 'Telegram payments need the native app.');
    }
    case 'switch_inline': {
      return t('a11y.inlineUnsupported', 'Inline mode is not supported in this client.');
    }
    case 'url_auth': {
      return t('a11y.loginButtonNeedsApp', 'Telegram login buttons need the native app.');
    }
    case 'user_profile': {
      return t('a11y.profileUnsupported', 'Profiles are not supported in this client.');
    }
    case 'disabled': {
      return t('a11y.buttonDisabledByBot', 'This button is disabled by the bot.');
    }
    case 'callback':
    case 'url':
    case 'webview':
    case 'copy': {
      return t('a11y.buttonUnsupported', 'This button is not supported in this client.');
    }
  }
}
