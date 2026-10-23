interface LaunchScreenProps {
  error: string | null;
  onRetry: () => void;
}

/**
 * The first paint while the SPA probes the Access session.
 *
 * The launch state is deliberately text-free: the probe is the app starting,
 * and a heading plus a spinner made it read like a stalled form. The mark is
 * the paper plane the favicon and the install icons draw, with the layered
 * motion in `styles/launch.css`; the status text is visually hidden so a
 * screen reader still hears the probe.
 *
 * A real bridge failure stays on this screen with the message and a retry
 * instead of masquerading as a signed-out visitor. The mark dims and pauses so
 * the failure reads as a state, not as a broken animation.
 */
export function LaunchScreen({ error, onRetry }: LaunchScreenProps) {
  return (
    <main className={`launch${error ? ' launch--error' : ''}`}>
      <div className="launch-stage" aria-hidden="true">
        <span className="launch-halo" />
        <span className="launch-orbit launch-orbit-outer" />
        <span className="launch-orbit launch-orbit-inner" />
        <div className="launch-mark">
          <AppMark />
          <span className="launch-sheen" />
        </div>
      </div>
      {error ? (
        <section className="launch-error">
          <h1>Connection failed</h1>
          <p className="status" role="alert">
            {error}
          </p>
          <button type="button" className="ghost" onClick={onRetry}>
            Try again
          </button>
        </section>
      ) : (
        <p className="sr-only" role="status">
          Checking access…
        </p>
      )}
    </main>
  );
}

/**
 * The app's mark, in the favicon's 32-unit box.
 *
 * The geometry is the one `index.html` and `pages/build/pwa/mark.ts` draw; only
 * the tile is lifted from `--bg` to a panel gradient, because on the splash the
 * tile would otherwise disappear into the page. Keep the three copies in step.
 */
function AppMark() {
  return (
    <svg viewBox="0 0 32 32" focusable="false">
      <defs>
        <linearGradient id="launch-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--panel-2)" />
          <stop offset="1" stopColor="var(--panel)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#launch-tile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke="var(--accent)" strokeOpacity="0.22" />
      <g className="launch-plane">
        <path d="M27 4.5 4.5 13 14.5 18z" fill="var(--accent)" />
        <path d="M27 4.5 14.5 18 18 27z" fill="var(--badge)" />
      </g>
    </svg>
  );
}
