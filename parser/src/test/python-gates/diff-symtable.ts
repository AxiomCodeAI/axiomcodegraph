/**
 * Adjudicates `py_scope` and `py_binding` against CPython's symtable.
 *
 * This is the strongest oracle available for the scope forest: symtable IS the
 * thing the compiler consults, so a disagreement is a real defect and not a
 * modelling preference. Ten flag columns per binding are checked, all of which
 * symtable states outright.
 *
 * Runs the oracle as ONE long-lived subprocess over a path list rather than one
 * process per file — at corpus scale the interpreter startup dominates
 * everything else.
 *
 * Usage:
 *   npx tsx src/test/python-gates/diff-symtable.ts <root> [--limit N] [--json out]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonBindingKind } from '@/enums/python/bindings';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const EMITTER = path.join(process.cwd(), 'src/test/python-gates/emit_symtable_truth.py');

/**
 * Same order as emit_symtable_truth.py's flag tuple.
 *
 * Seven are their own boolean column on py_binding. `is_declared_global` and
 * `is_nonlocal` have no column but ARE recoverable, because bindingKind carries
 * GLOBAL_EXPLICIT and NONLOCAL, so they are checked through it.
 *
 * `is_annotated` is left UNCHECKED and named here rather than quietly skipped:
 * ANNOTATED_ONLY is not the same predicate. symtable sets is_annotated for
 * `x: int = 1`, which is annotated AND assigned, while ANNOTATED_ONLY means
 * annotated WITHOUT assignment. Wiring them together would have scored a
 * disagreement as a pass on every annotated assignment in the corpus.
 */
const FLAGS = [
  'is_parameter', 'is_local', 'is_global', 'is_free', 'is_imported',
  'is_assigned', 'is_namespace', null, 'is_declared_global', 'is_nonlocal',
] as const;

interface OracleScope {
  kind: string;
  qual: string;
  ordinal: number;
  line: number;
  col: number;
  symbols: Record<string, boolean[]>;
}

export interface SymtableDiff {
  file: string;
  problems: string[];
  scopesExpected: number;
  scopesMatched: number;
  bindingsExpected: number;
  bindingsMatched: number;
  desync?: string;
  error?: string;
}

function moduleNameFor(file: string, root: string): string {
  const parts = path.relative(root, file).replace(/\.pyi?$/, '').split(path.sep);
  if (parts[parts.length - 1] === '__init__') {
    parts.pop();
  }
  return parts.join('.') || 'm';
}

/**
 * A scope is keyed by kind + position, NOT by qualified name: `lambda` and
 * `listcomp` are not unique names, and two of them on one line differ only by
 * column. Keying on the name would silently pair a scope with its neighbour.
 */
function keyOf(kind: string, line: number, col: number): string {
  return `${kind}|${line}:${col}`;
}

export function diffFiles(files: string[], root: string): SymtableDiff[] {
  const stdin = files.map((f) => `${f}\t${moduleNameFor(f, root)}`).join('\n');
  const raw = execFileSync(PINNED, [EMITTER], {
    input: stdin,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 1024,
  });

  const results: SymtableDiff[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const truth = JSON.parse(line) as {
      file: string;
      scopes?: OracleScope[];
      desync?: string;
      error?: string;
    };
    results.push(compareOne(truth, root));
  }
  return results;
}

function compareOne(
  truth: { file: string; scopes?: OracleScope[]; desync?: string; error?: string },
  root: string
): SymtableDiff {
  const base: SymtableDiff = {
    file: truth.file,
    problems: [],
    scopesExpected: 0,
    scopesMatched: 0,
    bindingsExpected: 0,
    bindingsMatched: 0,
  };
  if (truth.error !== undefined) {
    return { ...base, error: truth.error };
  }
  if (truth.desync !== undefined) {
    return { ...base, desync: truth.desync };
  }
  const oracleScopes = truth.scopes ?? [];

  let facts;
  try {
    facts = new PythonFactExtractor().extract({
      sourceCode: fs.readFileSync(truth.file, 'utf-8'),
      filePath: truth.file,
      baseMservPath: root,
      moduleQualifiedName: moduleNameFor(truth.file, root),
      serviceVersionLinkHash: 'SERVICE_VERSION_symtable',
    });
  } catch (exc) {
    return { ...base, error: `PARSER ${(exc as Error).message}` };
  }
  // A rejected Python 2 file emits nothing at all by design; symtable would
  // have refused it too, so there is nothing to compare.
  if (facts.scopes.length === 0) {
    return base;
  }

  const ours = new Map<string, (typeof facts.scopes)[number]>();
  for (const scope of facts.scopes) {
    ours.set(keyOf(scope.getScopeKind(), scope.getStartLine(), scope.getStartColumn()), scope);
  }
  const bindingsByScope = new Map<string, (typeof facts.bindings)[number][]>();
  for (const binding of facts.bindings) {
    const list = bindingsByScope.get(binding.getPyScopeLinkHash());
    if (list === undefined) {
      bindingsByScope.set(binding.getPyScopeLinkHash(), [binding]);
    } else {
      list.push(binding);
    }
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  let scopesMatched = 0;
  let bindingsExpected = 0;
  let bindingsMatched = 0;

  for (const expected of oracleScopes) {
    const key = keyOf(expected.kind, expected.line, expected.col);
    bindingsExpected += Object.keys(expected.symbols).length;
    const scope = ours.get(key);
    if (scope === undefined) {
      problems.push(`SCOPE_MISSING ${expected.kind}|${expected.qual}|${expected.line}:${expected.col}`);
      continue;
    }
    seen.add(key);
    scopesMatched += 1;
    const where = `${expected.kind}|${expected.qual}|${expected.line}:${expected.col}`;

    if (scope.getScopeOrdinal() !== expected.ordinal) {
      problems.push(
        `SCOPE_FIELD ${where} scopeOrdinal: oracle=${expected.ordinal} mine=${scope.getScopeOrdinal()}`
      );
    }
    if (scope.getQualifiedName() !== expected.qual) {
      problems.push(
        `SCOPE_FIELD ${where} qualifiedName: oracle=${expected.qual} mine=${scope.getQualifiedName()}`
      );
    }

    const mine = new Map<string, (typeof facts.bindings)[number]>();
    for (const binding of bindingsByScope.get(scope.getHash()) ?? []) {
      mine.set(binding.getName(), binding);
    }
    for (const [name, flags] of Object.entries(expected.symbols)) {
      const binding = mine.get(name);
      if (binding === undefined) {
        problems.push(`BIND_MISSING ${where}::${name}`);
        continue;
      }
      bindingsMatched += 1;
      const actual = [
        binding.getIsParameter(), binding.getIsLocal(), binding.getIsGlobal(),
        binding.getIsFree(), binding.getIsImported(), binding.getIsAssigned(),
        binding.getIsNamespace(), false,
        binding.getBindingKind() === PythonBindingKind.GLOBAL_EXPLICIT,
        binding.getBindingKind() === PythonBindingKind.NONLOCAL,
      ];
      for (let i = 0; i < FLAGS.length; i += 1) {
        if (FLAGS[i] === null) {
          continue;
        }
        if (Boolean(actual[i]) !== Boolean(flags[i])) {
          problems.push(
            `BIND_PRED ${where}::${name} ${FLAGS[i]}: oracle=${flags[i]} mine=${actual[i]}`
          );
        }
      }
    }
    for (const name of mine.keys()) {
      if (!(name in expected.symbols)) {
        problems.push(`BIND_SPURIOUS ${where}::${name}`);
      }
    }
  }
  for (const [key, scope] of ours) {
    if (!seen.has(key)) {
      problems.push(`SCOPE_SPURIOUS ${scope.getScopeKind()}|${scope.getQualifiedName()}|${key.split('|')[1]}`);
    }
  }

  return {
    ...base,
    problems,
    scopesExpected: oracleScopes.length,
    scopesMatched,
    bindingsExpected,
    bindingsMatched,
  };
}

function collect(root: string, out: string[]): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // The holdout is sealed; reading it spends the measurement permanently.
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
    throw new Error('usage: diff-symtable.ts <root> [--limit N] [--json out]');
  }
  const limitFlag = args.indexOf('--limit');
  const jsonFlag = args.indexOf('--json');
  const files: string[] = [];
  collect(path.resolve(root), files);
  files.sort();
  const limited = limitFlag >= 0 ? files.slice(0, Number(args[limitFlag + 1])) : files;

  const all: SymtableDiff[] = [];
  const BATCH = 200;
  for (let i = 0; i < limited.length; i += BATCH) {
    all.push(...diffFiles(limited.slice(i, i + BATCH), path.resolve(root)));
  }

  const kinds = new Map<string, number>();
  const samples: string[] = [];
  let clean = 0;
  let errored = 0;
  let desynced = 0;
  let scopesExpected = 0;
  let scopesMatched = 0;
  let bindExpected = 0;
  let bindMatched = 0;
  for (const result of all) {
    scopesExpected += result.scopesExpected;
    scopesMatched += result.scopesMatched;
    bindExpected += result.bindingsExpected;
    bindMatched += result.bindingsMatched;
    if (result.error !== undefined) {
      errored += 1;
      kinds.set(`ERROR ${result.error.slice(0, 40)}`, (kinds.get(`ERROR ${result.error.slice(0, 40)}`) ?? 0) + 1);
      continue;
    }
    if (result.desync !== undefined) {
      desynced += 1;
      kinds.set('GATE_DESYNC', (kinds.get('GATE_DESYNC') ?? 0) + 1);
      if (samples.length < 40) {
        samples.push(`  ${path.basename(result.file)}: GATE_DESYNC ${result.desync}`);
      }
      continue;
    }
    if (result.problems.length === 0) {
      clean += 1;
      continue;
    }
    for (const problem of result.problems) {
      const kind = problem.split(' ')[0];
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (samples.length < 40) {
        samples.push(`  ${path.basename(result.file)}: ${problem}`);
      }
    }
  }

  const dirty = all.length - clean - errored - desynced;
  process.stdout.write(
    `\nfiles: ${all.length}   clean: ${clean}   with problems: ${dirty}   ` +
      `gate-desync: ${desynced}   errored: ${errored}\n` +
      `scopes: ${scopesMatched}/${scopesExpected}   bindings: ${bindMatched}/${bindExpected}\n\n`
  );
  if (kinds.size > 0) {
    process.stdout.write('problem kinds:\n');
    for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(count).padStart(6)}  ${kind}\n`);
    }
    process.stdout.write('\nsamples:\n' + samples.join('\n') + '\n');
  }
  if (jsonFlag >= 0) {
    fs.writeFileSync(args[jsonFlag + 1]!, JSON.stringify(all.filter((r) => r.problems.length > 0), null, 2));
  }
  process.exit(dirty > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}
