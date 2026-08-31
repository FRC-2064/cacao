import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The seed dataset must not be reachable from the production client bundle.
 *
 * `$lib/data/teamData` carries `TEAM_CONTACTS` -- thirty-one adult sponsor
 * contacts with names, emails, phone numbers and addresses -- which is the
 * exact table `contacts.list` gates behind `requireActor`. A `await
 * import('$lib/data/teamData')` in a component makes SvelteKit emit it as a
 * code-split chunk referenced from the admin route node, and a route node is
 * a *static asset*: it is served to anyone who requests the URL, whether or
 * not the component that would have used it was ever mounted. `curl` does not
 * mount components, so lazy loading is not access control.
 *
 * The property is verified end to end by building and grepping the client
 * output:
 *
 *     npm run build && grep -rl "$(node -e 'import("./src/lib/data/teamData.ts").then(m=>console.log(m.TEAM_CONTACTS[0].email))')" .svelte-kit/output/client/
 *
 * That takes a full production build, so it is a release gate rather than a
 * unit test. This test defends the same property structurally and cheaply: it
 * fails the moment a module reaches for the dataset at runtime outside a
 * branch the bundler is guaranteed to delete.
 */

const SRC = fileURLToPath(new URL('../../..', import.meta.url));
const DATASET = '$lib/data/teamData';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|js|svelte)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/**
 * A reference that cannot produce a chunk: `import type ...` and `typeof
 * import(...)` are type positions, and a comment is a comment. Line-level
 * rather than parsed, which is the right trade here -- the check has to be
 * legible to whoever it fails on, and the shape it exists to catch is a
 * plain `import ... from '$lib/data/teamData'` someone added back.
 */
function cannotEmitAChunk(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return true;
  return /\bimport\s+type\b/.test(line) || /\btypeof\s+import\s*\(/.test(line);
}

describe('the seed dataset is not reachable from a production client bundle', () => {
  it('is imported at runtime only from a module that guards on import.meta.env.DEV', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes(DATASET)) continue;

      const runtimeRefs = text
        .split('\n')
        .map((line, i) => [line, i + 1] as const)
        .filter(([line]) => line.includes(DATASET) && !cannotEmitAChunk(line));
      if (runtimeRefs.length === 0) continue;

      // `import.meta.env.DEV` is substituted with a literal `false` at build
      // time, so anything behind it is dead code the bundler removes and no
      // chunk is emitted for what it referenced.
      if (!text.includes('import.meta.env.DEV')) {
        for (const [, lineNo] of runtimeRefs) {
          offenders.push(`${relative(SRC, file)}:${lineNo}`);
        }
      }
    }

    expect(
      offenders,
      `these modules load the seed dataset at runtime with no import.meta.env.DEV guard, which ships every sponsor contact as a public static asset: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('the panel that loads the dataset is itself only pulled in under import.meta.env.DEV', () => {
    const adminPanel = readFileSync(join(SRC, 'lib/components/admin/AdminPanel.svelte'), 'utf8');

    // A static `import ImportSeedPanel from './ImportSeedPanel.svelte'` puts
    // the panel -- and through it the dataset -- back in the production graph
    // however carefully the panel guards itself.
    expect(
      /import\s+ImportSeedPanel\s+from/.test(adminPanel),
      'AdminPanel.svelte imports ImportSeedPanel statically; load it dynamically behind import.meta.env.DEV instead'
    ).toBe(false);

    expect(adminPanel).toMatch(
      /import\.meta\.env\.DEV[\s\S]{0,200}import\(['"]\.\/ImportSeedPanel\.svelte['"]\)/
    );
  });

  it('the panel refuses to load the dataset outside a development build', () => {
    const panel = readFileSync(join(SRC, 'lib/components/admin/ImportSeedPanel.svelte'), 'utf8');
    expect(panel).toMatch(/if\s*\(\s*!import\.meta\.env\.DEV\s*\)/);
  });
});
