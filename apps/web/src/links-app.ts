import type { TelegramChatTarget } from './links-targets';
import { targetAppLink } from './links-targets';
import type { TelegramLink } from './links';

/**
 * The native-app handoff: a `tg://` link in a hidden iframe, with the https
 * fallback when nothing takes over.
 *
 * Split from `links.ts` so the grammar file stays under the god-file cap; the
 * two halves are one subject — a link is parsed there and opened here.
 */

/**
 * How long the app has to take over before the browser fallback opens.
 */
export const APP_LAUNCH_TIMEOUT_MS = 2500;

/**
 * Opens a `tg://` link in the installed app, falling back to the canonical
 * https URL when nothing takes over.
 *
 * The deep link is loaded in a hidden iframe: a browser with a handler for the
 * scheme shows its "open in app" prompt without navigating away, and one
 * without a handler does nothing, so this page is never clobbered. The tab
 * losing focus or visibility within the timeout proves the app took over;
 * otherwise the https URL opens in a new tab (popup blockers permitting).
 */
export function launchTelegramApp(deepLink: string, webUrl: string | null): void {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = deepLink;
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
  document.body.appendChild(frame);

  const timer = setTimeout(() => {
    stop();
    if (webUrl !== null) window.open(webUrl, '_blank', 'noopener,noreferrer');
  }, APP_LAUNCH_TIMEOUT_MS);

  // Hoisted, so the timer callback and the listeners below can share it.
  function stop(): void {
    clearTimeout(timer);
    window.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', onVisibility);
    frame.remove();
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') stop();
  }

  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', onVisibility);
}

/**
 * Hands a chat the bridge could not resolve to the installed app, using the
 * link's own address where there is one.
 *
 * A link that asked for the chat is the most faithful address: it may name a
 * chat this client cannot address yet. Without one, the resolved target is the
 * address, and a target that has no addressable form (a basic group known only
 * by its marked id) leaves the call with nothing to do.
 */
export function handOffTarget(target: TelegramChatTarget, link?: TelegramLink): void {
  if (link !== undefined) {
    launchTelegramApp(link.deepLink, link.webUrl);
    return;
  }
  const address = targetAppLink(target);
  if (address !== null) launchTelegramApp(address.deepLink, address.webUrl);
}
