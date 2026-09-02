/**
 * SERVICES TESTS — one file, mirroring gradle-tests.ts.
 *
 *     npx tsx src/test/services-tests.ts            # everything
 *     npx tsx src/test/services-tests.ts --list     # what runs, and what it proves
 *     npx tsx src/test/services-tests.ts --bless    # rewrite the goldens
 *
 * NO JVM, NO NETWORK. Every check runs the parser and compares the result with
 * expectations checked into src/test-data/services.
 *
 * ## What this suite can and cannot do
 *
 * The golden is drift detection and nothing more: it was produced by this
 * parser, so it agrees with whatever this parser currently does, mistakes
 * included.
 *
 * The format checks are the part that can find a defect. Each one is written
 * from the `java.util.ServiceLoader` specification of the
 * provider-configuration file rather than from parser output, and each is
 * paired with the naive implementation it rules out — a comment-stripping check
 * that only fails a parser which trims, a nested-name check that only fails one
 * which rewrites `$` unconditionally. A check that no plausible implementation
 * fails proves nothing, so the `rules out` line is part of the check.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ServiceDescriptor } from '@/analysis-types/services/ServiceDescriptor';
import { ServiceProvider } from '@/analysis-types/services/ServiceProvider';
import { ServicesParser } from '@/parsers/services/services-parser';
import { ServicesProjectAnalyzer } from '@/workflows/services/services-project-analyzer';

const DATA = 'src/test-data/services';
const GOLDEN = path.join(DATA, '_golden');
const BLESS = process.argv.includes('--bless');

/** Columns that cannot be compared across runs or machines. */
const VOLATILE = /^(baseMservPath|filePath)$/;

/**
 * Hash columns are dropped from the golden comparison: they are content
 * addressed over an absolute path, so they differ on every machine. Referential
 * integrity is what checks them, and it checks something stronger — that every
 * foreign key resolves to a row that exists.
 */
const HASH_COLUMN = /(Hash|hash)$/;

type Row = Record<string, string>;

const fail = (m: string): number => { console.log('  ✗ ' + m); return 1; };

interface Check { name: string; proves: string; run: () => number }

// ---------------------------------------------------------------------------
// format checks — from the ServiceLoader spec, in memory, no filesystem
// ---------------------------------------------------------------------------

/**
 * Parses one in-memory provider-configuration file.
 *
 * The file name is passed as the service being configured, which is how the
 * real format works: nothing inside the file names the service.
 */
function parseFile(
  fileName: string,
  content: string
): [ServiceDescriptor, ServiceProvider[]] {
  return new ServicesParser().parse(
    content,
    `/repo/src/main/resources/META-INF/services/${fileName}`,
    '/repo',
    'SERVICES_FIXTURE_VERSION'
  );
}

/** The providers of a file, by their emitted qualified name. */
function names(content: string, fileName = 'org.acme.Codec'): string[] {
  return parseFile(fileName, content)[1].map((p) => p.getProviderClass());
}

interface FormatCheck {
  name: string;
  /** The clause of the format this check comes from. */
  spec: string;
  /** The plausible wrong implementation this check fails. */
  rulesOut: string;
  run: () => number;
}

const formatChecks: FormatCheck[] = [
  {
    name: 'comment-only-file-is-a-descriptor-with-no-providers',
    spec: 'on each line all characters following the first comment character are ignored',
    rulesOut: 'a reader that emits one row per line',
    run: () => {
      const [descriptor, providers] = parseFile(
        'org.acme.Codec',
        '#\n# Licensed under the Apache License, Version 2.0\n#\n'
      );
      let bad = 0;
      if (providers.length !== 0) bad += fail(`${providers.length} providers from a comment-only file`);
      if (descriptor.getProviderCount() !== 0) bad += fail(`providerCount=${descriptor.getProviderCount()}`);
      // The file was read and understood; it declares nothing. Reporting it as
      // absent would make "no providers" and "not analysed" the same answer.
      if (descriptor.getLineCount() !== 3) bad += fail(`lineCount=${descriptor.getLineCount()}, expected 3`);
      if (descriptor.getServiceInterface() !== 'org.acme.Codec') {
        bad += fail(`serviceInterface=${descriptor.getServiceInterface()}`);
      }
      return bad;
    },
  },
  {
    name: 'inline-comment-is-stripped-from-the-name',
    spec: 'all characters following the first comment character are ignored',
    rulesOut: 'a reader that trims a line but does not strip its comment',
    run: () => {
      const [, providers] = parseFile('org.acme.Codec', 'org.acme.JsonCodec # the default\n');
      if (providers.length !== 1) return fail(`${providers.length} providers, expected 1`);
      const p = providers[0]!;
      let bad = 0;
      if (p.getProviderClass() !== 'org.acme.JsonCodec') bad += fail(`providerClass=${p.getProviderClass()}`);
      if (!p.getHasInlineComment()) bad += fail('hasInlineComment=false on a line carrying a comment');
      return bad;
    },
  },
  {
    name: 'a-hash-at-column-zero-hides-the-whole-line',
    spec: 'the comment runs from the FIRST comment character to end of line',
    rulesOut: "a reader that strips comments only when a name precedes the '#'",
    run: () => {
      const got = names('#org.acme.JsonCodec\n');
      return got.length === 0 ? 0 : fail(`commented-out name still emitted: ${got.join(', ')}`);
    },
  },
  {
    name: 'blank-and-whitespace-lines-are-ignored',
    spec: 'space and tab characters surrounding each name, as well as blank lines, are ignored',
    rulesOut: 'a reader that emits an empty-named row for a blank line',
    run: () => {
      const got = names('\n   \n\torg.acme.JsonCodec\t\n \n');
      return got.length === 1 && got[0] === 'org.acme.JsonCodec'
        ? 0
        : fail(`got ${JSON.stringify(got)}`);
    },
  },
  {
    name: 'position-counts-providers-not-lines',
    spec: 'the file is a list of provider classes; comments and blanks are not entries',
    rulesOut: 'a reader that uses the line number as the ordinal',
    run: () => {
      const [, providers] = parseFile(
        'org.acme.Codec',
        '# header\n\norg.acme.A\n\n# note\norg.acme.B\n'
      );
      let bad = 0;
      if (providers.map((p) => p.getPosition()).join(',') !== '0,1') {
        bad += fail(`positions=${providers.map((p) => p.getPosition()).join(',')}, expected 0,1`);
      }
      // The LINE is still the real line, so a consumer can cite the file.
      if (providers.map((p) => p.getStartLine()).join(',') !== '3,6') {
        bad += fail(`lines=${providers.map((p) => p.getStartLine()).join(',')}, expected 3,6`);
      }
      return bad;
    },
  },
  {
    name: 'a-nested-name-is-normalised-to-dots',
    spec: 'the file lists fully-qualified BINARY names',
    rulesOut: 'a reader that passes the binary name through unchanged',
    run: () => {
      const [, providers] = parseFile('org.acme.Codec', 'org.acme.Outer$Inner\n');
      if (providers.length !== 1) return fail(`${providers.length} providers`);
      const p = providers[0]!;
      let bad = 0;
      if (p.getProviderClass() !== 'org.acme.Outer.Inner') bad += fail(`providerClass=${p.getProviderClass()}`);
      if (p.getProviderClassBinaryName() !== 'org.acme.Outer$Inner') {
        bad += fail(`binary name lost: ${p.getProviderClassBinaryName()}`);
      }
      if (p.getEnclosingTypeName() !== 'org.acme.Outer') bad += fail(`enclosingTypeName=${p.getEnclosingTypeName()}`);
      if (p.getPackageName() !== 'org.acme') bad += fail(`packageName=${p.getPackageName()}`);
      if (p.getSimpleName() !== 'Inner') bad += fail(`simpleName=${p.getSimpleName()}`);
      if (!p.getIsNestedName()) bad += fail('isNestedName=false');
      if (!p.getIsWellFormedName()) bad += fail('isWellFormedName=false for a legal binary name');
      return bad;
    },
  },
  {
    name: 'a-synthetic-name-is-not-normalised',
    spec: "'$' is a legal identifier character, not only a nesting separator",
    rulesOut: "a reader that replaces every '$' with '.'",
    run: () => {
      let bad = 0;
      // Outer$1 is a compiler-generated anonymous class. `Outer.1` names nothing.
      const anon = parseFile('org.acme.Codec', 'org.acme.Outer$1\n')[1][0]!;
      if (anon.getProviderClass() !== 'org.acme.Outer$1') bad += fail(`providerClass=${anon.getProviderClass()}`);
      if (!anon.getIsNestedName()) bad += fail('isNestedName=false on a $-bearing name');
      // The parts are reported only where they survive without trusting the
      // `$`: the package does, `simpleName` is the binary one, and the
      // enclosing type is withheld rather than guessed at.
      if (anon.getSimpleName() !== 'Outer$1') bad += fail(`simpleName=${anon.getSimpleName()}`);
      if (anon.getPackageName() !== 'org.acme') bad += fail(`packageName=${anon.getPackageName()}`);
      if (anon.getEnclosingTypeName() !== '') {
        bad += fail(`enclosingTypeName=${anon.getEnclosingTypeName()}, expected empty`);
      }
      // A$$B is ONE legal identifier, so splitting it yields an empty part.
      const dollars = parseFile('org.acme.Codec', 'org.acme.A$$B\n')[1][0]!;
      if (dollars.getProviderClass() !== 'org.acme.A$$B') bad += fail(`providerClass=${dollars.getProviderClass()}`);
      if (!dollars.getIsWellFormedName()) bad += fail("isWellFormedName=false — '$' is legal in an identifier");
      if (dollars.getEnclosingTypeName() !== '') {
        bad += fail(`enclosingTypeName=${dollars.getEnclosingTypeName()}, expected empty — 'org.acme.A$' is not a type`);
      }
      return bad;
    },
  },
  {
    name: 'the-service-comes-from-the-file-name',
    spec: 'the file is named by the binary name of the service it configures',
    rulesOut: 'an extractor that reads only the lines and never the file name',
    run: () => {
      const [descriptor] = parseFile('org.acme.Outer$Nested', 'org.acme.Impl\n');
      let bad = 0;
      if (descriptor.getServiceInterface() !== 'org.acme.Outer.Nested') {
        bad += fail(`serviceInterface=${descriptor.getServiceInterface()}`);
      }
      if (descriptor.getServiceInterfaceBinaryName() !== 'org.acme.Outer$Nested') {
        bad += fail(`binary name lost: ${descriptor.getServiceInterfaceBinaryName()}`);
      }
      if (!descriptor.getIsNestedServiceName()) bad += fail('isNestedServiceName=false');
      if (descriptor.getSimpleName() !== 'Nested') bad += fail(`simpleName=${descriptor.getSimpleName()}`);
      if (descriptor.getPackageName() !== 'org.acme') bad += fail(`packageName=${descriptor.getPackageName()}`);
      return bad;
    },
  },
  {
    name: 'a-malformed-name-is-emitted-and-flagged',
    spec: 'a line that is not a legal binary name makes ServiceLoader throw',
    rulesOut: 'a reader that silently drops what it cannot parse',
    run: () => {
      // Arquillian writes this to suppress an extension. It is not a class name,
      // and it appears in real corpora.
      const [descriptor, providers] = parseFile(
        'org.acme.Codec',
        '!org.acme.Suppressed\norg.acme.Real\n'
      );
      let bad = 0;
      if (providers.length !== 2) return fail(`${providers.length} providers, expected 2`);
      const [suppressed, real] = providers as [ServiceProvider, ServiceProvider];
      if (suppressed.getIsWellFormedName()) bad += fail('!-prefixed name reported well formed');
      if (suppressed.getProviderClassBinaryName() !== '!org.acme.Suppressed') {
        bad += fail(`binary name=${suppressed.getProviderClassBinaryName()}`);
      }
      // Splitting a malformed token yields the package `!org.acme`, which names
      // nothing and would sit in a column a consumer joins on. Nothing is
      // derived from a name whose structure was not established.
      for (const [col, value] of [
        ['packageName', suppressed.getPackageName()],
        ['simpleName', suppressed.getSimpleName()],
        ['enclosingTypeName', suppressed.getEnclosingTypeName()],
      ] as const) {
        if (value !== '') bad += fail(`malformed name got ${col}=${value}, expected empty`);
      }
      if (!real.getIsWellFormedName()) bad += fail('a legal name beside a malformed one was flagged too');
      if (descriptor.getProviderCount() !== 2) bad += fail(`providerCount=${descriptor.getProviderCount()}`);
      if (descriptor.getWellFormedProviderCount() !== 1) {
        bad += fail(`wellFormedProviderCount=${descriptor.getWellFormedProviderCount()}, expected 1`);
      }
      return bad;
    },
  },
  {
    name: 'one-line-is-at-most-one-provider',
    spec: 'the file lists provider classes ONE PER LINE',
    rulesOut: 'a reader that splits a line on whitespace',
    run: () => {
      const [, providers] = parseFile('org.acme.Codec', 'org.acme.First org.acme.Second\n');
      let bad = 0;
      // Splitting here would fabricate two instantiations. The JVM performs
      // neither: it rejects the line.
      if (providers.length !== 1) bad += fail(`${providers.length} providers from one line, expected 1`);
      const p = providers[0];
      if (!p) return bad + fail('no row at all for a malformed line');
      if (p.getIsWellFormedName()) bad += fail('a two-token line reported well formed');
      if (p.getProviderClassBinaryName() !== 'org.acme.First org.acme.Second') {
        bad += fail(`binary name=${p.getProviderClassBinaryName()}`);
      }
      // `org.acme.First org.acme` is what a naive lastIndexOf('.') reports here.
      if (p.getPackageName() !== '') bad += fail(`packageName=${p.getPackageName()}, expected empty`);
      return bad;
    },
  },
  {
    name: 'crlf-does-not-become-part-of-the-name',
    spec: 'lines, however the file terminates them',
    rulesOut: "a reader that splits on '\\n' alone",
    run: () => {
      const got = names('org.acme.A\r\norg.acme.B\r\n');
      return got.join(',') === 'org.acme.A,org.acme.B' ? 0 : fail(`got ${JSON.stringify(got)}`);
    },
  },
  {
    name: 'a-bom-does-not-become-part-of-the-name',
    spec: 'the file must be encoded in UTF-8, in which a BOM is legal',
    rulesOut: 'a reader that takes the first line verbatim',
    run: () => {
      const [, providers] = parseFile('org.acme.Codec', '﻿org.acme.A\n');
      if (providers.length !== 1) return fail(`${providers.length} providers`);
      const p = providers[0]!;
      let bad = 0;
      if (p.getProviderClass() !== 'org.acme.A') bad += fail(`providerClass=${JSON.stringify(p.getProviderClass())}`);
      if (!p.getIsWellFormedName()) bad += fail('a BOM made a legal name look malformed');
      return bad;
    },
  },
  {
    name: 'a-repeat-in-one-file-is-flagged-not-collapsed',
    spec: 'a class named twice in the same file is loaded once',
    rulesOut: 'a reader that keys a provider by name and overwrites the twin',
    run: () => {
      const [, providers] = parseFile('org.acme.Codec', 'org.acme.A\norg.acme.B\norg.acme.A\n');
      let bad = 0;
      if (providers.length !== 3) bad += fail(`${providers.length} rows, expected 3 — both occurrences are citable`);
      if (providers.map((p) => (p.getIsDuplicateInFile() ? '1' : '0')).join('') !== '001') {
        bad += fail(`duplicate flags=${providers.map((p) => (p.getIsDuplicateInFile() ? '1' : '0')).join('')}, expected 001`);
      }
      if (new Set(providers.map((p) => p.getHash())).size !== 3) {
        bad += fail('two occurrences of one name share a key');
      }
      return bad;
    },
  },
  {
    name: 'the-same-class-in-two-files-is-not-a-duplicate',
    spec: 'each provider-configuration file configures one service',
    rulesOut: 'a reader that dedupes provider names across the corpus',
    run: () => {
      const a = new ServicesParser().parse(
        'org.acme.Shared\n',
        '/repo/core/src/main/resources/META-INF/services/org.acme.Codec',
        '/repo/core',
        'V'
      );
      const b = new ServicesParser().parse(
        'org.acme.Shared\n',
        '/repo/ext/src/main/resources/META-INF/services/org.acme.Codec',
        '/repo/ext',
        'V'
      );
      let bad = 0;
      if (a[1][0]!.getIsDuplicateInFile() || b[1][0]!.getIsDuplicateInFile()) {
        bad += fail('a class named in two modules was flagged a duplicate');
      }
      if (a[0].getHash() === b[0].getHash()) {
        bad += fail('two modules shipping the same service name collapsed to one descriptor');
      }
      if (a[1][0]!.getServiceDescriptorLinkHash() !== a[0].getHash()) {
        bad += fail('a provider does not chain to its own descriptor');
      }
      return bad;
    },
  },
  {
    name: 'line-count-does-not-count-a-terminating-newline',
    spec: 'a file of N lines ends its last line with a newline',
    rulesOut: "a reader that reports split('\\n').length",
    run: () => {
      let bad = 0;
      for (const [content, want] of [
        ['org.acme.A\n', 1],
        ['org.acme.A', 1],
        ['org.acme.A\norg.acme.B\n', 2],
        ['org.acme.A\n\n', 2],
        ['', 0],
      ] as const) {
        const got = parseFile('org.acme.Codec', content)[0].getLineCount();
        if (got !== want) bad += fail(`lineCount=${got} for ${JSON.stringify(content)}, expected ${want}`);
      }
      return bad;
    },
  },
  {
    name: 'the-default-package-has-no-package-name',
    spec: 'a binary name need not be qualified',
    rulesOut: "a reader that assumes a '.' is always present",
    run: () => {
      const p = parseFile('Codec', 'PlainCodec\n')[1][0]!;
      let bad = 0;
      if (p.getPackageName() !== '') bad += fail(`packageName=${p.getPackageName()}, expected empty`);
      if (p.getSimpleName() !== 'PlainCodec') bad += fail(`simpleName=${p.getSimpleName()}`);
      if (!p.getIsWellFormedName()) bad += fail('an unqualified name reported malformed');
      return bad;
    },
  },
];

// ---------------------------------------------------------------------------
// fixture-tree machinery
// ---------------------------------------------------------------------------

function tsv(dir: string, file: string): Row[] {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

/**
 * Runs the analyzer the way `extractProject` does: the repository root AND every
 * project beneath it as scan targets. The overlap is the point — it is what the
 * attribution check below exercises.
 */
async function analyse(
  rootDir: string,
  outputDir: string,
  order: 'root-first' | 'root-last' = 'root-first'
): Promise<string> {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const paths = [path.join(rootDir, 'core'), path.join(rootDir, 'ext')];
  // `extractProject` puts the repository root FIRST. Both orders are analysed
  // because a rule that only holds for one of them is not a rule: "keep the
  // last target that claimed the file" agrees with "keep the most specific
  // one" whenever the root happens to come first, so a root-first fixture
  // alone lets the attribution rule be reverted with every check still green.
  const targets = (order === 'root-first' ? [rootDir, ...paths] : [...paths, rootDir]).map((p) => ({
    name: path.basename(p),
    path: p,
    language: 'UNKNOWN' as never,
    hasSourceFiles: false,
  }));
  const silence = console.log;
  console.log = () => {};
  try {
    await new ServicesProjectAnalyzer(outputDir).analyzeServicesFiles(
      targets,
      'SERVICES_FIXTURE_VERSION'
    );
  } finally {
    console.log = silence;
  }
  return outputDir;
}

const RELATIONS = ['all-service-descriptors.csv', 'all-service-providers.csv'];

/** Every fact, sorted, volatile and hash columns dropped. Row order is not a contract. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of RELATIONS) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c) && !HASH_COLUMN.test(c));
    snap.set(
      f.replace('all-service-', '').replace('.csv', ''),
      rows.map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t')).sort()
    );
  }
  return snap;
}

function goldenCheck(out: string): number {
  const snap = snapshot(out);

  if (BLESS) {
    fs.rmSync(GOLDEN, { recursive: true, force: true });
    fs.mkdirSync(GOLDEN, { recursive: true });
    for (const [rel, rows] of snap) {
      fs.writeFileSync(path.join(GOLDEN, rel + '.txt'), rows.join('\n') + '\n');
    }
    console.log(`  ✎ blessed ${snap.size} relation(s)`);
    return 0;
  }

  if (!fs.existsSync(GOLDEN)) return fail('no golden; run --bless');

  let bad = 0;
  const expected = new Set(fs.readdirSync(GOLDEN).map((f) => f.replace('.txt', '')));
  for (const rel of expected) {
    if (!snap.has(rel)) bad += fail(`relation ${rel} vanished`);
  }
  for (const [rel, rows] of snap) {
    if (!expected.has(rel)) { bad += fail(`relation ${rel} appeared unexpectedly`); continue; }
    const want = fs.readFileSync(path.join(GOLDEN, rel + '.txt'), 'utf-8').split('\n').filter(Boolean);
    if (want.length !== rows.length) bad += fail(`${rel}: ${rows.length} rows, expected ${want.length}`);
    for (let i = 0; i < Math.min(want.length, rows.length); i++) {
      if (want[i] !== rows[i]) {
        bad += fail(`${rel} row ${i}\n      want ${want[i]}\n      got  ${rows[i]}`);
        break;
      }
    }
  }
  return bad;
}

function arityCheck(out: string): number {
  let bad = 0;
  for (const f of RELATIONS) {
    const fp = path.join(out, f);
    if (!fs.existsSync(fp)) { bad += fail(`${f} was not written`); continue; }
    const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
    const header = lines[0]!.split('\t');
    const last = header[header.length - 1]!;
    if (!/UniqueHash$/.test(last)) {
      bad += fail(`${f}: last column is ${last}, expected the row's own key`);
    }
    lines.slice(1).forEach((line, i) => {
      const n = line.split('\t').length;
      if (n !== header.length) bad += fail(`${f} row ${i}: ${n} fields, header has ${header.length}`);
    });
  }
  return bad;
}

/**
 * Absence is meaningful, so an empty foreign key is legal: it is how the parser
 * says "this could not be decided". A NON-empty key pointing at a row that does
 * not exist is a fabricated edge, and strictly worse than no edge at all.
 */
function integrityCheck(out: string): number {
  const rowsByFile = new Map(RELATIONS.map((f) => [f, tsv(out, f)]));

  const known = new Set<string>();
  for (const rows of rowsByFile.values()) {
    for (const r of rows) {
      for (const [col, value] of Object.entries(r)) {
        if (/UniqueHash$/.test(col) && value) known.add(value);
      }
    }
  }

  const NOT_A_FOREIGN_KEY = /^(serviceVersionLinkHash|.*UniqueHash)$/;
  let bad = 0;
  let checked = 0;
  for (const [file, rows] of rowsByFile) {
    for (const [i, r] of rows.entries()) {
      for (const [col, value] of Object.entries(r)) {
        if (!/Hash$/.test(col) || NOT_A_FOREIGN_KEY.test(col)) continue;
        if (!value) continue;
        checked++;
        if (!known.has(value)) {
          bad += fail(`${file} row ${i}: ${col}=${value.slice(0, 24)}… points at no row`);
          if (bad > 5) return bad;
        }
      }
    }
  }
  if (!bad) console.log(`  ${checked} foreign keys, all resolved`);
  return bad;
}

/**
 * The same fixture analysed with the repository root first and last.
 *
 * Attribution must not depend on the order the scan targets arrive in, and the
 * two runs are compared row for row rather than each being checked against the
 * golden separately — an attribution rule that is merely CONSISTENT with itself
 * would pass that.
 */
function orderIndependenceCheck(rootFirst: string, rootLast: string): number {
  const a = snapshot(rootFirst);
  const b = snapshot(rootLast);
  let bad = 0;
  if (a.size !== b.size) bad += fail(`${a.size} relations root-first, ${b.size} root-last`);
  for (const [rel, rows] of a) {
    const other = b.get(rel) ?? [];
    if (rows.length !== other.length) {
      bad += fail(`${rel}: ${rows.length} rows root-first, ${other.length} root-last`);
    }
    for (let i = 0; i < Math.min(rows.length, other.length); i++) {
      if (rows[i] !== other[i]) {
        bad += fail(`${rel} row ${i} depends on scan-target order\n      root-first ${rows[i]}\n      root-last  ${other[i]}`);
        break;
      }
    }
  }
  // The volatile columns are dropped from a snapshot, and baseMservPath is one
  // of them — so the comparison above cannot see the attribution itself.
  for (const [label, out] of [['root-first', rootFirst], ['root-last', rootLast]] as const) {
    for (const d of tsv(out, 'all-service-descriptors.csv')) {
      const leaf = path.basename(d['baseMservPath'] ?? '');
      if (leaf !== 'core' && leaf !== 'ext') {
        bad += fail(`${label}: ${d['relativePath']} attributed to ${d['baseMservPath']}`);
      }
    }
  }
  return bad;
}

function fixtureChecks(out: string): Check[] {
  const descriptors = (): Row[] => tsv(out, 'all-service-descriptors.csv');
  const providers = (): Row[] => tsv(out, 'all-service-providers.csv');

  return [
    {
      name: 'only-META-INF-services-is-collected',
      proves: 'a file beside META-INF/services, one directory over, or one below, is not a descriptor',
      run: () => {
        let bad = 0;
        const names = descriptors().map((d) => d['serviceInterfaceBinaryName']);
        // One directory over, one directory up, and one directory DOWN. The
        // format has no nested provider-configuration file: `ServiceLoader`
        // reads the resource `META-INF/services/<binary-name>` and nothing
        // below it, so a descriptor found by recursing would name providers
        // the JVM never instantiates.
        for (const wrong of ['org.acme.NotAService', 'org.acme.AlsoNotAService', 'org.acme.Deep']) {
          if (names.includes(wrong)) bad += fail(`${wrong} was collected but is not a META-INF/services entry`);
        }
        if (!names.includes('org.acme.Codec')) bad += fail('the real descriptor was missed');
        return bad;
      },
    },
    {
      name: 'build-output-copies-are-not-collected',
      proves: 'the same descriptor under target/classes is not counted a second time',
      run: () => {
        const inTarget = descriptors().filter((d) => (d['filePath'] ?? '').includes(`${path.sep}target${path.sep}`));
        return inTarget.length === 0
          ? 0
          : fail(`${inTarget.length} descriptor(s) read from build output — providers would double-count`);
      },
    },
    {
      name: 'each-file-is-emitted-once-for-its-innermost-project',
      proves: 'overlapping scan targets do not duplicate a row, and attribution is the nearest project',
      run: () => {
        let bad = 0;
        const byPath = new Map<string, Row[]>();
        for (const d of descriptors()) {
          const fp = d['filePath'] ?? '';
          byPath.set(fp, [...(byPath.get(fp) ?? []), d]);
        }
        for (const [fp, rows] of byPath) {
          if (rows.length !== 1) bad += fail(`${rows.length} descriptors for ${fp}`);
        }
        for (const d of descriptors()) {
          const base = d['baseMservPath'] ?? '';
          const leaf = path.basename(base);
          if (leaf !== 'core' && leaf !== 'ext') {
            bad += fail(`${d['relativePath']} attributed to ${base}, not to the project that ships it`);
          }
        }
        return bad;
      },
    },
    {
      name: 'provider-counts-match-the-rows',
      proves: 'the descriptor tally and the provider relation cannot disagree',
      run: () => {
        let bad = 0;
        const byDescriptor = new Map<string, Row[]>();
        for (const p of providers()) {
          const k = p['serviceDescriptorLinkHash'] ?? '';
          byDescriptor.set(k, [...(byDescriptor.get(k) ?? []), p]);
        }
        for (const d of descriptors()) {
          const rows = byDescriptor.get(d['serviceDescriptorUniqueHash'] ?? '') ?? [];
          if (Number(d['providerCount']) !== rows.length) {
            bad += fail(`${d['relativePath']}: providerCount=${d['providerCount']}, ${rows.length} rows`);
          }
          const wellFormed = rows.filter((r) => r['isWellFormedName'] === 'true').length;
          if (Number(d['wellFormedProviderCount']) !== wellFormed) {
            bad += fail(`${d['relativePath']}: wellFormedProviderCount=${d['wellFormedProviderCount']}, ${wellFormed} rows`);
          }
        }
        return bad;
      },
    },
    {
      name: 'keys-are-unique',
      proves: 'no two rows in a relation share a primary key',
      run: () => {
        let bad = 0;
        for (const [f, key] of [
          ['all-service-descriptors.csv', 'serviceDescriptorUniqueHash'],
          ['all-service-providers.csv', 'serviceProviderUniqueHash'],
        ] as const) {
          const keys = tsv(out, f).map((r) => r[key] ?? '');
          if (new Set(keys).size !== keys.length) {
            bad += fail(`${f}: ${keys.length - new Set(keys).size} duplicate key(s)`);
          }
        }
        return bad;
      },
    },
    {
      name: 'a-service-shipped-by-two-modules-keeps-both',
      proves: 'org.acme.Codec is configured in core and in ext, and neither is lost',
      run: () => {
        const codecs = descriptors().filter((d) => d['serviceInterfaceBinaryName'] === 'org.acme.Codec');
        return codecs.length === 2
          ? 0
          : fail(`${codecs.length} descriptors for org.acme.Codec, expected 2`);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    console.log('\nformat — from the ServiceLoader provider-configuration format');
    for (const c of formatChecks) {
      console.log(`  ${c.name.padEnd(52)} ${c.spec}`);
      console.log(`  ${''.padEnd(52)} rules out: ${c.rulesOut}`);
    }
    console.log('\nfixture — src/test-data/services/fixture');
    for (const c of [
      { name: 'golden', proves: 'every emitted row matches the committed expectation' },
      { name: 'arity', proves: 'every row has as many fields as its header, key column last' },
      { name: 'integrity', proves: 'every non-empty foreign key resolves to a row that exists' },
      { name: 'attribution-is-order-independent', proves: 'the same rows, whichever order the scan targets arrive in' },
      ...fixtureChecks('.'),
    ]) {
      console.log(`  ${c.name.padEnd(52)} ${c.proves}`);
    }
    return;
  }

  let failures = 0;

  console.log('\n▸ format');
  for (const check of formatChecks) {
    const bad = check.run();
    failures += bad;
    if (!bad) console.log(`  ✓ ${check.name}`);
  }

  console.log('\n▸ fixture');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'services-tests-'));
  const root = path.join(DATA, 'fixture');
  const out = await analyse(root, path.join(tmp, 'root-first'), 'root-first');
  const reordered = await analyse(root, path.join(tmp, 'root-last'), 'root-last');

  for (const [name, run] of [
    ['golden', () => goldenCheck(out)],
    ['arity', () => arityCheck(out)],
    ['integrity', () => integrityCheck(out)],
    ['attribution-is-order-independent', () => orderIndependenceCheck(out, reordered)],
  ] as const) {
    const bad = run();
    failures += bad;
    if (!bad) console.log(`  ✓ ${name}`);
  }
  for (const check of fixtureChecks(out)) {
    const bad = check.run();
    failures += bad;
    if (!bad) console.log(`  ✓ ${check.name}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(failures === 0
    ? '\n✅ all services checks passed'
    : `\n❌ ${failures} services check failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
