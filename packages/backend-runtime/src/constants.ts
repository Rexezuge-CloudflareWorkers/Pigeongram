/**
Cross-boundary constants.

These are the names and defaults the worker edge and the Durable Object must
agree on. Keeping them here means a header rename or a changed rate-limit
default is one edit, not a search across two layers.
*/

/**
The header that carries one request's correlation id.

The id travels as a header only: the JSON body is the bridge's own contract,
and a body field would make every error shape carry a transport concern.
*/
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
The per-minute request budget for the account plane of `/user/*` (the RPC,
login, state and upload routes) when `RATE_LIMIT_PER_MINUTE` is absent or
unusable.
*/
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

/**
The per-minute request budget for the media plane of `/user/*`
(`GET /user/file` and `GET /user/avatar`) when
`MEDIA_RATE_LIMIT_PER_MINUTE` is absent or unusable.

Media is metered apart from the account plane because every avatar and every
byte-range is its own request: a chat-list paint plus a media-heavy thread
legitimately issues hundreds of them in a minute, while the same volume of
RPC calls would be abuse.
*/
export const DEFAULT_MEDIA_RATE_LIMIT_PER_MINUTE = 600;

/**
Every path the Durable Object serves.

The edge and the engine must agree on this set: the edge forwards `/user/*`
and validates uploads before forwarding, while the engine distinguishes an
unknown path (404) from a known path with the wrong verb (405). One exported
set keeps the two ends from drifting apart.
*/
export const ENGINE_PATHS: ReadonlySet<string> = new Set([
  '/user/updates',
  '/user/state',
  '/user/login/qr',
  '/user/login/phone',
  '/user/login/code',
  '/user/login/password',
  '/user/login/cancel',
  '/user/logout',
  '/user/rpc',
  '/user/upload',
  '/user/upload-group',
  '/user/wake',
  '/user/stats',
  '/user/file',
  '/user/avatar',
  '/user/sticker',
]);

/**
The engine paths served without an RPC body: media bytes and cached images.

The edge meters them in a separate rate-limit bucket, because one rendered
chat list issues many of them. They stay a subset of {@link ENGINE_PATHS}.
*/
export const MEDIA_PATHS: ReadonlySet<string> = new Set(['/user/file', '/user/avatar', '/user/sticker']);
