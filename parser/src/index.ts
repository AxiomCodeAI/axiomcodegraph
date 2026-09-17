/**
 * The parser's command-line entry point. Arguments are positional:
 *
 *   node dist/index.js <projectsDir> <serviceVersionLink> <excludeTests> [outputDir]
 *                      [--per-language] [--library]
 *
 *   projectsDir        directory scanned for projects (recursively)
 *   serviceVersionLink commit tag stamped onto every extracted fact; required
 *   excludeTests       "true" or "false"; anything else exits 1
 *   outputDir          optional; defaults to the analyzers' built-in location
 *   --library          the tree is a DEPENDENCY being staged, not the project under
 *                      analysis: a build output directory its package.json ships from
 *                      is walked as its source (#620). For a project that directory is
 *                      the artefact beside the source and stays skipped (#796).
 *
 * To drive the parser from code rather than a shell, import `extractProject`
 * from `@/extract` directly — that is the package's main export, and this file
 * is a thin argument-parsing wrapper around it.
 */
import * as path from 'path';

import { extractProject } from '@/extract';

async function main() {
  // `--per-language` may appear anywhere: outputDir/<lang>/ instead of one flat folder.
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (f !== '--per-language' && f !== '--library') {
      console.error(`❌ Error: unknown option ${f}`); process.exit(1);
    }
  }
  const projectsDirectory = args[0];
  const serviceVersionLink = args[1];
  const excludeTestsArg = args[2];
  const outputDirArg = args[3];

  if (!projectsDirectory) {
    console.error('❌ Error: Please provide a projects directory path');
    process.exit(1);
  }
  if (!serviceVersionLink) {
    console.error('❌ Error: Please provide a service version link');
    process.exit(1);
  }
  if (excludeTestsArg !== undefined && excludeTestsArg !== 'true' && excludeTestsArg !== 'false') {
    console.error('❌ Error: excludeTests must be "true" or "false"');
    process.exit(1);
  }

  await extractProject({
    projectPath: path.resolve(projectsDirectory),
    versionLink: serviceVersionLink,
    excludeTests: excludeTestsArg === 'true',
    outputDir: outputDirArg,
    layout: flags.has('--per-language') ? 'per-language' : 'flat',
    // `--library`: this tree is a DEPENDENCY, so a build output directory it ships
    // from is its source (#620) rather than a copy of source beside it (#796).
    library: flags.has('--library'),
  });
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
