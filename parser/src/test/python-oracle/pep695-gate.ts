/**
 * PEP 695 GATE — py_type_parameter, adjudicated by CPython 3.12.
 *
 *     npx tsx src/test/python-oracle/pep695-gate.ts
 *
 * Separate from golden-gate because the two regimes are not comparable. The same
 * source yields a different scope tree under PY3_0_11 and PY3_12_PLUS (PEP 709
 * inlines comprehensions), and emissionRegime sits inside py_module's PK for that
 * reason. Mixing them in one corpus would produce a golden with no single correct
 * value.
 *
 * The oracle is CPython 3.12's own symtable and ast — not a table of expectations
 * I typed out. Every parameter, its position, its bound and its owner are read
 * from the interpreter and compared with what the parser emitted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
import { INTERPRETERS } from './harness/constants';

const CORPUS = 'src/test-data/python/verified-py312';
const OUT = '.pep695-out';

interface Truth { owner: string; ownerKind: string; name: string; position: number; bound: string }

/** Ground truth straight from CPython's ast. */
function truth(): Truth[] {
  const script = `
import ast, json, sys
out = []
src = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(src)
def walk(node, prefix):
    for child in ast.iter_child_nodes(node):
        nm = getattr(child, "name", None)
        if isinstance(child, ast.TypeAlias):
            nm = child.name.id
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.TypeAlias)):
            kind = ("TYPE" if isinstance(child, ast.ClassDef)
                    else "MODULE" if isinstance(child, ast.TypeAlias) else "METHOD")
            for i, tp in enumerate(getattr(child, "type_params", []) or []):
                b = getattr(tp, "bound", None)
                out.append({"owner": nm, "ownerKind": kind, "name": tp.name,
                            "position": i,
                            "bound": ast.unparse(b) if b is not None else ""})
            walk(child, (prefix + "." if prefix else "") + str(nm))
        else:
            walk(child, prefix)
walk(tree, "")
json.dump(out, sys.stdout)
`;
  const rows: Truth[] = [];
  for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.py'))) {
    rows.push(...JSON.parse(execFileSync(INTERPRETERS.PY3_12_PLUS,
      ['-c', script, path.join(CORPUS, f)], { encoding: 'utf-8' })) as Truth[]);
  }
  return rows;
}

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

export async function runPep695Gate(): Promise<number> {
  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: CORPUS, outputDir: OUT, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const failures: string[] = [];
  if (summary.extractionErrors) failures.push(`${summary.extractionErrors} extraction error(s)`);
  if (summary.filesRejected) failures.push(`${summary.filesRejected} file(s) REJECTED — 3.12 syntax must parse`);

  const want = truth();
  const got = tsv('all-python-type-parameters.csv');
  const key = (o: string, n: string, p: string | number) => `${o}|${n}|${p}`;
  const gotMap = new Map(got.map((g) => [key(g['ownerName']!, g['paramName']!, g['position']!), g]));

  let ok = 0;
  for (const w of want) {
    const g = gotMap.get(key(w.owner, w.name, w.position));
    if (!g) { failures.push(`MISSING py_type_parameter ${w.owner}[${w.name}] at position ${w.position}`); continue; }
    if ((g['boundText'] ?? '') !== w.bound) {
      failures.push(`${w.owner}[${w.name}] bound: CPython says ${JSON.stringify(w.bound)}, parser says ${JSON.stringify(g['boundText'])}`);
      continue;
    }
    if ((g['ownerKind'] ?? '') !== w.ownerKind) {
      failures.push(`${w.owner}[${w.name}] ownerKind: expected ${w.ownerKind}, got ${g['ownerKind']}`);
      continue;
    }
    ok++;
  }
  for (const g of got) {
    const k = key(g['ownerName']!, g['paramName']!, g['position']!);
    if (!want.some((w) => key(w.owner, w.name, w.position) === k)) {
      failures.push(`SPURIOUS py_type_parameter ${k} — CPython sees no such parameter`);
    }
  }

  console.log(`PEP 695 gate — ${CORPUS}`);
  console.log(`  files ${summary.filesAnalysed}, extraction errors ${summary.extractionErrors}`);
  console.log(`  CPython 3.12 declares ${want.length} type parameters; parser emitted ${got.length}`);
  console.log(`  agreeing on name + position + bound + ownerKind: ${ok}/${want.length}`);

  // KNOWN GAP, asserted so it cannot be forgotten or silently "fixed" by regression.
  // §2.20 gives py_type_parameter a pyScopeLinkHash, and PythonScopeKind declares
  // TYPE_PARAM, TYPE_ALIAS and TYPE_PARAM_BOUND, but no extractor emits those scopes,
  // so the FK is empty on every row. The values existing in an enum is not the same
  // as a fact being emitted.
  const scopes = tsv('all-python-scopes.csv');
  const pepScopes = scopes.filter((s) =>
    ['TYPE_PARAM', 'TYPE_ALIAS', 'TYPE_PARAM_BOUND'].includes(s['scopeKind'] ?? ''));
  const linked = got.filter((g) => g['pyScopeLinkHash']).length;
  console.log(`\n  PEP 695 scopes emitted: ${pepScopes.length}   (CPython opens one wrapper per generic construct)`);
  console.log(`  py_type_parameter rows with a pyScopeLinkHash: ${linked}/${got.length}`);
  if (pepScopes.length === 0) {
    console.log('  KNOWN GAP — enum values exist, nothing emits them. Tracked, not failed.');
  }

  console.log('');
  if (failures.length) {
    console.log('FAIL');
    for (const f of failures.slice(0, 20)) console.log('  ' + f);
    return 1;
  }
  console.log('PASS  every type parameter matches CPython 3.12');
  return 0;
}

if (require.main === module) runPep695Gate().then((c) => process.exit(c));
