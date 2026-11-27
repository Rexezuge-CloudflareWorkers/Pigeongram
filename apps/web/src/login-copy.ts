import { t } from './i18n';
import type { EngineStateDto } from './types';

/**
The login screen's sentences, kept out of the transport.

`api.ts` names the bridge's methods and paths; what a phase reads as is copy, so
it lives beside the catalogue and is translated there. The code-delivery table
is prose too: Telegram names where it sent the code, and the reader reads that
name in their own language.

The delivery labels are a `switch` rather than a lookup table of keys so every
key is a literal translation call: `validate:locales` reads literal keys, and a
table would make them unreachable and uncheckable.
*/
export function loginPhaseMessage(state: EngineStateDto | null): string {
  if (!state) return t('login.phaseConnecting', 'Connecting To The Session Engine…');
  switch (state.phase) {
    case 'qr': {
      return t('login.phaseQr', 'Scan This QR Code From Telegram: Settings → Devices → Link Desktop Device');
    }
    case 'scanned': {
      return t('login.phaseScanned', 'QR Code Accepted — Finishing Sign-In…');
    }
    case 'code': {
      const where = state.codeType ? codeDelivery(state.codeType) : null;
      return where === null
        ? t('login.phaseCodePlain', 'Type The Login Code Telegram Sent You')
        : t('login.phaseCode', 'Telegram Sent A Login Code {{where}} — Type It Below', { where });
    }
    case 'password': {
      return t('login.phasePassword', 'Two-Step Verification: Enter Your Telegram Cloud Password');
    }
    case 'error': {
      return state.error ?? t('login.phaseError', 'The Session Engine Reported An Error');
    }
    default: {
      return t('login.phasePreparing', 'Preparing A Login QR Code…');
    }
  }
}

/**
Where Telegram said it sent the code, or `null` for a delivery this client does
not name (the plain sentence covers it).
*/
function codeDelivery(codeType: string): string | null {
  switch (codeType) {
    case 'app': {
      return t('login.deliveryApp', 'To Your Telegram App');
    }
    case 'sms':
    case 'firebase':
    case 'fragment':
    case 'sms_word':
    case 'sms_phrase': {
      return t('login.deliverySms', 'By SMS');
    }
    case 'call': {
      return t('login.deliveryCall', 'In A Phone Call');
    }
    case 'flash_call': {
      return t('login.deliveryFlashCall', 'As A Flash Call');
    }
    case 'missed_call': {
      return t('login.deliveryMissedCall', 'As A Missed Call');
    }
    case 'email': {
      return t('login.deliveryEmail', 'By Email');
    }
    default: {
      return null;
    }
  }
}
