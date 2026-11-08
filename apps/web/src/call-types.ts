/**
 * The calls half of the bridge contract.
 *
 * `@pigeongram/shared` owns the DTOs and the `call.*` method shapes; this
 * barrel keeps the SPA's call modules importing `./call-types` while there is
 * exactly one copy of the contract in the workspace.
 */

export * from '@pigeongram/shared/call-types';
