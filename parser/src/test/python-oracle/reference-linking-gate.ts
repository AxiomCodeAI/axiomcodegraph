/**
 * REFERENCE-LINKING GATE — when a name is used, does it point at the thing?
 *
 *     npx tsx src/test/python-oracle/reference-linking-gate.ts <analyzer-out>
 *
 * Five reference kinds, each measured against a denominator that EXCLUDES what
 * cannot be linked in principle. A rate over all references is meaningless: most
 * of a real file names things outside the analysis root, and counting those as
 * failures measures the corpus rather than the parser.
 *
 *   OBJECT CREATION   Foo()            -> py_type
 *   TYPE REFERENCE    x: Foo, (Foo)    -> py_type
 *   METHOD CALL       o.m(), m()       -> py_method
 *   METHOD REFERENCE  cb = self.m      -> py_method   (named, never called)
 *   VARIABLE REF      x                -> py_binding
 *
 * IN-ROOT is the denominator throughout: a reference is counted only when the
 * thing it names is declared somewhere in this analysis root. If `Foo` lives in a
 * package we did not analyse, an unlinked reference to it is correct behaviour.
 */
import * as fs from 'fs';
import * as path from 'path';

const OUT = process.argv[2] ?? '.chain-out';

function tsv(f: string): Record<string, string>[] {
  const fp = path.join(OUT, f);
  if (!fs.existsSync(fp)) return [];
  const L = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!L.length) return [];
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? ''])) as Record<string, string>;
  });
}

interface Row { total: number; inRoot: number; linked: number; wrong: number }
const mk = (): Row => ({ total: 0, inRoot: 0, linked: 0, wrong: 0 });

function main(): number {
  const exprs = tsv('all-python-expressions.csv');
  const calls = tsv('all-python-call-sites.csv');
  const types = tsv('all-python-types.csv');
  const methods = tsv('all-python-methods.csv');
  const bindings = tsv('all-python-bindings.csv');
  const trefs = tsv('all-python-type-references.csv');
  const bases = tsv('all-python-type-bases.csv');

  const typeH = new Set(types.map((t) => t['pyTypeUniqueHash']!));
  const methodH = new Set(methods.map((m) => m['pyMethodUniqueHash']!));
  const bindH = new Set(bindings.map((b) => b['pyBindingUniqueHash']!));
  const typeNames = new Set(types.map((t) => t['name']!));
  const methodNames = new Set(methods.map((m) => m['name']!));

  const R = {
    objectCreation: mk(), typeReference: mk(), methodCall: mk(),
    methodReference: mk(), variableReference: mk(), baseClass: mk(),
    typeReference2: mk(), fieldReference: mk(),
  };

  // ---- 1. object creation: a CALL whose callee names a declared class --------
  for (const c of calls) {
    const n = c['calleeName'] ?? '';
    if (!typeNames.has(n)) continue;              // not naming a class we declare
    R.objectCreation.total++;
    R.objectCreation.inRoot++;
    const h = c['resolvedCalleeHash'];
    if (h && typeH.has(h)) R.objectCreation.linked++;
    else if (h) R.objectCreation.wrong++;          // linked, but not to a py_type
  }

  // ---- 2. type references: annotations, isinstance, except, casts ------------
  for (const t of trefs) {
    R.typeReference.total++;
    if (!typeNames.has(t['typeName'] ?? '')) continue;   // names something external
    R.typeReference.inRoot++;
    const h = t['referencedTypeLinkHash'];
    if (h && typeH.has(h)) R.typeReference.linked++;
    else if (h) R.typeReference.wrong++;
  }

  // ---- 3. base classes: the edge C3 walks ------------------------------------
  for (const b of bases) {
    R.baseClass.total++;
    if (!typeNames.has(b['baseSimpleName'] ?? '')) continue;
    R.baseClass.inRoot++;
    const h = b['resolvedTypeLinkHash'];
    if (h && typeH.has(h)) R.baseClass.linked++;
    else if (h) R.baseClass.wrong++;
  }

  // ---- 4. method calls -------------------------------------------------------
  for (const c of calls) {
    const n = c['calleeName'] ?? '';
    if (typeNames.has(n)) continue;               // counted as construction above
    R.methodCall.total++;
    if (!methodNames.has(n)) continue;            // callee declared nowhere in-root
    R.methodCall.inRoot++;
    const h = c['resolvedCalleeHash'];
    if (h && methodH.has(h)) R.methodCall.linked++;
    else if (h) R.methodCall.wrong++;
  }

  // ---- 5. entity references: the parser's OWN claim, verified ---------------
  //
  // Measured through referencedEntityKind rather than by name-matching. The first
  // version matched any attribute whose last segment equalled a method name, swept
  // in 5,733 field accesses, and reported 0.0% linked with 232 mislinks — all of it
  // my filter, none of it the parser. The parser labels each reference; the honest
  // check is whether that label lands in the table it names.
  const TABLE: Record<string, Set<string>> = {
    METHOD: methodH, TYPE: typeH,
    FIELD: new Set(tsv('all-python-fields.csv').map((f) => f['pyFieldUniqueHash']!)),
  };
  for (const e of exprs) {
    const k = e['referencedEntityKind'] ?? '';
    if (!(k in TABLE)) continue;
    const row = k === 'METHOD' ? R.methodReference : k === 'TYPE' ? R.typeReference2 : R.fieldReference;
    row.total++; row.inRoot++;
    const h = e['referencedEntityHash'];
    if (!h) continue;                      // claimed a kind, produced no target
    if (TABLE[k]!.has(h)) row.linked++;
    else row.wrong++;                      // points into the WRONG table
  }

  // ---- 6. variable references ------------------------------------------------
  for (const e of exprs) {
    if (e['kind'] !== 'NAME_REFERENCE' || e['nameContext'] !== 'LOAD') continue;
    R.variableReference.total++;
    R.variableReference.inRoot++;   // a NAME load always has a binding somewhere
    const h = e['bindingLinkHash'];
    if (h && bindH.has(h)) R.variableReference.linked++;
    else if (h) R.variableReference.wrong++;
  }

  console.log(`REFERENCE LINKING — ${OUT}\n`);
  const label: Record<string, string> = {
    objectCreation: 'object creation  Foo()',
    typeReference: 'type reference   x: Foo',
    baseClass: 'base class       class C(Foo)',
    methodCall: 'method call      o.m()',
    methodReference: 'method ref       cb = o.m',
    typeReference2: 'type ref (expr)  Foo in code',
    fieldReference: 'field ref        self.x',
    variableReference: 'variable ref     x',
  };
  console.log('  reference kind              total   in-root    linked      rate   MISLINKED');
  let ir = 0, lk = 0, wr = 0;
  for (const [k, r] of Object.entries(R)) {
    const pct = r.inRoot ? ((100 * r.linked) / r.inRoot).toFixed(1) + '%' : '   n/a';
    console.log(`  ${label[k]!.padEnd(28)}${String(r.total).padStart(5)}` +
      `${String(r.inRoot).padStart(10)}${String(r.linked).padStart(10)}${pct.padStart(10)}` +
      `${String(r.wrong).padStart(12)}`);
    ir += r.inRoot; lk += r.linked; wr += r.wrong;
  }
  console.log(`  ${'TOTAL'.padEnd(28)}${''.padStart(5)}${String(ir).padStart(10)}` +
    `${String(lk).padStart(10)}${(((100 * lk) / Math.max(ir, 1)).toFixed(1) + '%').padStart(10)}` +
    `${String(wr).padStart(12)}`);
  console.log('\n  in-root = the referenced entity is declared in this analysis root.');
  console.log('  MISLINKED = a link exists but points into the wrong table. Any nonzero');
  console.log('  value here is worse than an unlinked reference: it is a false edge.');
  return wr === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main());
