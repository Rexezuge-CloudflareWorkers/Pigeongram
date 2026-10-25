import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_NAME, DEFAULT_APP_SHORT_NAME, escapeHtml, readBranding } from '../../pages/branding';
import { pwaBrandingPlugin } from '../../pages/build/pwa/branding-plugin';
import { createManifest } from '../../pages/build/pwa/manifest';

interface TransformHook {
  handler: (html: string) => string;
}

function brandedTitle(name: string): string {
  const hook = pwaBrandingPlugin({ name, shortName: name }).transformIndexHtml as unknown as TransformHook;
  return hook.handler('<title>%APP_NAME%</title>');
}

/**
 * The product name is a build-time input; the defaults are the repository's
 * own brand, and a fork can change both values from the environment.
 */
describe('the app branding', () => {
  it('defaults to Pigeongram', () => {
    expect(readBranding({})).toEqual({ name: DEFAULT_APP_NAME, shortName: DEFAULT_APP_SHORT_NAME });
    expect(DEFAULT_APP_NAME).toBe('Pigeongram');
  });

  it('reads the build environment and trims it', () => {
    expect(readBranding({ VITE_APP_NAME: '  Acme Gram  ', VITE_APP_SHORT_NAME: ' Acme ' })).toEqual({
      name: 'Acme Gram',
      shortName: 'Acme',
    });
  });

  it('falls back to the full name for the short name and treats empty values as unset', () => {
    expect(readBranding({ VITE_APP_NAME: 'Acme Gram', VITE_APP_SHORT_NAME: '  ' })).toEqual({
      name: 'Acme Gram',
      shortName: 'Acme Gram',
    });
    expect(readBranding({ VITE_APP_NAME: '  ' })).toEqual({ name: DEFAULT_APP_NAME, shortName: DEFAULT_APP_NAME });
  });

  it('brands the manifest', () => {
    const manifest = createManifest({ name: 'Acme Gram', shortName: 'Acme' });
    expect(manifest.name).toBe('Acme Gram');
    expect(manifest.short_name).toBe('Acme');
    expect(manifest.description).toContain('Acme Gram');
  });

  it('writes the name into the document title', () => {
    expect(brandedTitle('Acme Gram')).toBe('<title>Acme Gram</title>');
  });

  it('escapes a name that would otherwise break the document', () => {
    expect(escapeHtml('Tom & Jerry <Chat>')).toBe('Tom &amp; Jerry &lt;Chat&gt;');
    expect(brandedTitle('Tom & Jerry <Chat>')).toBe('<title>Tom &amp; Jerry &lt;Chat&gt;</title>');
  });
});
