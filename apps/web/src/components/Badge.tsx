/**
 * The app's badge, in the Material 3 shape: a pill with `primary-container`
 * fill and `on-primary-container` text, `label-small` by default. Sits
 * outside bubbles (chat-list unread counts), so the legacy bubble-tree
 * badges keep their own chrome.
 */

export function Badge({ count, label, className = '' }: { count?: number; label?: string; className?: string }) {
  const text = label ?? (count === undefined ? null : count > 999 ? '999+' : String(count));
  if (text === null) return null;
  return (
    <span
      data-badge="unread"
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-primary-container px-1.5 py-0.5 text-[11px] font-bold text-on-primary-container${className ? ` ${className}` : ''}`}
    >
      {text}
    </span>
  );
}
