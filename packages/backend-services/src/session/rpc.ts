import type { TelegramClient } from '@mtcute/core/client.js';
import type { CallRegistry } from './call-registry';
import { EngineError } from './errors';
import { requireRecord } from './params';
import { RPC_METHODS } from './rpc-methods';
import type { DispatchContext, MethodSpec } from './rpc-methods';
import type { UnreadAlbumLedger } from './unread-albums';

/**
 * The curated method surface of `POST /user/rpc`.
 *
 * Deliberately a whitelist — the bridge never forwards raw MTProto from the
 * browser. Every method resolves peers server-side (marked ids in, DTOs out).
 * The method table itself lives in `rpc-methods.ts`; this module is only the
 * dispatcher that validates the envelope and supplies the batch's recursion.
 *
 * The calls surface is the one documented exception: it carries the
 * Diffie-Hellman values and the signalling packets as opaque bytes, because
 * those belong to the two peers and not to the bridge. Every peer in every
 * call method is still resolved server-side — a call is addressed by its id,
 * and the engine keeps the access hash that addresses it.
 */
export async function dispatchRpc(
  client: TelegramClient,
  method: string,
  rawParams: unknown,
  albums: UnreadAlbumLedger,
  registry: CallRegistry,
): Promise<unknown> {
  const params = requireRecord(rawParams);
  const spec = methodSpec(method);
  const context: DispatchContext = {
    client,
    albums,
    calls: registry,
    // A batch's inner call goes through the same dispatcher, so its envelope
    // is validated the same way and its own methods resolve the same way.
    dispatch: (inner, innerParams) => dispatchRpc(client, inner, innerParams, albums, registry),
  };
  return spec.run(context, params);
}

/**
 * The classification of one method, or a 404 for a name the bridge does not
 * serve. `Object.hasOwn` keeps a prototype name such as `constructor` from
 * being answered by the table's prototype chain.
 */
function methodSpec(method: string): MethodSpec {
  if (!Object.hasOwn(RPC_METHODS, method)) {
    throw new EngineError(`Unknown RPC method: ${method}`, 404);
  }
  return (RPC_METHODS as Record<string, MethodSpec>)[method];
}
