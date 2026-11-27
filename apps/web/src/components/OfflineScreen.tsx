import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../app-name';

/**
The screen shown when the client cannot reach the server at all.

It is the fourth face of the home page: the network is gone, so neither the
Cloudflare Access session nor the Telegram session can be probed, and the
chat list is not there to show. The app retries by itself when the browser
says the network is back.
*/
interface OfflineScreenProps {
  onRetry: () => void;
}

export function OfflineScreen({ onRetry }: OfflineScreenProps) {
  const { t } = useTranslation();
  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="eyebrow">{APP_NAME}</p>
        <h1>{t('offline.title', 'You Are Offline')}</h1>
        <p className="lead">
          {t(
            'offline.body',
            'The Client Cannot Reach The Server, So It Cannot Read Your Chats. It Reconnects On Its Own As Soon As The Network Is Back.',
          )}
        </p>
        <button type="button" className="cta" onClick={onRetry}>
          {t('offline.tryAgain', 'Try Again')}
        </button>
      </section>
    </main>
  );
}
