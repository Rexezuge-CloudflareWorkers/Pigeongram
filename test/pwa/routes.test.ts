import { describe, expect, it } from 'vitest';
import { SHELL_URL, isPassthroughPath } from '../../apps/web/sw/routes';

/**
 * The service worker's routing rules.
 *
 * These are the rules that keep the Cloudflare Access gate intact, so they
 * are asserted here rather than trusted to a comment.
 */
describe('the service worker routes', () => {
  it('keeps the account plane out of the shell', () => {
    expect(isPassthroughPath('/user')).toBe(true);
    expect(isPassthroughPath('/user/state')).toBe(true);
    expect(isPassthroughPath('/user/login')).toBe(true);
    expect(isPassthroughPath('/user/file')).toBe(true);
    expect(isPassthroughPath('/api')).toBe(true);
    expect(isPassthroughPath('/api/health')).toBe(true);
  });

  it('serves the shell for the app own paths', () => {
    expect(isPassthroughPath('/')).toBe(false);
    expect(isPassthroughPath('/archived')).toBe(false);
    expect(isPassthroughPath('/chat/123')).toBe(false);
    expect(isPassthroughPath('/chat/123/post/9/comments')).toBe(false);
  });

  it('matches the prefixes on a path boundary', () => {
    // `/usersettings` is the app's own path, not the account plane.
    expect(isPassthroughPath('/usersettings')).toBe(false);
    expect(isPassthroughPath('/apiary')).toBe(false);
  });

  it('falls back to the document Pages serves', () => {
    expect(SHELL_URL).toBe('/index.html');
  });
});
