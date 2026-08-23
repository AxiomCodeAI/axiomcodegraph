/**
 * Can CHA, RTA and interprocedural flow be BUILT from the emitted CSVs alone?
 *
 * Resolving a virtual call to one target is the engine's job, not this parser's.
 * What the parser owes is the substrate those algorithms consume. Asserting that
 * the substrate is sufficient is worth nothing, so this builds the algorithms —
 * with no parser objects, only the CSVs a consumer gets — and reports what is
 * CONSTRUCTIBLE and what is BLOCKED for want of a fact.
 *
 * Five things are attempted, each a prerequisite of the next:
 *
 *   1. C3 linearisation per class          — needs base ORDER, not just edges
 *   2. Override edges across the hierarchy — the concrete part of CHA
 *   3. CHA candidate sets for virtual calls
 *   4. RTA: the instantiated-type set, and CHA narrowed by it
 *   5. Argument -> parameter binding, the interprocedural flow edge
 *
 * A step that cannot be built names the missing fact. A step that can is engine
 * work by definition and is reported with the numbers to show it ran.
 */
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, string>;

function load(dir: string, file: string): Row[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    return [];
  }
  const lines = fs.readFileSync(full, 'utf-8').split('\n').filter(Boolean);
  const header = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

function pk(rows: Row[]): string {
  const first = rows[0];
  if (first === undefined) {
    return '';
  }
  return Object.keys(first).find((k) => k.endsWith('UniqueHash')) ?? '';
}

function main(): void {
  const dir = process.argv[2]!;
  const types = load(dir, 'all-python-types.csv');
  const bases = load(dir, 'all-python-type-bases.csv');
  const methods = load(dir, 'all-python-methods.csv');
  const params = load(dir, 'all-python-method-parameters.csv');
  const callSites = load(dir, 'all-python-call-sites.csv');
  const expressions = load(dir, 'all-python-expressions.csv');

  const typeKey = pk(types);
  const methodKey = pk(methods);
  const exprKey = pk(expressions);
  const typeName = new Map(types.map((t) => [t[typeKey]!, t['name']!]));

  // ---- 1. C3 linearisation ------------------------------------------------
  // Requires base ORDER. py_type_base.position is what makes `class C(A, B)`
  // distinguishable from `class C(B, A)`, and C3 is undefined without it.
  const basesOf = new Map<string, string[]>();
  let unorderedBases = 0;
  for (const base of bases) {
    if (base['resolvedTypeLinkHash'] === '') {
      continue;
    }
    if (base['position'] === '') {
      unorderedBases += 1;
    }
    const list = basesOf.get(base['pyTypeLinkHash']!) ?? [];
    list.push(base['resolvedTypeLinkHash']!);
    basesOf.set(base['pyTypeLinkHash']!, list);
  }
  for (const [child] of basesOf) {
    const ordered = bases
      .filter((b) => b['pyTypeLinkHash'] === child && b['resolvedTypeLinkHash'] !== '')
      .sort((a, b) => Number(a['position']) - Number(b['position']))
      .map((b) => b['resolvedTypeLinkHash']!);
    basesOf.set(child, ordered);
  }

  const mroCache = new Map<string, string[]>();
  const linearise = (hash: string, stack: Set<string>): string[] => {
    const cached = mroCache.get(hash);
    if (cached !== undefined) {
      return cached;
    }
    if (stack.has(hash)) {
      return [hash];
    }
    stack.add(hash);
    const parents = basesOf.get(hash) ?? [];
    const sequences = parents.map((p) => linearise(p, stack)).concat([parents]);
    const result: string[] = [hash];
    const pending = sequences.map((s) => [...s]);
    for (;;) {
      const nonEmpty = pending.filter((s) => s.length > 0);
      if (nonEmpty.length === 0) {
        break;
      }
      let head: string | undefined;
      for (const sequence of nonEmpty) {
        const candidate = sequence[0]!;
        const inTail = nonEmpty.some((other) => other.slice(1).includes(candidate));
        if (!inTail) {
          head = candidate;
          break;
        }
      }
      if (head === undefined) {
        break; // inconsistent hierarchy; C3 genuinely fails, not our gap
      }
      result.push(head);
      for (const sequence of pending) {
        if (sequence[0] === head) {
          sequence.shift();
        }
      }
    }
    stack.delete(hash);
    mroCache.set(hash, result);
    return result;
  };
  let mroBuilt = 0;
  let mroDeep = 0;
  for (const type of types) {
    const mro = linearise(type[typeKey]!, new Set());
    mroBuilt += 1;
    mroDeep = Math.max(mroDeep, mro.length);
  }

  // ---- 2. override edges --------------------------------------------------
  const methodsByType = new Map<string, Row[]>();
  for (const method of methods) {
    const owner = method['pyTypeLinkHash']!;
    if (owner === '') {
      continue;
    }
    const list = methodsByType.get(owner) ?? [];
    list.push(method);
    methodsByType.set(owner, list);
  }
  const overrides: Array<[string, string]> = [];
  for (const [owner, list] of methodsByType) {
    const mro = mroCache.get(owner) ?? [owner];
    for (const method of list) {
      for (const ancestor of mro.slice(1)) {
        const found = (methodsByType.get(ancestor) ?? []).find(
          (m) => m['name'] === method['name']
        );
        if (found !== undefined) {
          overrides.push([method[methodKey]!, found[methodKey]!]);
          break;
        }
      }
    }
  }

  // ---- 3. CHA -------------------------------------------------------------
  const subclassesOf = new Map<string, string[]>();
  for (const [child, parents] of basesOf) {
    for (const parent of parents) {
      subclassesOf.set(parent, [...(subclassesOf.get(parent) ?? []), child]);
    }
  }
  const descendants = (root: string): string[] => {
    const out: string[] = [];
    const queue = [root];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      out.push(current);
      queue.push(...(subclassesOf.get(current) ?? []));
    }
    return out;
  };

  // ---- 4. RTA -------------------------------------------------------------
  // The instantiated set is exactly the call sites whose callee resolves to a
  // TYPE: `Foo()` is a constructor call and py_call_site says so.
  const instantiated = new Set<string>();
  for (const site of callSites) {
    if (site['resolvedCalleeKind'] === 'TYPE' && site['resolvedCalleeHash'] !== '') {
      instantiated.add(site['resolvedCalleeHash']!);
    }
  }

  let chaTotal = 0;
  let chaCandidates = 0;
  let rtaCandidates = 0;
  let chaMonomorphic = 0;
  let chaResolved = 0;
  let nonSelf = 0;
  let nonSelfAlreadyLinked = 0;
  let nonSelfWithEvidence = 0;
  let nonSelfNoEvidence = 0;

  // Every (scope, name) for which the parser emitted SOMETHING that states a
  // type: a declared field type, an annotated parameter, an isinstance or
  // except narrowing, or an assignment from a constructor. This is the input a
  // flow pass needs; whether it propagates correctly is the engine's business.
  const receiverTypeEvidence = new Set<string>();
  const typeRefs = load(dir, 'all-python-type-references.csv');
  const bindings = load(dir, 'all-python-bindings.csv');
  const bindingKey = pk(bindings);
  const bindingScopeName = new Map(
    bindings.map((b) => [b[bindingKey]!, `${b['pyScopeLinkHash']}||${b['name']}`])
  );
  for (const reference of typeRefs) {
    if (reference['referencedTypeLinkHash'] === '') {
      continue;
    }
    if (reference['referenceOwnerKind'] === 'BINDING') {
      const key = bindingScopeName.get(reference['typeReferenceOwnerHash']!);
      if (key !== undefined) {
        receiverTypeEvidence.add(key);
      }
    }
  }
  for (const parameter of params) {
    if (parameter['parameterBaseType'] !== '' && parameter['bindingLinkHash'] !== '') {
      const key = bindingScopeName.get(parameter['bindingLinkHash']!);
      if (key !== undefined) {
        receiverTypeEvidence.add(key);
      }
    }
  }
  // `isinstance(x, Foo)` narrows x. The reference is owned by the CALL, since
  // that is where the narrowing holds, so the binding is reached through the
  // call's first argument -- one hop, and the hop is the reason the reference is
  // owned by the call rather than the variable.
  const exprByHash = new Map(expressions.map((e) => [e[exprKey]!, e]));
  for (const reference of typeRefs) {
    if (
      reference['context'] !== 'ISINSTANCE_TYPE' ||
      reference['referencedTypeLinkHash'] === ''
    ) {
      continue;
    }
    const call = exprByHash.get(reference['typeReferenceOwnerHash']!);
    if (call === undefined) {
      continue;
    }
    const firstArg = expressions.find(
      (e) =>
        e['parentExpressionHash'] === call[exprKey] &&
        e['edgeRole'] === 'ARGUMENT' &&
        e['position'] === '0'
    );
    if (firstArg !== undefined && firstArg['bindingLinkHash'] !== '') {
      const key = bindingScopeName.get(firstArg['bindingLinkHash']!);
      if (key !== undefined) {
        receiverTypeEvidence.add(key);
      }
    }
  }

  for (const site of callSites) {
    // `x = Foo()` -- the binding the constructor result flows into.
    if (site['resolvedCalleeKind'] !== 'TYPE') {
      continue;
    }
    const expr = expressions.find((e) => e[exprKey] === site['pyExpressionLinkHash']);
    if (expr === undefined || expr['edgeRole'] !== 'ASSIGNMENT_VALUE') {
      continue;
    }
    const target = expressions.find(
      (e) =>
        e['parentExpressionHash'] === expr['parentExpressionHash'] &&
        e['edgeRole'] === 'ASSIGNMENT_TARGET'
    );
    if (target !== undefined && target['bindingLinkHash'] !== '') {
      const key = bindingScopeName.get(target['bindingLinkHash']!);
      if (key !== undefined) {
        receiverTypeEvidence.add(key);
      }
    }
  }
  let rtaMonomorphic = 0;
  for (const site of callSites) {
    // ONLY self/cls dispatch. For those the receiver's static type IS the
    // enclosing class, so CHA can run with no type inference at all. For any
    // other receiver the static type has to come from flow first, and using the
    // enclosing class there is simply wrong -- it is what made the earlier
    // feasibility numbers overstate parser gaps, so it is not repeated here.
    // Those sites are counted separately, by whether the parser emitted
    // anything a flow pass could start from.
    const selfDispatch =
      site['receiverKind'] === 'SELF' ||
      site['receiverText'] === 'self' ||
      site['receiverText'] === 'cls';
    const staticType = site['pyTypeLinkHash']!;
    if (!selfDispatch) {
      if (site['calleeName'] !== '' && site['receiverText'] !== '') {
        nonSelf += 1;
        if (site['resolvedCalleeHash'] !== '') {
          nonSelfAlreadyLinked += 1;
        } else if (receiverTypeEvidence.has(`${site['pyScopeLinkHash']}||${site['receiverText']}`)) {
          nonSelfWithEvidence += 1;
        } else {
          nonSelfNoEvidence += 1;
        }
      }
      continue;
    }
    if (staticType === '' || site['calleeName'] === '') {
      continue;
    }
    chaTotal += 1;
    // CHA: for every possible RUNTIME type of the receiver -- the static type
    // and every subclass of it -- resolve the name the way Python will, by
    // walking that subclass's own MRO. Looking only DOWN the hierarchy finds
    // nothing whenever the method is inherited rather than redeclared, which is
    // the common case and made this read 536 candidates for 6604 sites.
    const targets = new Set<string>();
    for (const runtime of descendants(staticType)) {
      for (const ancestor of mroCache.get(runtime) ?? [runtime]) {
        const found = (methodsByType.get(ancestor) ?? []).find(
          (m) => m['name'] === site['calleeName']
        );
        if (found !== undefined) {
          targets.add(found[methodKey]!);
          break;
        }
      }
    }
    const cha = [...targets];
    // RTA narrows the receiver's possible runtime types to those actually
    // constructed somewhere in the program, then re-resolves.
    const rtaTargets = new Set<string>();
    for (const runtime of descendants(staticType)) {
      if (!instantiated.has(runtime) && runtime !== staticType) {
        continue;
      }
      for (const ancestor of mroCache.get(runtime) ?? [runtime]) {
        const found = (methodsByType.get(ancestor) ?? []).find(
          (m) => m['name'] === site['calleeName']
        );
        if (found !== undefined) {
          rtaTargets.add(found[methodKey]!);
          break;
        }
      }
    }
    const rta = [...rtaTargets];
    chaCandidates += cha.length;
    rtaCandidates += rta.length;
    if (cha.length >= 1) {
      chaResolved += 1;
    }
    if (cha.length === 1) {
      chaMonomorphic += 1;
    }
    if (rta.length === 1) {
      rtaMonomorphic += 1;
    }
  }

  // ---- 5. argument -> parameter -------------------------------------------
  const paramsByMethod = new Map<string, Row[]>();
  for (const parameter of params) {
    const owner = parameter['pyMethodLinkHash']!;
    const list = paramsByMethod.get(owner) ?? [];
    list.push(parameter);
    paramsByMethod.set(owner, list);
  }
  for (const [, list] of paramsByMethod) {
    list.sort((a, b) => Number(a['position']) - Number(b['position']));
  }
  const argsByParent = new Map<string, Row[]>();
  for (const expression of expressions) {
    if (expression['edgeRole'] !== 'ARGUMENT' && expression['edgeRole'] !== 'KEYWORD_ARGUMENT') {
      continue;
    }
    const parent = expression['parentExpressionHash']!;
    const list = argsByParent.get(parent) ?? [];
    list.push(expression);
    argsByParent.set(parent, list);
  }
  let argEdges = 0;
  let argBlockedNoCallee = 0;
  let argBlockedNoParams = 0;
  let constructorHops = 0;
  for (const site of callSites) {
    const args = argsByParent.get(site['pyExpressionLinkHash']!) ?? [];
    if (args.length === 0) {
      continue;
    }
    if (site['resolvedCalleeHash'] === '') {
      argBlockedNoCallee += args.length;
      continue;
    }
    let declared = paramsByMethod.get(site['resolvedCalleeHash']!);
    if (declared === undefined && site['resolvedCalleeKind'] === 'TYPE') {
      // A constructor call resolves to the TYPE, and a type has no parameters --
      // `__init__` does. The hop is one join on py_method.pyTypeLinkHash, so it
      // is engine work, but it has to be TAKEN or every `Foo(a, b)` looks like a
      // call with no parameter list.
      const init = (methodsByType.get(site['resolvedCalleeHash']!) ?? []).find(
        (m) => m['name'] === '__init__'
      );
      if (init !== undefined) {
        declared = paramsByMethod.get(init[methodKey]!);
        constructorHops += 1;
      }
    }
    if (declared === undefined) {
      argBlockedNoParams += args.length;
      continue;
    }
    const receiverOffset = declared.some((p) => p['isReceiverParameter'] === 'true') ? 1 : 0;
    for (const argument of args) {
      if (argument['edgeRole'] === 'KEYWORD_ARGUMENT') {
        const named = declared.find((p) => p['paramName'] === argument['argumentKeywordName']);
        if (named !== undefined) {
          argEdges += 1;
        }
        continue;
      }
      const slot = declared[Number(argument['position']) + receiverOffset];
      if (slot !== undefined) {
        argEdges += 1;
      }
    }
  }

  const out: string[] = [];
  out.push(`\nsubstrate built from CSVs alone — ${types.length} types, ${methods.length} methods\n`);
  out.push(`1. C3 linearisation      : ${mroBuilt} classes linearised, deepest MRO ${mroDeep}`);
  out.push(`     bases missing position: ${unorderedBases}  ${unorderedBases === 0 ? '(order preserved)' : '(C3 UNDEFINED)'}`);
  out.push(`2. override edges        : ${overrides.length} built across the hierarchy`);
  out.push(`3. CHA virtual calls     : ${chaTotal} sites, ${chaCandidates} candidate targets`);
  out.push(`     sites with >=1 candidate: ${chaResolved} (${((chaResolved / Math.max(chaTotal, 1)) * 100).toFixed(1)}%)`);
  out.push(`     monomorphic by CHA    : ${chaMonomorphic} (${((chaMonomorphic / Math.max(chaTotal, 1)) * 100).toFixed(1)}%)`);
  out.push(`4. RTA instantiated set  : ${instantiated.size} types constructed somewhere`);
  out.push(`     candidates after RTA  : ${rtaCandidates} (from ${chaCandidates})`);
  out.push(`     monomorphic by RTA    : ${rtaMonomorphic} (${((rtaMonomorphic / Math.max(chaTotal, 1)) * 100).toFixed(1)}%)`);
  out.push(`   non-self receivers       : ${nonSelf} sites (need a type from FLOW first)`);
  out.push(`     already linked by parser: ${nonSelfAlreadyLinked}`);
  out.push(`     parser emitted type evidence for the receiver: ${nonSelfWithEvidence}`);
  out.push(`     no evidence anywhere -- genuinely dynamic: ${nonSelfNoEvidence}`);
  out.push(`5. argument -> parameter : ${argEdges} edges bound`);
  out.push(`     blocked, callee unresolved: ${argBlockedNoCallee}`);
  out.push(`     via constructor hop type -> __init__: ${constructorHops}`);
  out.push(`     blocked, callee has no py_method_parameter rows: ${argBlockedNoParams}`);
  out.push('');
  process.stdout.write(out.join('\n') + '\n');

  const sample = overrides.slice(0, 5).map(([child, parent]) => {
    const c = methods.find((m) => m[methodKey] === child)!;
    const p = methods.find((m) => m[methodKey] === parent)!;
    return `    ${typeName.get(c['pyTypeLinkHash']!)}.${c['name']} overrides ${typeName.get(p['pyTypeLinkHash']!)}.${p['name']}`;
  });
  if (sample.length > 0) {
    process.stdout.write('override edges (sample):\n' + sample.join('\n') + '\n');
  }
}

if (require.main === module) {
  main();
}
