interface ToastsProps {
  /**
  The failure that is on screen, if any.
  */
  error: string | null;
  /**
  The notice that is on screen, if any.
  */
  notice: string | null;
}

/**
The app's toasts: the failure on top, the notice below it.

Split out of `App.tsx` so the shell stays readable: the app owns the two
messages, this renders them.
*/
export function Toasts({ error, notice }: ToastsProps) {
  if (!error && !notice) return null;
  return (
    <div className="toasts">
      {error ? (
        <p className="toast" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="toast notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
