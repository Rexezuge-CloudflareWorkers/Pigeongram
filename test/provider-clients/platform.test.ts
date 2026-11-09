import { LogManager } from '@mtcute/core/utils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPlatform } from '../../packages/provider-clients/src/mtproto/platform';

/**
 * mtcute's platform surface inside a Durable Object.
 *
 * The class is small but load-bearing: it is what keeps mtcute from reaching
 * for browser events workerd does not have, and it is the only place mtcute's
 * log lines are formatted for Workers Logs.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkerPlatform', () => {
  const platform = new WorkerPlatform();

  it('reports the worker as an always-online device with no exit hook', () => {
    expect(platform.getDeviceModel()).toBe('Cloudflare Workers');
    expect(platform.isOnline()).toBe(true);
    expect(platform.getDefaultLogLevel()).toBeNull();

    const stop = platform.beforeExit();
    expect(stop).toBeTypeOf('function');
    expect(stop()).toBeUndefined();
  });

  it('routes warnings and below through console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    platform.log(0, LogManager.WARN, 'transport', 'retrying %d', [3]);

    expect(warn).toHaveBeenCalledWith('[mtcute:transport] retrying 3');
    expect(log).not.toHaveBeenCalled();
  });

  it('routes everything above WARN through console.log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    platform.log(0, LogManager.WARN + 1, 'transport', 'connected', []);

    expect(log).toHaveBeenCalledWith('[mtcute:transport] connected');
    expect(warn).not.toHaveBeenCalled();
  });

  it('formats every placeholder mtcute uses', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    platform.log(0, LogManager.WARN + 1, 'tag', '%s %d %j %e %b %%', ['text', 7, { a: 1 }, true, 2]);

    expect(log).toHaveBeenCalledWith('[mtcute:tag] text 7 [object Object] true 2 %');
  });

  it('keeps a placeholder with no argument and renders an error readably', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    platform.log(0, LogManager.WARN + 1, 'tag', '%s %s', [new Error('boom')]);

    expect(log).toHaveBeenCalledWith('[mtcute:tag] Error: boom %s');
  });
});
