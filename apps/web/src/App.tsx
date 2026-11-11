import { HomeScreen } from './components/HomeScreen';
import { SignedInShell } from './components/SignedInShell';
import { DataSaverProvider, useDataSaverPreferences } from './data-saver';
import { useLoginFlow } from './hooks';
import { usePwa } from './pwa/usePwa';
import { useAppHeight } from './useAppHeight';

/**
 * The app: the screen picker over the login flow, and the two planes it picks
 * between. The home page has four faces — the public intro, the offline
 * screen, the QR login and the chat list — and the picker lives in
 * `HomeScreen`; the signed-in plane (and the account data behind it) lives in
 * `SignedInShell`, so neither this file nor that one is a feature away from
 * the god-file cap.
 */
export function App() {
  useAppHeight();
  const { state, access, error, reportError, retryAccess, onPhone, onCode, onPassword, onRetry, reset } = useLoginFlow();
  // Registered on every screen: the public intro is installable too.
  const pwa = usePwa();
  // The media-loading choices belong to the device, so they load before the
  // signed-in plane and survive a sign-out.
  const dataSaver = useDataSaverPreferences();
  const authorized = state?.authorized ?? false;

  if (access !== 'authenticated' || !authorized) {
    return (
      <HomeScreen
        access={access}
        state={state}
        error={error}
        onRetryAccess={retryAccess}
        onPhone={onPhone}
        onCode={onCode}
        onPassword={onPassword}
        onRetry={onRetry}
      />
    );
  }

  return (
    <DataSaverProvider value={dataSaver}>
      <SignedInShell initialMe={state?.me ?? null} error={error} pwa={pwa} onError={reportError} onSignedOut={reset} />
    </DataSaverProvider>
  );
}
