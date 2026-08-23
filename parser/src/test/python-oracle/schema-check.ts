/**
 * Schema guard as a suite: doc vs generated .dl vs every TypeScript enum.
 * Thin wrapper so python-tests.ts can run it like any other suite.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

function main(): number {
  const cwd = path.resolve(__dirname, '..', '..', 'schema', 'python');
  try {
    console.log(execFileSync('python3', ['gen_decls.py', '--check'], { cwd, encoding: 'utf-8' }).trim());
    return 0;
  } catch (e) {
    console.log(String((e as { stdout?: string }).stdout ?? '').trim());
    return 1;
  }
}
if (require.main === module) process.exit(main());
