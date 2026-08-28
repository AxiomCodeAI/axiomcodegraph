#!/usr/bin/env node
/**
 * THE DISPATCH ENVELOPE — the TypeScript analogue of the JVM front end's CHA/RTA sets.
 *
 * ── WHY A SECOND BOUND IS NEEDED AT ALL ─────────────────────────────────────
 * The JVM oracle reads two different truths from compiled artifacts: the DECLARED
 * target (`invokevirtual` names one method — a miss is undeniable) and the DISPATCH
 * ENVELOPE (class-hierarchy analysis over the same hierarchy — a result outside it is
 * a demonstrable false positive). Scoring an engine against only the first punishes
 * every sound over-approximation; scoring against only the second hides real misses.
 *
 * `getResolvedSignature` gives the first. This program gives the second, and it has
 * to be built rather than read, because TypeScript ships no compiled artifact and its
 * hierarchy is not the whole story.
 *
 * ── WHY CHA DOES NOT PORT AS-IS, AND WHAT REPLACES IT ───────────────────────
 * Java CHA walks `extends`/`implements`: a call on a `Handler`-typed receiver may
 * reach any class that DECLARES itself a Handler. In TypeScript that walk sees at
 * best two fifths of the truth — 60.4% of classes satisfy their interfaces with no
 * `implements` clause, and 21.5% of assignable pairs appear in no syntax anywhere.
 * The relation that actually governs dispatch is ASSIGNABILITY, and the compiler
 * computes it exactly:
 *
 *     checker.isTypeAssignableTo(candidateInstanceType, receiverType)
 *
 * So the envelope here is: every class in the program whose instance type is
 * assignable to the receiver's type, and which declares (or inherits) the member
 * being called. That is the honest superset — a value of the receiver's type can only
 * be an instance of such a class.
 *
 * ── TWO BOUNDS, AS IN THE JVM HARNESS ───────────────────────────────────────
 *   CHA  every assignable class that has the member.
 *   RTA  the subset whose class is actually INSTANTIATED in the program (`new C()`,
 *        or a class expression). This is Rapid Type Analysis's refinement, and it is
 *        what makes the bound tight enough to be worth reporting: a class nothing
 *        constructs cannot be the runtime receiver.
 *
 * ── COST, AND THE BOUND ON IT ───────────────────────────────────────────────
 * Assignability is not cheap and the naive form is |receiver types| x |classes|. Two
 * bounds keep it tractable: candidate classes are PROJECT classes only (a library
 * class the client never constructs cannot be a runtime receiver of a client-typed
 * value, and including the whole of lib.dom would dominate the run), and the
 * per-receiver-type answer is memoised by the checker's own type id, so a receiver
 * type appearing at 400 call sites is computed once.
 *
 * Output TSV, one row per call site:
 *   callFile callLine callCol callEndLine callEndCol callKind calleeName
 *   mustTarget   file:line:col of getResolvedSignature's declaration ("" if none)
 *   chaCount     size of the assignable-class envelope
 *   rtaCount     size of the instantiated subset
 *   chaTargets   ';'-joined file:line:col, capped
 *   rtaTargets   ';'-joined file:line:col, capped
 *
 * Usage: node tsc-envelope.mjs <project-dir> <out.tsv> [maxTargets]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2]);
const outPath = path.resolve(process.argv[3]);
const MAX_TARGETS = Number(process.argv[4] ?? 64);

// The compiler is loaded from the project under analysis when it has one, so the
// oracle speaks the same language version the project is written against. A workspace
// package often has no `typescript` of its own — it is hoisted to the repository root
// — so TS_MODULE_PATH lets the harness pass the copy it already located rather than
// the oracle failing on a layout that is perfectly ordinary.
function loadTypeScript() {
  const envPath = process.env.TS_MODULE_PATH;
  if (envPath) {
    try { return createRequire(import.meta.url)(envPath); } catch { /* fall through */ }
  }
  for (const base of [projectDir, path.dirname(projectDir), path.dirname(path.dirname(projectDir))]) {
    try { return createRequire(path.join(base, 'package.json'))('typescript'); } catch { /* next */ }
  }
  return createRequire(import.meta.url)('typescript');
}
const ts = loadTypeScript();

const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error(`no tsconfig.json under ${projectDir}`);
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  path.dirname(configPath)
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function pos(sf, offset) {
  const lc = sf.getLineAndCharacterOfPosition(offset);
  return [lc.line + 1, lc.character + 1];
}
function siteOf(decl) {
  const dsf = decl.getSourceFile();
  const [l, c] = pos(dsf, decl.getStart(dsf));
  return `${path.basename(dsf.fileName)}:${l}:${c}`;
}

// ── the candidate universe: every class declared in the PROJECT ─────────────
// Plus which of them are constructed anywhere, which is the RTA refinement.
const projectClasses = [];
const instantiated = new Set();

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = path.relative(projectDir, sf.fileName);
  if (rel.startsWith('..')) continue;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const sym = node.name ? checker.getSymbolAtLocation(node.name) : node.symbol;
      if (sym) {
        const inst = checker.getDeclaredTypeOfSymbol(sym);
        if (inst) projectClasses.push({ node, sym, inst });
      }
    }
    if (ts.isNewExpression(node)) {
      const t = checker.getTypeAtLocation(node);
      const s = t?.getSymbol?.();
      if (s) instantiated.add(s);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

/**
 * Every project class assignable to `recvType`, memoised on the checker's type id.
 * The id is stable within one program, which is exactly the lifetime this cache has.
 */
const assignableCache = new Map();
function assignableClasses(recvType) {
  if (!recvType) return [];
  const id = recvType.id ?? checker.typeToString(recvType);
  const hit = assignableCache.get(id);
  if (hit) return hit;
  const out = [];
  for (const c of projectClasses) {
    try {
      if (checker.isTypeAssignableTo(c.inst, recvType)) out.push(c);
    } catch {
      // An assignability question the checker cannot answer (a circular conditional
      // type, a deferred inference) is recorded as "not in the envelope" rather than
      // guessed. Under-reporting the envelope makes the bound TIGHTER, which risks
      // calling a real dispatch possibility a false positive — so it is counted.
      envelopeErrors += 1;
    }
  }
  assignableCache.set(id, out);
  return out;
}
let envelopeErrors = 0;

/** The declarations of `name` on a type, following its own inheritance. */
function memberDeclarations(type, name) {
  const prop = checker.getPropertyOfType(type, name);
  if (!prop) return [];
  return prop.getDeclarations() ?? [];
}

const rows = [];
let sites = 0;

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = path.relative(projectDir, sf.fileName);
  if (rel.startsWith('..')) continue;

  const visit = (node) => {
    const isCall =
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxOpeningElement(node) ||
      ts.isDecorator(node);
    if (isCall) {
      sites += 1;
      const [line, col] = pos(sf, node.getStart(sf));
      const [eline, ecol] = pos(sf, node.getEnd());

      let must = '';
      let callKind = 'FUNCTION_CALL';
      let calleeName = '';
      try {
        const sig = checker.getResolvedSignature(node);
        if (sig?.declaration) must = siteOf(sig.declaration);
      } catch {
        /* left empty — an unresolvable site has no must-have target */
      }

      const cha = new Set();
      const rta = new Set();
      const expr = node.expression;
      if (ts.isNewExpression(node)) {
        callKind = 'CONSTRUCTOR_CALL';
        calleeName = expr ? expr.getText() : '';
      } else if (expr && ts.isPropertyAccessExpression(expr)) {
        callKind = 'METHOD_CALL';
        calleeName = expr.name.getText();
        // THE DISPATCH QUESTION: what can the receiver actually be at run time, and
        // which body would then run. The receiver's type is taken at the receiver
        // expression, not at the call — narrowing applies to the former.
        let recvType;
        try {
          recvType = checker.getTypeAtLocation(expr.expression);
        } catch {
          recvType = undefined;
        }
        if (recvType) {
          for (const c of assignableClasses(recvType)) {
            for (const d of memberDeclarations(c.inst, calleeName)) {
              const s = siteOf(d);
              cha.add(s);
              if (instantiated.has(c.sym)) rta.add(s);
            }
          }
        }
      } else if (expr && ts.isIdentifier(expr)) {
        calleeName = expr.getText();
      }

      // The must-have target is always inside both bounds by construction: the
      // compiler named it, so it is a dispatch possibility. Adding it explicitly
      // keeps the envelope a true SUPERSET even where the receiver is a library type
      // and no project class is assignable to it.
      if (must) {
        cha.add(must);
        rta.add(must);
      }

      // THE OVERLOAD SET IS INSIDE THE ENVELOPE, and leaving it out makes the bound
      // wrong rather than merely tight. Picking a different overload of the SAME
      // function is an over-approximation — the call does reach that function — while
      // picking a different function is a defect. The envelope has to be able to tell
      // those apart, so every declaration of the resolved symbol belongs in it.
      //
      // Measured on this corpus: `new Error(msg)` has three construct signatures
      // across lib.es5 and lib.es2022, the compiler names one, and an engine that
      // emits all three was being scored as three false positives for what is one
      // ordinary ambiguity.
      try {
        const sig = checker.getResolvedSignature(node);
        const sym = sig?.declaration?.symbol;
        for (const d of sym?.getDeclarations?.() ?? []) {
          const s = siteOf(d);
          cha.add(s);
          rta.add(s);
        }
      } catch {
        /* no overload set to add */
      }

      const chaList = [...cha].slice(0, MAX_TARGETS);
      const rtaList = [...rta].slice(0, MAX_TARGETS);
      rows.push(
        [
          rel, line, col, eline, ecol, callKind,
          calleeName.replace(/\t|\n/g, ' '),
          must,
          cha.size, rta.size,
          chaList.join(';'), rtaList.join(';'),
        ].join('\t')
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

fs.writeFileSync(
  outPath,
  ['callFile','callLine','callCol','callEndLine','callEndCol','callKind','calleeName',
   'mustTarget','chaCount','rtaCount','chaTargets','rtaTargets'].join('\t') +
    '\n' + rows.join('\n') + '\n'
);
console.error(
  `envelope: ${sites} sites, ${projectClasses.length} project classes ` +
    `(${instantiated.size} instantiated), ${assignableCache.size} distinct receiver types, ` +
    `${envelopeErrors} assignability errors -> ${outPath}`
);
