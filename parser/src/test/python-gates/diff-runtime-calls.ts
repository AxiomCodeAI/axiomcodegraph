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
      const constructor = (sitesByLocation.get(key) ?? []).filter(
        (site) => edge.calleeName === '__init__' && classNames.has(site['calleeName'] ?? '')
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
      if (unlinkedSamples.length < 8) {
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
