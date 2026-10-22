/**
 * The screen shown when the client cannot reach the server at all.
 *
 * It is the fourth face of the home page: the network is gone, so neither the
 * Cloudflare Access session nor the Telegram session can be probed, and the
 * chat list is not there to show. The app retries by itself when the browser
 * says the network is back.
 */
interface OfflineScreenProps {
  onRetry: () => void;
}

export function OfflineScreen({ onRetry }: OfflineScreenProps) {
  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="eyebrow">Telegram Web Client</p>
        <h1>You are offline</h1>
        <p className="lead">
          The client cannot reach the server, so it cannot read your chats. It reconnects on its own as soon as the network is back.
        </p>
        <button type="button" className="cta" onClick={onRetry}>
          Try again
        </button>
      </section>
    </main>
  );
}
