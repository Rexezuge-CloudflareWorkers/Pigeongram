/**
 * The worker bases are the kit's.
 *
 * Only `AbstractEntrypointWorker` is re-exported: it is pure, so the backend
 * services and their Vitest suite can import it under the node runtime. The
 * Durable Object, queue and workflow bases all import `cloudflare:workers`,
 * which the node runtime cannot resolve; they stay out of this seam until the
 * repository adopts `@cloudflare/vitest-pool-workers`.
 *
 * The import is the package's file subpath rather than its barrel on purpose:
 * `@rexezuge/runtime`'s barrel also re-exports the platform-bound bases, so
 * importing the barrel here would reintroduce the unresolved module.
 */
export { AbstractEntrypointWorker } from '@rexezuge/runtime/base/AbstractEntrypointWorker';
export type { WorkerExecutionContext, WorkerScheduledController } from '@rexezuge/runtime/base/AbstractEntrypointWorker';
