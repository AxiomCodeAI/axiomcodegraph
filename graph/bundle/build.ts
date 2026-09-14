/**
 * Build the bundle's core tables in memory from a raw Soufflé dump plus the parser IR.
 *
 * Order matters for memory: the raw relations are small (edges) and come first; they say
 * which ids the bundle needs. The IR entity tables — the expression table can be GB-scale —
 * are then STREAMED once each, keeping only the rows those ids ask for. Library facts are
 * treated the same way, from the staged copy the engine itself read (`--lib-facts`), so the
 * names attached to a library target are the ones the rules resolved against.
 */
import * as fs from 'fs';
import * as path from 'path';

import { Header, readHeader, readRaw, readRfc4180 } from '@/bundle/csv';
import type { LanguageAdapter, RawSource } from '@/bundle/languages';

export type Cell = string | number | null;
export type Row = Cell[];

export interface CoreTables {
  run: Row[];
  methods: Row[];
  types: Row[];
  call_sites: Row[];
  call_edges: Row[];
  type_ancestors: Row[];
  overrides: Row[];
  entry_points: Row[];
  entry_reachable: Row[];
  unresolved_sites: Row[];
  type_instantiated: Row[];
}

export interface BuildInputs {
  adapter: LanguageAdapter;
  rawDir: string;
  clientIrDir: string;
  /** library IR roots (each the IR itself, or a folder of module sub-folders) — for headers */
  libraryRoots: string[];
  /** the engine's staged library facts (headerless copies of the library entity tables) */
  libFactsDir?: string;
  /** relation name → IR basename (without .csv), parsed from the language's lib.map */
  libMap: Map<string, string>;
  /** key/value facts for the `run` table */
  meta: Record<string, string>;
  log: (s: string) => void;
}

const NONE = '-';
const nul = (s: string | undefined): string | null => (s === undefined || s === '' || s === NONE ? null : s);
const int = (s: string | undefined): number | null => {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
};

/** Read one raw relation through a RawSource mapping. */
async function readSource(rawDir: string, src: RawSource): Promise<Row[]> {
  const out: Row[] = [];
  for await (const r of readRaw(path.join(rawDir, src.file))) {
    const row: Row = src.columns.map((i) => r[i] ?? '');
    if (src.constant !== undefined) row.push(src.constant);
    out.push(row);
  }
  return out;
}

/** The entity file for a header lookup: the root itself if it holds the IR, else its first module holding it. */
function findLibFile(roots: string[], basename: string): string | null {
  for (const root of roots) {
    const direct = path.join(root, basename);
    if (fs.existsSync(direct) && fs.statSync(direct).size > 0) return direct;
    if (!fs.existsSync(root)) continue;
    for (const m of fs.readdirSync(root, { withFileTypes: true })) {
      if (!m.isDirectory() && !m.isSymbolicLink()) continue;
      const p = path.join(root, m.name, basename);
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    }
  }
  return null;
}

interface EntitySource {
  /** rows, with or without a header line */
  path: string;
  header: Header;
  hasHeaderRow: boolean;
}

/** The client's copy of an entity file: headered, may be zero-byte (→ null: nothing to read). */
async function clientSource(irDir: string, file: string): Promise<EntitySource | null> {
  const p = path.join(irDir, file);
  const h = await readHeader(p);
  return h ? { path: p, header: h, hasHeaderRow: true } : null;
}

/** The library's staged copy: headerless facts, with the header taken from a library module's own file. */
async function libSource(inp: BuildInputs, file: string): Promise<EntitySource | null> {
  if (!inp.libFactsDir) return null;
  const rel = inp.libMap.get(file.replace(/\.csv$/, ''));
  if (!rel) return null;
  const facts = path.join(inp.libFactsDir, `${rel}.facts`);
  if (!fs.existsSync(facts) || fs.statSync(facts).size === 0) return null;
  const headerFile = findLibFile(inp.libraryRoots, file);
  const h = headerFile ? await readHeader(headerFile) : null;
  if (!h) {
    inp.log(`  ! no header found for ${file} under any library root — library ${file} rows will not be named`);
    return null;
  }
  return { path: facts, header: new Header(h.names, `${facts} (header from ${headerFile})`), hasHeaderRow: false };
}

async function* rowsOf(src: EntitySource): AsyncGenerator<string[]> {
  let first = src.hasHeaderRow;
  for await (const r of readRfc4180(src.path)) {
    if (first) { first = false; continue; }
    yield r;
  }
}

export async function buildCore(inp: BuildInputs): Promise<CoreTables> {
  const { adapter: A, rawDir, log } = inp;

  // ── 1. raw relations ──────────────────────────────────────────────────────
  const rawEdges = await readSource(rawDir, A.raw.callEdges); // site, caller, callee, prov, tier, kind
  const rawAncestors = A.raw.typeAncestors ? await readSource(rawDir, A.raw.typeAncestors) : [];
  const rawOverrides = A.raw.overrides ? await readSource(rawDir, A.raw.overrides) : [];
  const rawEntry = A.raw.entryPoints ? await readSource(rawDir, A.raw.entryPoints) : [];
  const rawReach = A.raw.entryReachable ? await readSource(rawDir, A.raw.entryReachable) : [];
  const rawInst = A.raw.typeInstantiated ? await readSource(rawDir, A.raw.typeInstantiated) : [];
  log(`  raw: ${rawEdges.length} edge rows, ${rawAncestors.length} ancestor rows, ${rawOverrides.length} override rows`);

  // call_edges: split the raw ToMethod into a method key or a label by provenance
  const call_edges: Row[] = [];
  const unresolvedKeys = new Set<string>();
  const unresolved_sites: Row[] = [];
  const siteKind = new Map<string, string>();
  const siteCaller = new Map<string, string>();
  for (const r of rawEdges) {
    const [site, caller, callee, prov, tier, kind] = r as string[];
    const p = nul(prov);
    const c = nul(callee);
    const isMethod = c !== null && (p === 'client' || p === 'lib');
    call_edges.push([site!, caller!, isMethod ? c : null, isMethod ? null : c, p, tier!, kind!]);
    if (!siteKind.has(site!)) { siteKind.set(site!, kind!); siteCaller.set(site!, caller!); }
    if (tier!.startsWith('ambiguous_')) {
      const k = `${caller}\t${site}`;
      if (!unresolvedKeys.has(k)) { unresolvedKeys.add(k); unresolved_sites.push([caller!, site!]); }
    }
  }

  // ── 2. which ids the bundle must name ─────────────────────────────────────
  const wantMethods = new Set<string>();
  const wantTypes = new Set<string>();
  for (const e of call_edges) {
    wantMethods.add(e[1] as string);
    if (e[2] !== null) wantMethods.add(e[2] as string);
  }
  for (const r of rawOverrides) { wantMethods.add(r[0] as string); wantMethods.add(r[1] as string); }
  for (const r of rawEntry) wantMethods.add(r[0] as string);
  for (const r of rawReach) wantMethods.add(r[0] as string);
  for (const r of rawAncestors) { wantTypes.add(r[0] as string); wantTypes.add(r[1] as string); }
  for (const r of rawInst) wantTypes.add(r[0] as string);

  // ── 3. client entities (all of them — the client is the subject) ──────────
  const methods = new Map<string, Row>();
  const types = new Map<string, Row>();
  const modules = new Map<string, string>(); // module hash → file path

  const M = A.ir.methods, T = A.ir.types;
  const readMethods = async (src: EntitySource, prov: 'client' | 'lib', only?: Set<string>) => {
    const h = src.header;
    const [ci, cn, cq, cs, ck, co, coq, cf, cs1, ce1] = [M.id, M.name, M.qualifiedName, M.signature, M.kind, M.ownerTypeId, M.ownerQualifiedName, M.filePath, M.startLine, M.endLine].map((n) => h.col(n));
    let n = 0;
    for await (const r of rowsOf(src)) {
      const id = r[ci!] ?? '';
      if (only && !only.has(id)) continue;
      if (methods.has(id)) continue;
      const owner = nul(r[co!]);
      methods.set(id, [id, r[cn!] ?? '', r[cq!] ?? '', r[cs!] ?? '', r[ck!] ?? '', owner, owner ? nul(r[coq!]) : null, r[cf!] ?? '', int(r[cs1!]), int(r[ce1!]), prov]);
      if (owner) wantTypes.add(owner);
      n++;
    }
    return n;
  };
  const readTypes = async (src: EntitySource, prov: 'client' | 'lib', only?: Set<string>) => {
    const h = src.header;
    const [ci, cn, cq, cc, cf, cs1, ce1] = [T.id, T.name, T.qualifiedName, T.category, T.filePath, T.startLine, T.endLine].map((n) => h.col(n));
    let n = 0;
    for await (const r of rowsOf(src)) {
      const id = r[ci!] ?? '';
      if (only && !only.has(id)) continue;
      if (types.has(id)) continue;
      types.set(id, [id, r[cn!] ?? '', r[cq!] ?? '', r[cc!] ?? '', r[cf!] ?? '', int(r[cs1!]), int(r[ce1!]), prov]);
      n++;
    }
    return n;
  };

  const cm = await clientSource(inp.clientIrDir, M.file);
  if (cm) log(`  client methods: ${await readMethods(cm, 'client')}`);
  const ct = await clientSource(inp.clientIrDir, T.file);
  if (ct) log(`  client types: ${await readTypes(ct, 'client')}`);
  if (A.ir.modules) {
    const src = await clientSource(inp.clientIrDir, A.ir.modules.file);
    if (src) {
      const ci = src.header.col(A.ir.modules.id), cf = src.header.col(A.ir.modules.filePath);
      for await (const r of rowsOf(src)) modules.set(r[ci] ?? '', r[cf] ?? '');
    }
  }

  // ── 4. library entities — only the referenced ones ────────────────────────
  const missingMethods = new Set([...wantMethods].filter((id) => !methods.has(id)));
  if (missingMethods.size > 0) {
    const lm = await libSource(inp, M.file);
    if (lm) log(`  library methods named: ${await readMethods(lm, 'lib', missingMethods)} of ${missingMethods.size} referenced`);
  }
  const missingTypes = new Set([...wantTypes].filter((id) => !types.has(id)));
  if (missingTypes.size > 0) {
    const lt = await libSource(inp, T.file);
    if (lt) log(`  library types named: ${await readTypes(lt, 'lib', missingTypes)} of ${missingTypes.size} referenced`);
  }
  // A library module's file path is not staged; a library site never occurs (edges start in the client).

  // ── 5. call sites: name + position for every site the edges mention ───────
  // row: id, caller_id, kind, callee_name, file_path, start_line, start_column, end_line, end_column
  const sites = new Map<string, Row>();
  for (const [id, kind] of siteKind) sites.set(id, [id, siteCaller.get(id)!, kind, null, null, null, null, null, null]);
  const fileOf = (via: { column: string; through: 'modules' | 'types' }, h: Header, r: string[]): string | null => {
    const key = r[h.col(via.column)] ?? '';
    if (via.through === 'modules') return modules.get(key) ?? null;
    const t = types.get(key);
    return t ? (t[4] as string) : null;
  };
  const fill = (row: Row, i: number, v: Cell) => { if (row[i] === null && v !== null) row[i] = v; };

  if (A.ir.callSites) {
    const C = A.ir.callSites;
    const src = await clientSource(inp.clientIrDir, C.file);
    if (src) {
      const h = src.header;
      const ce = h.col(C.expressionId), cn = h.col(C.calleeName), cl = h.col(C.startLine), cc = h.col(C.startColumn);
      const cel = C.endLine ? h.col(C.endLine) : -1;
      for await (const r of rowsOf(src)) {
        const row = sites.get(r[ce] ?? '');
        if (!row) continue;
        fill(row, 3, nul(r[cn])); fill(row, 4, fileOf(C.fileVia, h, r));
        fill(row, 5, int(r[cl])); fill(row, 6, int(r[cc]));
        if (cel >= 0) fill(row, 7, int(r[cel]));
      }
    }
  }
  {
    const E = A.ir.expressions;
    const src = await clientSource(inp.clientIrDir, E.file);
    if (src) {
      const h = src.header;
      const ci = h.col(E.id), ck = h.col(E.kind), cl = h.col(E.startLine), cc = h.col(E.startColumn), cel = h.col(E.endLine), cec = h.col(E.endColumn);
      const cname = E.calleeName ? h.col(E.calleeName.column) : -1;
      const nameKinds = new Set(E.calleeName?.kinds ?? []);
      for await (const r of rowsOf(src)) {
        const row = sites.get(r[ci] ?? '');
        if (!row) continue;
        if (cname >= 0 && nameKinds.has(r[ck] ?? '')) fill(row, 3, nul(r[cname]));
        fill(row, 4, fileOf(E.fileVia, h, r));
        fill(row, 5, int(r[cl])); fill(row, 6, int(r[cc])); fill(row, 7, int(r[cel])); fill(row, 8, int(r[cec]));
      }
    }
  }
  if (A.ir.decorators) {
    const D = A.ir.decorators;
    const src = await clientSource(inp.clientIrDir, D.file);
    if (src) {
      const h = src.header;
      const ci = h.col(D.id), ce = h.col(D.expressionId), cn = h.col(D.name), cl = h.col(D.startLine), cel = h.col(D.endLine);
      for await (const r of rowsOf(src)) {
        const row = sites.get(r[ci] ?? '') ?? sites.get(r[ce] ?? '');
        if (!row) continue;
        fill(row, 3, nul(r[cn])); fill(row, 4, fileOf(D.fileVia, h, r));
        fill(row, 5, int(r[cl])); fill(row, 7, int(r[cel]));
      }
    }
  }
  // a site keyed on a type (Python METACLASS_CREATION) is positioned at the class declaration
  for (const row of sites.values()) {
    if (row[5] !== null) continue;
    const t = types.get(row[0] as string);
    if (t) { fill(row, 4, t[4] ?? null); fill(row, 5, t[5] ?? null); fill(row, 7, t[6] ?? null); }
  }
  // last resort for the file: the caller's own file
  for (const row of sites.values()) {
    if (row[4] !== null) continue;
    const m = methods.get(row[1] as string);
    if (m) row[4] = m[7] ?? null;
  }
  const unplaced = [...sites.values()].filter((r) => r[5] === null).length;
  if (unplaced > 0) log(`  ! ${unplaced} of ${sites.size} call sites have no position in the IR`);

  // ── 6. assemble ───────────────────────────────────────────────────────────
  const run: Row[] = Object.entries(inp.meta).map(([k, v]) => [k, v]);
  return {
    run,
    methods: [...methods.values()],
    types: [...types.values()],
    call_sites: [...sites.values()],
    call_edges,
    type_ancestors: dedupe(rawAncestors),
    overrides: dedupe(rawOverrides),
    entry_points: dedupe(rawEntry),
    entry_reachable: dedupe(rawReach),
    unresolved_sites,
    type_instantiated: dedupe(rawInst),
  };
}

function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const k = r.join('\t');
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}
