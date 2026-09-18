import * as fs from 'fs';
import * as path from 'path';

import {
  CSHARP_CLIENT_REQUIRED_ENTITIES,
  JAVA_CLIENT_REQUIRED_ENTITIES,
  JDK_REQUIRED_ENTITIES,
  PYTHON_CLIENT_REQUIRED_ENTITIES,
  TYPESCRIPT_CLIENT_REQUIRED_ENTITIES,
} from '@/constants/schema';
import { IR_MARKER, IR_MARKER_BY_LANGUAGE } from '@/constants/paths';

/**
 * Required client blocks per language. Java and Python do not share filenames,
 * so validating Python IR against the Java list rejects every valid Python
 * project — it would look for `all-types.csv` and find `all-python-modules.csv`.
 */
const CLIENT_REQUIRED_BY_LANGUAGE: Record<string, readonly string[]> = {
  java: JAVA_CLIENT_REQUIRED_ENTITIES,
  python: PYTHON_CLIENT_REQUIRED_ENTITIES,
  typescript: TYPESCRIPT_CLIENT_REQUIRED_ENTITIES,
  csharp: CSHARP_CLIENT_REQUIRED_ENTITIES,
};

/**
 * Immediate sub-folders of the library path that are IR modules (contain
 * all-types.csv), sorted. `fs.existsSync` follows symlinks. If the path itself
 * holds the IR (single module), it is the sole module.
 */
function discoverModules(libraryDir: string, marker: string = IR_MARKER): string[] {
  if (fs.existsSync(path.join(libraryDir, marker))) return [libraryDir];
  return fs
    .readdirSync(libraryDir)
    .map((name) => path.join(libraryDir, name))
    .filter((dir) => fs.existsSync(path.join(dir, marker)))
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
export function validateRequiredEntities(
  clientIrDir: string,
  libraryRoots: string[],
  language = 'java',
): void {
  const problems: string[] = [];
  const clientRequired = CLIENT_REQUIRED_BY_LANGUAGE[language];
  if (!clientRequired) {
    throw new Error(`validateRequiredEntities: unknown --language=${language}`);
  }
  const marker = IR_MARKER_BY_LANGUAGE[language] ?? IR_MARKER;

  // ── Client IR: client-required files present directly ────────────────────
  // PRESENCE, not non-emptiness. A zero-byte block is a real answer: a module
  // that calls nothing has an empty call-sites file, and an empty `__init__.py`
  // empties bindings and expressions too.
  for (const entity of clientRequired) {
    if (!fs.existsSync(path.join(clientIrDir, entity))) {
      problems.push(`client-ir is missing required block: ${entity}`);
    }
  }

  // ── Library (OPTIONAL): when roots are given, each JDK-required block must be present in
  // ≥1 module across ALL roots. When no library was passed (client-only scan), skip entirely —
  // an empty library is valid; the forward chain simply stays within first-party code.
  if (libraryRoots.length > 0) {
    const modules = libraryRoots.flatMap((root) => discoverModules(root, marker));
    if (modules.length === 0) {
      problems.push(`no library IR modules found (no folder with ${marker}) in: ${libraryRoots.join(', ')}`);
    } else {
      // The JDK-required list is Java-specific; Python's library is the stdlib
      // IR and is validated by the same client-required blocks.
      const libRequired = language === 'java' ? JDK_REQUIRED_ENTITIES : clientRequired;
      for (const entity of libRequired) {
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
