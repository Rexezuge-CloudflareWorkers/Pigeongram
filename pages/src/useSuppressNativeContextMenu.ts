import { useEffect } from 'react';

/**
The fields that keep the browser's own context menu. The native menu is how a
desktop reader pastes into the composer or the login form, and the app offers no
replacement there.
*/
const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Takes the browser's context menu away from every element but an editable
 * field.
 *
 * The message bubble is the app's only custom right-click menu; everywhere else
 * a right-click should do nothing rather than hand over the browser's own menu
 * (save image, open link, reload, inspect). The listener is capture-phase
 * because the media viewer and the forward picker stop propagation on their own
 * `contextmenu` handler — a bubble-phase listener on the document would never
 * see those events. `preventDefault` alone leaves propagation intact, so React's
 * `onContextMenu` handlers (the message menu, and its keyboard invocation) still
 * run.
 */
export function useSuppressNativeContextMenu(): void {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(EDITABLE) !== null) return;
      event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, []);
}
