/**
 * A message bound for the toast surface: its text plus the token that says
 * which arrival it is. The token is what makes a repeated message a fresh
 * toast, so the text alone is never the identity of a notification.
 */
export interface ToastMessage {
  text: string;
  token: number;
}
