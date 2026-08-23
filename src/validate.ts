import * as fs from 'fs';
import * as path from 'path';

import { CLIENT_REQUIRED_ENTITIES, JDK_REQUIRED_ENTITIES } from '@/constants/schema';
import { IR_MARKER } from '@/constants/paths';

/**
 * Immediate sub-folders of the library path that are IR modules (contain
 * all-types.csv), sorted. `fs.existsSync` follows symlinks. If the path itself
 * holds the IR (single module), it is the sole module.
 */
function discoverModules(libraryDir: string): string[] {
  if (fs.existsSync(path.join(libraryDir, IR_MARKER))) return [libraryDir];
  return fs
    .readdirSync(libraryDir)
    .map((name) => path.join(libraryDir, name))
    .filter((dir) => fs.existsSync(path.join(dir, IR_MARKER)))
    .sort();
}

/**
 * Verify both input paths actually hold usable Java IR by checking for the
 * required entity blocks (all-types, all-methods, all-imports,
 * all-method-parameters, all-expressions):
 *
 *   - client IR: each CLIENT-required file must sit directly in the client dir
 *     (all-imports is NOT client-required — a project may have no imports).
 *   - JDK library: each JDK-required file (which DOES include all-imports) must
 *     appear in at least one module folder (modules are sharded; small/aggregator
 *     modules legitimately lack some, so library-wide presence is the right
 *     granularity).
 *
 * Any missing block means the path doesn't point at valid IR — throw with a
 * clear message so the phase stops instead of producing empty output.
 */
export function validateRequiredEntities(clientIrDir: string, libraryRoots: string[]): void {
  const problems: string[] = [];

  // ── Client IR: client-required files present directly ────────────────────
  for (const entity of CLIENT_REQUIRED_ENTITIES) {
    if (!fs.existsSync(path.join(clientIrDir, entity))) {
      problems.push(`client-ir is missing required block: ${entity}`);
    }
  }

  // ── Library (OPTIONAL): when roots are given, each JDK-required block must be present in
  // ≥1 module across ALL roots. When no library was passed (client-only scan), skip entirely —
  // an empty library is valid; the forward chain simply stays within first-party code.
  if (libraryRoots.length > 0) {
    const modules = libraryRoots.flatMap(discoverModules);
    if (modules.length === 0) {
      problems.push(`no library IR modules found (no folder with all-types.csv) in: ${libraryRoots.join(', ')}`);
    } else {
      for (const entity of JDK_REQUIRED_ENTITIES) {
        const present = modules.some((m) => fs.existsSync(path.join(m, entity)));
        if (!present) {
          problems.push(`library is missing required block in every module: ${entity}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      'Path information is invalid — required IR blocks not found:\n' +
        problems.map((p) => `  • ${p}`).join('\n') +
        `\n  client-ir: ${clientIrDir}\n  library  : ${libraryRoots.join(', ')}`,
    );
  }
}
