import { useEffect, useState } from 'react';

/**
Whether a CSS media query currently matches, and keeps matching as the
viewport changes.

The settings screen needs the answer in JavaScript rather than in a class
list: the desktop rail and the mobile index are two navigations (one replaces
the history entry, the other pushes), and the back button means a different
level at each width. A `hidden`/`flex` pair could not express that.

`matchMedia` is absent in jsdom, so a test renders the narrow layout unless it
stubs the query. That default is the safe one: the index is the screen that
works at every width.
*/
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => queryMatches(query));

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function queryMatches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}
