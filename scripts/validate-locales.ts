#!/usr/bin/env node
/**
Validate the SPA's locale bundles.

The checks are the ones that matter the moment a second catalogue lands, and
they catch a mistake in the first one just as well. With all twelve kit
locales shipping, they run across every bundle on every check:

- **Two-way parity against `en`**: a key a bundle lacks renders the fallback in
  every language, and a key a bundle has that `en` does not is dead weight.
- **Placeholder parity** (`{{name}}`), empty values, and bundle-directory parity
  with the tags `apps/web/src/i18n.ts` declares — a language offered by the
  selector without a catalogue fails here instead of throwing at runtime.
- **Code↔bundle coverage in both directions**: every `t('…')` key must exist in
  `en` (a missing one renders the inline default for every reader, forever),
  every inline default must equal the bundled value (otherwise the default is a
  second, drifting copy of the copy), and a bundled key no call site reaches is
  reported as advisory.

The work itself is the kit's `validateLocalesCli`, which is the same checker the
rest of the family runs. This file only points it at this repository's layout.

Usage: `pnpm run validate:locales` from the repo root.
*/

import { join } from 'node:path';
import { validateLocalesCli } from '@rexezuge/tooling/scripts/validate-locales';

const ROOT = process.cwd();

process.exit(
  validateLocalesCli([
    join(ROOT, 'apps', 'web', 'src', 'locales'),
    `--call-sites=${join(ROOT, 'apps', 'web', 'src')}`,
    `--tags=${join(ROOT, 'apps', 'web', 'src', 'i18n.ts')}`,
  ]),
);
