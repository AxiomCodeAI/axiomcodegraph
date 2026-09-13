/**
 * WHAT FRACTION OF THE COMPILER'S OWN TREE DOES THIS PARSER EMIT A FACT FOR?
 *
 *     npx tsx src/test/javascript-gates/ast-recall.ts <corpus-root>
 *
 * A MEASUREMENT, not a gate. It is slow — it extracts the corpus and then
 * re-walks every file — and its residue needs reading rather than asserting, so
 * it is not in `javascript-tests.ts` and does not fail a build.
 *
 * ## The compiler is the oracle, and this is what that buys
 *
 * For every node kind that should produce a row, it walks
 * `ts.createSourceFile`'s AST, takes the position, and asks whether the fact
 * base has a row there. Positional deliberately: a position join is the wrong
 * way to LINK facts and the right way to measure RECALL, because it shares no
 * code with the extractor and therefore cannot agree with it by construction.
 *
 * Bundled, Flow-excluded and generated files are skipped — they contribute to no
 * denominator by rule, so counting them would measure the exclusion.
 *
 * ## What it found, and what the residue means
 *
 * It located three defects that every row-count check was blind to, because
 * none of them changed a count anyone was watching:
 *
 * - 2 call sites and 28 variables lost to a default inside a destructuring
 *   ASSIGNMENT — `({ buffer = Buffer.alloc(16384) } = params)` — where the
 *   target parses as an object LITERAL and the default lands on
 *   `objectAssignmentInitializer`, a property nothing read;
 * - 4,944 nested JSX elements emitted no row at all. They were walked THROUGH,
 *   so their attributes and the calls inside those attributes were emitted and
 *   hung off the OUTERMOST element — parts present, structure absent.
 *
 * The residue that remains is intended or is this measure's own expectation, and
 * saying which is the point of running it:
 *
 * - `ParenthesizedExpression` (7,564) — INTENDED. §6: unwrap at the root, in one
 *   place. A parenthesis is a non-emitting node by design.
 * - `CaseBlock` (803) — MEASURE. A switch emits `SWITCH` at the statement and
 *   `SWITCH_CASE` per clause; the brace between them is not a separate block.
 * - `VariableDeclaration` (28) — MEASURE, and the parser is right in a way worth
 *   keeping: `function (container) { var container = ... }` is ONE binding, and
 *   it is already a `js_method_parameter` row. A second row would be a second
 *   binding that does not exist.
 * - `StringLiteral` (3,522) and `PrivateIdentifier` (1,149) — MEASURE. A
 *   quoted key in a binding pattern and a `#name` are PropertyNames that
 *   `ts.isExpression` happens to accept; they are not values.
 * - `PropertyAccessExpression` (833) — OPEN, and raised rather than decided:
 *   these are JSX tag names like `<TestContext.Provider/>`. The tag is on the
 *   JSX_ELEMENT row's text; whether it should ALSO be its own expression row is
 *   a schema question, and for a component graph there is a real argument that
 *   it should.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';
import { isJavaScriptSourceFile, jsExtensionOf } from '@/utils/javascript';

type Key = string;
const key = (line: number, col: number): Key => `${line}:${col}`;

interface Bucket { expected: number; found: number; missing: Map<string, number> }
const bucket = (): Bucket => ({ expected: 0, found: 0, missing: new Map() });

async function main(): Promise<void> {
  const root = process.argv[2]!;
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'js-recall-'));
  const summary = await new JavaScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir: out, baseMservPath: root,
    serviceVersionLink: 'recall', excludeDirs: ['.git', '.bin'],
  });

  // ---- read the fact base ONCE, streaming, indexed by (relation, file)
  //
  // Streamed because `js_expression` is past V8's maximum string length on a
  // real corpus, and indexed in a single pass because re-reading every relation
  // per source file is O(files x relations) and does not finish.
  const streamLines = (full: string, onLine: (line: string, i: number) => void): void => {
    const fd = fs.openSync(full, 'r');
    try {
      const CHUNK = 1 << 20;
      const buf = Buffer.allocUnsafe(CHUNK);
      let carry = ''; let i = 0; let pos = 0;
      for (;;) {
        const n = fs.readSync(fd, buf, 0, CHUNK, pos);
        if (n <= 0) { break; }
        pos += n;
        const parts = (carry + buf.toString('utf-8', 0, n)).split('\n');
        carry = parts.pop() ?? '';
        for (const l of parts) { if (l !== '') { onLine(l, i); i += 1; } }
      }
      if (carry !== '') { onLine(carry, i); }
    } finally { fs.closeSync(fd); }
  };

  const modules = { header: [] as string[], rows: [] as string[][] };
  streamLines(path.join(out, 'all-javascript-modules.csv'), (line, i) => {
    if (i === 0) { modules.header = line.split('\t'); return; }
    modules.rows.push(line.split('\t'));
  });
  const mPath = modules.header.indexOf('filePath');
  const mPk = modules.header.indexOf('jsModuleUniqueHash');
  const mProv = modules.header.indexOf('sourceProvenance');
  const fileByModule = new Map<string, string>();
  const provByFile = new Map<string, string>();
  for (const r of modules.rows) {
    fileByModule.set(r[mPk]!, r[mPath]!);
    provByFile.set(r[mPath]!, r[mProv]!);
  }

  const index = new Map<string, Map<string, Set<Key>>>();
  for (const f of fs.readdirSync(out)) {
    if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) { continue; }
    let header: string[] = [];
    let owner = -1; let line = -1; let col = -1;
    const byFile = new Map<string, Set<Key>>();
    streamLines(path.join(out, f), (raw, i) => {
      if (i === 0) {
        header = raw.split('\t');
        owner = header.indexOf('ownerModuleLinkHash');
        line = header.indexOf('startLine');
        col = header.indexOf('startColumn');
        return;
      }
      if (owner < 0 || line < 0 || col < 0) { return; }
      const cells = raw.split('\t');
      const file = fileByModule.get(cells[owner] ?? '');
      if (file === undefined) { return; }
      let set = byFile.get(file);
      if (set === undefined) { set = new Set<Key>(); byFile.set(file, set); }
      set.add(key(Number(cells[line]), Number(cells[col])));
    });
    index.set(f, byFile);
  }

  const buckets: Record<string, Bucket> = {
    'call sites      -> js_call_site': bucket(),
    'callables       -> js_method': bucket(),
    'classes         -> js_type': bucket(),
    'variable names  -> js_variable': bucket(),
    'blocks          -> js_block': bucket(),
    'expressions     -> js_expression': bucket(),
  };
  const relationFor: Record<string, string> = {
    'call sites      -> js_call_site': 'all-javascript-call-sites.csv',
    'callables       -> js_method': 'all-javascript-methods.csv',
    'classes         -> js_type': 'all-javascript-types.csv',
    'variable names  -> js_variable': 'all-javascript-variables.csv',
    'blocks          -> js_block': 'all-javascript-blocks.csv',
    'expressions     -> js_expression': 'all-javascript-expressions.csv',
  };

  const files: string[] = [];
  const walkDir = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'build', 'out', 'coverage'].includes(e.name)) {
          walkDir(full);
        }
      } else if (isJavaScriptSourceFile(e.name)) { files.push(full); }
    }
  };
  walkDir(root);

  const examples = new Map<string, string[]>();
  let measured = 0;
  for (const absolute of files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const provenance = provByFile.get(relative);
    if (provenance !== 'PROJECT') { continue; }
    measured += 1;
    const text = fs.readFileSync(absolute, 'utf-8');
    const sf = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true,
      // The EIGHTH spelling of "is this JSX", written in this very file during
      // the same session that collapsed the other seven. That is how reliably
      // this trap regenerates, and why the check below is a check rather than a
      // note.
      jsExtensionOf(relative) === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
    const at = (n: ts.Node): Key => {
      const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      return key(p.line + 1, p.character + 1);
    };
    const want = (name: string, n: ts.Node, label: string): void => {
      const b = buckets[name]!;
      b.expected += 1;
      if (index.get(relationFor[name]!)?.get(relative)?.has(at(n)) === true) {
        b.found += 1; return;
      }
      b.missing.set(label, (b.missing.get(label) ?? 0) + 1);
      const shown = examples.get(label) ?? [];
      if (shown.length < 3) {
        shown.push(`${relative}:${at(n)}  ${n.getText(sf).slice(0, 62).replace(/\n/g, ' ')}`);
        examples.set(label, shown);
      }
    };
    const isRequire = (n: ts.Node): boolean => ts.isCallExpression(n)
      && ts.isIdentifier(n.expression) && n.expression.text === 'require';
    const visit = (n: ts.Node): void => {
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)
        || ts.isTaggedTemplateExpression(n)) && !isRequire(n)) {
        want('call sites      -> js_call_site', n, ts.SyntaxKind[n.kind]!);
      }
      if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
        || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n)
        || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)
        || ts.isClassStaticBlockDeclaration(n)) {
        want('callables       -> js_method', n, ts.SyntaxKind[n.kind]!);
      }
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
        want('classes         -> js_type', n, ts.SyntaxKind[n.kind]!);
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
        want('variable names  -> js_variable', n.name, 'VariableDeclaration');
      }
      if (ts.isBlock(n) || ts.isCaseBlock(n) || ts.isModuleBlock(n)) {
        want('blocks          -> js_block', n, ts.SyntaxKind[n.kind]!);
      }
      if (ts.isExpression(n) && !ts.isIdentifier(n)) {
        want('expressions     -> js_expression', n, ts.SyntaxKind[n.kind]!);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }

  console.log(`\nAST RECALL — ${measured} PROJECT files of ${summary.filesAnalysed} analysed`);
  console.log('='.repeat(76));
  for (const [name, b] of Object.entries(buckets)) {
    const pct = b.expected === 0 ? 0 : (100 * b.found) / b.expected;
    console.log(`  ${name.padEnd(34)} ${String(b.found).padStart(8)} / `
      + `${String(b.expected).padStart(8)}  ${pct.toFixed(1)}%`);
    const top = [...b.missing.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    if (top.length > 0) {
      console.log(`      top missing: ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
  }
  console.log('\nEXAMPLES of each missing kind:');
  for (const [label, list] of [...examples.entries()].sort()) {
    console.log(`  ${label}:`);
    for (const e of list) { console.log(`      ${e}`); }
  }
  fs.rmSync(out, { recursive: true, force: true });
}
void main();
