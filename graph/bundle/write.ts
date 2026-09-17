/**
 * Two writers over the same in-memory tables: headered tab-delimited text (one file per
 * core table) and one SQLite database holding core + ext + catalog. The SQLite file is the
 * contract; the text files are the same core tables for a consumer without a database.
 */
import * as fs from 'fs';
import * as path from 'path';

import { readRaw, writeTable } from '@/bundle/csv';
import type { CoreTables, Row } from '@/bundle/build';
import type { ExtRelation } from '@/bundle/catalog';
import { CATALOG_TABLES, CORE_TABLES, GUIDE, LANGUAGES, NOTES, QUERIES, SCHEMA_VERSION, VOCAB, type Language, type TableSpec } from '@/bundle/schema';

export function writeCoreCsv(graphDir: string, core: CoreTables, log: (s: string) => void): void {
  fs.mkdirSync(graphDir, { recursive: true });
  for (const t of CORE_TABLES) {
    const rows = (core as unknown as Record<string, Row[]>)[t.name] ?? [];
    const n = writeTable(path.join(graphDir, `${t.name}.csv`), t.columns.map((c) => c.name), rows);
    log(`  csv/${t.name}.csv: ${n} rows`);
  }
}

/** Node ≥ 22.5 ships `node:sqlite`. */
export function sqliteAvailable(): boolean {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj! > 22 || (maj === 22 && min! >= 5);
}

function createSql(t: TableSpec, prefix = ''): string {
  const cols = t.columns.map((c) => `  ${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}`);
  const keys = t.columns.filter((c) => c.key).map((c) => c.name);
  if (keys.length > 0) cols.push(`  PRIMARY KEY (${keys.join(', ')})`);
  return `CREATE TABLE ${prefix}${t.name} (\n${cols.join(',\n')}\n)${keys.length > 0 ? ' WITHOUT ROWID' : ''};`;
}

export interface SqliteInputs {
  dbPath: string;
  language: Language;
  core: CoreTables;
  ext: ExtRelation[];
  rawDir: string;
  log: (s: string) => void;
}

export async function writeSqlite(inp: SqliteInputs): Promise<void> {
  // Loaded lazily so the CSV path works on a Node without the module.
  const { DatabaseSync } = await import('node:sqlite');
  fs.rmSync(inp.dbPath, { force: true });
  fs.rmSync(inp.dbPath + '-journal', { force: true });
  const db = new DatabaseSync(inp.dbPath);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
  try {
    // ── core ────────────────────────────────────────────────────────────────
    db.exec('BEGIN;');
    for (const t of CORE_TABLES) {
      db.exec(createSql(t));
      const rows = (inp.core as unknown as Record<string, Row[]>)[t.name] ?? [];
      const ins = db.prepare(`INSERT OR IGNORE INTO ${t.name} VALUES (${t.columns.map(() => '?').join(', ')})`);
      for (const r of rows) ins.run(...(r as (string | number | null)[]));
      inp.log(`  sqlite ${t.name}: ${rows.length} rows`);
    }
    db.exec('COMMIT;');

    // ── ext ─────────────────────────────────────────────────────────────────
    db.exec('BEGIN;');
    for (const e of inp.ext) {
      const cols = Array.from({ length: e.arity }, (_, i) => `c${i} TEXT`);
      const name = `ext_${e.relation}`;
      db.exec(`CREATE TABLE ${name} (${cols.join(', ')});`);
      if (e.arity === 0) continue;
      const ins = db.prepare(`INSERT INTO ${name} VALUES (${cols.map(() => '?').join(', ')})`);
      let n = 0;
      for await (const r of readRaw(path.join(inp.rawDir, e.file))) {
        if (r.length !== e.arity) continue; // a torn row is dropped, as the engine's own staging does
        ins.run(...r); n++;
      }
      if (n > 0) inp.log(`  sqlite ${name}: ${n} rows`);
    }
    db.exec('COMMIT;');

    // ── catalog ─────────────────────────────────────────────────────────────
    db.exec('BEGIN;');
    for (const t of CATALOG_TABLES) db.exec(createSql(t));
    const tab = db.prepare('INSERT INTO schema_tables VALUES (?, ?, ?, ?)');
    const col = db.prepare('INSERT INTO schema_columns VALUES (?, ?, ?, ?, ?, ?)');
    for (const t of [...CORE_TABLES, ...CATALOG_TABLES]) {
      tab.run(t.name, CORE_TABLES.includes(t) ? 'core' : 'catalog', null, t.description);
      t.columns.forEach((c, i) => col.run(t.name, i, c.name, c.type, c.nullable ? 1 : 0, c.description));
    }
    for (const e of inp.ext) {
      tab.run(`ext_${e.relation}`, 'ext', inp.language, `[${e.arity} columns c0…c${e.arity - 1}; raw/${e.file}]\n${e.description}`);
    }
    const voc = db.prepare('INSERT OR IGNORE INTO schema_vocab VALUES (?, ?, ?, ?, ?)');
    for (const v of VOCAB) {
      for (const l of v.languages === 'all' ? LANGUAGES : v.languages) voc.run(v.table, v.column, l, v.value, v.meaning);
    }
    // completeness: a value in the data that the authored list lacks is still documented as such
    const authored = new Set(VOCAB.flatMap((v) => (v.languages === 'all' ? LANGUAGES : v.languages).map((l) => `${v.table}\t${v.column}\t${l}\t${v.value}`)));
    const prefixes = VOCAB.filter((v) => v.value.endsWith('*')).map((v) => ({ key: `${v.table}\t${v.column}`, prefix: v.value.slice(0, -1) }));
    const observe = (table: string, column: string, values: Iterable<string | null>) => {
      for (const val of new Set(values)) {
        if (val === null) continue;
        const k = `${table}\t${column}\t${inp.language}\t${val}`;
        if (authored.has(k)) continue;
        if (prefixes.some((p) => p.key === `${table}\t${column}` && val.startsWith(p.prefix))) continue;
        voc.run(table, column, inp.language, val, 'undocumented — observed in this run; not in the authored vocabulary (graph/bundle/schema.ts)');
        inp.log(`  ! undocumented ${table}.${column} value: ${val}`);
      }
    };
    const c = inp.core;
    observe('methods', 'kind', c.methods.map((r) => r[4] as string));
    observe('methods', 'provenance', c.methods.map((r) => r[10] as string));
    observe('types', 'category', c.types.map((r) => r[3] as string));
    observe('call_edges', 'tier', c.call_edges.map((r) => r[5] as string));
    observe('call_edges', 'callee_provenance', c.call_edges.map((r) => r[4] as string | null));
    observe('call_edges', 'kind', c.call_edges.map((r) => r[6] as string));
    observe('entry_points', 'reason', c.entry_points.map((r) => r[1] as string));
    observe('type_instantiated', 'how', c.type_instantiated.map((r) => r[1] as string));
    observe('fields', 'kind', c.fields.map((r) => r[2] as string));
    observe('fields', 'provenance', c.fields.map((r) => r[10] as string));
    observe('field_access', 'access', c.field_access.map((r) => r[4] as string));
    observe('field_access', 'tier', c.field_access.map((r) => r[5] as string));
    observe('field_access', 'field_provenance', c.field_access.map((r) => r[3] as string | null));
    observe('type_use', 'context', c.type_use.map((r) => r[2] as string));
    observe('type_use', 'owner_kind', c.type_use.map((r) => r[4] as string));
    observe('type_use', 'tier', c.type_use.map((r) => r[9] as string));
    observe('type_use', 'type_provenance', c.type_use.map((r) => r[8] as string | null));
    const note = db.prepare('INSERT INTO schema_notes VALUES (?, ?, ?)');
    for (const n of NOTES) if (n.language === 'all' || n.language === inp.language) note.run(n.language, n.table, n.note);
    const guide = db.prepare('INSERT INTO schema_guide VALUES (?, ?)');
    GUIDE.forEach((g, i) => guide.run(i + 1, g));
    const query = db.prepare('INSERT INTO schema_queries VALUES (?, ?, ?, ?)');
    for (const q of QUERIES) query.run(q.name, q.question, q.params, q.sql);
    db.exec('COMMIT;');

    // ── indexes, after the load ─────────────────────────────────────────────
    db.exec('BEGIN;');
    for (const t of CORE_TABLES) {
      for (const cc of t.columns) if (cc.indexed) db.exec(`CREATE INDEX idx_${t.name}_${cc.name} ON ${t.name}(${cc.name});`);
    }
    for (const e of inp.ext) if (e.arity > 0) db.exec(`CREATE INDEX idx_ext_${e.relation}_c0 ON ext_${e.relation}(c0);`);
    db.exec('COMMIT;');
    db.exec(`PRAGMA user_version = ${Number(SCHEMA_VERSION)};`);
  } finally {
    db.close();
  }
}
