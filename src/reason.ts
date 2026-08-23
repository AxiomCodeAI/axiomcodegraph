import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { RUN_SOUFFLE_SH } from '@/constants/paths';
import { validateRequiredEntities } from '@/validate';

export interface ReasoningOptions {
  /** Client-extracted IR (parser output) — passed through the agent CLI. */
  clientIrDir?: string;
  /** JDK library path — the folder holding the module sub-folders (jdk-26). */
  libraryDir?: string;
  /** Intermediate scratch: staged facts + the compiled-engine cache. */
  intermediateDir?: string;
  /** Final output (pruned CSVs). */
  outputDir?: string;
}

/**
 * Java reasoning entry: validate → run the Soufflé engine (run-souffle.sh) → outputs.
 *
 * run-souffle.sh is self-contained: it stages facts from the raw client/library IR
 * (parsing the .map import map), compiles the .dl program to a native binary
 * (cached by program checksum under `<intermediate>/souffle`, so only the first run —
 * or a rule change — pays the compile cost), and solves into `<output>/resolution`.
 *
 * Working dirs are always owned SUBFOLDERS of the given paths, so cleanups can only touch
 * our own dirs, never the caller's raw IR. Throws on any problem so the agent can catch it.
 */
export function runReasoning(opts: ReasoningOptions = {}): void {
  const errors: string[] = [];
  const requireExisting = (raw: string | undefined, flag: string, label: string): string => {
    if (!raw) return (errors.push(`  • ${flag}=DIR is required — ${label}`), '');
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      errors.push(`  • ${flag}: not a directory: ${resolved}`);
      return '';
    }
    return resolved;
  };

  const clientIrDir = requireExisting(opts.clientIrDir, '--client-ir', 'client code IR');
  // --library is an OPTIONAL comma-separated list of external-library IR roots (each with jdk-style
  // module sub-folders, or a flat IR dir). Absent → a client-only scan of first-party source; the
  // lib_* relations stay empty and the forward chain stays within first-party code (external sinks
  // are still flagged by qualified name). The caller controls which libraries, if any, are loaded.
  const libraryRoots = (opts.libraryDir ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => requireExisting(raw, '--library', 'external library IR root'));
  if (!opts.intermediateDir) errors.push('  • --intermediate=DIR is required');
  if (!opts.outputDir) errors.push('  • --output=DIR is required');

  if (errors.length > 0) {
    throw new Error(`reasoning-java: invalid arguments — cannot run:\n${errors.join('\n')}`);
  }

  const intermediateDir = path.resolve(opts.intermediateDir!);
  const outputDir = path.resolve(opts.outputDir!);

  validateRequiredEntities(clientIrDir, libraryRoots);

  // ── Owned subfolders ──────────────────────────────────────────────────────
  const exportDir = path.join(outputDir, 'resolution'); // this stage's output
  const souffleScratch = path.join(intermediateDir, 'souffle'); // staged facts + compile cache (persistent)
  fs.mkdirSync(souffleScratch, { recursive: true });
  // run-souffle.sh creates but does not clean the output dir; wipe stale results ourselves.
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(exportDir, { recursive: true });

  console.log(`⚙️  reasoning-java (souffle)`);
  console.log(`   client IR : ${clientIrDir}`);
  console.log(`   library   : ${libraryRoots.length} root(s) — ${libraryRoots.join(', ')}`);
  console.log(`▶ running souffle: ${exportDir}`);

  const result = spawnSync(
    'bash',
    [RUN_SOUFFLE_SH,
      '--client-ir', clientIrDir,
      '--library', libraryRoots.join(','),
      '--intermediate', souffleScratch,
      '--output', exportDir],
    { stdio: 'inherit' }
  );
  if (result.error) throw new Error(`Failed to run run-souffle.sh: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`run-souffle.sh failed with exit code ${result.status ?? 'unknown'}`);

  console.log(`✅ reasoning-java complete: ${exportDir}`);
}
