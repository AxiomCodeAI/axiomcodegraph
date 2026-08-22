/**
 * Builds concrete call chains from the emitted CSVs alone.
 *
 * This is the question the whole IR exists to answer, and the only honest way to
 * check it is to do what a consumer would do: read the CSVs, follow the foreign
 * keys, and see whether a chain comes out. Nothing here touches the parser's
 * internals — if a hop needs a fact the CSVs do not carry, the walk stops, which
 * is exactly the failure a consumer would hit.
 *
 * The chain is METHOD -> CALL SITE -> RESOLVED CALLEE -> its call sites -> ...
 * Every edge is a hash join. A chain that reaches a leaf is concrete; a chain
 * that stops early names the hop that was missing.
 *
 *   npx tsx src/test/python-gates/call-chain.ts <csv-dir> [root-qualified-name]
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

interface Edge {
  fromMethod: string;
  callText: string;
  toHash: string;
  kind: string;
}

export function buildChains(dir: string): {
  methods: Map<string, string>;
  edges: Map<string, Edge[]>;
  unlinked: Map<string, number>;
} {
  const methods = load(dir, 'all-python-methods.csv');
  const types = load(dir, 'all-python-types.csv');
  const callSites = load(dir, 'all-python-call-sites.csv');

  const nameByHash = new Map<string, string>();
  for (const m of methods) {
    nameByHash.set(m.pyMethodUniqueHash!, m.qualifiedName!);
  }
  for (const t of types) {
    nameByHash.set(t.pyTypeUniqueHash!, t.qualifiedName!);
  }

  const edges = new Map<string, Edge[]>();
  const unlinked = new Map<string, number>();
  for (const site of callSites) {
    const from = site.pyMethodLinkHash!;
    const label =
      (site.receiverText ? `${site.receiverText}.` : '') + `${site.calleeName}()`;
    if (site.resolvedCalleeHash === '') {
      const reason = site.resolvedCalleeKind === 'UNRESOLVED' ? 'UNRESOLVED' : site.resolvedCalleeKind!;
      unlinked.set(reason, (unlinked.get(reason) ?? 0) + 1);
      continue;
    }
    const list = edges.get(from) ?? [];
    list.push({
      fromMethod: from,
      callText: label,
      toHash: site.resolvedCalleeHash!,
      kind: site.receiverKind!,
    });
    edges.set(from, list);
  }
  return { methods: nameByHash, edges, unlinked };
}

/** Walks outward from one method, depth-first, reporting every concrete chain. */
function walk(
  start: string,
  graph: ReturnType<typeof buildChains>,
  depth: number,
  seen: Set<string>,
  prefix: string,
  out: string[]
): void {
  if (depth > 6 || seen.has(start)) {
    return;
  }
  seen.add(start);
  for (const edge of graph.edges.get(start) ?? []) {
    const target = graph.methods.get(edge.toHash);
    if (!target) {
      // A hash that resolves to no row would be a dangling FK — reported rather
      // than skipped, because that is a defect and not a short chain.
      out.push(`${prefix}${edge.callText}  -> DANGLING ${edge.toHash}`);
      continue;
    }
    out.push(`${prefix}${edge.callText}  -> ${target}`);
    walk(edge.toHash, graph, depth + 1, new Set(seen), `${prefix}  `, out);
  }
}

if (require.main === module) {
  const dir = process.argv[2]!;
  const rootName = process.argv[3];
  const graph = buildChains(dir);

  let deepest = 0;
  let chains = 0;
  for (const [from] of graph.edges) {
    const out: string[] = [];
    walk(from, graph, 0, new Set(), '', out);
    if (out.length > 0) {
      chains += 1;
      deepest = Math.max(deepest, Math.max(...out.map(l => (l.match(/^ */)?.[0].length ?? 0) / 2)));
    }
  }

  console.log('call chains built from the CSVs alone');
  console.log(`  methods with outgoing edges : ${graph.edges.size}`);
  console.log(`  concrete edges              : ${[...graph.edges.values()].reduce((a, b) => a + b.length, 0)}`);
  console.log(`  deepest chain               : ${deepest} hops`);
  console.log(`  chains that start somewhere : ${chains}`);
  const dangling = [...graph.edges.values()].flat().filter(e => !graph.methods.has(e.toHash)).length;
  console.log(`  DANGLING targets            : ${dangling}`);
  console.log('  edges NOT built, by reason  :');
  for (const [reason, count] of [...graph.unlinked.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${reason.padEnd(14)}${count}`);
  }

  if (rootName) {
    const start = [...graph.methods.entries()].find(([, n]) => n.endsWith(rootName));
    if (start) {
      console.log(`\n  chain from ${start[1]}:`);
      const out: string[] = [];
      walk(start[0], graph, 0, new Set(), '    ', out);
      out.forEach(l => console.log(l));
    }
  }
}
