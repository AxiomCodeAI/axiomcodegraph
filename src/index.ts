/**
 * Entry point for the Java reasoning engine. Invoked by @axiomcode/agent-search
 * (for --language=java), receiving the client IR and JDK library paths from the
 * agent's CLI:
 *
 *   node dist/index.js --client-ir=DIR --library=DIR --intermediate=DIR --output=DIR
 *
 * Throws (non-zero exit) on any failure so the agent sees it.
 */
import { runReasoning, ReasoningOptions } from '@/reason';

function parseArgs(argv: string[]): ReasoningOptions {
  const opts: ReasoningOptions = {};
  for (const arg of argv) {
    if (arg.startsWith('--client-ir=')) opts.clientIrDir = arg.slice('--client-ir='.length);
    else if (arg.startsWith('--library=')) opts.libraryDir = arg.slice('--library='.length);
    else if (arg.startsWith('--intermediate=')) opts.intermediateDir = arg.slice('--intermediate='.length);
    else if (arg.startsWith('--output=')) opts.outputDir = arg.slice('--output='.length);
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  runReasoning(parseArgs(argv));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
