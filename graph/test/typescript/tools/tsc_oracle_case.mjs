/**
 * GROUND TRUTH for one case, from the TypeScript compiler itself.
 *
 * `checker.getResolvedSignature(node)` is the compiler answering the exact question
 * the engine is asked: for THIS call, which declaration did I select. It is the same
 * role javac + javap play for the Java suite — an independent authority, never the
 * thing under test restating itself.
 *
 * Emits client->client pairs only, in the label form normalize_edges.py produces, so
 * the two are directly comparable:
 *     <owner>#<name>(<paramTypes>) -> <owner>#<name>(<paramTypes>)
 * The erasure rules are mirrored deliberately: type parameters to `T`, generic
 * arguments dropped, qualified names reduced to their last segment.
 *
 * With a LIBRARY directory, the program spans both trees and the callers are still
 * only the client's. That makes the client->lib edges ground truth too, which is the
 * half of the graph a client-only suite can never check.
 *
 * usage: node tsc_oracle_case.mjs <src-dir> [lib-dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadTypeScript } from '../ground-truth/load-typescript.mjs';

const root = path.resolve(process.argv[2]);

// Through the shared loader like the rest of the stack: a bare `import ts from
// 'typescript'` resolves to whatever is nearest and dies on a property access if that
// copy is a TypeScript 7, which ships no JavaScript compiler API at all (#239).
const ts = loadTypeScript(root, { toolName: 'tsc_oracle_case' });
const libRoot = process.argv[3] ? path.resolve(process.argv[3]) : undefined;

function collect(d) {
  const out = [];
  (function walk(x) {
    for (const e of fs.readdirSync(x, { withFileTypes: true })) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  })(d);
  return out.sort();
}
const clientFiles = collect(root);
const libFiles = libRoot !== undefined && fs.existsSync(libRoot) ? collect(libRoot) : [];
const files = [...clientFiles, ...libFiles];

const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2022.d.ts'],
  strict: true,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  moduleResolution: ts.ModuleResolutionKind.Node10,
};

// ── a case may OVERRIDE these with its own src/tsconfig.json ────────────────
// The defaults above are right for almost every case and stay the default: a case
// without a tsconfig is compiled exactly as before. But some behaviour the engine has
// to reproduce is DECIDED by a compiler option, and such a case cannot be written at
// all while the oracle hardcodes the option's value.
//
// `strictBindCallApply` is the live example. lib.es5.d.ts declares `call`, `apply` and
// `bind` twice — on `Function`, and again on `CallableFunction extends Function` — and
// that flag is the only thing that decides which one the compiler answers with. With
// `strict: true` pinned here, the oracle can only ever produce the CallableFunction
// answer, so a fixture for the OTHER regime would have the oracle disagreeing with the
// engine precisely when the engine is right. The fixture would then fail on the fix and
// pass on the bug, which is worse than having no fixture.
//
// The PARSER already reads the case's tsconfig (it must, to emit the resolved flag at
// ts_module c27), so honouring it here is what makes the two sides describe the same
// program.
const caseConfig = path.join(root, 'tsconfig.json');
if (fs.existsSync(caseConfig)) {
  const read = ts.readConfigFile(caseConfig, ts.sys.readFile);
  if (read.error) {
    console.error(`case tsconfig is unreadable: ${caseConfig}`);
    process.exit(1);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  if (parsed.errors.length) {
    console.error(`case tsconfig is invalid: ${caseConfig}`);
    for (const e of parsed.errors) {
      console.error(`  ${ts.flattenDiagnosticMessageText(e.messageText, ' ')}`);
    }
    process.exit(1);
  }
  // Merged, not replaced: a case states the ONE option it is about and inherits the
  // rest, so a case tsconfig cannot silently drop `lib` and change every other answer.
  Object.assign(options, parsed.options);
  // `noLib` and the default `lib` list contradict each other, and the default is ours,
  // not the case's — so a case asking for noLib gets it rather than getting both.
  if (options.noLib) delete options.lib;
  // `files`/`include` are ignored on purpose — the file set is the directory walk above,
  // which is what the parser is handed too.
}

const program = ts.createProgram(files, options);
const checker = program.getTypeChecker();
// CALLERS come only from the client. TARGETS may be either, which is what makes the
// client->lib half measurable.
const own = new Set(clientFiles.map((f) => path.resolve(f)));
const reachable = new Set(files.map((f) => path.resolve(f)));

/** `Promise<Row>[]` -> `Promise[]`; `a.b.C` -> `C`; a type variable -> `T`. */
function simple(t) {
  t = (t || '').trim();
  let arr = '';
  while (t.endsWith('[]')) { arr += '[]'; t = t.slice(0, -2); }
  let out = '', d = 0;
  for (const ch of t) {
    if (ch === '<') d++;
    else if (ch === '>') d--;
    else if (d === 0) out += ch;
  }
  t = out.trim();
  while (t.endsWith('[]')) { arr += '[]'; t = t.slice(0, -2); }
  t = t.split('.').pop() ?? t;
  if (/^[A-Z]\d?$/.test(t)) t = 'T';
  return (t || '?') + arr;
}

/**
 * The module label the IR uses: the path below its OWN root, without its extension.
 * A library module is keyed relative to the library root, exactly as a separately
 * parsed library IR keys it — using the client's root for both would invent a
 * `../lib/x` label that no IR ever produces.
 */
function moduleName(file) {
  const base = libRoot !== undefined && path.resolve(file).startsWith(libRoot + path.sep)
    ? libRoot : root;
  return path.relative(base, file).replace(/\\/g, '/').replace(/\.(tsx|ts)$/, '');
}

/** The label for a declaration, matching normalize_edges.py. */
function labelOf(decl) {
  if (decl === undefined) return undefined;
  const sf = decl.getSourceFile();
  if (!reachable.has(path.resolve(sf.fileName))) return undefined;

  let owner;
  let p = decl.parent;
  while (p && !ts.isSourceFile(p)) {
    if (ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p)
      || ts.isClassExpression(p) || ts.isEnumDeclaration(p)) {
      owner = p.name ? p.name.text : undefined;
      break;
    }
    // A NAMESPACE OWNS ITS MEMBERS. This function claims to match normalize_edges.py
    // and did not: the engine reads ownerTypeName, which the parser sets to the
    // enclosing namespace, so it labelled `namespace outer { export function pack() }`
    // as `outer#pack` while this side fell through to the filename and said
    // `legacy#pack`. The target was the same declaration at the same line, and the
    // comparison scored it as a missing edge PLUS an extra one — accuracy understated
    // on every namespace member, and three such lines sit in 07's known-missing as
    // accepted gaps that were never gaps.
    //
    // Identifier-named only. `declare module "pkg"` is also a ModuleDeclaration and is
    // NOT an owner — its members belong to the module, which is what the fallback
    // already gives.
    if (ts.isModuleDeclaration(p) && p.name && ts.isIdentifier(p.name)) {
      owner = p.name.text;
      break;
    }
    p = p.parent;
  }
  if (owner === undefined) owner = moduleName(sf.fileName);

  let name;
  if (ts.isConstructorDeclaration(decl)) name = '<new>';
  else if (decl.name !== undefined && ts.isIdentifier(decl.name)) name = decl.name.text;
  else if (decl.name !== undefined) name = decl.name.getText(sf);
  else name = undefined;

  // An arrow or function expression is named by the const it is bound to.
  if (name === undefined && decl.parent && ts.isVariableDeclaration(decl.parent)
    && ts.isIdentifier(decl.parent.name)) {
    name = decl.parent.name.text;
  }
  if (name === undefined) {
    const line = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1;
    name = `<arrow@${line}>`;
  }
  const mods = ts.canHaveModifiers(decl) ? (ts.getModifiers(decl) ?? []) : [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) name = 'static ' + name;

  const ps = (decl.parameters ?? []).map((param) => {
    let t = param.type ? param.type.getText(sf) : '?';
    if (param.dotDotDotToken && !t.endsWith('[]')) t += '[]';
    return simple(t);
  });
  return `${owner}#${name}(${ps.join(',')})`;
}

/** The enclosing function/method of a node, as a label; the module otherwise. */
function callerOf(node) {
  let p = node.parent;
  while (p) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)
      || ts.isConstructorDeclaration(p) || ts.isArrowFunction(p)
      || ts.isFunctionExpression(p) || ts.isGetAccessorDeclaration(p)
      || ts.isSetAccessorDeclaration(p)) {
      const l = labelOf(p);
      if (l !== undefined) return l;
    }
    p = p.parent;
  }
  return `${moduleName(node.getSourceFile().fileName)}#<module-init>()`;
}

const pairs = new Set();
for (const sf of program.getSourceFiles()) {
  if (!own.has(path.resolve(sf.fileName))) continue;
  const visit = (node) => {
    // A DECORATOR APPLICATION IS A CALL, and this side did not think so. The project
    // oracle enumerates `ts.isDecorator` and calls it DECORATOR_CALL; this list omitted
    // it, so the per-case suite was blind to decorators entirely — green on them whatever
    // the engine did, while a project run counted 191 absences on a decorator-driven
    // codebase. No case had ever used a decorator, so nothing caught the disagreement.
    // Whichever side is right, both must say it, and the compiler settles it: it resolves
    // the application, because a decorator is a function invoked with (target, key,
    // descriptor). #233.
    if (ts.isCallExpression(node) || ts.isNewExpression(node)
      || ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)
      || ts.isTaggedTemplateExpression(node) || ts.isDecorator(node)) {
      let sig;
      try { sig = checker.getResolvedSignature(node); } catch { sig = undefined; }
      const target = labelOf(sig?.declaration);
      if (target !== undefined) pairs.add(`${callerOf(node)} -> ${target}`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

const diags = ts.getPreEmitDiagnostics(program)
  .filter((d) => d.file && reachable.has(path.resolve(d.file.fileName)));
if (diags.length > 0) {
  // A case that does not typecheck has an unreliable oracle: the checker still
  // answers, but it answers about a program the author did not mean to write.
  for (const d of diags.slice(0, 8)) {
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    process.stderr.write(`  tsc: ${path.relative(root, d.file.fileName)}:${line + 1} `
      + `${ts.flattenDiagnosticMessageText(d.messageText, ' ')}\n`);
  }
  process.stderr.write(`  ${diags.length} diagnostic(s) — the case does not typecheck\n`);
  process.exit(2);
}
for (const p of [...pairs].sort()) console.log(p);
