import { forwardToEngine } from './engine';
import type { ApiContext } from '../types';

/**
Browser push subscriptions.

The body is a small JSON object, so unlike an upload it needs no edge
pre-flight: the engine validates it once with the same parser it uses for
storage. Both routes sit under the Access gate and on the account plane —
a subscription belongs to the signed-in account's Durable Object.

They are named explicitly before the `/user/*` catch-all in the route table
so the edge knows these are real routes; the shared `ENGINE_PATHS` set keeps
the engine's own 404/405 answers in step.
*/
export const pushSubscribeHandler = (c: ApiContext): Promise<Response> => forwardToEngine(c);

export const pushUnsubscribeHandler = (c: ApiContext): Promise<Response> => forwardToEngine(c);
