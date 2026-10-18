import type { ICorePlatform } from '@mtcute/core';
import { LogManager } from '@mtcute/core/utils.js';

/**
 * The minimal `ICorePlatform` mtcute needs to run inside a Durable Object.
 *
 * Deliberately not `@mtcute/web`'s `WebPlatform`: that one hooks browser
 * events (`online`/`offline`, `beforeunload`) that workerd does not have.
 */
export class WorkerPlatform implements ICorePlatform {
  /**
   * Workerd gives no exit event to hook. Durability instead comes from the
   * engine calling `client.disconnect()` at the end of every wake and every
   * live session, which is what flushes mtcute's write-behind storage queue.
   */
  beforeExit(): () => void {
    return () => {};
  }

  log(_color: number, level: number, tag: string, fmt: string, args: unknown[]): void {
    const line = `[mtcute:${tag}] ${formatLine(fmt, args)}`;
    if (level <= LogManager.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  getDefaultLogLevel(): number | null {
    return null;
  }

  getDeviceModel(): string {
    return 'Cloudflare Workers';
  }

  isOnline(): boolean {
    return true;
  }
}

/**
 * mtcute's LogManager formats with `printf`-ish placeholders (`%s`, `%d`,
 * `%j`, `%e`, `%b`); plain string interpolation is enough for engine logs.
 */
function formatLine(fmt: string, args: unknown[]): string {
  let index = 0;
  return fmt.replaceAll(/%[sdjeb%]/g, (match) => {
    if (match === '%%') return '%';
    if (index >= args.length) return match;
    const value = args[index++];
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return String(value);
  });
}
