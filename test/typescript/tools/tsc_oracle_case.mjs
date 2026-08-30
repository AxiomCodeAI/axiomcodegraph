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
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
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
    if (ts.isCallExpression(node) || ts.isNewExpression(node)
      || ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)
      || ts.isTaggedTemplateExpression(node)) {
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
