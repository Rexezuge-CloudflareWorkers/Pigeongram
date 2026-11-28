import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
The widget sandbox's SharedArrayBuffer bridge only boots on a cross-origin
isolated document. The dev server gets the headers from the sandbox's Vite
plugin; the deployed origin gets them from Pages' `_headers` file, which is
where a future edit could quietly drop one.
*/

const HEADERS = readFileSync(path.resolve(process.cwd(), 'apps/web/public/_headers'), 'utf8');

describe('cross-origin isolation headers', () => {
  it('sets all three headers on every static response', () => {
    expect(HEADERS).toMatch(/^\/\*\s*$/m);
    expect(HEADERS).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(HEADERS).toContain('Cross-Origin-Embedder-Policy: require-corp');
    expect(HEADERS).toContain('Cross-Origin-Resource-Policy: same-origin');
  });

  it('does not put account routes behind a static header rule', () => {
    // /user/* is served by a Pages Function and carries the Access session;
    // a header rule for it here would be silently ignored.
    expect(HEADERS).not.toMatch(/^\/user\//m);
  });
});
