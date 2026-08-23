/**
 * REAL link coverage: of the links that could resolve, how many do.
 *
 * A raw "resolved / total" ratio is not a measurement of the parser. Most
 * unresolved references name something that is not in the corpus at all -- a
 * builtin, a C extension, a third-party package -- and no parser work will ever
 * link those. Counting them as misses makes the number track how many imports a
 * project has rather than how good the parser is.
 *
 * So every unresolved link is put in one of three buckets:
 *
 *   LINKED      a hash was minted.
 *   RESOLVABLE  no hash, but the NAME matches an entity this run emitted.
 *               This is the parser's gap, and the only bucket that is a defect.
 *   EXTERNAL    no hash, and nothing by that name exists in the corpus.
 *
 * REAL COVERAGE = LINKED / (LINKED + RESOLVABLE). EXTERNAL is excluded from the
 * denominator, because including it measures the corpus rather than the code.
 *
 * The name index is deliberately GENEROUS -- last segment as well as qualified
 * name -- so a name that could plausibly refer to something emitted counts
 * against us. An over-generous denominator understates coverage, which is the
 * safe direction for a number used to decide what to work on.
 *
 * Usage: npx tsx src/test/python-gates/link-coverage.ts <root> [--csv dir]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

interface Bucket {
  linked: number;
  resolvable: number;
  external: number;
  resolvableSamples: string[];
}

function emptyBucket(): Bucket {
  return { linked: 0, resolvable: 0, external: 0, resolvableSamples: [] };
}

function readCsv(file: string): { header: string[]; rows: string[][] } {
  if (!fs.existsSync(file)) {
    return { header: [], rows: [] };
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }
  const header = lines[0]!.split('\t');
  return { header, rows: lines.slice(1).map((l) => l.split('\t')) };
}

function column(header: string[], rows: string[][], name: string): string[] {
  const index = header.indexOf(name);
  if (index < 0) {
    return [];
  }
  return rows.map((r) => r[index] ?? '');
}

function main(): void {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] ?? '.');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcov-'));
  process.stdout.write(`output: ${outputDir}\n`);

  const analyzer = new PythonProjectAnalyzer();
  void analyzer
    .analyze({
      rootDir: root,
      outputDir,
      baseMservPath: root,
      serviceVersionLink: 'link-coverage',
    })
    .then((summary) => {
      report(outputDir, root, summary);
    });
}

function report(outputDir: string, root: string, summary: { filesAnalysed: number }): void {
  const load = (name: string): { header: string[]; rows: string[][] } =>
    readCsv(path.join(outputDir, `all-python-${name}.csv`));

  const types = load('types');
  const methods = load('methods');
  const fields = load('fields');
  const modules = load('modules');

  // Every name anything in this corpus could legitimately be referred to by.
  const known = new Set<string>();
  const add = (value: string): void => {
    if (value === '') {
      return;
    }
    known.add(value);
    const last = value.split('.').pop();
    if (last !== undefined && last !== '') {
      known.add(last);
    }
  };
  for (const name of column(types.header, types.rows, 'name')) {
    add(name);
  }
  for (const name of column(types.header, types.rows, 'qualifiedName')) {
    add(name);
  }
  for (const name of column(methods.header, methods.rows, 'name')) {
    add(name);
  }
  for (const name of column(methods.header, methods.rows, 'qualifiedName')) {
    add(name);
  }
  for (const name of column(fields.header, fields.rows, 'name')) {
    add(name);
  }
  for (const name of column(modules.header, modules.rows, 'name')) {
    add(name);
  }

  const buckets = new Map<string, Bucket>();
  const classify = (
    label: string,
    hash: string,
    name: string
  ): void => {
    let bucket = buckets.get(label);
    if (bucket === undefined) {
      bucket = emptyBucket();
      buckets.set(label, bucket);
    }
    if (hash !== '') {
      bucket.linked += 1;
      return;
    }
    if (name !== '' && known.has(name.split('.').pop() ?? name)) {
      bucket.resolvable += 1;
      if (bucket.resolvableSamples.length < 6) {
        bucket.resolvableSamples.push(name);
      }
      return;
    }
    bucket.external += 1;
  };

  const callSites = load('call-sites');
  const csName = column(callSites.header, callSites.rows, 'calleeName');
  const csHash = column(callSites.header, callSites.rows, 'resolvedCalleeHash');
  for (let i = 0; i < callSites.rows.length; i += 1) {
    classify('py_call_site.resolvedCalleeHash', csHash[i] ?? '', csName[i] ?? '');
  }

  const typeRefs = load('type-references');
  const trName = column(typeRefs.header, typeRefs.rows, 'typeName');
  const trHash = column(typeRefs.header, typeRefs.rows, 'referencedTypeLinkHash');
  for (let i = 0; i < typeRefs.rows.length; i += 1) {
    classify('py_type_reference.referencedTypeLinkHash', trHash[i] ?? '', trName[i] ?? '');
  }

  const typeBases = load('type-bases');
  const tbName = column(typeBases.header, typeBases.rows, 'baseSimpleName');
  const tbHash = column(typeBases.header, typeBases.rows, 'resolvedTypeLinkHash');
  for (let i = 0; i < typeBases.rows.length; i += 1) {
    classify('py_type_base.resolvedTypeLinkHash', tbHash[i] ?? '', tbName[i] ?? '');
  }

  const fieldName = column(fields.header, fields.rows, 'fieldBaseType');
  const fieldHash = column(fields.header, fields.rows, 'pyTypeLinkHash');
  for (let i = 0; i < fields.rows.length; i += 1) {
    // Only fields that DECLARE a type are candidates; an unannotated field has
    // nothing to link and is not a miss.
    if ((fieldName[i] ?? '') === '') {
      continue;
    }
    classify('py_field.pyTypeLinkHash', fieldHash[i] ?? '', fieldName[i] ?? '');
  }

  const imports = load('imports');
  const imName = column(imports.header, imports.rows, 'simpleName');
  const imHash = column(imports.header, imports.rows, 'resolvedModuleLinkHash');
  for (let i = 0; i < imports.rows.length; i += 1) {
    classify('py_import.resolvedModuleLinkHash', imHash[i] ?? '', imName[i] ?? '');
  }

  process.stdout.write(
    `\nroot: ${root}\nfiles analysed: ${summary.filesAnalysed}\n\n` +
      `${'link'.padEnd(44)}${'LINKED'.padStart(8)}${'RESOLV'.padStart(8)}` +
      `${'EXTERN'.padStart(8)}${'REAL'.padStart(9)}\n` +
      `${'-'.repeat(77)}\n`
  );
  let totalLinked = 0;
  let totalResolvable = 0;
  for (const [label, bucket] of buckets) {
    const denominator = bucket.linked + bucket.resolvable;
    const real = denominator === 0 ? 100 : (bucket.linked / denominator) * 100;
    totalLinked += bucket.linked;
    totalResolvable += bucket.resolvable;
    process.stdout.write(
      `${label.padEnd(44)}${String(bucket.linked).padStart(8)}` +
        `${String(bucket.resolvable).padStart(8)}${String(bucket.external).padStart(8)}` +
        `${(real.toFixed(1) + '%').padStart(9)}\n`
    );
  }
  const overall =
    totalLinked + totalResolvable === 0
      ? 100
      : (totalLinked / (totalLinked + totalResolvable)) * 100;
  process.stdout.write(
    `${'-'.repeat(77)}\n${'REAL COVERAGE (excl. external)'.padEnd(44)}` +
      `${String(totalLinked).padStart(8)}${String(totalResolvable).padStart(8)}` +
      `${''.padStart(8)}${(overall.toFixed(1) + '%').padStart(9)}\n\n`
  );
  for (const [label, bucket] of buckets) {
    if (bucket.resolvableSamples.length > 0) {
      process.stdout.write(`unlinked but resolvable — ${label}:\n`);
      for (const sample of bucket.resolvableSamples) {
        process.stdout.write(`    ${sample}\n`);
      }
    }
  }
}

if (require.main === module) {
  main();
}
