import type { PwaState } from '../pwa/usePwa';
import type { ToastMessage } from '../toast-message';
import type { MeDto } from '../types';

/**
The signed-in shell's inputs: the account the login flow read, its failure
toast and the callbacks the shell reports through.
*/
export interface SignedInShellProps {
  /**
  The account the login flow already read. The boot's own read replaces it.
  */
  initialMe: MeDto | null;
  /**
  The login flow's failure, shown by the global toast.
  */
  error: ToastMessage | null;
  /**
  The installable app's offer, shown by the account menu.
  */
  pwa: PwaState;
  /**
  Reports a failure to the login flow's toast (and drops an expired Access session).
  */
  onError: (failure: unknown) => void;
  onDismissError: () => void;
  /**
  Drops the login snapshot after a sign-out.
  */
  onSignedOut: () => void;
}
