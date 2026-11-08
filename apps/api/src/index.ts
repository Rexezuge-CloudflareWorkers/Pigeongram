import { ApiWorker } from './workers/ApiWorker';

const worker = new ApiWorker();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => worker.fetch(request, env, ctx),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => worker.scheduled(event, env, ctx),
};

// Wrangler discovers the Durable Object class through this re-export.
export { SessionEngine } from '@pigeongram/backend-services';
