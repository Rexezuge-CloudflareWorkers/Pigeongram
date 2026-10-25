import { accessLoginUrl } from '../api';
import { APP_NAME } from '../app-name';

/**
 * The public home page, shown before Cloudflare Access authenticates the
 * browser. Modelled on the sibling Edge-Git landing: the only action is the
 * Access sign-in, which returns to the path the visitor arrived on so a
 * bookmarked chat link survives the login round-trip.
 */
export function LandingPage() {
  const returnTo = `${location.pathname}${location.search}`;
  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="eyebrow">{APP_NAME}</p>
        <h1>Your Telegram, on Cloudflare Workers</h1>
        <p className="lead">
          A single-account client that stays online at the edge: a Durable Object keeps the Telegram session warm, and this page streams
          chats live while a tab is attached.
        </p>
        <a className="cta" href={accessLoginUrl(returnTo)}>
          Sign in with Cloudflare Access
        </a>
        <p className="muted small">Cloudflare Access is the front door. The account API is never publicly routable.</p>
      </section>
      <section className="landing-features" aria-label="What this client does">
        <article className="feature">
          <h2>Always-on session</h2>
          <p>A Durable Object wakes on an alarm, replays missed updates, and goes back to sleep.</p>
        </article>
        <article className="feature">
          <h2>Live updates</h2>
          <p>New messages, edits, and read receipts arrive over one WebSocket while you are here.</p>
        </article>
        <article className="feature">
          <h2>Private by default</h2>
          <p>Access guards every account route; chats and media are fetched live from Telegram.</p>
        </article>
      </section>
    </main>
  );
}
