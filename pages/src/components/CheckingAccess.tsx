import { Spinner } from './Spinner';

interface CheckingAccessProps {
  error: string | null;
  onRetry: () => void;
}

/**
 * The first paint while the SPA probes the Access session. It keeps the intro
 * and the QR screen from flashing before the bridge answers; a real bridge
 * failure stays here with a retry instead of masquerading as a signed-out
 * visitor.
 */
export function CheckingAccess({ error, onRetry }: CheckingAccessProps) {
  return (
    <main className="login">
      <section className="card">
        <h1>Checking access</h1>
        {error ? <p className="status">{error}</p> : <Spinner size={36} label="Connecting to the session engine…" padding="4px 0" />}
        {error ? (
          <button type="button" className="ghost" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </section>
    </main>
  );
}
