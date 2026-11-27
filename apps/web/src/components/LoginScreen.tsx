import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loginPhaseMessage } from '../login-copy';
import type { EngineStateDto } from '../types';
import { Spinner } from './Spinner';
import { TextField } from './TextField';

/**
The last few seconds of a code's life are not shown at all: Telegram's login
tokens live ~30 s, and a scanned-but-expired token makes the scanning app
answer with a generic "an error occurred".
*/
const QR_REFRESH_WINDOW_MS = 3000;

interface LoginScreenProps {
  state: EngineStateDto | null;
  error: string | null;
  onPhone: (phone: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onPassword: (password: string) => Promise<void>;
  onRetry: () => void;
}

export function LoginScreen({ state, error, onPhone, onCode, onPassword, onRetry }: LoginScreenProps) {
  const { t } = useTranslation();
  // Which of the two sign-in paths the operator picked; the engine's phase
  // overrides it whenever a code is already in flight (e.g. after a reload).
  const [usePhone, setUsePhone] = useState(false);
  const phase = state?.phase ?? 'unauthorized';
  const awaitingCode = phase === 'code';
  const phoneForm = usePhone && !awaitingCode && phase !== 'password';
  const qrVisible = !awaitingCode && !phoneForm && phase !== 'password';
  const statusBusy = !phoneForm && (state === null || phase === 'unauthorized' || phase === 'scanned');
  const statusText = phoneForm
    ? t('login.phoneEntry', 'Enter Your Phone Number — Telegram Will Send A Login Code.')
    : loginPhaseMessage(state);
  return (
    <main className="login">
      <section className="card">
        <h1>{t('login.title', 'Sign In To Telegram')}</h1>
        {qrVisible ? <QrPanel state={state} /> : null}
        <p className="status">{statusBusy ? <Spinner inline size={14} label={statusText} /> : statusText}</p>
        {phoneForm ? <PhoneForm onSubmit={onPhone} onBack={() => setUsePhone(false)} /> : null}
        {awaitingCode ? <CodeForm state={state} onSubmit={onCode} onRetry={onRetry} /> : null}
        {phase === 'password' ? <PasswordForm invalid={state?.passwordInvalid === true} onSubmit={onPassword} /> : null}
        {error ? <p className="error">{error}</p> : null}
        {phase === 'error' || error ? (
          <button type="button" className="ghost" onClick={onRetry}>
            {t('login.startOver', 'Start Over')}
          </button>
        ) : null}
        {qrVisible ? (
          <button type="button" className="ghost" onClick={() => setUsePhone(true)}>
            {t('login.usePhone', 'Use A Phone Number Instead')}
          </button>
        ) : null}
        <p className="muted small">
          {t(
            'login.footnote',
            'Session Engine: Cloudflare Durable Object, MTProto Over WSS. The Client Only Holds Your Session; Messages Are Fetched Live From Telegram.',
          )}
        </p>
      </section>
    </main>
  );
}

function QrPanel({ state }: { state: EngineStateDto | null }) {
  const { t } = useTranslation();
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
        <img className="qr" src={dataUrl} alt={t('a11y.loginQrCode', 'Telegram login QR code')} width={256} height={256} />
      ) : (
        <div className="qr placeholder grid place-items-center" aria-hidden="true">
          <Spinner size={32} />
        </div>
      )}
      <p className="muted small">
        {dataUrl && expiresIn !== null
          ? t('login.qrValid', 'Code Valid For {{seconds}}s — Telegram Login Codes Live ~30 Seconds, So Scan As Soon As It Appears.', {
              seconds: Math.max(expiresIn, 0),
            })
          : t('login.qrWaiting', 'Waiting For A Fresh QR Code…')}
      </p>
    </>
  );
}

function PhoneForm({ onSubmit, onBack }: { onSubmit: (phone: string) => Promise<void>; onBack: () => void }) {
  const { t } = useTranslation();
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
      <TextField
        type="tel"
        value={phone}
        placeholder={t('login.phonePlaceholder', '+15551234567')}
        autoComplete="tel"
        autoFocus
        aria-label={t('a11y.phoneNumber', 'Phone number')}
        onChange={(event) => setPhone(event.target.value)}
      />
      <button type="submit" disabled={submitting || phone.trim().length < 5} aria-busy={submitting}>
        {submitting ? (
          <>
            <Spinner inline size={14} color="currentColor" /> {t('login.sending', 'Sending…')}
          </>
        ) : (
          t('common.sendCode', 'Send Code')
        )}
      </button>
      <button type="button" className="ghost" onClick={onBack} disabled={submitting}>
        {t('login.useQr', 'Use A QR Code Instead')}
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
  const { t } = useTranslation();
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
      <TextField
        type="text"
        inputMode="numeric"
        value={code}
        placeholder={t('login.codePlaceholder', 'Login Code')}
        autoComplete="one-time-code"
        autoFocus
        aria-label={t('a11y.loginCode', 'Login code')}
        onChange={(event) => setCode(event.target.value)}
      />
      {state?.codeInvalid ? (
        <p className="error">{t('login.codeRejected', 'That Code Was Rejected — Check The Latest Message And Try Again.')}</p>
      ) : null}
      <button type="submit" disabled={submitting || code.trim().length === 0} aria-busy={submitting}>
        {submitting ? (
          <>
            <Spinner inline size={14} color="currentColor" /> {t('login.checking', 'Checking…')}
          </>
        ) : (
          t('common.submitCode', 'Submit Code')
        )}
      </button>
      <button type="button" className="ghost" onClick={onRetry}>
        {t('login.startOver', 'Start Over')}
      </button>
    </form>
  );
}

function PasswordForm({ invalid, onSubmit }: { invalid: boolean; onSubmit: (password: string) => Promise<void> }) {
  const { t } = useTranslation();
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
      <TextField
        type="password"
        value={password}
        placeholder={t('login.passwordPlaceholder', 'Cloud Password')}
        autoComplete="current-password"
        autoFocus
        aria-label={t('a11y.cloudPassword', 'Cloud password')}
        onChange={(event) => setPassword(event.target.value)}
      />
      {invalid ? <p className="error">{t('login.passwordRejected', 'That Password Was Rejected — Try Again.')}</p> : null}
      <button type="submit" disabled={submitting || password.length === 0} aria-busy={submitting}>
        {submitting ? (
          <>
            <Spinner inline size={14} color="currentColor" /> {t('login.checking', 'Checking…')}
          </>
        ) : (
          t('common.submit', 'Submit')
        )}
      </button>
    </form>
  );
}
