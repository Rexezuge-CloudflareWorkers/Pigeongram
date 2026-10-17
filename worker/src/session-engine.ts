/**
 * Stub home of the future MTProto session engine.
 *
 * One instance per Telegram account (`idFromName(accountId)`). In phase 1 this
 * holds the auth key, replays `getDifference` on its alarm, and persists to DO
 * SQLite; today it only proves the binding and migration deploy correctly.
 *
 * Deliberately a plain class, **not** extending `DurableObject` from
 * `cloudflare:workers`: that import cannot resolve under Vitest's node/jsdom
 * runtime without the Workers test pool, and a DO class does not need to extend
 * it. Keep it that way until `@cloudflare/vitest-pool-workers` is added for
 * real DO tests.
 */
export class SessionEngine {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareEnv,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    return Response.json({ ready: false, service: 'telegram-web-client' });
  }

  async alarm(): Promise<void> {
    // Phase 1: wake cycle (connect → getDifference → persist → disconnect →
    // re-arm the alarm).
  }
}
