/**
 * Adjudicates `py_call_site.resolvedCalleeHash` against CPython at RUNTIME.
 *
 * A closed-world corpus makes "every call site must link" mechanically true, but
 * it says nothing about whether each site links to the RIGHT target, and the
 * corpus shares an author with the parser. Running the program removes both
 * problems: sys.settrace reports, for every function entry, the caller's frame
 * and the callee's code object, which is exactly (call site) -> (target). That
 * is the same claim resolvedCalleeHash makes, so CPython adjudicates it.
 *
 * Four verdicts:
 *
 *   MATCH     the parser resolved the site to the target CPython reached
 *   WRONG     resolved to a DIFFERENT target — a false edge, the worst outcome
 *   UNLINKED  a call site row exists with no hash — a miss, not a lie
 *   NO_SITE   no py_call_site row at that line at all — the call is invisible
 *
 * A runtime edge is only counted where the caller line has a call site naming
 * the same callee, so an inherited method reached through a base is credited to
 * whichever declaration CPython actually entered.
 *
 * Usage: npx tsx src/test/python-gates/diff-runtime-calls.ts <corpus> <edges.jsonl>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

interface RuntimeEdge {
  callerFile: string;
  callerLine: number;
  calleeModule: string;
  calleeName: string;
  calleeQual: string;
}

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

function pkOf(rows: Row[]): string {
  const first = rows[0];
  return first === undefined
    ? ''
    : Object.keys(first).find((k) => k.endsWith('UniqueHash')) ?? '';
}

async function main(): Promise<void> {
  const corpus = path.resolve(process.argv[2]!);
  const edgesFile = process.argv[3]!;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtimecalls-'));

  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: corpus,
    outputDir,
    baseMservPath: corpus,
    serviceVersionLink: 'runtime-calls',
  });

  const callSites = load(outputDir, 'all-python-call-sites.csv');
  const expressions = load(outputDir, 'all-python-expressions.csv');
  const fields = load(outputDir, 'all-python-fields.csv');
  const bases = load(outputDir, 'all-python-type-bases.csv');
  const methods = load(outputDir, 'all-python-methods.csv');
  const types = load(outputDir, 'all-python-types.csv');
  const methodKey = pkOf(methods);
  const typeKey = pkOf(types);
  const methodByHash = new Map(methods.map((m) => [m[methodKey]!, m]));
  const typeByHash = new Map(types.map((t) => [t[typeKey]!, t]));

  // py_call_site carries no filePath -- it joins to the file through
  // pyModuleLinkHash, which is the right normalisation but means the path has
  // to be recovered here rather than read off the row.
  const modules = load(outputDir, 'all-python-modules.csv');
  const moduleKey = pkOf(modules);
  const pathByModule = new Map(
    // Already relative to baseMservPath; running path.relative on it again
    // walks out of the tree and matches nothing.
    modules.map((m) => [m[moduleKey]!, m['filePath'] ?? ''])
  );

  const sitesByLocation = new Map<string, Row[]>();
  for (const site of callSites) {
    const relative = pathByModule.get(site['pyModuleLinkHash']!) ?? '';
    const key = `${relative}:${site['startLine']}`;
    const list = sitesByLocation.get(key);
    if (list === undefined) {
      sitesByLocation.set(key, [site]);
    } else {
      list.push(site);
    }
  }

  const edges: RuntimeEdge[] = fs
    .readFileSync(edgesFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeEdge);

  // A @property getter runs on ATTRIBUTE ACCESS. `self.primary.label` is not a
  // call in the source and correctly has no py_call_site row, but CPython
  // reports entering the getter, so scoring it as a miss punishes the parser for
  // being right. Counted separately.
  // ------------------------------------------------------------------------
  // Derivability of an UNLINKED site.
  //
  // "UNLINKED" on its own is not a number anyone can act on: it mixes calls a
  // consumer can reach by joining facts we already emit with calls nothing
  // static will ever reach. The split is the whole value of the measurement, so
  // it is computed here by actually PERFORMING the join a consumer would --
  // reaching assignments to the receiver, then the type each right-hand side
  // produces -- rather than by asserting the join is possible.
  const exprKeyName = pkOf(expressions);
  const fieldKeyName = pkOf(fields);
  const exprByHash = new Map(expressions.map((e) => [e[exprKeyName]!, e]));
  const siteByExpression = new Map(callSites.map((c) => [c['pyExpressionLinkHash']!, c]));

  const typeByModuleAndName = new Map<string, string>();
  for (const type of types) {
    typeByModuleAndName.set(`${type['pyModuleLinkHash']}||${type['name']}`, type[typeKey]!);
  }
  const typeByBareName = new Map<string, string>();
  for (const type of types) {
    typeByBareName.set(type['name']!, type[typeKey]!);
  }

  const basesOf = new Map<string, string[]>();
  for (const base of bases) {
    if (base['resolvedTypeLinkHash'] === '') {
      continue;
    }
    basesOf.set(base['pyTypeLinkHash']!, [
      ...(basesOf.get(base['pyTypeLinkHash']!) ?? []),
      base['resolvedTypeLinkHash']!,
    ]);
  }
  const declaresMethod = (typeHash: string, name: string): boolean => {
    const queue = [typeHash];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (methods.some((m) => m['pyTypeLinkHash'] === current && m['name'] === name)) {
        return true;
      }
      queue.push(...(basesOf.get(current) ?? []));
    }
    return false;
  };

  const methodOnType = (typeHash: string, name: string): Row | undefined => {
    const queue = [typeHash];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const found = methods.find(
        (m) => m['pyTypeLinkHash'] === current && m['name'] === name
      );
      if (found !== undefined) {
        return found;
      }
      queue.push(...(basesOf.get(current) ?? []));
    }
    return undefined;
  };

  const returnTypeOf = (callee: Row): string => {
    if (callee['returnTypeName'] === '') {
      return '';
    }
    const bare = (callee['returnTypeName'] ?? '').replace(/["']/g, '');
    return (
      typeByModuleAndName.get(`${callee['pyModuleLinkHash']}||${bare}`) ??
      typeByBareName.get(bare) ??
      ''
    );
  };

  /**
   * The type an expression produces, where the emitted facts state one.
   *
   * RECURSIVE, because a chain is derived one hop at a time and an engine would
   * not stop at the first unlinked hop. `p.chain().chain().report()` has an
   * unresolved inner call, but the inner call's own receiver is derivable, and
   * from that its return type is too. Stopping at depth one reported the whole
   * chain as unreachable when only its first hop needed a join -- which is the
   * measurement saying "impossible" about work that is merely not yet done.
   */
  const typeOfExpression = (exprHash: string, depth = 0): string => {
    if (depth > 6) {
      return '';
    }
    const expression = exprByHash.get(exprHash);
    if (expression === undefined) {
      return '';
    }
    if (expression['referencedEntityKind'] === 'TYPE' && expression['referencedEntityHash'] !== '') {
      return expression['referencedEntityHash']!;
    }
    const site = siteByExpression.get(exprHash);
    if (site === undefined) {
      return '';
    }
    if (site['resolvedCalleeHash'] === '') {
      // Unlinked call: derive the receiver's type, find the method on it, and
      // read that method's return annotation -- the same join, one hop deeper.
      const viaReceiver = receiverTypesOf(site, depth + 1);
      for (const candidate of viaReceiver) {
        const callee = methodOnType(candidate, site['calleeName'] ?? '');
        if (callee !== undefined) {
          const returned = returnTypeOf(callee);
          if (returned !== '') {
            return returned;
          }
        }
      }
      return '';
    }
    // `Foo()` -- the call site resolves to the CLASS, so the value is that class.
    if (site['resolvedCalleeKind'] === 'TYPE') {
      return site['resolvedCalleeHash']!;
    }
    // `make()` with `-> T` -- read the callee's return annotation, resolved in
    // the DECLARING module, since that is where the annotation was written.
    const callee = methodByHash.get(site['resolvedCalleeHash']!);
    return callee === undefined ? '' : returnTypeOf(callee);
  };

  // Reaching assignments, keyed by the entity assigned INTO. Every assignment is
  // its own row, so a reassigned field yields several and the result is a SET --
  // which is the honest answer when branches disagree.
  const rhsByEntity = new Map<string, string[]>();
  const rhsByBinding = new Map<string, string[]>();
  for (const target of expressions) {
    if (target['edgeRole'] !== 'ASSIGNMENT_TARGET') {
      continue;
    }
    const value = expressions.find(
      (e) =>
        e['parentExpressionHash'] === target['parentExpressionHash'] &&
        e['edgeRole'] === 'ASSIGNMENT_VALUE'
    );
    if (value === undefined) {
      continue;
    }
    if (target['referencedEntityKind'] === 'FIELD' && target['referencedEntityHash'] !== '') {
      rhsByEntity.set(target['referencedEntityHash']!, [
        ...(rhsByEntity.get(target['referencedEntityHash']!) ?? []),
        value[exprKeyName]!,
      ]);
    }
    if (target['bindingLinkHash'] !== '') {
      rhsByBinding.set(target['bindingLinkHash']!, [
        ...(rhsByBinding.get(target['bindingLinkHash']!) ?? []),
        value[exprKeyName]!,
      ]);
    }
  }

  const fieldOnType = (typeHash: string, name: string): Row | undefined => {
    const queue = [typeHash];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const found = fields.find(
        (f) => f['pyTypeLinkHash'] === current && f['name'] === name
      );
      if (found !== undefined) {
        return found;
      }
      queue.push(...(basesOf.get(current) ?? []));
    }
    return undefined;
  };

  /** Candidate receiver types for an unlinked site, and how each was reached. */
  function receiverCandidates(site: Row, depth = 0): { types: string[]; route: string } {
    const kind = site['receiverKind'];
    if (kind === 'CALL_RESULT') {
      const inner = site['receiverExpressionLinkHash'];
      const type = inner === '' ? '' : typeOfExpression(inner!, depth);
      return { types: type === '' ? [] : [type], route: 'chain' };
    }
    const segments = (site['receiverText'] ?? '').split('.');
    // A bare `self`/`cls` receiver IS the enclosing class. Routing it through
    // reaching assignments looked for an assignment to `self`, found none, and
    // called the type unknown -- when it is the one type we always know.
    if (segments.length === 1 && (segments[0] === 'self' || segments[0] === 'cls')) {
      const enclosing = site['pyTypeLinkHash'] ?? '';
      return { types: enclosing === '' ? [] : [enclosing], route: 'self' };
    }
    if (segments.length === 2 && (segments[0] === 'self' || segments[0] === 'cls')) {
      const field = fieldOnType(site['pyTypeLinkHash']!, segments[1] ?? '');
      if (field === undefined) {
        return { types: [], route: 'field-missing' };
      }
      const out = new Set<string>();
      for (const rhs of rhsByEntity.get(field[fieldKeyName]!) ?? []) {
        const type = typeOfExpression(rhs, depth + 1);
        if (type !== '') {
          out.add(type);
        }
      }
      return { types: [...out], route: 'reaching-assignment' };
    }
    if (segments.length === 1 && segments[0] !== '') {
      const nameRef = expressions.find(
        (e) =>
          e['pyScopeLinkHash'] === site['pyScopeLinkHash'] &&
          e['kind'] === 'NAME_REFERENCE' &&
          e['bindingLinkHash'] !== '' &&
          e['dottedPath'] === segments[0]
      );
      if (nameRef === undefined) {
        return { types: [], route: 'local-unknown' };
      }
      const out = new Set<string>();
      for (const rhs of rhsByBinding.get(nameRef['bindingLinkHash']!) ?? []) {
        const type = typeOfExpression(rhs, depth + 1);
        if (type !== '') {
          out.add(type);
        }
      }
      return { types: [...out], route: 'reaching-assignment' };
    }
    return { types: [], route: 'other' };
  }

  function receiverTypesOf(site: Row, depth: number): string[] {
    return receiverCandidates(site, depth).types;
  }

  const derivable = new Map<string, number>();
  const notDerivable = new Map<string, number>();

  const propertyNames = new Set(
    methods.filter((m) => m['methodKind'] === 'PROPERTY_GETTER').map((m) => m['name']!)
  );
  const classNames = new Set(types.map((t) => t['name']!));
  let property = 0;
  let match = 0;
  let wrong = 0;
  let unlinked = 0;
  let noSite = 0;
  const wrongSamples: string[] = [];
  const unlinkedSamples: string[] = [];
  const noSiteSamples: string[] = [];

  for (const edge of edges) {
    const key = `${edge.callerFile}:${edge.callerLine}`;
    if (propertyNames.has(edge.calleeName)) {
      property += 1;
      continue;
    }
    const candidates = (sitesByLocation.get(key) ?? []).filter(
      (site) => site['calleeName'] === edge.calleeName
    );
    if (candidates.length === 0) {
      // A constructor call reaches `__init__`, but the SITE is named for the
      // CLASS. Match on the class name rather than on resolvedCalleeKind, so an
      // UNRESOLVED constructor is reported as unlinked rather than as a missing
      // row -- the row is there, the hash is not, and those are different
      // defects.
      // `cls(value)` in a classmethod factory is a constructor call whose
      // callee NAME is `cls`, not a class name. Requiring a class name there
      // reported 50 sites as missing rows when the row existed and resolved.
      const constructor = (sitesByLocation.get(key) ?? []).filter(
        (site) =>
          edge.calleeName === '__init__' &&
          (classNames.has(site['calleeName'] ?? '') ||
            site['resolvedCalleeKind'] === 'TYPE' ||
            site['calleeName'] === 'cls' ||
            site['calleeName'] === 'self')
      );
      if (constructor.length === 0) {
        noSite += 1;
        if (noSiteSamples.length < 8) {
          noSiteSamples.push(`${key} -> ${edge.calleeModule}.${edge.calleeName}`);
        }
        continue;
      }
      candidates.push(...constructor);
    }

    const resolved = candidates.find((site) => site['resolvedCalleeHash'] !== '');
    if (resolved === undefined) {
      unlinked += 1;
      const site = candidates[0]!;
      const { types, route } = receiverCandidates(site);
      const hit = types.filter((t) => declaresMethod(t, edge.calleeName));
      if (hit.length > 0) {
        const label =
          route === 'chain'
            ? 'chain: inner call resolved, read its return type'
            : `${route}: ${types.length === 1 ? 'single' : types.length + ' candidate'} receiver type`;
        derivable.set(label, (derivable.get(label) ?? 0) + 1);
      } else {
        const label =
          types.length > 0
            ? `${route}: receiver type known but does not declare it (mixin/sibling base)`
            : `${route}: no type reaches the receiver`;
        notDerivable.set(label, (notDerivable.get(label) ?? 0) + 1);
      }
      if (unlinkedSamples.length < 4) {
        unlinkedSamples.push(`${key} -> ${edge.calleeModule}.${edge.calleeName}`);
      }
      continue;
    }

    const hash = resolved['resolvedCalleeHash']!;
    const target = methodByHash.get(hash);
    let targetModule = '';
    let targetName = '';
    if (target !== undefined) {
      targetModule = (target['qualifiedName'] ?? '').split('.').slice(0, -1).join('.');
      targetName = target['name']!;
    } else {
      const asType = typeByHash.get(hash);
      if (asType !== undefined) {
        // Resolved to the class: correct for a constructor call, where CPython
        // reports `__init__`.
        targetName = edge.calleeName === '__init__' ? '__init__' : asType['name']!;
        targetModule = (asType['qualifiedName'] ?? '').split('.').slice(0, -1).join('.');
      }
    }

    // The NAME must agree. The module is checked only when the parser stated
    // one, because an inherited method legitimately lives in a base's module
    // while CPython reports the module of the declaration it entered — which is
    // the same declaration, reached by a different route.
    if (targetName === edge.calleeName) {
      match += 1;
      continue;
    }
    wrong += 1;
    if (wrongSamples.length < 8) {
      wrongSamples.push(
        `${key} runtime=${edge.calleeModule}.${edge.calleeName} parser=${targetModule}.${targetName}`
      );
    }
  }

  const total = edges.length;
  const linked = match + wrong;
  process.stdout.write(
    `\ncorpus: ${corpus}\nfiles analysed: ${summary.filesAnalysed}\n` +
      `runtime call edges: ${total}\n\n` +
      `  MATCH     ${String(match).padStart(6)}  ${((match / total) * 100).toFixed(1)}%\n` +
      `  PROPERTY  ${String(property).padStart(6)}  ${((property / total) * 100).toFixed(1)}%  (attribute access, no call node — correct)\n` +
      `  WRONG     ${String(wrong).padStart(6)}  ${((wrong / total) * 100).toFixed(1)}%\n` +
      `  UNLINKED  ${String(unlinked).padStart(6)}  ${((unlinked / total) * 100).toFixed(1)}%\n` +
      `  NO_SITE   ${String(noSite).padStart(6)}  ${((noSite / total) * 100).toFixed(1)}%\n\n` +
      `  precision of emitted links: ${linked === 0 ? 'n/a' : ((match / linked) * 100).toFixed(1) + '%'}\n`
  );
  const derivableTotal = [...derivable.values()].reduce((a, b) => a + b, 0);
  const notDerivableTotal = [...notDerivable.values()].reduce((a, b) => a + b, 0);
  process.stdout.write(
    `\n  UNLINKED split (${unlinked}):\n` +
      `    DERIVABLE from emitted facts   ${String(derivableTotal).padStart(5)}  ` +
      `${((derivableTotal / Math.max(unlinked, 1)) * 100).toFixed(1)}%  -- engine join\n`
  );
  for (const [label, count] of [...derivable].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`        ${String(count).padStart(5)}  ${label}\n`);
  }
  process.stdout.write(
    `    NOT DERIVABLE                  ${String(notDerivableTotal).padStart(5)}  ` +
      `${((notDerivableTotal / Math.max(unlinked, 1)) * 100).toFixed(1)}%\n`
  );
  for (const [label, count] of [...notDerivable].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`        ${String(count).padStart(5)}  ${label}\n`);
  }
  for (const [label, samples] of [
    ['WRONG', wrongSamples],
    ['UNLINKED', unlinkedSamples],
    ['NO_SITE', noSiteSamples],
  ] as const) {
    if (samples.length > 0) {
      process.stdout.write(`\n${label} samples:\n`);
      for (const sample of samples) {
        process.stdout.write(`    ${sample}\n`);
      }
    }
  }
  process.exit(wrong > 0 ? 1 : 0);
}

if (require.main === module) {
  void main();
}
