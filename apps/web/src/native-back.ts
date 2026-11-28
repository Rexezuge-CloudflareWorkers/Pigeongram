import { useEffect } from 'react';
import type { Router } from './useRouter';

/**
The native shell's back seam.

The Android WebView shell cannot ask the WebView's own history whether there
is somewhere to go back to: `WebView.canGoBack()` goes stale for the entries
`useRouter` seeds with back-to-back `replaceState`/`pushState`, and Chromium's
history-manipulation intervention can skip them anyway. So the shell calls
this function instead, and the answer is the one the in-app back button gives:
handled, or the chat list is the root.

`true`/`false` is what the page answers; the shell maps it onto 1/0/absent
(see `MainActivity.handleBack`). An absent function — the login screen, or a
web build older than this seam — leaves the shell on its WebView-history
fallback.
*/

declare global {
  // The shell's page-side seam. `var` puts it on the global object, which is
  // what `globalThis` and `window` both read.
  // eslint-disable-next-line no-var
  var __pigeongramBack: (() => boolean) | undefined;
}

/**
Installs the shell's back handler and returns the cleanup. Only the chat list
hands the press back to the shell, which then leaves the app; every other
screen is the same traversal the in-app back button performs.
*/
export function installNativeBack(router: Pick<Router, 'back' | 'route'>): () => void {
  const handleBack = (): boolean => {
    if (router.route().view === 'list') return false;
    router.back();
    return true;
  };
  globalThis.__pigeongramBack = handleBack;
  return () => {
    if (globalThis.__pigeongramBack === handleBack) delete globalThis.__pigeongramBack;
  };
}

/**
Installs the seam for as long as the signed-in navigation is mounted.
*/
export function useNativeBack({ back, route }: Pick<Router, 'back' | 'route'>): void {
  useEffect(() => installNativeBack({ back, route }), [back, route]);
}
