import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { parentRoute, pathForRoute, routeForPath, sameRoute } from './routes';
import type { Route, RouteApplyOptions } from './routes';

/**
 * The browser-history half of navigation: reads `location`, writes `history`,
 * and listens for `popstate`. The route → screen mapping belongs to
 * `useChatNavigation`; the media viewer owns its own React state and only uses
 * the layer helpers here.
 *
 * Every entry this hook creates carries the same marker and a depth. The depth
 * is what lets the UI's back button behave like the browser's: when the entry
 * came from in-app navigation it calls `history.back()`, and only a first
 * entry (a shared deep link, or the list itself) falls back to replacing the
 * URL with the parent route. The viewer layer is pushed on the same URL, so
 * back closes the viewer without changing the route underneath.
 */

const APP = 'telegram-web-client';

interface EntryState {
  app: typeof APP;
  depth: number;
  layer?: 'viewer';
}

export interface RouterOptions {
  /**
   * Applies a route. The router has already checked `canOpen` and written the
   * URL; handlers only have to move the screen.
   */
  onRoute: (route: Route, options: RouteApplyOptions) => void;
  /**
   * Whether the route names something the signed-in account can open. The
   * list always can; a chat the current dialogs do not contain cannot.
   */
  canOpen: (route: Route) => boolean;
  /**
   * Enter and leave the viewer layer, for browser forward/back over a viewer
   * entry. Opening and closing the viewer from the app uses the helpers below
   * instead.
   */
  onViewerEnter?: () => void;
  onViewerLeave?: () => void;
}

export interface Router {
  /**
   * Seeds the history stack once the signed-in data is ready, then applies the
   * route named by the current URL. A fresh deep link gets a parent list (and,
   * for comments, the chat) behind it, so the browser's back gesture always
   * lands on an in-app screen.
   */
  boot: () => void;
  navigateTo: (route: Route, options?: { force?: boolean }) => void;
  /**
   * The view's back button: the same traversal as the browser's back gesture.
   */
  back: () => void;
  /**
   * Sign-out: replaces the current entry with the list and stops applying
   * popstate until the next boot.
   */
  reset: () => void;
  openViewer: () => void;
  closeViewer: () => void;
}

export function useRouter({ onRoute, canOpen, onViewerEnter, onViewerLeave }: RouterOptions): Router {
  const routeRef = useRef<Route>(routeForPath(location.pathname));
  const depthRef = useRef(entryState()?.depth ?? 0);
  const startedRef = useRef(false);
  const layerRef = useRef(false);

  // The popstate listener is installed once; it must always call the latest
  // handlers, which change with the thread/comments render.
  const handlers = useRef({ onRoute, canOpen, onViewerEnter, onViewerLeave });
  // Layout, not passive: a click can arrive in the same frame the thread's
  // window commits, and it must see the handler that knows those messages.
  useLayoutEffect(() => {
    handlers.current = { onRoute, canOpen, onViewerEnter, onViewerLeave };
  });

  const replaceRef = useRef<(route: Route) => void>(() => {});
  const replaceTo = useCallback((route: Route): void => {
    routeRef.current = route;
    history.replaceState(marker(depthRef.current), '', pathForRoute(route));
    handlers.current.onRoute(route, { force: false, replaceTo: replaceRef.current });
  }, []);
  useLayoutEffect(() => {
    replaceRef.current = replaceTo;
  }, [replaceTo]);

  const apply = useCallback(
    (route: Route, force: boolean): void => {
      if (!handlers.current.canOpen(route)) {
        replaceTo({ view: 'list' });
        return;
      }
      handlers.current.onRoute(route, { force, replaceTo });
    },
    [replaceTo],
  );

  // The listener below is installed once, so it calls the current `apply`.
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
  });

  useEffect(() => {
    const sync = (): void => {
      if (!startedRef.current) return;
      const state = entryState();
      if (state) depthRef.current = state.depth;

      const inViewer = state?.layer === 'viewer';
      if (inViewer && !layerRef.current) {
        layerRef.current = true;
        handlers.current.onViewerEnter?.();
      } else if (!inViewer && layerRef.current) {
        layerRef.current = false;
        handlers.current.onViewerLeave?.();
      }

      const route = routeForPath(location.pathname);
      if (sameRoute(route, routeRef.current)) return;
      routeRef.current = route;
      applyRef.current(route, false);
    };
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, []);

  const boot = useCallback((): void => {
    if (startedRef.current) return;
    const route = routeForPath(location.pathname);
    const state = entryState();

    if (state) {
      // A reload: the browser kept this entry's state and the stack behind it.
      // A viewer entry cannot be restored (its payload was in memory), so drop
      // the layer and put the route it covered back on the current entry.
      depthRef.current = state.layer === 'viewer' ? Math.max(0, state.depth - 1) : state.depth;
      history.replaceState(marker(depthRef.current), '', pathForRoute(route));
    } else {
      // A fresh tab or shared link. Seed the list as the base of the stack,
      // then the route the URL asked for, so back has an in-app parent even
      // when the app was not entered through its list.
      depthRef.current = 0;
      history.replaceState(marker(0), '', '/');
      if (route.view === 'chat') {
        depthRef.current = 1;
        history.pushState(marker(1), '', pathForRoute(route));
      } else if (route.view === 'comments') {
        const post = { view: 'chat' as const, chatId: route.chatId, postId: route.postId };
        depthRef.current = 1;
        history.pushState(marker(1), '', pathForRoute(post));
        depthRef.current = 2;
        history.pushState(marker(2), '', pathForRoute(route));
      }
    }

    routeRef.current = route;
    startedRef.current = true;
    apply(route, false);
  }, [apply]);

  const navigateTo = useCallback(
    (route: Route, options?: { force?: boolean }): void => {
      if (!startedRef.current) return;
      const force = options?.force ?? false;
      if (sameRoute(route, routeRef.current)) {
        if (force) apply(route, true);
        return;
      }

      // A comments screen steps back to its post's chat. The thread's current
      // route already is that chat when the reader opened comments from it (a
      // linked post is the same window); from the list, or from another chat,
      // push the parent first so one back lands on the thread rather than the
      // list.
      if (route.view === 'comments') {
        const current = routeRef.current;
        const onPost =
          current.view === 'chat' && current.chatId === route.chatId && (current.postId === null || current.postId === route.postId);
        if (!onPost) {
          const parent: Route = { view: 'chat', chatId: route.chatId, postId: route.postId };
          depthRef.current += 1;
          history.pushState(marker(depthRef.current), '', pathForRoute(parent));
          routeRef.current = parent;
        }
      }

      depthRef.current += 1;
      history.pushState(marker(depthRef.current), '', pathForRoute(route));
      routeRef.current = route;
      apply(route, force);
    },
    [apply],
  );

  const back = useCallback((): void => {
    if (!startedRef.current || routeRef.current.view === 'list') return;
    const state = entryState();
    if (state && state.depth > 0) {
      history.back();
      return;
    }
    replaceTo(parentRoute(routeRef.current));
  }, [replaceTo]);

  const reset = useCallback((): void => {
    routeRef.current = { view: 'list' };
    depthRef.current = 0;
    startedRef.current = false;
    layerRef.current = false;
    history.replaceState(marker(0), '', '/');
  }, []);

  const openViewer = useCallback((): void => {
    if (!startedRef.current || layerRef.current) return;
    depthRef.current += 1;
    history.pushState(marker(depthRef.current, 'viewer'), '', pathForRoute(routeRef.current));
    layerRef.current = true;
  }, []);

  const closeViewer = useCallback((): void => {
    if (!layerRef.current) return;
    layerRef.current = false;
    if (entryState()?.layer === 'viewer') history.back();
  }, []);

  return { boot, navigateTo, back, reset, openViewer, closeViewer };
}

function entryState(): EntryState | null {
  const state = history.state as Partial<EntryState> | null;
  return state?.app === APP && typeof state.depth === 'number' ? (state as EntryState) : null;
}

function marker(depth: number, layer?: 'viewer'): EntryState {
  return layer === undefined ? { app: APP, depth } : { app: APP, depth, layer };
}
