/**
 * The app's badge, in the print shape: a squared `primary-container` tag
 * with `on-primary-container` text, `label-small` by default. Sits outside
 * bubbles (chat-list unread counts), so the legacy bubble-tree badges keep
 * their own chrome. Squared to the print system — the old pill is cut.
 */

export function Badge({ count, label, className = '' }: { count?: number; label?: string; className?: string }) {
  const text = label ?? (count === undefined ? null : count > 99 ? '99+' : String(count));
  if (text === null) return null;
  return (
    <span
      data-badge="unread"
      className={`inline-flex min-w-5 items-center justify-center rounded-xs bg-primary-container px-1.5 py-0.5 text-[11px] font-semibold text-on-primary-container${className ? ` ${className}` : ''}`}
    >
      {text}
    </span>
  );
}
