/**
 * ENGINE-FEASIBILITY GATE — could an engine build the chain from these facts?
 *
 *     npx tsx src/test/python-oracle/engine-feasibility-gate.ts <analyzer-out>
 *
 * THIS IS THE QUESTION THE OTHER GATES GET WRONG.
 *
 * chain-gate.ts reports that we resolve 42.5% of resolvable call sites, and that
 * number quietly holds the PARSER responsible for work the schema assigns to the
 * ENGINE. Section 0.5 puts cross-module resolution, MRO, argument flow and return
 * flow in layer 4, and says the parser emits SYNTACTIC EVIDENCE ONLY. A parser
 * that resolved everything would be out of spec.
 *
 * So the real acceptance test is not "did the parser resolve it" but:
 *
 *     for every call site the parser left unresolved, are the HOPS present that
 *     an engine would have to walk to resolve it?
 *
 * Each receiver shape needs a different chain of facts, and each hop is checked
 * against the emitted tables rather than assumed:
 *
 *   x.foo()      receiver expression -> bindingLinkHash -> the binding's
 *                ASSIGNMENT_TARGET -> parent ASSIGNMENT -> sibling
 *                ASSIGNMENT_VALUE. Four hops; a break anywhere is a parser gap.
 *   self.x.foo() py_field row for x on the enclosing class, carrying an
 *                initializer or an annotation to type it from.
 *   super().m()  py_type_base rows for the enclosing class, ORDERED, because C3
 *                is undefined without order.
 *   f().m()      the callee's py_method row plus a return annotation or a
 *                RETURN_VALUE expression to infer from.
 *
 * FEASIBLE MEANS THE CHAIN REACHES A TYPE, NOT THAT IT HAS A FIRST STEP.
 *
 * The first version of this gate stopped after one hop: if a local had an
 * ASSIGNMENT_TARGET with a sibling ASSIGNMENT_VALUE, it called the site feasible.
 * A3 built an independent gate that followed the chain to the end and got a very
 * different answer, so I measured the difference: of 840 NAME receivers with a
 * fully intact hop chain, only 392 reach a value from which a type is derivable.
 * The other 448 have every fact present and lead nowhere — 316 assigned from a
 * call whose return type nobody wrote down, 92 from an attribute with no stated
 * type. "The engine can do this" was wrong about more than half of them, and it
 * matters because engine-work implies recoverable and NOT_STATIC does not.
 *
 * So the walk is now TRANSITIVE, with a depth bound and cycle detection, and a
 * chain that runs out of facts is NOT_STATIC rather than feasible.
 *
 * VERDICTS
 *   FEASIBLE      the chain reaches a concrete type — engine work, recoverable
 *   NOT_STATIC    every fact present, and the source never states the type
 *   BLOCKED       a hop is missing — a PARSER defect, and the missing fact is named
 *   UNDECIDABLE   no static answer exists at all (getattr, dynamic base)
 *
 * A high BLOCKED count is the only result that indicts the parser. A high FEASIBLE
 * count with low resolution means the engine has not been written yet, which is a
 * different problem with a different owner.
 *
 * WHAT "FEASIBLE" DOES NOT MEAN. It does not promise the engine will get the right
 * answer. It says the FACTS ARE PRESENT — the engine still has to implement C3, the
 * scope walk and argument flow, and can implement them wrongly. This gate says only
 * that the parser is not the thing standing in the way.
 *
 * TRUST THIS NUMBER ONLY BECAUSE IT IS MUTATION-TESTED. It read 97.7%, then 85.2%,
 * then 99.5% across three revisions of the CHECKER, on identical parser output —
 * first because three verdicts were assumed rather than checked, then because the
 * checks were stricter than an engine would be, looking for a field on the exact
 * type instead of walking the MRO, and demanding an ASSIGNMENT_TARGET in the same
 * scope for a global. A feasibility checker is exactly as good as its model of the
 * engine, so it is verified by DELETING FACT CLASSES and confirming the verdict
 * moves:
 *
 *     baseline                            35 blocked
 *     strip ASSIGNMENT_TARGET parents  2,223
 *     delete every py_field row          760
 *     delete every py_type_base row      130
 *     blank every bindingLinkHash      2,223
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

type V = 'FEASIBLE' | 'BLOCKED' | 'UNDECIDABLE' | 'NOT_STATIC';
interface Verdict { verdict: V; reason: string }

function main(): number {
  const calls = tsv('all-python-call-sites.csv');
  const exprs = tsv('all-python-expressions.csv');
  const methods = tsv('all-python-methods.csv');
  const fields = tsv('all-python-fields.csv');
  const bases = tsv('all-python-type-bases.csv');
  const types = tsv('all-python-types.csv');

  const exprByHash = new Map(exprs.map((e) => [e['pyExpressionUniqueHash']!, e]));

  // binding -> the ASSIGNMENT_TARGET expressions that write it
  const targetsOfBinding = new Map<string, Record<string, string>[]>();
  for (const e of exprs) {
    if (e['edgeRole'] !== 'ASSIGNMENT_TARGET' || !e['bindingLinkHash']) continue;
    const k = e['bindingLinkHash']!;
    (targetsOfBinding.get(k) ?? targetsOfBinding.set(k, []).get(k)!).push(e);
  }
  // parent ASSIGNMENT -> its ASSIGNMENT_VALUE child
  const valueOfParent = new Map<string, Record<string, string>>();
  for (const e of exprs) {
    if (e['edgeRole'] === 'ASSIGNMENT_VALUE' && e['parentExpressionHash']) {
      valueOfParent.set(e['parentExpressionHash']!, e);
    }
  }
  // fields by (owning type, name)
  const fieldByKey = new Map(fields.map((f) => [`${f['pyTypeLinkHash']}|${f['name']}`, f]));
  // ordered bases per type
  const basesOfType = new Map<string, Record<string, string>[]>();
  for (const b of bases) {
    const k = b['pyTypeLinkHash']!;
    (basesOfType.get(k) ?? basesOfType.set(k, []).get(k)!).push(b);
  }
  // methods that carry a return annotation or an explicit RETURN_VALUE expression
  // parameters, so "binding has no assignment" can be VERIFIED as a parameter
  // rather than assumed to be one
  const params = tsv('all-python-method-parameters.csv');
  const paramBindings = new Set(params.map((p) => p['bindingLinkHash']).filter(Boolean) as string[]);
  // scope chain + imports, for bare-name resolution
  const scopes = tsv('all-python-scopes.csv');
  const bindings = tsv('all-python-bindings.csv');
  const bindingNamesByScope = new Map<string, Set<string>>();
  for (const b of bindings) {
    const k = b['pyScopeLinkHash']!;
    (bindingNamesByScope.get(k) ?? bindingNamesByScope.set(k, new Set()).get(k)!).add(b['name']!);
  }
  const imports = tsv('all-python-imports.csv');
  const importedNames = new Set<string>();
  for (const i of imports) {
    for (const k of ['importedName', 'alias', 'packageOrTypeName', 'memberName']) {
      if (i[k]) importedNames.add(i[k]!);
    }
  }
  const methodNames = new Set(methods.map((m) => m['name']!));
  const typeNamesAll = new Set(types.map((t) => t['name']!));
  const bindingByHash = new Map(bindings.map((b) => [b['pyBindingUniqueHash']!, b]));
  // Fields by NAME, ignoring the owning type. An engine resolving self.x walks the
  // MRO, so a field declared on a BASE class is found — keying strictly on the
  // enclosing type reported 145 sites as blocked that an engine resolves fine.
  const fieldNames = new Set(fields.map((f) => f['name']!));
  // Origins that bind from a source OTHER than an assignment. Each is legitimate
  // and each names its own mechanism, so an engine knows what to walk.
  const NON_ASSIGN_ORIGINS = new Set([
    'FOR_TARGET', 'WITH_TARGET', 'TUPLE_UNPACK_TARGET', 'COMPREHENSION_TARGET',
    'EXCEPT_TARGET', 'WALRUS', 'IMPORT', 'CLASS_DEF', 'FUNCTION_DEF', 'MULTIPLE',
  ]);
  // Binding kinds resolved by walking OUT of this scope rather than within it.
  const OUTER_SCOPE_KINDS = new Set(['GLOBAL_IMPLICIT', 'GLOBAL_EXPLICIT', 'FREE', 'IMPORTED']);
  const typeNames = new Set(types.map((t) => t['name']!));


  /**
   * Follow an assigned value to a concrete type, transitively.
   *
   * Returns the reason it terminated. Depth-bounded and cycle-guarded: `a = b;
   * b = a` is legal Python and would otherwise spin.
   */
  function typeOfValue(v: Record<string, string> | undefined, seen: Set<string>, depth: number): Verdict {
    if (!v) return { verdict: 'NOT_STATIC', reason: 'assignment has no value expression' };
    if (depth > 6) return { verdict: 'NOT_STATIC', reason: 'value chain exceeded 6 hops' };
    const id = v['pyExpressionUniqueHash'] ?? '';
    if (seen.has(id)) return { verdict: 'NOT_STATIC', reason: 'value chain is cyclic' };
    seen.add(id);

    if (v['inferredTypeName']) return { verdict: 'FEASIBLE', reason: 'value carries inferredTypeName' };
    const last = (v['dottedPath'] || '').split('.').pop() ?? '';
    if (v['kind'] === 'CALL' && typeNamesAll.has(last))
      return { verdict: 'FEASIBLE', reason: 'value is a constructor call' };
    if (v['kind'] === 'CALL') {
      // One more hop: does the callee state a return type anywhere?
      const m = methods.find((x) => x['name'] === last);
      if (m && (m['returnTypeName'] || m['returnBaseType']))
        return { verdict: 'FEASIBLE', reason: 'value is a call whose callee states a return type' };
      return { verdict: 'NOT_STATIC', reason: 'value is a call whose return type is never stated' };
    }
    if (v['kind'] === 'NAME_REFERENCE' && v['bindingLinkHash']) {
      const tg = targetsOfBinding.get(v['bindingLinkHash']!) ?? [];
      for (const t of tg) {
        const nxt = valueOfParent.get(t['parentExpressionHash'] ?? '');
        const r = typeOfValue(nxt, seen, depth + 1);
        if (r.verdict === 'FEASIBLE') return r;
      }
      return { verdict: 'NOT_STATIC', reason: 'value is a name whose own type is never stated' };
    }
    if (v['kind'] === 'ATTRIBUTE_ACCESS')
      return { verdict: 'NOT_STATIC', reason: 'value is an attribute with no stated type' };
    return { verdict: 'NOT_STATIC', reason: `value is ${v['kind']} — no type stated` };
  }

  /** Can an engine type the value a local binding was last assigned? */
  function localHops(recvExprHash: string): Verdict {
    const recv = exprByHash.get(recvExprHash);
    if (!recv) return { verdict: 'BLOCKED', reason: 'receiver has no py_expression row' };
    const b = recv['bindingLinkHash'];
    if (!b) return { verdict: 'BLOCKED', reason: 'receiver expression carries no bindingLinkHash' };
    const tgts = targetsOfBinding.get(b);
    if (!tgts?.length) {
      // Assumed to be a parameter on the first pass. VERIFY it — a binding with
      // neither an assignment nor a parameter row is a hole, and calling it
      // "engine work" would hide 1,290 sites behind an assumption.
      if (paramBindings.has(b)) {
        return { verdict: 'FEASIBLE', reason: 'parameter binding; needs arg->param flow (engine)' };
      }
      // Still too strict on the second pass. A binding can legitimately have no
      // ASSIGNMENT_TARGET *in this scope*:
      //   GLOBAL_IMPLICIT / FREE  the write lives in an enclosing scope, and the
      //                           engine reaches it by walking the scope chain —
      //                           644 + 55 sites, every one of them resolvable
      //   IMPORTED                py_import carries the target
      //   FOR_TARGET etc.         bound from an iterable or context manager, and
      //                           bindingOrigin NAMES which
      // Only a binding that is none of these has genuinely nothing to walk.
      const bind = bindingByHash.get(b);
      const kind = bind?.['bindingKind'] ?? '';
      const origin = bind?.['bindingOrigin'] ?? '';
      if (!bind) return { verdict: 'BLOCKED', reason: 'bindingLinkHash points at no py_binding row' };
      if (OUTER_SCOPE_KINDS.has(kind)) {
        // Same depth-1 flaw as the local case, one branch over: the scope walk
        // finds the outer binding, but if THAT binding's value states no type the
        // chain still ends in nothing. Follow it by name to a module-level write.
        const nm = bind['name'] ?? '';
        for (const [bh, tg] of targetsOfBinding) {
          const ob = bindingByHash.get(bh);
          if (!ob || ob['name'] !== nm || bh === b) continue;
          for (const t of tg) {
            const r = typeOfValue(valueOfParent.get(t['parentExpressionHash'] ?? ''), new Set(), 0);
            if (r.verdict === 'FEASIBLE')
              return { verdict: 'FEASIBLE', reason: `${kind} — outer write yields a type` };
          }
        }
        if (kind === 'IMPORTED')
          return { verdict: 'FEASIBLE', reason: 'IMPORTED — py_import carries the target' };
        return { verdict: 'NOT_STATIC', reason: `${kind} — outer write states no type` };
      }
      if (origin === 'IMPORT')
        return { verdict: 'FEASIBLE', reason: 'IMPORT origin; py_import carries the target' };
      if (NON_ASSIGN_ORIGINS.has(origin))
        // FOR_TARGET, WITH_TARGET, TUPLE_UNPACK and friends bind an ELEMENT. Naming
        // the mechanism is not the same as knowing the element type, and for an
        // unannotated iterable nothing in the source states it.
        return { verdict: 'NOT_STATIC', reason: `bound by ${origin}; element type never stated` };
      return { verdict: 'BLOCKED', reason: `binding ${kind}/${origin} has no assignment, parameter or named origin` };
    }
    const withParent = tgts.filter((t) => t['parentExpressionHash']);
    if (!withParent.length) return { verdict: 'BLOCKED', reason: 'ASSIGNMENT_TARGET has no parent — value unreachable' };
    const withValue = withParent.filter((t) => valueOfParent.has(t['parentExpressionHash']!));
    if (!withValue.length) return { verdict: 'BLOCKED', reason: 'no sibling ASSIGNMENT_VALUE under the parent' };
    // Intact is not enough — follow it to a type or admit it reaches none.
    let last: Verdict = { verdict: 'NOT_STATIC', reason: 'no assigned value yields a type' };
    for (const t of withValue) {
      const r = typeOfValue(valueOfParent.get(t['parentExpressionHash']!), new Set(), 0);
      if (r.verdict === 'FEASIBLE') return r;
      last = r;
    }
    return last;
  }

  const tally = new Map<string, Map<string, number>>();
  const note = (kind: string, v: Verdict) => {
    const m = tally.get(kind) ?? tally.set(kind, new Map()).get(kind)!;
    const k = `${v.verdict}: ${v.reason}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  };

  let resolved = 0, undecidable = 0, feasible = 0, blocked = 0, notStatic = 0;
  for (const c of calls) {
    if (c['resolvedCalleeHash']) { resolved++; continue; }
    if (c['resolvedCalleeKind'] === 'BUILTIN' || c['callKind'] === 'DYNAMIC_CALL') {
      undecidable++; continue;
    }
    const rk = c['receiverKind'] ?? '';
    let v: Verdict;
    switch (rk) {
      case 'NAME':
        v = localHops(c['receiverExpressionLinkHash'] ?? '');
        break;
      case 'SELF': {
        // self.m() needs the enclosing class and its ordered bases for the MRO walk
        const t = c['pyTypeLinkHash'];
        if (!t) v = { verdict: 'BLOCKED', reason: 'SELF call not attributed to a py_type' };
        else if (!types.some((x) => x['pyTypeUniqueHash'] === t))
          v = { verdict: 'BLOCKED', reason: 'enclosing py_type row missing' };
        else if (!methodNames.has(c['calleeName'] ?? ''))
          // Not a defect: the method is inherited from something outside the root.
          v = { verdict: 'UNDECIDABLE', reason: 'method declared nowhere in-root — inherited externally' };
        else if (!basesOfType.has(t) && !methods.some((m) => m['pyTypeLinkHash'] === t && m['name'] === c['calleeName']))
          v = { verdict: 'BLOCKED', reason: 'not on this type and the type has no py_type_base rows to walk' };
        else v = { verdict: 'FEASIBLE', reason: 'type + bases present; MRO walk is engine work' };
        break;
      }
      case 'ATTRIBUTE': {
        // self.x.m() — need a py_field row for x with something to type it from
        const rt = (c['receiverText'] ?? '');
        const m = /^self\.([A-Za-z_]\w*)/.exec(rt);
        if (!m) { v = { verdict: 'FEASIBLE', reason: 'non-self attribute chain; needs upstream typing (engine)' }; break; }
        const t = c['pyTypeLinkHash'] ?? '';
        const f = fieldByKey.get(`${t}|${m[1]}`);
        // Not on THIS type is not the same as missing. An engine resolving self.x
        // walks the MRO, so a field declared on a base is reachable — checking only
        // the enclosing type blamed the parser for 145 sites it emits correctly.
        // Inherited: find the row wherever it lives, then judge it on whether it
        // states a TYPE. "A field of this name exists somewhere" was the last
        // over-generous clause here — it let 525 untyped attributes read as engine
        // work when nothing in the source ever says what they hold.
        const anyF = f ?? fields.find((x) => x['name'] === m[1]);
        if (!anyF) v = { verdict: 'BLOCKED', reason: `no py_field row for self.${m[1]} anywhere` };
        else if (anyF['fieldTypeName'] || anyF['initializerKind'] === 'CONSTRUCTOR_CALL'
                 || anyF['hasAnnotation'] === 'true')
          v = { verdict: 'FEASIBLE', reason: 'py_field states a type or a constructor initializer' };
        else v = { verdict: 'NOT_STATIC', reason: 'py_field exists but states no type' };
        break;
      }
      case 'SUPER': {
        const t = c['pyTypeLinkHash'] ?? '';
        const bs = basesOfType.get(t);
        if (!bs?.length) v = { verdict: 'BLOCKED', reason: 'super() with no py_type_base rows' };
        else if (bs.some((b) => !b['position'])) v = { verdict: 'BLOCKED', reason: 'py_type_base rows unordered — C3 undefined' };
        else v = { verdict: 'FEASIBLE', reason: 'ordered bases present; C3 is engine work' };
        break;
      }
      case 'CALL_RESULT': {
        // Verify the INNER call has a py_expression row to hang a return type on.
        // Without it there is no node for the engine to attach the inferred type to.
        const inner = exprByHash.get(c['receiverExpressionLinkHash'] ?? '');
        if (!inner) v = { verdict: 'BLOCKED', reason: 'inner call has no py_expression row' };
        else v = { verdict: 'FEASIBLE', reason: 'inner call node present; return-type flow is engine work' };
        break;
      }
      case 'NONE': {
        // Assumed feasible on the first pass. Verify the name is REACHABLE by the
        // walk an engine would perform: bound in some scope, imported, or the name
        // of a declared method or type. Otherwise there is nothing to find and
        // calling it engine work is passing the buck.
        const n = c['calleeName'] ?? '';
        // "A binding with this name exists somewhere in the corpus" was the single
        // most inflationary clause in this gate — it credited 991 of 1,157 bare
        // names as engine work. A binding is not a CALLEE: to link `foo()` the
        // engine needs a declared py_method or py_type named foo, or an import
        // that resolves to one. Only 166 of the 1,157 qualify.
        if (!n) v = { verdict: 'UNDECIDABLE', reason: 'call with no callee name' };
        else if (methodNames.has(n) || typeNames.has(n))
          v = { verdict: 'FEASIBLE', reason: 'callee declared in-root; scope walk is engine work' };
        else if (importedNames.has(n))
          v = { verdict: 'FEASIBLE', reason: 'callee imported; py_import carries the target' };
        else v = { verdict: 'UNDECIDABLE', reason: 'no declared callee of that name in-root' };
        break;
      }
      case 'LITERAL':
      case 'SUBSCRIPT':
        v = { verdict: 'UNDECIDABLE', reason: `${rk} receiver reaches a C type or container element` };
        break;
      default:
        v = { verdict: 'FEASIBLE', reason: `${rk} receiver` };
    }
    note(rk, v);
    if (v.verdict === 'FEASIBLE') feasible++;
    else if (v.verdict === 'BLOCKED') blocked++;
    else if (v.verdict === 'NOT_STATIC') notStatic++;
    else undecidable++;
  }

  const tot = calls.length;
  console.log(`ENGINE FEASIBILITY — ${tot} call sites in ${OUT}\n`);
  console.log(`  already resolved by the parser      ${String(resolved).padStart(5)}`);
  console.log(`  UNDECIDABLE (no callee can exist)   ${String(undecidable).padStart(5)}`);
  console.log(`  NOT_STATIC  (source never says)     ${String(notStatic).padStart(5)}   <- nobody can fix`);
  console.log(`  FEASIBLE (hops present, engine's)   ${String(feasible).padStart(5)}`);
  console.log(`  BLOCKED  (a fact is MISSING)        ${String(blocked).padStart(5)}   <- the parser's bill`);
  // NOT_STATIC leaves the denominator: no engine and no parser can recover a type
  // the source never states, so counting it as a miss measures the CORPUS.
  const answerable = resolved + feasible + blocked;
  console.log(`\n  Of ${answerable} statically answerable sites, an engine could reach`);
  console.log(`  ${resolved + feasible} = ${((100 * (resolved + feasible)) / answerable).toFixed(1)}% with the facts as they stand today.`);

  console.log('\n  BY RECEIVER SHAPE');
  for (const [kind, m] of [...tally].sort((a, b) =>
    [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`\n    ${kind}  (${n})`);
    for (const [r, c] of [...m].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(c).padStart(5)}  ${r}`);
    }
  }
  console.log('');
  return blocked === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main());
