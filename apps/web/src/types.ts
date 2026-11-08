/**
 * The bridge contract the SPA consumes.
 *
 * The DTOs, the RPC method shapes, the search half and the chat-link half are
 * owned by `@pigeongram/shared`; this barrel exists so the SPA's modules keep
 * importing `./types` while there is exactly one copy of the contract in the
 * workspace. The calls contract is mirrored the same way in `./call-types`.
 */

export * from '@pigeongram/shared/types';
export * from '@pigeongram/shared/rpc-types';
export * from '@pigeongram/shared/search-types';
export * from '@pigeongram/shared/call-types';
