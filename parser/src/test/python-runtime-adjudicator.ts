/**
 * Runtime adjudicator for the four fields no static oracle covers.
 *
 *   npx tsx src/test/python-runtime-adjudicator.ts <file.py>...
 *   npx tsx src/test/python-runtime-adjudicator.ts --sweep <dir> [--limit N]
 *
 * ## Why this exists, and why it is different evidence
 *
 * `py_type.typeCategory`, `py_type.typeModifier` and `py_method.methodKind` are
 * derived by the parser from **syntax** — bases, decorators, keyword arguments.
 * The oracle emits none of them, and the ast differ compares none of them, so
 * until now they were guarded only by assertion tests written by the same author
 * as the code. Those catch regressions but cannot falsify a wrong premise.
 *
 * This asks a third party instead: it **imports the module** and interrogates the
 * live objects with CPython's own introspection — `dataclasses.is_dataclass`,
 * `inspect.isabstract`, `inspect.iscoroutinefunction`, `__slots__`,
 * `__dataclass_params__.frozen`. The runtime knows what a class IS without
 * looking at how it was written, so a shared premise between the parser and a
 * static checker cannot hide here.
 *
 * ## What it cannot do
 *
 * Importing executes module-level code. That rules out anything with side
 * effects or missing dependencies, so this runs on a curated corpus and reports
 * import failures as UNJUDGED rather than as passes. It is a **sampling**
 * check, not a corpus-wide gate — stated plainly because overselling it would
 * reintroduce exactly the false confidence it exists to remove.
 *
 * ## How disagreements are judged
 *
 * `runtimeCategories` is a SET. Precedence between, say, DATACLASS_TYPE and
 * EXCEPTION_CLASS_TYPE is a modelling choice the runtime does not make, so the
 * assertion is MEMBERSHIP — the parser's category must be one the runtime
 * confirms — rather than equality against an invented ordering.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED_INTERPRETER =
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const PROBE = path.join(process.cwd(), 'src/test/python-runtime/probe_runtime.py');

/** Modifiers both sides can see. Anything else is not comparable. */
const COMPARABLE_MODIFIERS = new Set([
  'SLOTS', 'FROZEN', 'ABSTRACT', 'RUNTIME_CHECKABLE',
  'HAS_GETATTR', 'HAS_SETATTR', 'HAS_CALL', 'CALLABLE_INSTANCE',
]);

/**
 * Method kinds the runtime can state unambiguously. Kinds that are purely
 * syntactic positions — NESTED_FUNCTION, OVERLOAD_STUB — are not comparable,
 * because the runtime cannot see them.
 */
const COMPARABLE_KINDS = new Set([
  'STATIC_METHOD', 'CLASS_METHOD', 'PROPERTY_GETTER', 'ASYNC_FUNCTION',
  'ASYNC_GENERATOR', 'GENERATOR', 'CONSTRUCTOR', 'ALLOCATOR', 'ABSTRACT_METHOD',
]);

interface Disagreement {
  file: string;
  entity: string;
  field: string;
  runtime: string;
  parser: string;
}

export interface AdjudicationResult {
  filesJudged: number;
  filesUnjudged: number;
  classesChecked: number;
  methodsChecked: number;
  disagreements: Disagreement[];
}

function probe(file: string): { classes: any[]; functions: any[] } | null {
  try {
    const out = execFileSync(PINNED_INTERPRETER, [PROBE, '--file', file], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    });
    return JSON.parse(out);
  } catch {
    // Import failed: side effects, missing dependency, or a deliberate raise.
    return null;
  }
}

export function adjudicate(files: string[]): AdjudicationResult {
  const result: AdjudicationResult = {
    filesJudged: 0, filesUnjudged: 0, classesChecked: 0, methodsChecked: 0,
    disagreements: [],
  };

  for (const file of files) {
    const runtime = probe(file);
    if (runtime === null) {
      result.filesUnjudged += 1;
      continue;
    }

    let facts;
    try {
      facts = new PythonFactExtractor().extract({
        sourceCode: fs.readFileSync(file, 'utf8'),
        filePath: file,
        baseMservPath: '/repo',
        moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
        serviceVersionLinkHash: 'SERVICE_VERSION_test',
      });
    } catch {
      result.filesUnjudged += 1;
      continue;
    }
    result.filesJudged += 1;

    // ---- typeCategory and typeModifier, keyed on (name, line)
    const parserTypes = new Map<string, string[]>();
    for (const type of facts.types) {
      const cols = type.toCsv().split('\t');
      parserTypes.set(`${cols[0]}|${cols[9]}`, cols);
    }
    for (const cls of runtime.classes) {
      if (cls.line === null) {
        continue;
      }
      const cols = parserTypes.get(`${cls.name}|${cls.line}`);
      if (!cols) {
        continue;
      }
      result.classesChecked += 1;

      const categories: string[] = cls.runtimeCategories;
      const emitted = cols[3]!;
      // Membership, not equality: the runtime does not rank its signals.
      if (categories.length > 0 && !categories.includes(emitted)) {
        result.disagreements.push({
          file, entity: cls.name, field: 'typeCategory',
          runtime: categories.join('|'), parser: emitted,
        });
      }
      if (categories.length === 0 && emitted !== 'CLASS_TYPE') {
        result.disagreements.push({
          file, entity: cls.name, field: 'typeCategory',
          runtime: '(none — plain class)', parser: emitted,
        });
      }

      const runtimeMods = new Set(
        (cls.runtimeModifiers as string[]).filter(m => COMPARABLE_MODIFIERS.has(m))
      );
      const parserMods = new Set(
        (cols[5] ?? '').split(',').filter(m => COMPARABLE_MODIFIERS.has(m))
      );
      for (const modifier of runtimeMods) {
        if (!parserMods.has(modifier)) {
          result.disagreements.push({
            file, entity: cls.name, field: 'typeModifier',
            runtime: `has ${modifier}`, parser: [...parserMods].join(',') || '(none)',
          });
        }
      }
      for (const modifier of parserMods) {
        if (!runtimeMods.has(modifier)) {
          result.disagreements.push({
            file, entity: cls.name, field: 'typeModifier',
            runtime: `NOT ${modifier}`, parser: [...parserMods].join(','),
          });
        }
      }
    }

    // ---- methodKind, keyed on (name, line)
    const parserMethods = new Map<string, string[]>();
    for (const method of facts.methods) {
      const cols = method.toCsv().split('\t');
      parserMethods.set(`${cols[0]}|${cols[5]}`, cols);
    }
    for (const fn of runtime.functions) {
      if (fn.line === null) {
        continue;
      }
      const cols = parserMethods.get(`${fn.name}|${fn.line}`);
      if (!cols) {
        continue;
      }
      const runtimeKind: string = fn.runtimeKind;
      if (!COMPARABLE_KINDS.has(runtimeKind)) {
        continue;
      }
      result.methodsChecked += 1;
      if (cols[16] !== runtimeKind) {
        result.disagreements.push({
          file, entity: fn.qualname, field: 'methodKind',
          runtime: runtimeKind, parser: cols[16]!,
        });
      }
    }
  }
  return result;
}

function collect(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['__pycache__', '.git', 'node_modules', 'test', 'tests'].includes(entry.name)) {
          walk(p);
        }
        continue;
      }
      if (entry.name.endsWith('.py')) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out.sort();
}

function main(): void {
  const args = process.argv.slice(2);
  const sweepIndex = args.indexOf('--sweep');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
  const skip = new Set<string>();
  if (limitIndex >= 0) {
    skip.add(args[limitIndex + 1]!);
  }
  if (sweepIndex >= 0) {
    skip.add(args[sweepIndex + 1]!);
  }

  const files = sweepIndex >= 0
    ? collect(args[sweepIndex + 1]!).slice(0, limit)
    : args.filter(a => !a.startsWith('--') && !skip.has(a));

  console.log('='.repeat(80));
  console.log('Runtime adjudicator — a THIRD source, independent of the parser and the harness');
  console.log('  asks live objects what they are, via CPython introspection');
  console.log('='.repeat(80));

  const result = adjudicate(files);

  console.log(`\nfiles judged: ${result.filesJudged}   unjudged (import failed): ${result.filesUnjudged}`);
  console.log(`classes checked: ${result.classesChecked}   methods checked: ${result.methodsChecked}`);
  console.log(`disagreements: ${result.disagreements.length}`);

  if (result.disagreements.length > 0) {
    const byField = new Map<string, number>();
    for (const d of result.disagreements) {
      byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
    }
    console.log('\nby field:');
    for (const [field, count] of [...byField].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(5)}  ${field}`);
    }
    console.log('\nsamples:');
    for (const d of result.disagreements.slice(0, 25)) {
      console.log(`  ${path.basename(d.file)} :: ${d.entity} ${d.field}`);
      console.log(`      runtime: ${d.runtime}`);
      console.log(`      parser:  ${d.parser}`);
    }
  }
  console.log('\n' + '='.repeat(80));
  console.log(result.disagreements.length === 0 ? 'RUNTIME AGREES' : 'DISAGREEMENTS TO ADJUDICATE');
  console.log('='.repeat(80));
}

main();
