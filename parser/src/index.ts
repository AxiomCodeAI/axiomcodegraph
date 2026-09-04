/**
 * The parser's command-line entry point. Arguments are positional:
 *
 *   node dist/index.js <projectsDir> <serviceVersionLink> <excludeTests> [outputDir]
 *
 *   projectsDir        directory scanned for projects (recursively)
 *   serviceVersionLink commit tag stamped onto every extracted fact; required
 *   excludeTests       "true" or "false"; anything else exits 1
 *   outputDir          optional; defaults to the analyzers' built-in location
 *
 * To drive the parser from code rather than a shell, import `extractProject`
 * from `@/extract` directly — that is the package's main export, and this file
 * is a thin argument-parsing wrapper around it.
 */
import * as path from 'path';

import { extractProject } from '@/extract';

async function main() {
  const projectsDirectory = process.argv[2];
  const serviceVersionLink = process.argv[3];
  const excludeTestsArg = process.argv[4];
  const outputDirArg = process.argv[5];

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
  });
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
