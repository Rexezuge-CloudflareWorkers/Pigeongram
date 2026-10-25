import type { TelegramClient } from '@mtcute/core/client.js';
import type { BatchableRpcMethod, RpcMethod } from '../rpc-types';
import type { CallRegistry } from './call-registry';
import { callRpcMethods } from './call-rpc';
import { parseBatchCalls } from './params';
import { dialogsRpcMethods } from './rpc-dialogs';
import { dispatchBatch } from './rpc-batch';
import { messagesRpcMethods } from './rpc-messages';
import type { UnreadAlbumLedger } from './unread-albums';

/**
 * What one bridge method is, and how to run it.
 *
 * The read-only flag is the batch whitelist: a batch runs its calls
 * concurrently, so a write would have no defined completion order. The table
 * below is the one place that classification lives — the dispatcher, the
 * batch parser and the calls half all read it here.
 */
export interface MethodSpec {
  readOnly: boolean;
  run(context: DispatchContext, params: Record<string, unknown>): Promise<unknown>;
}

/**
 * Everything a method may touch. The batch's own dispatch is supplied by the
 * dispatcher, so a nested method goes through exactly the same path as a
 * top-level one.
 */
export interface DispatchContext {
  client: TelegramClient;
  albums: UnreadAlbumLedger;
  calls: CallRegistry;
  dispatch: (method: string, params: unknown) => Promise<unknown>;
}

export type MethodTable<M extends RpcMethod = RpcMethod> = { readonly [K in M]: MethodSpec };
export type PartialMethodTable<M extends RpcMethod = RpcMethod> = Partial<MethodTable<M>>;

/**
 * The bridge's method surface, one entry per contract method.
 *
 * The mapped type is deliberate: adding a method to `RpcMethod` is a compile
 * error until it is classified here, and the calls surface is no longer a
 * parallel switch with a `null` "not a call" answer — every `call.*` method is
 * an ordinary entry with `readOnly: false`.
 */
export const RPC_METHODS = {
  ...callRpcMethods,
  ...dialogsRpcMethods,
  ...messagesRpcMethods,

  batch: {
    // A batch is a read of many reads; the batch parser refuses every write
    // before one reaches this entry.
    readOnly: false,
    run: async (context, params) => dispatchBatch(context.client, parseBatchCalls(params.calls, BATCHABLE_METHOD_SET), context.dispatch),
  },
} as const satisfies MethodTable;

/**
 * The methods a batch may carry, derived from the classified surface.
 *
 * The union is a type-level filter over the table, so a method that is marked
 * read-only is batchable by construction; the check below proves the derived
 * set still equals the contract's `BatchableRpcMethod` in both directions.
 */
type ReadOnlyRpcMethod = {
  [M in RpcMethod]: (typeof RPC_METHODS)[M]['readOnly'] extends true ? M : never;
}[RpcMethod];

type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _batchableMatchesContract: SameUnion<ReadOnlyRpcMethod, BatchableRpcMethod> = true;

export const BATCHABLE_METHODS: readonly BatchableRpcMethod[] = (Object.keys(RPC_METHODS) as RpcMethod[]).filter(
  (method): method is BatchableRpcMethod => RPC_METHODS[method].readOnly,
);

export const BATCHABLE_METHOD_SET: ReadonlySet<string> = new Set(BATCHABLE_METHODS);
