/**
 * The configuration seam.
 *
 * `EnvParser` is the family's one reader for a Worker `env` binding: every
 * deployment value is a string, so a reader that answered a number without
 * parsing would be inventing a value the platform never supplied. The project's
 * own defaults stay beside the reader that applies them.
 *
 * `AppConfiguration` is re-exported for a future config class; today the
 * engine's bounds are plain functions over `EnvParser`, which keeps a wake and
 * an upload pre-flight reading the same table without a stateful object.
 */
export { AppConfiguration } from '@rexezuge/runtime/config/AppConfiguration';
export { DEFAULT_SITE_URL } from '@rexezuge/runtime/config/ConfigurationDefaults';
export { EnvParser } from '@rexezuge/runtime/config/EnvParser';
