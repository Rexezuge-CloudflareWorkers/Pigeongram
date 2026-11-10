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
        <h1>Your Telegram, On Cloudflare Workers</h1>
        <p className="lead">
          A Single-Account Client That Stays Online At The Edge: A Durable Object Keeps The Telegram Session Warm, And This Page Streams
          Chats Live While A Tab Is Attached.
        </p>
        <a className="cta" href={accessLoginUrl(returnTo)}>
          Sign In With Cloudflare Access
        </a>
        <p className="muted small">Cloudflare Access Is The Front Door. The Account API Is Never Publicly Routable.</p>
      </section>
      <section className="landing-features" aria-label="What this client does">
        <article className="feature">
          <h2>Always-On Session</h2>
          <p>A Durable Object Wakes On An Alarm, Replays Missed Updates, And Goes Back To Sleep.</p>
        </article>
        <article className="feature">
          <h2>Live Updates</h2>
          <p>New Messages, Edits, And Read Receipts Arrive Over One WebSocket While You Are Here.</p>
        </article>
        <article className="feature">
          <h2>Private By Default</h2>
          <p>Access Guards Every Account Route; Chats And Media Are Fetched Live From Telegram.</p>
        </article>
      </section>
    </main>
  );
}
