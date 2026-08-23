/**
 * Adjudicates `py_decorator` and `py_decorator_argument` against CPython's ast.
 *
 * Twenty-two columns across the two relations had nothing checking them, on the
 * relation the schema treats as Python's answer to Java's annotations. ast is
 * unusually strong ground truth here: a decorator list is a plain list of
 * expressions hanging off a definition, so presence, ORDER, the dotted name,
 * the call/bare distinction and every argument are stated outright.
 *
 * Decorators are keyed by their own START LINE. Python gives every decorator a
 * line of its own -- two cannot share one -- so the line is unique within a
 * file, which name and position are not: keying on (owner name, position)
 * pooled every `test#0` in unittest's testpatch.py across a dozen classes and
 * then paired them in encounter order, reporting a shift as a dozen wrong
 * columns.
 *
 * Usage:
 *   npx tsx src/test/python-gates/diff-decorator.ts <root> [--limit N]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const EMITTER = path.join(process.cwd(), 'src/test/python-gates/emit_decorator_truth.py');

interface OracleArgument {
  index: number;
  name: string;
  isKeyword: boolean;
  dotted: string;
  literal: string;
  starred: boolean;
}

interface OracleDecorator {
  ownerName: string;
  context: string;
  position: number;
  applicationOrder: number;
  kind: string;
  name: string;
  dotted: string;
  argumentCount: number;
  builtin: boolean;
  line: number;
  args: OracleArgument[];
}

export interface DecoratorDiff {
  file: string;
  problems: string[];
  expected: number;
  matched: number;
  checked: number;
  error?: string;
}

function moduleNameFor(file: string, root: string): string {
  const parts = path.relative(root, file).replace(/\.pyi?$/, '').split(path.sep);
  if (parts[parts.length - 1] === '__init__') {
    parts.pop();
  }
  return parts.join('.') || 'm';
}

export function diffFiles(files: string[], root: string): DecoratorDiff[] {
  const raw = execFileSync(PINNED, [EMITTER], {
    input: files.join('\n'),
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  const results: DecoratorDiff[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    results.push(
      compareOne(JSON.parse(line) as { file: string; decorators?: OracleDecorator[]; error?: string }, root)
    );
  }
  return results;
}

function compareOne(
  truth: { file: string; decorators?: OracleDecorator[]; error?: string },
  root: string
): DecoratorDiff {
  const base: DecoratorDiff = { file: truth.file, problems: [], expected: 0, matched: 0, checked: 0 };
  if (truth.error !== undefined) {
    return { ...base, error: truth.error };
  }
  let facts;
  try {
    facts = new PythonFactExtractor().extract({
      sourceCode: fs.readFileSync(truth.file, 'utf-8'),
      filePath: truth.file,
      baseMservPath: root,
      moduleQualifiedName: moduleNameFor(truth.file, root),
      serviceVersionLinkHash: 'SERVICE_VERSION_decorator',
    });
  } catch (exc) {
    return { ...base, error: `PARSER ${(exc as Error).message}` };
  }
  if (facts.scopes.length === 0) {
    return base;
  }

  const ownerNameOf = new Map<string, string>();
  for (const type of facts.types) {
    ownerNameOf.set(type.getHash(), type.getName());
  }
  for (const method of facts.methods) {
    ownerNameOf.set(method.getHash(), method.getName());
  }
  const oursByName = new Map<string, (typeof facts.decorators)[number][]>();
  for (const decorator of facts.decorators) {
    const key = String(decorator.getStartLine());
    const bucket = oursByName.get(key);
    if (bucket === undefined) {
      oursByName.set(key, [decorator]);
    } else {
      bucket.push(decorator);
    }
  }

  const problems: string[] = [];
  let matched = 0;
  let checked = 0;
  const consumed = new Map<string, number>();

  for (const expected of (truth.decorators ?? [])) {
    const key = String(expected.line);
    const bucket = oursByName.get(key) ?? [];
    const used = consumed.get(key) ?? 0;
    const decorator = bucket[used];
    if (decorator === undefined) {
      problems.push(`DEC_MISSING ${key} @${expected.dotted || expected.kind} L${expected.line}`);
      continue;
    }
    consumed.set(key, used + 1);
    matched += 1;
    const where = `${expected.ownerName}:L${key} @${expected.dotted || expected.kind}`;

    const compare = (column: string, oracle: string | number | boolean, mine: string | number | boolean): void => {
      checked += 1;
      if (String(oracle) !== String(mine)) {
        problems.push(`DEC_FIELD ${where} ${column}: oracle=${oracle} mine=${mine}`);
      }
    };
    compare('ownerName', expected.ownerName, ownerNameOf.get(decorator.getOwnerHash()) ?? '?');
    compare('position', expected.position, decorator.getPosition());
    compare('kind', expected.kind, decorator.getKind());
    // decoratorName is NOT checked for non-name expressions: ast can state the
    // dotted path of a Name or Attribute and nothing else, while the parser
    // digs the rightmost identifier out of any expression. The oracle not
    // knowing is not the parser being wrong, and asserting '' here would push
    // the parser to throw away information ast simply does not model.
    if (expected.dotted !== '') {
      compare('decoratorName', expected.name, decorator.getDecoratorName());
    }
    compare('dottedPath', expected.dotted, decorator.getDottedPath());
    compare('argumentCount', expected.argumentCount, decorator.getArgumentCount());
    compare('applicationOrder', expected.applicationOrder, decorator.getApplicationOrder());
    // The enum spells the class case TYPE_DECLARATION, and it distinguishes a
    // method from a nested function -- a distinction ast does not make here, so
    // the comparison collapses to class-vs-not rather than pretending to check
    // more than the oracle knows.
    compare(
      'context',
      expected.context,
      decorator.getContext() === 'TYPE_DECLARATION' ? 'CLASS' : 'FUNCTION'
    );

    // A list/tuple/set argument is deliberately SPLIT into one row per element,
    // distinguished by arrayIndex and sharing the argument's position -- the
    // same treatment Java gives an array-valued annotation. So the row count is
    // not the argument count: `@jump_test(2, 1, [1, 1, 2])` is three arguments
    // in five rows. Grouping by position is what makes the two comparable.
    const byPosition = new Map<number, (typeof facts.decoratorArguments)[number]>();
    for (const arg of facts.decoratorArguments) {
      if (arg.getParentDecoratorLinkHash() !== decorator.getHash()) {
        continue;
      }
      if (!byPosition.has(arg.getPosition())) {
        byPosition.set(arg.getPosition(), arg);
      }
    }
    const mineArgs = [...byPosition.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]);
    if (mineArgs.length !== expected.args.length) {
      problems.push(
        `ARG_COUNT ${where}: oracle=${expected.args.length} mine=${mineArgs.length}`
      );
      continue;
    }
    for (let index = 0; index < expected.args.length; index += 1) {
      const oracleArg = expected.args[index]!;
      const mineArg = mineArgs[index]!;
      checked += 2;
      if (oracleArg.name !== mineArg.getArgumentName()) {
        problems.push(
          `ARG_FIELD ${where}[${index}] name: oracle=${oracleArg.name} mine=${mineArg.getArgumentName()}`
        );
      }
      if (oracleArg.isKeyword !== mineArg.getIsKeyword()) {
        problems.push(
          `ARG_FIELD ${where}[${index}] isKeyword: oracle=${oracleArg.isKeyword} mine=${mineArg.getIsKeyword()}`
        );
      }
    }
  }

  for (const [key, bucket] of oursByName) {
    const used = consumed.get(key) ?? 0;
    for (let index = used; index < bucket.length; index += 1) {
      problems.push(`DEC_SPURIOUS ${key} @${bucket[index]!.getDottedPath()}`);
    }
  }

  return { ...base, problems, expected: (truth.decorators ?? []).length, matched, checked };
}

function collect(root: string, out: string[]): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_holdout' || entry.name === '__pycache__' || entry.name === 'node_modules') {
        continue;
      }
      collect(full, out);
    } else if (entry.name.endsWith('.py')) {
      out.push(full);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args[0];
  if (root === undefined) {
    throw new Error('usage: diff-decorator.ts <root> [--limit N]');
  }
  const limitFlag = args.indexOf('--limit');
  const files: string[] = [];
  collect(path.resolve(root), files);
  files.sort();
  const limited = limitFlag >= 0 ? files.slice(0, Number(args[limitFlag + 1])) : files;

  const all: DecoratorDiff[] = [];
  const BATCH = 200;
  for (let i = 0; i < limited.length; i += BATCH) {
    all.push(...diffFiles(limited.slice(i, i + BATCH), path.resolve(root)));
  }

  const kinds = new Map<string, number>();
  const samples: string[] = [];
  let clean = 0;
  let errored = 0;
  let expected = 0;
  let matched = 0;
  let checked = 0;
  for (const result of all) {
    expected += result.expected;
    matched += result.matched;
    checked += result.checked;
    if (result.error !== undefined) {
      errored += 1;
      continue;
    }
    if (result.problems.length === 0) {
      clean += 1;
      continue;
    }
    for (const problem of result.problems) {
      const kind = problem.split(' ')[0]!;
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (samples.length < 40) {
        samples.push(`  ${path.basename(result.file)}: ${problem}`);
      }
    }
  }

  const dirty = all.length - clean - errored;
  process.stdout.write(
    `\nfiles: ${all.length}   clean: ${clean}   with problems: ${dirty}   errored: ${errored}\n` +
      `decorators: ${matched}/${expected}   column comparisons: ${checked}\n\n`
  );
  if (kinds.size > 0) {
    process.stdout.write('problem kinds:\n');
    for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(count).padStart(6)}  ${kind}\n`);
    }
    process.stdout.write('\nsamples:\n' + samples.join('\n') + '\n');
  }
  process.exit(dirty > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
