/**
Timing and shaping constants shared by the engine's collaborators.

These are protocol/policy decisions, not deployment configuration: the
operator can change the wake cadence and the upload cap through the
environment, but a replay timeout or a cache lifetime is a property of the
bridge itself. Keeping them in one module stops the wake and the driver from
silently disagreeing about how long a catch-up may take.
*/

/**
How long a wake or a live replay may spend catching up before it disconnects
anyway.
*/
export const CATCH_UP_TIMEOUT_MS = 25_000;

/**
How long media bytes and profile photos may be cached by the browser.

A media URL is stable for the life of the message: the engine streams the
bytes behind a Cloudflare Access-authenticated request, and the response is
`private` so no shared proxy keeps it.
*/
export const MEDIA_CACHE_SECONDS = 86_400;
