import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { ToggleSwitch } from './ToggleSwitch';

/**
The settings screen's row shapes.

One row is an icon, a label with an optional hint, and a trailing control.
The three controls the screen offers — a switch, a choice group and a
navigation chevron — are the same geometry everywhere, so the sections read
as one list rather than three hand-built layouts.
*/

interface SettingsRowProps {
  label: string;
  hint?: string;
  icon?: IconName;
  /**
  The trailing control.
  */
  children: ReactNode;
}

export function SettingsRow({ label, hint, icon, children }: SettingsRowProps) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-2">
      <span className="flex min-w-0 items-center gap-3">
        {icon ? <Icon name={icon} size={20} className="shrink-0 text-muted" /> : null}
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-fg">{label}</span>
          {hint ? <span className="text-xs text-muted">{hint}</span> : null}
        </span>
      </span>
      {children}
    </div>
  );
}

interface SettingsSwitchRowProps {
  icon: IconName;
  label: string;
  hint?: string;
  checked: boolean;
  indeterminate?: boolean;
  /**
  A subscription is being written; the row reports it while the switch stays
  usable (the hook itself refuses a second press).
  */
  busy?: boolean;
  onChange: (checked: boolean) => void;
}

export function SettingsSwitchRow({ icon, label, hint, checked, indeterminate = false, busy = false, onChange }: SettingsSwitchRowProps) {
  return (
    <div aria-busy={busy}>
      <SettingsRow icon={icon} label={label} hint={hint}>
        <ToggleSwitch checked={checked} indeterminate={indeterminate} label={label} onChange={onChange} />
      </SettingsRow>
    </div>
  );
}

interface SettingsNavRowProps {
  icon: IconName;
  label: string;
  onSelect: () => void;
  /**
  Receives the row's button, so the screen can put focus back on the row a
  section was opened from.
  */
  buttonRef?: (element: HTMLButtonElement | null) => void;
}

export function SettingsNavRow({ icon, label, onSelect, buttonRef }: SettingsNavRowProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onSelect}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Icon name={icon} size={20} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <Icon name="chevron-right" size={20} className="shrink-0 text-muted" />
    </button>
  );
}

interface SettingsChoice<T extends string> {
  value: T;
  label: string;
}

interface ChoiceGroupProps<T extends string> {
  /**
  The group's accessible name, matching the row label.
  */
  label: string;
  value: T;
  options: ReadonlyArray<SettingsChoice<T>>;
  onChange: (value: T) => void;
}

/**
A segmented choice: one selected value, two or three options. Theme and
contrast use it, so the appearance section has one control shape instead of
the pill button, colour dots and text buttons it used to mix.
*/
export function ChoiceGroup<T extends string>({ label, value, options, onChange }: ChoiceGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 gap-0.5 rounded-full bg-panel-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            value === option.value ? 'bg-primary/15 text-primary' : 'text-muted hover:text-fg'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
