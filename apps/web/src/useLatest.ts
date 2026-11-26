import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

/**
The latest value of a prop or state, readable from a long-lived callback.

Sockets and DOM listeners are installed once but must see the newest handler;
recreating them on every render would reconnect the socket or drop the
listener. These two helpers are the two refresh timings such a callback needs:
passive for a socket message, layout for a click that can arrive in the same
frame as a commit.
*/
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useLatestLayout<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
