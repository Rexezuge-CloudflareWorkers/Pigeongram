/**
 * The settings window's switch: an MD3 track and thumb that report the next
 * value from one click. The visible row label names the switch, so the call
 * site passes the same text as the accessible name; the thumb is decorative.
 */
interface ToggleSwitchProps {
  checked: boolean;
  /**
   * The switch's accessible name, matching the visible label beside it.
   */
  label: string;
  onChange: (checked: boolean) => void;
}

export function ToggleSwitch({ checked, label, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        checked ? 'border-primary bg-primary' : 'border-outline bg-transparent'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-5 rounded-full transition-transform ${
          checked ? 'translate-x-[22px] bg-on-primary' : 'translate-x-0.5 bg-outline'
        }`}
      />
    </button>
  );
}
