import { useId } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SEEDS, type Contrast, type Seed } from './useDynamicColor';

/**
 * The reader's settings, in a modal window.
 *
 * Only the choices that belong to this device live here: the theme, the accent
 * seed and the contrast level. The account menu keeps the actions that act on
 * the account or navigate the app (the archive, installing the app, signing
 * out), so this window is the one place appearance is changed.
 *
 * The shared `Dialog` carries the modal behaviour — focus, the focus trap,
 * Escape and scrim dismissal — and the settings rows are plain controls inside
 * it. The choices persist through `useTheme`/`useDynamicColor`, so the buttons
 * only report the next value.
 */

interface SettingsPopupProps {
  theme: 'dark' | 'light';
  onToggleTheme?: () => void;
  seed: Seed;
  onSetSeed?: (seed: Seed) => void;
  contrast: Contrast;
  onSetContrast?: (contrast: Contrast) => void;
  onClose: () => void;
  /**
   * Focuses this callback's target when the popup unmounts. Defaults to the
   * element focused at mount, which can already be gone when the popup opens
   * from a menu item.
   */
  returnFocus?: () => void;
  /**
   * Whether the popup is animating out; forwarded to the shared Dialog.
   */
  exiting?: boolean;
}

export function SettingsPopup({
  theme,
  onToggleTheme,
  seed,
  onSetSeed,
  contrast,
  onSetContrast,
  onClose,
  returnFocus,
  exiting = false,
}: SettingsPopupProps) {
  const appearanceId = useId();

  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      returnFocus={returnFocus}
      exiting={exiting}
      className="max-w-[440px]"
      actions={
        <Button variant="text" onClick={onClose}>
          Done
        </Button>
      }
    >
      <section className="flex flex-col gap-4" aria-labelledby={appearanceId}>
        <h3 id={appearanceId} className="text-xs font-semibold tracking-wide text-muted uppercase">
          Appearance
        </h3>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            <Icon name={theme === 'dark' ? 'dark-mode' : 'light-mode'} size={18} className="text-muted" />
            Theme
          </span>
          <button
            type="button"
            className="rounded-full border border-outline px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4" role="radiogroup" aria-label="Accent">
          <span className="text-sm font-medium text-fg">Accent</span>
          <div className="flex gap-1.5">
            {SEEDS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={seed === option.id}
                aria-label={option.label}
                title={option.label}
                onClick={() => onSetSeed?.(option.id)}
                className={`size-7 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${seed === option.id ? 'border-primary' : 'border-transparent'}`}
                style={{ background: option.hex }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4" role="radiogroup" aria-label="Contrast">
          <span className="text-sm font-medium text-fg">Contrast</span>
          <div className="flex gap-1">
            {(['standard', 'medium', 'high'] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={contrast === level}
                onClick={() => onSetContrast?.(level)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${contrast === level ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
              >
                {level === 'standard' ? 'Standard' : level === 'medium' ? 'Medium' : 'High'}
              </button>
            ))}
          </div>
        </div>
      </section>
    </Dialog>
  );
}
