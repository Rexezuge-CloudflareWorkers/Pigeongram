import { describe, expect, it } from 'vitest';
import { parentRoute, pathForRoute, routeForPath, sameRoute } from '../../pages/src/routes';
import type { Route } from '../../pages/src/routes';

const chat = (chatId: number, postId: number | null = null): Route => ({ view: 'chat', chatId, postId });
const comments = (chatId: number, postId: number): Route => ({ view: 'comments', chatId, postId });
const archived: Route = { view: 'archived' };

describe('routeForPath', () => {
  it('reads the chat list from the root and from unknown paths', () => {
    expect(routeForPath('/')).toEqual({ view: 'list' });
    expect(routeForPath('')).toEqual({ view: 'list' });
    expect(routeForPath('/nope')).toEqual({ view: 'list' });
    expect(routeForPath('/chat')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/abc')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/0')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/2/extra')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/2/post')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/2/post/0')).toEqual({ view: 'list' });
    expect(routeForPath('/chat/2/post/5/nope')).toEqual({ view: 'list' });
  });

  it('reads a chat, a linked post and a comments thread', () => {
    expect(routeForPath('/chat/2')).toEqual(chat(2));
    expect(routeForPath('/chat/-1000000000030')).toEqual(chat(-1_000_000_000_030));
    expect(routeForPath('/chat/2/')).toEqual(chat(2));
    expect(routeForPath('/chat/2/post/42')).toEqual(chat(2, 42));
    expect(routeForPath('/chat/2/post/42/')).toEqual(chat(2, 42));
    expect(routeForPath('/chat/2/post/42/comments')).toEqual(comments(2, 42));
  });

  it('decodes segments before parsing ids', () => {
    expect(routeForPath('/chat/%32')).toEqual(chat(2));
    expect(routeForPath('/chat/2/%70ost/42')).toEqual(chat(2, 42));
  });

  it('reads the archive from its own path', () => {
    expect(routeForPath('/archived')).toEqual(archived);
    expect(routeForPath('/archived/')).toEqual(archived);
    // Anything deeper is not a screen the app knows, so it falls back to the
    // chat list rather than stranding the reader on an empty archive.
    expect(routeForPath('/archived/2')).toEqual({ view: 'list' });
  });
});

describe('pathForRoute', () => {
  it('is the inverse of routeForPath for every route', () => {
    const routes = [{ view: 'list' } as const, archived, chat(2), chat(2, 42), chat(-1_000_000_000_030, 7), comments(2, 42)];
    for (const route of routes) {
      expect(routeForPath(pathForRoute(route))).toEqual(route);
    }
  });

  it('writes canonical paths', () => {
    expect(pathForRoute({ view: 'list' })).toBe('/');
    expect(pathForRoute(archived)).toBe('/archived');
    expect(pathForRoute(chat(2))).toBe('/chat/2');
    expect(pathForRoute(chat(-1_000_000_000_030, 42))).toBe('/chat/-1000000000030/post/42');
    expect(pathForRoute(comments(2, 42))).toBe('/chat/2/post/42/comments');
  });
});

describe('sameRoute', () => {
  it('compares the view and every id', () => {
    expect(sameRoute({ view: 'list' }, { view: 'list' })).toBe(true);
    expect(sameRoute(archived, archived)).toBe(true);
    expect(sameRoute(archived, { view: 'list' })).toBe(false);
    expect(sameRoute(chat(2), chat(2))).toBe(true);
    expect(sameRoute(chat(2), chat(2, 5))).toBe(false);
    expect(sameRoute(chat(2, 5), chat(2, 6))).toBe(false);
    expect(sameRoute(chat(2), chat(3))).toBe(false);
    expect(sameRoute(chat(2, 5), comments(2, 5))).toBe(false);
    expect(sameRoute(comments(2, 5), comments(2, 5))).toBe(true);
    expect(sameRoute({ view: 'list' }, chat(2))).toBe(false);
  });
});

describe('parentRoute', () => {
  it('steps comments back to their post and chats back to the list', () => {
    expect(parentRoute(comments(2, 42))).toEqual(chat(2, 42));
    expect(parentRoute(chat(2, 42))).toEqual({ view: 'list' });
    expect(parentRoute(chat(2))).toEqual({ view: 'list' });
    expect(parentRoute({ view: 'list' })).toEqual({ view: 'list' });
    expect(parentRoute(archived)).toEqual({ view: 'list' });
  });
});
