/**
 * For every UNRESOLVED call, can an engine derive the target from the CSVs?
 *
 * The claim under test is that the remaining method-call gap is engine work
 * rather than parser work. That is only true if the FACTS needed are already
 * emitted, so this checks it the same way a consumer would: read the CSVs, and
 * for each unresolved site ask whether a path to a concrete type exists using
 * nothing but foreign keys.
 *
 * Three verdicts, and the split is the whole point:
 *
 *   DERIVABLE   the facts are present; composing them is the engine's job
 *   NEEDS_FACT  a fact is missing that only the parser can supply — a real gap
 *   NOT_STATIC  no static analysis reaches it (getattr, a builtin receiver)
 *
 * A high DERIVABLE count supports the claim. A high NEEDS_FACT count refutes it,
 * and names what to emit.
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
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

function main(): void {
  const dir = process.argv[2]!;
  const callSites = load(dir, 'all-python-call-sites.csv');
  const expressions = load(dir, 'all-python-expressions.csv');
  const bindings = load(dir, 'all-python-bindings.csv');
  const fields = load(dir, 'all-python-fields.csv');
  const parameters = load(dir, 'all-python-method-parameters.csv');
  const types = load(dir, 'all-python-types.csv');

  const typeByName = new Map<string, Row>();
  for (const type of types) {
    typeByName.set(type.name!, type);
  }
  const bindingByHash = new Map(bindings.map(b => [b.pyBindingUniqueHash!, b]));
  const parameterByHash = new Map(parameters.map(p => [p.pyMethodParameterUniqueHash!, p]));
  const fieldsByOwnerName = new Map<string, Row[]>();
  for (const field of fields) {
    const key = `${field.pyTypeLinkHash}||${field.name}`;
    fieldsByOwnerName.set(key, [...(fieldsByOwnerName.get(key) ?? []), field]);
  }
  // Name references, by (scope, name), so a receiver can be resolved to its
  // binding exactly as the engine would.
  const nameRefByScopeAndName = new Map<string, Row>();
  for (const expression of expressions) {
    if (expression.kind === 'NAME_REFERENCE' && expression.bindingLinkHash !== '') {
      nameRefByScopeAndName.set(`${expression.pyScopeLinkHash}||${expression.literalValue}`, expression);
    }
  }

  // Base edges, so an INHERITED attribute is found where it is declared.
  const basesByType = new Map<string, string[]>();
  for (const base of load(dir, 'all-python-type-bases.csv')) {
    if (base.resolvedTypeLinkHash !== '') {
      basesByType.set(base.pyTypeLinkHash!, [
        ...(basesByType.get(base.pyTypeLinkHash!) ?? []),
        base.resolvedTypeLinkHash!,
      ]);
    }
  }
  const fieldsAlongMro = (typeHash: string, name: string): Row[] => {
    const queue = [typeHash];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const rows = fieldsByOwnerName.get(`${current}||${name}`);
      if (rows && rows.length > 0) {
        return rows;
      }
      queue.push(...(basesByType.get(current) ?? []));
    }
    return [];
  };
  /**
   * True when `name` is not on this class's own MRO, but IS on the MRO of some
   * class that inherits from it -- the MIXIN pattern.
   *
   *     class CallableMixin(Base):        self.call_args_list.append(...)
   *     class NonCallableMock(Base):      call_args_list = ...
   *     class Mock(CallableMixin, NonCallableMock): ...
   *
   * `call_args_list` genuinely does not exist on CallableMixin or anything it
   * inherits from. It exists only once a subclass combines the mixin with a
   * SIBLING base that supplies it, and which sibling that is cannot be known
   * from the mixin -- there may be several, supplying different types. Linking
   * it would mean picking one, which is a guess wearing the shape of a fact.
   *
   * So this is NOT a parser gap. It is reported as its own verdict rather than
   * folded into a generic NOT_STATIC, because "unknowable" and "knowable only
   * from the other side of a combination this parser is not looking at" are
   * different things and a reader should be able to tell them apart.
   */
  const subclassesOf = new Map<string, string[]>();
  for (const [child, parents] of basesByType) {
    for (const parent of parents) {
      subclassesOf.set(parent, [...(subclassesOf.get(parent) ?? []), child]);
    }
  }
  const mixinProvided = (typeHash: string, name: string): boolean => {
    const queue = [...(subclassesOf.get(typeHash) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (fieldsAlongMro(current, name).length > 0) {
        return true;
      }
      queue.push(...(subclassesOf.get(current) ?? []));
    }
    return false;
  };

  const methods = load(dir, 'all-python-methods.csv');
  const propertyByOwnerName = new Map<string, Row>();
  for (const method of methods) {
    if (method.methodKind === 'PROPERTY_GETTER') {
      propertyByOwnerName.set(`${method.pyTypeLinkHash}||${method.name}`, method);
    }
  }
  const propertyAlongMro = (typeHash: string, name: string): Row | undefined => {
    const queue = [typeHash];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const found = propertyByOwnerName.get(`${current}||${name}`);
      if (found) {
        return found;
      }
      queue.push(...(basesByType.get(current) ?? []));
    }
    return undefined;
  };
  const importedModuleNames = new Set(
    load(dir, 'all-python-imports.csv')
      .filter(i => i.isModuleImport === 'true')
      .map(i => i.simpleName!)
  );

  const verdicts = new Map<string, number>();
  const needs = new Map<string, number>();
  const needSamples: string[] = [];
  const typeByHash = new Map(types.map(t => [t['pyTypeUniqueHash'] ?? '', t]));
  const typeNameOf = (hash: string): string => typeByHash.get(hash)?.['name'] ?? '?';
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };

  for (const site of callSites) {
    if (site.resolvedCalleeHash !== '') {
      continue;
    }
    const receiver = site.receiverText ?? '';
    const kind = site.receiverKind!;

    if (site.resolvedCalleeKind === 'BUILTIN') {
      bump(verdicts, 'NOT_STATIC (builtin target, no py_method exists)');
      continue;
    }
    if (kind === 'LITERAL' || kind === 'SUBSCRIPT' || kind === 'UNKNOWN') {
      bump(verdicts, 'NOT_STATIC (literal/subscript/dynamic receiver)');
      continue;
    }
    if (kind === 'IMPORTED' || site.resolvedCalleeKind === 'IMPORTED') {
      bump(verdicts, 'NOT_STATIC (target outside the analysis root)');
      continue;
    }

    // A receiver rooted at `self.<attr>`: is there a py_field carrying a type?
    //
    // Two corrections to an earlier version of this check, both of which made it
    // over-report parser gaps. A MODULE-rooted receiver like `sys.stderr.write()`
    // is not an attribute of the enclosing class at all, and an INHERITED
    // attribute lives on a base — `self._loop` in Task is declared on Future — so
    // looking only at the class's own fields reported both as missing rows.
    const segments = receiver.split('.');
    const moduleRooted = importedModuleNames.has(segments[0] ?? '');
    if (kind === 'ATTRIBUTE' && moduleRooted) {
      bump(verdicts, 'NOT_STATIC (target outside the analysis root)');
      continue;
    }
    // A two-segment attribute receiver is only an attribute OF THE ENCLOSING
    // CLASS when it is rooted at `self` or `cls`. `mock.call_args.get()` and
    // `result.errors.append()` are attributes of whatever local `mock` and
    // `result` hold, and looking those names up in the enclosing class's MRO
    // finds nothing and then blames the parser for a missing py_field. On
    // unittest that was 262 of the receivers in this branch against 134 real
    // ones -- the majority of the NEEDS_FACT total was this mistake.
    const selfRooted = segments[0] === 'self' || segments[0] === 'cls';
    if (kind === 'ATTRIBUTE' && segments.length === 2 && !selfRooted) {
      // Fall through to the local-binding logic below by re-rooting on the
      // receiver's own base name, which is what actually determines the type.
      const rootRef = nameRefByScopeAndName.get(`${site.pyScopeLinkHash}||${segments[0]}`);
      const rootBinding = rootRef ? bindingByHash.get(rootRef.bindingLinkHash!) : undefined;
      bump(
        verdicts,
        rootBinding === undefined
          ? 'NOT_STATIC (receiver rooted at an unknown local)'
          : 'NOT_STATIC (attribute of a local whose type is not stated)'
      );
      continue;
    }
    if (kind === 'ATTRIBUTE' && segments.length === 2 && site.pyTypeLinkHash !== '') {
      const rows = fieldsAlongMro(site.pyTypeLinkHash!, segments[1] ?? '');
      if (rows.length === 0) {
        // A @property is a py_METHOD, not a py_field — `self.parameters` where
        // `parameters` is a property has no field row and never should. The fact
        // is emitted, in the relation that models it, and its declared return
        // type is what an engine reads.
        const property = propertyAlongMro(site.pyTypeLinkHash!, segments[1] ?? '');
        if (property) {
          bump(
            verdicts,
            property.returnTypeName !== ''
              ? 'DERIVABLE (@property with a declared return type)'
              : 'NOT_STATIC (@property, return type stated nowhere)'
          );
          continue;
        }
        if (mixinProvided(site.pyTypeLinkHash!, segments[1] ?? '')) {
          bump(verdicts, 'NOT_STATIC (mixin: attribute supplied by a sibling base)');
          continue;
        }
        bump(needs, 'py_field row absent for the attribute');
        needSamples.push(`${typeNameOf(site.pyTypeLinkHash!)}.${segments[1]} -> .${site.calleeName}()`);
        bump(verdicts, 'NEEDS_FACT');
        continue;
      }
      const annotated = rows.find(r => r.fieldTypeName !== '');
      const constructed = rows.find(r => r.initializerKind === 'CALL');
      if (annotated || constructed) {
        bump(verdicts, 'DERIVABLE (field carries a type or constructor)');
      } else {
        // NOT counted as NEEDS_FACT. The field row exists and the source never
        // states a type for it, so there is no fact for the parser to emit --
        // inventing one would be a guess presented as a link. It was being
        // booked in BOTH buckets, which is why the parser-owned total read 84
        // when the parser-owned work was 6.
        bump(verdicts, 'NOT_STATIC (attribute type stated nowhere)');
      }
      continue;
    }

    // A bare-name receiver: does the binding reach a parameter or an entity?
    if (kind === 'NAME' && receiver !== '' && !receiver.includes('.')) {
      const nameRef = nameRefByScopeAndName.get(`${site.pyScopeLinkHash}||${receiver}`);
      const binding = nameRef ? bindingByHash.get(nameRef.bindingLinkHash!) : undefined;
      if (!binding) {
        bump(needs, 'no py_binding reachable for the receiver name');
        needSamples.push(`${receiver} -> .${site.calleeName}()`);
        bump(verdicts, 'NEEDS_FACT');
        continue;
      }
      if (binding.targetEntityHash !== '') {
        const parameter = parameterByHash.get(binding.targetEntityHash!);
        if (parameter && parameter.parameterTypeName !== '') {
          bump(verdicts, 'DERIVABLE (parameter annotation)');
          continue;
        }
      }
      if (binding.declaredTypeName !== '') {
        bump(verdicts, 'DERIVABLE (binding carries a declared type)');
        continue;
      }
      bump(verdicts, 'NOT_STATIC (local with no stated or constructed type)');
      continue;
    }

    if (kind === 'CALL_RESULT') {
      bump(verdicts, 'DERIVABLE (inner call site is linked; read its return)');
      continue;
    }
    bump(verdicts, `other (${kind})`);
  }

  const total = [...verdicts.values()].reduce((a, b) => a + b, 0);
  console.log(`link feasibility over ${total} unlinked call sites`);
  for (const [verdict, count] of [...verdicts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${verdict}`);
  }
  const needsTotal = [...needs.values()].reduce((a, b) => a + b, 0);
  console.log(`\n  NEEDS_FACT total: ${needsTotal}  — these are PARSER gaps, not engine work`);
  for (const [reason, count] of [...needs.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${reason}`);
  for (const sample of [...new Set(needSamples)]) {
    console.log(`      ${sample}`);
  }
  }
}

main();
