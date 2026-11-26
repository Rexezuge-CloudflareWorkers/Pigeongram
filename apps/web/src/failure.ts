/**
The one readable form of a bridge failure in the SPA.

A thrown value crosses several layers — the API client throws `ServiceError`s,
an encoder throws `Error`s, and a mock may throw a string — and every screen
needs the same sentence for its toast. Keeping the conversion here means a
screen cannot disagree with its neighbour about how a failure is named.
*/
export function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
