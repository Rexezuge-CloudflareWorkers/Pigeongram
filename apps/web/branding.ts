/**
 * The product's user-visible name.
 *
 * The repository, the package scope, the worker and the Pages project keep the
 * `telegram-web-client` identifiers. Only the name a reader sees is branded:
 * Telegram's Terms of Service forbid a third-party product from using
 * "Telegram" in its name.
 *
 * The Pages build resolves these values once in `vite.config.ts`; the SPA reads
 * the same `VITE_APP_NAME` through `src/app-name.ts`.
 */

export const DEFAULT_APP_NAME = 'Pigeongram';
export const DEFAULT_APP_SHORT_NAME = 'Pigeongram';

export interface Branding {
  readonly name: string;
  readonly shortName: string;
}

/**
 * Resolves the branding from a build environment (or `import.meta.env`).
 *
 * Empty and whitespace-only values count as unset. The short name falls back to
 * the full name, so one variable is enough to rebrand a fork; launchers' usual
 * 12-character guidance stays the deployment's to keep.
 */
function stripControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += character;
  }
  return result;
}

export function readBranding(env: Readonly<Record<string, string | undefined>>): Branding {
  const rawName = env.VITE_APP_NAME?.trim() || DEFAULT_APP_NAME;
  const name = stripControlCharacters(rawName).slice(0, 64).trim() || DEFAULT_APP_NAME;
  const rawShortName = env.VITE_APP_SHORT_NAME?.trim() || name;
  const shortName = stripControlCharacters(rawShortName).slice(0, 64).trim() || name;
  return { name, shortName };
}

/**
 * Escapes a name for the document's `<title>`.
 *
 * The name comes from the deployment's own build configuration, but it is still
 * interpolated into HTML: a name with `&` or `<` has to render as text rather
 * than break the document.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
