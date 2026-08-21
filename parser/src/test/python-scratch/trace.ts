/**
 * Traceability check: can every fact reach a py_method and a py_module by
 * JOINS ALONE, with polymorphic FKs resolved in the relation their discriminator
 * names?
 *
 * This is the assumption deferral rests on. The 11 deferred relations all point
 * INTO the spine (py_decorator carries ownerHash, pyMethodLinkHash,
 * pyExpressionLinkHash, pyModuleLinkHash), so they can only attach if those
 * spine PKs exist and the chain from any expression up to its owning method is
 * unbroken.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

interface Row { cols: string[]; }

export function trace(file: string) {
  const facts = new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(file, 'utf8'), filePath: file, baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SV',
  });
  const problems: string[] = [];
  if (!facts.module) return { problems, checked: 0 };

  const modulePk = facts.module.getHash();
  const moduleInit = facts.module.toCsv().split('\t')[19]!;
  const types = new Map(facts.types.map(t => [t.getHash(), t.toCsv().split('\t')]));
  const methods = new Map(facts.methods.map(m => [m.getHash(), m.toCsv().split('\t')]));
  const scopes = new Map(facts.scopes.map(s => [s.getHash(), s.toCsv().split('\t')]));
  const exprs = new Map(facts.expressions.map(e => [e.getHash(), e.toCsv().split('\t')]));
  const bindings = new Map(facts.bindings.map(b => [b.getHash(), b.toCsv().split('\t')]));
  const params = new Map(facts.methodParameters.map(p => [p.getHash(), p.getPyMethodLinkHash()]));

  /** Resolve an expression owner to a py_method PK, by joins only. */
  const ownerToMethod = (kind: string, hash: string): string | null => {
    switch (kind) {
      case 'METHOD':
      case 'LAMBDA':
        return methods.has(hash) ? hash : null;
      case 'METHOD_PARAMETER': {
        // A parameter owns its annotation subtree; it reaches a method via its
        // own FK.
        const owner = params.get(hash);
        return owner && methods.has(owner) ? owner : null;
      }
      case 'TYPE': {
        const t = types.get(hash);
        // A class body's code is owned by its synthetic <classbody> method.
        return t && methods.has(t[16]!) ? t[16]! : null;
      }
      case 'MODULE':
        return hash === modulePk && methods.has(moduleInit) ? moduleInit : null;
      default:
        return null;
    }
  };

  let checked = 0;

  // ---- every expression reaches a method, then the module
  for (const [hash, cols] of exprs) {
    checked++;
    const method = ownerToMethod(cols[3]!, cols[5]!);
    if (!method) {
      problems.push(`EXPR->METHOD unreachable: ownerKind=${cols[3]} kind=${cols[0]} line ${cols[20]}`);
      continue;
    }
    if (methods.get(method)![21] !== modulePk) {
      problems.push(`METHOD->MODULE broken for ${methods.get(method)![0]}`);
    }
    // scope must resolve, and its chain must reach the single root
    if (!scopes.has(cols[24]!)) {
      problems.push(`EXPR->SCOPE unresolved at line ${cols[20]}`);
    }
    // a bound name must resolve to a real binding
    if (cols[26] !== '' && !bindings.has(cols[26]!)) {
      problems.push(`EXPR->BINDING unresolved at line ${cols[20]}`);
    }
    void hash;
  }

  // ---- every call site reaches its caller method and its expression
  for (const c of facts.callSites) {
    checked++;
    const cols = c.toCsv().split('\t');
    if (!exprs.has(cols[5]!)) problems.push(`CALL->EXPR unresolved ${cols[1]}`);
    if (!methods.has(cols[8]!)) problems.push(`CALL->METHOD unresolved ${cols[1]}`);
    if (cols[9] !== '' && !types.has(cols[9]!)) problems.push(`CALL->TYPE unresolved ${cols[1]}`);
    if (cols[6] !== '' && !exprs.has(cols[6]!)) problems.push(`CALL->RECEIVER_EXPR unresolved ${cols[1]}`);
  }

  // ---- every method reaches its scope, its module, and its type when it has one
  for (const [, cols] of methods) {
    checked++;
    if (cols[22] !== '' && !scopes.has(cols[22]!)) problems.push(`METHOD->SCOPE unresolved ${cols[0]}`);
    if (cols[7] !== '' && !types.has(cols[7]!)) problems.push(`METHOD->TYPE unresolved ${cols[0]}`);
    if (cols[20] !== '' && !methods.has(cols[20]!)) problems.push(`METHOD->ENCLOSING unresolved ${cols[0]}`);
    if (cols[23] !== '' && !bindings.has(cols[23]!)) problems.push(`METHOD->BINDING unresolved ${cols[0]}`);
  }

  // ---- every type reaches its scope, its <classbody>, its module
  for (const [, cols] of types) {
    checked++;
    if (cols[15] !== '' && !scopes.has(cols[15]!)) problems.push(`TYPE->SCOPE unresolved ${cols[0]}`);
    if (cols[16] !== '' && !methods.has(cols[16]!)) problems.push(`TYPE->CLASSBODY unresolved ${cols[0]}`);
    if (cols[13] !== '' && !types.has(cols[13]!)) problems.push(`TYPE->ENCLOSING unresolved ${cols[0]}`);
    if (cols[12] !== modulePk) problems.push(`TYPE->MODULE broken ${cols[0]}`);
  }

  // ---- scope chain terminates at exactly one root, no cycles
  for (const [hash, cols] of scopes) {
    checked++;
    let current: string | undefined = cols[4]!;
    let hops = 0;
    while (current !== '' && current !== undefined) {
      if (++hops > scopes.size + 1) { problems.push(`SCOPE cycle from ${cols[1]}`); break; }
      current = scopes.get(current)?.[4];
      if (current === undefined) { problems.push(`SCOPE->PARENT dangling from ${cols[1]}`); break; }
    }
    void hash;
  }

  return { problems, checked };
}

if (require.main === module) {
  const files = process.argv.slice(2);
  let total = 0, bad = 0;
  for (const f of files) {
    const r = trace(f);
    total += r.checked; bad += r.problems.length;
    console.log(`${(r.problems.length === 0 ? 'TRACEABLE' : r.problems.length + ' BROKEN').padEnd(14)} ${path.basename(f).padEnd(40)} ${r.checked} links`);
    r.problems.slice(0, 6).forEach(p => console.log('     ' + p));
  }
  console.log(`\n${total} links checked, ${bad} broken`);
  process.exit(bad === 0 ? 0 : 1);
}
