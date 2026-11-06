export function ThreadSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading messages…
      </span>
      <ul className="thread-skeleton" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li
            key={index}
            className={`thread-skeleton-row thread-skeleton-row-enter${index % 2 === 1 ? ' own' : ''}`}
            style={{ ['--row-index' as string]: index }}
          >
            <span className={`skeleton skeleton-bubble${index === 2 ? ' wide' : ''}`} />
          </li>
        ))}
      </ul>
    </>
  );
}
