import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
The app's floating action button: a tonal container with a 40px glyph,
elevated by tonal surface pairing rather than a shadow (MD3 level 3).
Pairs with `Icon` (`name="arrow-down"` for the scroll-to-latest case).
*/

/**
How long a click keeps the ring up even when the jump answers at once (or
does not issue a read because the window is already at the latest message).
A longer jump holds it for as long as `busy` is true.
*/
const MIN_SPIN_MS = 600;

/**
The scroll-to-latest affordance: a small tonal FAB over the message pane.
Placement is owned by the caller.

The ring is the acknowledgement: an in-flight jump is `busy`, and a click
starts a short spin of its own so the control answers even when the window
was already at the latest message and the jump has no read to make.
*/
export function JumpToLatestButton({
  onClick,
  disabled = false,
  busy = false,
  className = '',
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [clicked, setClicked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinning = busy || clicked;

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = (): void => {
    setClicked(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClicked(false);
    }, MIN_SPIN_MS);
    onClick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || spinning}
      aria-busy={spinning}
      aria-label={spinning ? t('a11y.jumpInProgress', 'Jump In Progress') : t('a11y.jumpToLatest', 'Jump To Latest And Mark As Read')}
      data-icon-only
      className={`fab-jump inline-flex size-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface shadow-lg transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-50${className ? ` ${className}` : ''}`}
    >
      {spinning ? <Spinner inline size={20} color="currentColor" /> : <Icon name="arrow-down" />}
    </button>
  );
}
