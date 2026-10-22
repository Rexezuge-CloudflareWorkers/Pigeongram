import type { AccessStatus } from '../hooks';
import type { EngineStateDto } from '../types';
import { CheckingAccess } from './CheckingAccess';
import { LandingPage } from './LandingPage';
import { LoginScreen } from './LoginScreen';
import { OfflineScreen } from './OfflineScreen';

/**
The four faces of the home page: the public intro until Cloudflare Access
admits the browser, the offline screen when there is no network to ask, the
Telegram QR login once Access is through but Telegram is not linked, and the
chat list once both are.

The picker lives here rather than in `App.tsx`, which is already at the
god-file limit: these are the app's first screen, and the order they are
picked in is what makes the flow readable.
*/
interface HomeScreenProps {
  access: AccessStatus;
  state: EngineStateDto | null;
  error: string | null;
  onRetryAccess: () => void;
  onPhone: (phone: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onPassword: (password: string) => Promise<void>;
  onRetry: () => void;
}

export function HomeScreen({ access, state, error, onRetryAccess, onPhone, onCode, onPassword, onRetry }: HomeScreenProps) {
  if (access === 'checking') {
    return <CheckingAccess error={error} onRetry={onRetryAccess} />;
  }

  if (access === 'offline') {
    return <OfflineScreen onRetry={onRetryAccess} />;
  }

  if (access === 'anonymous') {
    return <LandingPage />;
  }

  return <LoginScreen state={state} error={error} onPhone={onPhone} onCode={onCode} onPassword={onPassword} onRetry={onRetry} />;
}
