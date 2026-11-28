import { Icon } from './Icon';

/**
The settings screen's switch: an MD3 track and thumb that report the next
value from one click. The visible row label names the switch, so the call
site passes the same text as the accessible name; the thumb is decorative.

A switch that governs several choices (the data-saver master) reports the
mixed state MD3 defines: `aria-checked="mixed"` with a dash in the thumb, and
the next click turns everything on.
*/
interface ToggleSwitchProps {
  checked: boolean;
  /**
  Whether only some of the choices the switch governs are on. Implies the
  next click turns them all on.
  */
  indeterminate?: boolean;
  /**
  The switch's accessible name, matching the visible label beside it.
  */
  label: string;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ checked, indeterminate = false, label, onChange }: ToggleSwitchProps) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        on ? 'border-primary bg-primary' : 'border-outline bg-transparent'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-5 items-center justify-center rounded-full transition-transform ${
          on ? 'translate-x-[22px] bg-on-primary' : 'translate-x-0.5 bg-outline'
        }`}
      >
        {indeterminate ? <Icon name="minus" size={14} className="text-primary" /> : null}
      </span>
    </button>
  );
}
