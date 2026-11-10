interface MessageSkeletonProps {
  /**
  The status a screen reader hears while the window is on its way.
  */
  label: string;
  /**
  How many placeholder rows to draw.
  */
  rows?: number;
  /**
  Reserve the sender avatar's gutter, as the comments screen does.
  */
  avatars?: boolean;
}

/**
 * The loading bones shared by the thread and the comments screen. The chat
 * list draws its own row shape, but all three use the same sheen and the same
 * capped stagger, so the loading surfaces cannot drift apart.
 */
export function MessageSkeleton({ label, rows = 5, avatars = false }: MessageSkeletonProps) {
  return (
    <>
      <span role="status" className="sr-only">
        {label}
      </span>
      <ul className={`thread-skeleton${avatars ? ' with-avatars' : ''}`} aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <li
            key={index}
            className={`thread-skeleton-row row-enter${index % 2 === 1 ? ' own' : ''}`}
            style={{ ['--row-index' as string]: Math.min(index, 8) }}
          >
            {avatars && index % 2 === 0 ? <span className="skeleton skeleton-avatar" /> : null}
            <span className={`skeleton skeleton-bubble${index === 2 ? ' wide' : ''}`} />
          </li>
        ))}
      </ul>
    </>
  );
}
