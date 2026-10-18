import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { loginPhaseMessage } from '../api';
import type { EngineStateDto } from '../types';

/**
 * The last few seconds of a code's life are not shown at all: Telegram's login
 * tokens live ~30 s, and a scanned-but-expired token makes the scanning app
 * answer with a generic "an error occurred".
 */
const QR_REFRESH_WINDOW_MS = 3000;

interface LoginScreenProps {
  state: EngineStateDto | null;
  /**
  True when the bridge rejected the request for a missing token.
  */
  gate: boolean;
  error: string | null;
  onToken: (token: string) => void;
  onPhone: (phone: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onPassword: (password: string) => Promise<void>;
  onRetry: () => void;
}

export function LoginScreen({ state, gate, error, onToken, onPhone, onCode, onPassword, onRetry }: LoginScreenProps) {
  // Which of the two sign-in paths the operator picked; the engine's phase
  // overrides it whenever a code is already in flight (e.g. after a reload).
  const [usePhone, setUsePhone] = useState(false);
  if (gate) {
    return <TokenGate onToken={onToken} />;
  }
  const phase = state?.phase ?? 'unauthorized';
  const awaitingCode = phase === 'code';
  const phoneForm = usePhone && !awaitingCode && phase !== 'password';
  const qrVisible = !awaitingCode && !phoneForm && phase !== 'password';
  return (
    <main className="login">
      <section className="card">
        <h1>Sign in to Telegram</h1>
        {qrVisible ? <QrPanel state={state} /> : null}
        <p className="status">{phoneForm ? 'Enter your phone number — Telegram will send a login code.' : loginPhaseMessage(state)}</p>
        {phoneForm ? <PhoneForm onSubmit={onPhone} onBack={() => setUsePhone(false)} /> : null}
        {awaitingCode ? <CodeForm state={state} onSubmit={onCode} onRetry={onRetry} /> : null}
        {phase === 'password' ? <PasswordForm invalid={state?.passwordInvalid === true} onSubmit={onPassword} /> : null}
        {error ? <p className="error">{error}</p> : null}
        {phase === 'error' || error ? (
          <button type="button" className="ghost" onClick={onRetry}>
            Start over
          </button>
        ) : null}
        {qrVisible ? (
          <button type="button" className="ghost" onClick={() => setUsePhone(true)}>
            Use a phone number instead
          </button>
        ) : null}
        <p className="muted small">
          Session engine: Cloudflare Durable Object, MTProto over WSS. The client only holds your session; messages are fetched live from
          Telegram.
        </p>
      </section>
    </main>
  );
}

function TokenGate({ onToken }: { onToken: (token: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <main className="login">
      <section className="card">
        <h1>Access token required</h1>
        <p className="muted">
          Until Cloudflare Access is in front of this deployment, the session engine is gated by a shared secret. Paste it below; it is kept
          in this browser only.
        </p>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            onToken(draft);
          }}
        >
          <input
            type="password"
            value={draft}
            placeholder="Access token"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={draft.trim().length === 0}>
            Save
          </button>
        </form>
      </section>
    </main>
  );
}

function QrPanel({ state }: { state: EngineStateDto | null }) {
  // `rendered` pairs the QR payload with its image: when the engine rotates
  // the URL, the stale image is ignored instead of being briefly shown.
  const [rendered, setRendered] = useState<{ url: string; dataUrl: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const qrUrl = state?.qrUrl ?? null;
  const qrExpires = state?.qrExpires ?? null;

  // The panel keeps its own clock because the engine only refreshes on the
  // next poll: a code in its last seconds must be hidden, not offered for
  // scanning. An expired code is exactly what makes the scanning app answer
  // with a generic "an error occurred".
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!qrUrl) return;
    let cancelled = false;
    // The quiet zone is 4 modules (the spec minimum): scanners reject codes
    // with a tight margin, especially on a dark page. Low error correction is
    // deliberate — it keeps the module count (and so the module size) large.
    QRCode.toDataURL(qrUrl, { margin: 4, width: 256, errorCorrectionLevel: 'L' })
      .then((dataUrl) => {
        if (!cancelled) setRendered({ url: qrUrl, dataUrl });
      })
      .catch(() => {
        // Without a canvas (tests, exotic browsers) the placeholder stays.
      });
    return () => {
      cancelled = true;
    };
  }, [qrUrl]);

  const expiresIn = qrExpires === null ? null : Math.ceil((qrExpires - now) / 1000);
  const fresh = qrUrl !== null && (expiresIn === null || expiresIn * 1000 > QR_REFRESH_WINDOW_MS);
  const dataUrl = fresh && rendered?.url === qrUrl ? rendered.dataUrl : null;
  return (
    <>
      {dataUrl ? (
        <img className="qr" src={dataUrl} alt="Telegram login QR code" width={256} height={256} />
      ) : (
        <div className="qr placeholder" aria-hidden="true" />
      )}
      <p className="muted small">
        {dataUrl && expiresIn !== null
          ? `Code valid for ${Math.max(expiresIn, 0)}s — Telegram login codes live ~30 seconds, so scan as soon as it appears.`
          : 'Waiting for a fresh QR code…'}
      </p>
    </>
  );
}

function PhoneForm({ onSubmit, onBack }: { onSubmit: (phone: string) => Promise<void>; onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="column"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void onSubmit(phone.trim()).finally(() => setSubmitting(false));
      }}
    >
      <input
        type="tel"
        value={phone}
        placeholder="+15551234567"
        autoComplete="tel"
        autoFocus
        onChange={(event) => setPhone(event.target.value)}
      />
      <button type="submit" disabled={submitting || phone.trim().length < 5}>
        {submitting ? 'Sending…' : 'Send code'}
      </button>
      <button type="button" className="ghost" onClick={onBack} disabled={submitting}>
        Use a QR code instead
      </button>
    </form>
  );
}

function CodeForm({
  state,
  onSubmit,
  onRetry,
}: {
  state: EngineStateDto | null;
  onSubmit: (code: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="column"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void onSubmit(code.trim())
          .then(() => setCode(''))
          .finally(() => setSubmitting(false));
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        value={code}
        placeholder="Login code"
        autoComplete="one-time-code"
        autoFocus
        onChange={(event) => setCode(event.target.value)}
      />
      {state?.codeInvalid ? <p className="error">That code was rejected — check the latest message and try again.</p> : null}
      <button type="submit" disabled={submitting || code.trim().length === 0}>
        {submitting ? 'Checking…' : 'Submit code'}
      </button>
      <button type="button" className="ghost" onClick={onRetry}>
        Start over
      </button>
    </form>
  );
}

function PasswordForm({ invalid, onSubmit }: { invalid: boolean; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="column"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitting(true);
        void onSubmit(password)
          .then(() => setPassword(''))
          .finally(() => setSubmitting(false));
      }}
    >
      <input
        type="password"
        value={password}
        placeholder="Cloud password"
        autoComplete="current-password"
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />
      {invalid ? <p className="error">That password was rejected — try again.</p> : null}
      <button type="submit" disabled={submitting || password.length === 0}>
        {submitting ? 'Checking…' : 'Submit'}
      </button>
    </form>
  );
}
