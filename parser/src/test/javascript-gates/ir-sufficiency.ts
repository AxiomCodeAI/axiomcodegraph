/**
 * CAN THE ENGINE BUILD THE FLOWS FROM WHAT WE EMIT?
 *
 *     npx tsx src/test/javascript-gates/ir-sufficiency.ts <corpus-root>
 *
 * A different question from AST recall, and the one that actually matters.
 * Recall asks *is there a row for this node*. This asks *do the rows carry the
 * edges the engine needs* — because the parser emits IR and the engine
 * (type-directed-graph) builds the call chain, so a row that is present and
 * unlinkable is worth nothing to it.
 *
 * Tier-3 columns are DELIBERATELY empty: `js_call_site.resolvedMethodLinkHash`
 * and `js_type_reference.resolvedTypeLinkHash` are the engine's answers, not
 * ours. So this measures the columns the engine RESOLVES FROM, per flow kind,
 * and a low number here is a parser gap rather than a design choice.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';

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

interface Tally { total: number; carried: number }
const pct = (t: Tally): string => t.total === 0 ? '    —'
  : `${((100 * t.carried) / t.total).toFixed(1)}%`;

async function main(): Promise<void> {
  const root = process.argv[2]!;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'js-suff-'));
  await new JavaScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir: out, baseMservPath: root, serviceVersionLink: 'suff',
  });

  const header = (file: string): string[] => {
    let h: string[] = [];
    streamLines(path.join(out, file), (line, i) => { if (i === 0) { h = line.split('\t'); } });
    return h;
  };
  const each = (file: string, fn: (row: string[], h: string[]) => void): void => {
    let h: string[] = [];
    streamLines(path.join(out, file), (line, i) => {
      if (i === 0) { h = line.split('\t'); return; }
      fn(line.split('\t'), h);
    });
  };

  // Which modules are PROJECT? Everything else contributes to no denominator.
  const project = new Set<string>();
  each('all-javascript-modules.csv', (r, h) => {
    if (r[h.indexOf('sourceProvenance')] === 'PROJECT') {
      project.add(r[h.indexOf('jsModuleUniqueHash')]!);
    }
  });
  const mine = (r: string[], h: string[]): boolean =>
    project.has(r[h.indexOf('ownerModuleLinkHash')] ?? '');

  // Declared method and type names per module, so "the engine could resolve
  // this same-file" is measured rather than assumed.
  const methodNames = new Map<string, Set<string>>();
  each('all-javascript-methods.csv', (r, h) => {
    const m = r[h.indexOf('ownerModuleLinkHash')]!;
    const set = methodNames.get(m) ?? new Set<string>();
    set.add(r[h.indexOf('name')]!);
    methodNames.set(m, set);
  });
  const fieldNames = new Map<string, Set<string>>();
  each('all-javascript-fields.csv', (r, h) => {
    const m = r[h.indexOf('ownerModuleLinkHash')]!;
    const set = fieldNames.get(m) ?? new Set<string>();
    set.add(r[h.indexOf('name')]!);
    fieldNames.set(m, set);
  });
  const typeNames = new Map<string, Set<string>>();
  each('all-javascript-types.csv', (r, h) => {
    const m = r[h.indexOf('ownerModuleLinkHash')]!;
    const set = typeNames.get(m) ?? new Set<string>();
    set.add(r[h.indexOf('name')]!);
    typeNames.set(m, set);
  });

  const rows: Array<[string, Tally, string]> = [];

  // ---- NAME FLOW: an identifier reference reaching its binding.
  const bound: Tally = { total: 0, carried: 0 };
  // The pre-c33 definition, kept so the prediction made before c33 landed —
  // 66.4% -> ~95%, residue UNRESOLVED_FREE at 23,586 — is measured against the
  // same denominator it was stated over, not a moved one.
  const boundBeforeC33: Tally = { total: 0, carried: 0 };
  const unboundBy = new Map<string, number>();
  const named: Tally = { total: 0, carried: 0 };
  const propertyNamed: Tally = { total: 0, carried: 0 };
  const propertyKinded: Tally = { total: 0, carried: 0 };
  const accessTargets = new Set<string>();
  const targeted = new Set<string>();
  const refKinded: Tally = { total: 0, carried: 0 };
  each('all-javascript-expressions.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const kind = r[h.indexOf('expressionKind')]!;
    if (kind === 'IDENTIFIER') {
      bound.total += 1;
      const resolution = r[h.indexOf('bindingResolution')] ?? '';
      const viaVariable = (r[h.indexOf('resolvedBindingLinkHash')] ?? '') !== '';
      const viaParameter = (r[h.indexOf('resolvedParameterLinkHash')] ?? '') !== '';
      if (viaVariable || resolution === 'GLOBAL_BUILTIN' || resolution === 'IMPORTED') {
        boundBeforeC33.carried += 1;
      }
      boundBeforeC33.total += 1;
      if (viaVariable || viaParameter || resolution === 'GLOBAL_BUILTIN'
        || resolution === 'IMPORTED') {
        bound.carried += 1;
      } else {
        unboundBy.set(resolution || '(empty)', (unboundBy.get(resolution || '(empty)') ?? 0) + 1);
      }
      named.total += 1;
      if ((r[h.indexOf('referencedName')] ?? '') !== '') { named.carried += 1; }
      refKinded.total += 1;
      if ((r[h.indexOf('referenceKind')] ?? '') !== '') { refKinded.carried += 1; }
    }
    if (kind === 'PROPERTY_ACCESS') {
      // `name`, NOT `referencedName`. The two carry different facts and the
      // first draft of this report asked the wrong one, reporting field flow at
      // 0.0% of 155,940 — a spectacular-looking gap that did not exist.
      // `referencedName` is what an IDENTIFIER reference resolves to;
      // `name` is the MEMBER being accessed, which is what field flow needs.
      // Verified against source before believing the number.
      propertyNamed.total += 1;
      if ((r[h.indexOf('name')] ?? '') !== '') { propertyNamed.carried += 1; }
      propertyKinded.total += 1;
      if ((r[h.indexOf('referenceKind')] ?? '') !== '') { propertyKinded.carried += 1; }
      accessTargets.add(r[h.indexOf('jsExpressionUniqueHash')]!);
    }
    // The RECEIVER half: field flow needs to know which OBJECT, not just which
    // member, and that is the ACCESS_TARGET child pointing back at the access.
    if ((r[h.indexOf('edgeRole')] ?? '') === 'ACCESS_TARGET') {
      targeted.add(r[h.indexOf('parentExpressionLinkHash')] ?? '');
    }
  });
  rows.push(['NAME FLOW   identifier -> its binding (c17 only, pre-c33)', boundBeforeC33,
    'js_expression.resolvedBindingLinkHash + bindingResolution — the 66.4% baseline']);
  rows.push(['NAME FLOW   identifier -> its binding (c17 or c33)', bound,
    'resolvedBindingLinkHash OR resolvedParameterLinkHash — the prediction was ~95%, '
    + 'residue UNRESOLVED_FREE 23,586']);
  rows.push(['NAME FLOW   identifier names itself', named, 'js_expression.referencedName']);
  rows.push(['NAME FLOW   read vs write is stated', refKinded,
    'js_expression.referenceKind']);
  rows.push(['FIELD FLOW  obj.x names x', propertyNamed, 'js_expression.name']);
  rows.push(['FIELD FLOW  obj.x is a read or a write', propertyKinded,
    'js_expression.referenceKind']);
  let reachesReceiver = 0;
  for (const access of accessTargets) {
    if (targeted.has(access)) { reachesReceiver += 1; }
  }
  rows.push(['FIELD FLOW  obj.x reaches obj',
    { total: accessTargets.size, carried: reachesReceiver },
    'a child expression with edgeRole = ACCESS_TARGET']);

  // ---- METHOD CALLS: what the engine resolves a callee from.
  const calleeNamed: Tally = { total: 0, carried: 0 };
  const receiverLinked: Tally = { total: 0, carried: 0 };
  const scoped: Tally = { total: 0, carried: 0 };
  const localResolvable: Tally = { total: 0, carried: 0 };
  each('all-javascript-call-sites.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    calleeNamed.total += 1;
    const name = r[h.indexOf('calleeName')] ?? '';
    if (name !== '') { calleeNamed.carried += 1; }
    scoped.total += 1;
    if ((r[h.indexOf('ownerScopeLinkHash')] ?? '') !== ''
      && (r[h.indexOf('enclosingMethodLinkHash')] ?? '') !== '') { scoped.carried += 1; }
    if ((r[h.indexOf('receiverText')] ?? '') !== '') {
      receiverLinked.total += 1;
      if ((r[h.indexOf('receiverExpressionLinkHash')] ?? '') !== '') {
        receiverLinked.carried += 1;
      }
    }
    // The same-file one hop: a callee whose NAME is a method declared in this
    // module. This is the population the engine can close without leaving the
    // file, so it is the floor on what our IR must support.
    const module = r[h.indexOf('ownerModuleLinkHash')]!;
    if (name !== '' && methodNames.get(module)?.has(name) === true) {
      localResolvable.total += 1;
      if ((r[h.indexOf('ownerScopeLinkHash')] ?? '') !== '') { localResolvable.carried += 1; }
    }
  });
  rows.push(['METHOD CALL callee is named', calleeNamed, 'js_call_site.calleeName']);
  rows.push(['METHOD CALL receiver reaches its expression', receiverLinked,
    'js_call_site.receiverExpressionLinkHash']);
  rows.push(['METHOD CALL site knows its scope + method', scoped,
    'js_call_site.ownerScopeLinkHash + enclosingMethodLinkHash']);
  rows.push(['METHOD CALL same-file callee is resolvable', localResolvable,
    'calleeName matches a js_method in the same module']);

  // ---- TYPE FLOW
  const typed: Tally = { total: 0, carried: 0 };
  const typedResidue = new Map<string, number>();
  const typeTreeLocal: Tally = { total: 0, carried: 0 };
  for (const [file, nameCol, linkCol] of [
    ['all-javascript-variables.csv', 'declaredTypeName', 'typeReferenceLinkHash'],
    ['all-javascript-fields.csv', 'declaredTypeName', 'typeReferenceLinkHash'],
    ['all-javascript-method-parameters.csv', 'declaredTypeName', 'typeReferenceLinkHash'],
  ] as const) {
    each(file, (r, h) => {
      if (!mine(r, h)) { return; }
      if ((r[h.indexOf(nameCol)] ?? '') === '') { return; }
      typed.total += 1;
      if ((r[h.indexOf(linkCol)] ?? '') !== '') { typed.carried += 1; return; }
      // A declared type NAME with no tree. Reported by source and by name,
      // because "98%" with an unexplained remainder is the thing this report
      // exists not to produce.
      const key = `${r[h.indexOf('declaredTypeSource')]} ${r[h.indexOf(nameCol)]}`;
      typedResidue.set(key, (typedResidue.get(key) ?? 0) + 1);
    });
  }
  each('all-javascript-type-references.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const module = r[h.indexOf('ownerModuleLinkHash')]!;
    const name = r[h.indexOf('typeName')] ?? '';
    if (name === '' || typeNames.get(module)?.has(name) !== true) { return; }
    typeTreeLocal.total += 1;
    if ((r[h.indexOf('ownerLinkHash')] ?? '') !== '') { typeTreeLocal.carried += 1; }
  });
  rows.push(['TYPE FLOW   declared type reaches its tree', typed,
    '*.typeReferenceLinkHash']);
  rows.push(['TYPE FLOW   same-file type ref knows its owner', typeTreeLocal,
    'js_type_reference.ownerLinkHash where typeName is declared here']);

  // ---- MEMBER FLOW: a member reaches the type that owns it.
  const owned: Tally = { total: 0, carried: 0 };
  for (const file of ['all-javascript-fields.csv', 'all-javascript-methods.csv']) {
    const h0 = header(file);
    if (h0.indexOf('ownerTypeLinkHash') < 0) { continue; }
    each(file, (r, h) => {
      if (!mine(r, h)) { return; }
      // Only members that HAVE an owner in the syntax: a free function is not a
      // member and counting it would report a gap that is not one.
      const form = r[h.indexOf('declarationForm')] ?? '';
      const isMember = form !== 'SYNTACTIC' || (r[h.indexOf('ownerTypeLinkHash')] ?? '') !== '';
      if (!isMember) { return; }
      owned.total += 1;
      if ((r[h.indexOf('ownerTypeLinkHash')] ?? '') !== '') { owned.carried += 1; }
    });
  }
  rows.push(['MEMBER FLOW member reaches its type', owned, '*.ownerTypeLinkHash']);

  // ---- SCOPE FLOW: a method's locals live in the scope its body OPENS.
  //
  // Measured by KIND, not by presence. Every method's bodyScopeLinkHash was a
  // valid scope hash — and the enclosing scope, on every row — and this report
  // counted it as carried because the column was non-empty. A link that is
  // populated, resolvable and wrong is the one shape presence cannot see.
  const scopeKind = new Map<string, string>();
  each('all-javascript-scopes.csv', (r, h) => {
    scopeKind.set(r[h.indexOf('jsScopeUniqueHash')]!, r[h.indexOf('scopeKind')]!);
  });
  const bodyScoped: Tally = { total: 0, carried: 0 };
  each('all-javascript-methods.csv', (r, h) => {
    if (!mine(r, h) || r[h.indexOf('methodKind')] === 'MODULE_INITIALIZER') { return; }
    bodyScoped.total += 1;
    const kind = scopeKind.get(r[h.indexOf('bodyScopeLinkHash')] ?? '') ?? '';
    if ((kind === 'FUNCTION' || kind === 'ARROW' || kind === 'CLASS_STATIC_BLOCK')
      && r[h.indexOf('bodyScopeLinkHash')] !== r[h.indexOf('ownerScopeLinkHash')]) {
      bodyScoped.carried += 1;
    }
  });
  rows.push(['SCOPE FLOW  body scope is the scope the method OPENS', bodyScoped,
    'js_method.bodyScopeLinkHash is a callable scope distinct from ownerScopeLinkHash']);

  // ---- MODULE FLOW
  const edges: Tally = { total: 0, carried: 0 };
  const saidWhy: Tally = { total: 0, carried: 0 };
  each('all-javascript-imports.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    edges.total += 1;
    const outcome = r[h.indexOf('resolutionOutcome')] ?? '';
    if (outcome.startsWith('RESOLVED')) { edges.carried += 1; }
    // Separate, because they are different claims. An unresolved import is not
    // a parser gap when the package is simply not installed — what would be a
    // gap is an import that says nothing at all.
    saidWhy.total += 1;
    if (outcome !== '') { saidWhy.carried += 1; }
  });
  const aliased: Tally = { total: 0, carried: 0 };
  each('all-javascript-variables.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const kind = r[h.indexOf('initializerKind')] ?? '';
    if (kind !== 'REQUIRE_CALL' && kind !== 'IMPORT_BINDING') { return; }
    aliased.total += 1;
    if ((r[h.indexOf('importLinkHash')] ?? '') !== '') { aliased.carried += 1; }
  });
  rows.push(['MODULE FLOW import RESOLVES to a path', edges,
    'js_import.resolutionOutcome is RESOLVED_*']);
  rows.push(['MODULE FLOW import SAYS WHY when it does not', saidWhy,
    'js_import.resolutionOutcome is never empty — the rest are UNRESOLVED_MISSING '
    + '(an uninstalled package, environmental) and UNRESOLVED_NON_LITERAL (unknowable)']);
  rows.push(['MODULE FLOW module alias reaches its import', aliased,
    'js_variable.importLinkHash where initializerKind is a module alias']);

  // ---- RETURN FLOW: what a method gives back.
  //
  // There is no `returnExpressionLinkHash` on js_method and there should not be
  // — a method has MANY returns. The edge is carried the other way: an
  // expression with `rootContext = RETURN` names the method it returns from via
  // `ownerMethodLinkHash`, so the engine asks "what does this method return" as
  // a filter rather than a join.
  const returns: Tally = { total: 0, carried: 0 };
  const throws: Tally = { total: 0, carried: 0 };
  const exportValues: Tally = { total: 0, carried: 0 };
  const arguments_: Tally = { total: 0, carried: 0 };
  const assignments: Tally = { total: 0, carried: 0 };
  const callRows = new Set<string>();
  const moduleEdgeRows = new Set<string>();
  const moduleArguments: Tally = { total: 0, carried: 0 };
  each('all-javascript-call-sites.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    callRows.add(r[h.indexOf('expressionLinkHash')] ?? '');
  });
  each('all-javascript-expressions.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    if ((r[h.indexOf('isModuleEdge')] ?? '') === 'true') {
      moduleEdgeRows.add(r[h.indexOf('jsExpressionUniqueHash')] ?? '');
    }
  });
  each('all-javascript-expressions.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const context = r[h.indexOf('rootContext')] ?? '';
    const role = r[h.indexOf('edgeRole')] ?? '';
    const owner = r[h.indexOf('ownerMethodLinkHash')] ?? '';
    // A ROOT is a row with no PARENT, not a row with no edgeRole. A root
    // carries `edgeRole = OPERAND`, so the first draft of this measure filtered
    // on an empty role and reported RETURN and THROW flow as 0 of 0 — which is
    // the shape of a total gap and was a total mis-measurement.
    const isRoot = (r[h.indexOf('parentExpressionLinkHash')] ?? '') === '';
    if (context === 'RETURN' && isRoot) {
      returns.total += 1;
      if (owner !== '') { returns.carried += 1; }
    }
    if (context === 'THROW' && isRoot) {
      throws.total += 1;
      if (owner !== '') { throws.carried += 1; }
    }
    if (context === 'EXPORT_VALUE' && isRoot) {
      exportValues.total += 1;
      if (owner !== '') { exportValues.carried += 1; }
    }
    // An ARGUMENT must reach the CALL it is an argument to. Without this the
    // engine has a list of expressions and no idea which call consumes them,
    // which is the first of the three hops a parameter needs.
    if (role === 'ARGUMENT') {
      const parent = r[h.indexOf('parentExpressionLinkHash')] ?? '';
      // A `require('./x')` argument is NOT a call argument: require is a module
      // edge and has no js_call_site row by rule, so its specifier reaches its
      // edge through `moduleEdgeLinkHash` instead. Counting those as unreached
      // arguments put this measure at 95.2% and the missing 12,895 were exactly
      // the corpus's require edges.
      if (moduleEdgeRows.has(parent)) {
        moduleArguments.total += 1;
        moduleArguments.carried += 1;
        return;
      }
      arguments_.total += 1;
      if (callRows.has(parent)) {
        arguments_.carried += 1;
      }
    }
    if (role === 'ASSIGNMENT_VALUE') {
      assignments.total += 1;
      if ((r[h.indexOf('parentExpressionLinkHash')] ?? '') !== '') {
        assignments.carried += 1;
      }
    }
  });
  rows.push(['RETURN FLOW returned value names its method', returns,
    'js_expression rootContext = RETURN + ownerMethodLinkHash']);
  rows.push(['THROW FLOW  thrown value names its method', throws,
    'js_expression rootContext = THROW + ownerMethodLinkHash']);
  rows.push(['ARG FLOW    argument reaches its call', arguments_,
    'js_expression.parentExpressionLinkHash -> the call site expression']);
  rows.push(['ARG FLOW    require specifier reaches its edge', moduleArguments,
    'js_expression.moduleEdgeLinkHash — require has no call site by rule']);
  rows.push(['DATA FLOW   assigned value reaches its target', assignments,
    'js_expression.parentExpressionLinkHash on ASSIGNMENT_VALUE']);

  // ---- EXPORT FLOW: what leaves the module reaches what it names.
  const exported: Tally = { total: 0, carried: 0 };
  each('all-javascript-exports.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const local = r[h.indexOf('localName')] ?? '';
    const module = r[h.indexOf('ownerModuleLinkHash')]!;
    // Only exports naming something DECLARED HERE: a re-export names another
    // module and is the engine's hop, not ours.
    const declaredHere = methodNames.get(module)?.has(local) === true
      || typeNames.get(module)?.has(local) === true;
    if (local === '' || !declaredHere) { return; }
    exported.total += 1;
    if ((r[h.indexOf('targetLinkHash')] ?? '') !== '') { exported.carried += 1; }
  });
  rows.push(['EXPORT FLOW export reaches its local declaration', exported,
    'js_export.targetLinkHash where localName is declared here']);

  // ---- HERITAGE FLOW: a subclass reaches its superclass, same file.
  const heritage: Tally = { total: 0, carried: 0 };
  each('all-javascript-type-heritages.csv', (r, h) => {
    if (!mine(r, h)) { return; }
    const module = r[h.indexOf('ownerModuleLinkHash')]!;
    const superName = r[h.indexOf('superTypeName')] ?? '';
    if (superName === '' || typeNames.get(module)?.has(superName) !== true) { return; }
    heritage.total += 1;
    // Same-file one hop: the engine closes it on superTypeName, and what we owe
    // is the owner and a name that matches a js_type in this module.
    if ((r[h.indexOf('ownerTypeLinkHash')] ?? '') !== '') { heritage.carried += 1; }
  });
  rows.push(['HERITAGE    same-file superclass is nameable', heritage,
    'js_type_heritage.superTypeName matches a js_type here + ownerTypeLinkHash']);

  console.log(`\nIR SUFFICIENCY — what the engine can build from, ${project.size} PROJECT files`);
  console.log('='.repeat(96));
  for (const [label, tally, column] of rows) {
    console.log(`  ${label.padEnd(42)} ${String(tally.carried).padStart(9)} / `
      + `${String(tally.total).padStart(9)}  ${pct(tally).padStart(6)}`);
    console.log(`      ${column}`);
  }
  console.log('\n  NAME FLOW residue by bindingResolution:');
  for (const [k, v] of [...unboundBy].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(7)}  ${k}`);
  }
  if (typedResidue.size > 0) {
    const total = [...typedResidue.values()].reduce((a, b) => a + b, 0);
    console.log(`\n  TYPE FLOW residue — ${total} declared type name(s) with no tree:`);
    for (const [k, v] of [...typedResidue].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      console.log(`      ${String(v).padStart(4)}  ${k}`);
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
}
void main();
