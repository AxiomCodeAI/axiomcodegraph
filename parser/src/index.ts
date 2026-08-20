/**
 * Legacy positional entry point — preserved so the orchestrator pipeline can keep
 * invoking the parser as:
 *   node dist/index.js <projectsDir> <serviceVersionLink> <excludeTests> [outputDir]
 *
 * For interactive use, prefer the CLI: `axiomcode-parser <path> [options]` (src/cli.ts).
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
