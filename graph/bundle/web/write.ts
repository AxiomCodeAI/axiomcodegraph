/**
 * The web graph's named tables (web/schema.ts) in the graph.sqlite the core writer has just written: created up
 * front, each row inserted as the builder makes it (batched), then the views, a catalog row per table and column so
 * `schema_tables` documents them like the core tables, and an index on every id column.
 */
import { WEB_FINALIZE, WEB_TABLES, WEB_VIEWS } from '@/bundle/web/schema';

type Stmt = { run(...a: (string | number | null)[]): unknown };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };

const BATCH = 64;
/**
 * SHORT UIDS (C-05). Every web uid is an IR hash, a kind prefix and 32 hex digits, repeated in many columns and
 * indexes: on a dev project with 591k styles rows they were about a third of a 1.36 GB file. A value that is exactly such
 * a hash is written with its first 16 hex digits (64 bits; within one project, one kind's million ids collide with odds
 * near 1e-7). Every table goes through this one sink, so a uid and every reference to it stay equal; the prefix stays,
 * so a uid still names its kind.
 */
const IR_HASH = /^([A-Z][A-Z0-9_]*_)([0-9a-f]{32})$/;
const shortUid = (v: string): string => { const m = IR_HASH.exec(v); return m ? m[1]! + m[2]!.slice(0, 16) : v; };
/** text columns where the empty string is a value, not "none": an empty inline script's body, an empty handler's code */
const KEEP_EMPTY = new Set(['web_scripts.body', 'web_handlers.code']);

export class WebDb {
  private readonly buf = new Map<string, (string | number | null)[]>();
  private readonly counts = new Map<string, number>();
  private readonly arity = new Map<string, number>();
  private readonly cols = new Map<string, string[]>();
  private readonly full = new Map<string, Stmt>();

  private constructor(private readonly db: Db, private readonly log: (s: string) => void) {}

  static async open(dbPath: string, log: (s: string) => void): Promise<WebDb> {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath) as unknown as Db;
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;');
    const w = new WebDb(db, log);
    db.exec('BEGIN;');
    for (const t of WEB_TABLES) {
      db.exec(`CREATE TABLE ${t.name} (${t.columns.map((c) => `"${c.name}" ${c.type}`).join(', ')});`);
      w.arity.set(t.name, t.columns.length);
      w.cols.set(t.name, t.columns.map((c) => c.name));
      w.buf.set(t.name, []);
      w.counts.set(t.name, 0);
    }
    return w;
  }

  private row(n: number): string { return `(${Array.from({ length: n }, () => '?').join(', ')})`; }

  /** one row, by column name; a name the table does not have is a defect in the builder, not a column to drop */
  push = (table: string, r: Record<string, string | number | null>): void => {
    const n = this.arity.get(table);
    if (n === undefined) throw new Error(`no web table ${table}`);
    const cols = this.cols.get(table)!;
    for (const k of Object.keys(r)) if (!cols.includes(k)) throw new Error(`${table} has no column ${k}`);
    const b = this.buf.get(table)!;
    for (const c of cols) {
      const v = r[c];
      b.push(v === undefined || (v === '' && !KEEP_EMPTY.has(`${table}.${c}`)) ? null : typeof v === 'string' && v.length === 0 ? v : typeof v === 'string' ? shortUid(v) : v);
    }
    this.counts.set(table, this.counts.get(table)! + 1);
    if (b.length === n * BATCH) {
      let st = this.full.get(table);
      if (st === undefined) { st = this.db.prepare(`INSERT INTO ${table} VALUES ${Array.from({ length: BATCH }, () => this.row(n)).join(', ')}`); this.full.set(table, st); }
      st.run(...b); b.length = 0;
    }
  };

  close(): void {
    const db = this.db;
    try {
      for (const t of WEB_TABLES) {
        const b = this.buf.get(t.name)!; const n = t.columns.length;
        if (b.length > 0) db.prepare(`INSERT INTO ${t.name} VALUES ${Array.from({ length: b.length / n }, () => this.row(n)).join(', ')}`).run(...b);
        const c = this.counts.get(t.name)!;
        if (c > 0) this.log(`  sqlite ${t.name}: ${c} rows`);
      }
      for (const v of WEB_VIEWS) db.exec(v + ';');
      const tab = db.prepare('INSERT INTO schema_tables VALUES (?, ?, ?, ?)');
      const col = db.prepare('INSERT INTO schema_columns VALUES (?, ?, ?, ?, ?, ?)');
      for (const t of WEB_TABLES) {
        tab.run(t.name, 'web', 'web', t.description);
        t.columns.forEach((c, i) => col.run(t.name, i, c.name, c.type, c.nullable ? 1 : 0, c.description));
      }
      db.exec('COMMIT;');
      db.exec('BEGIN;');
      for (const t of WEB_TABLES) for (const c of t.columns) if (c.indexed) db.exec(`CREATE INDEX idx_${t.name}_${c.name} ON ${t.name}("${c.name}");`);
      db.exec('CREATE INDEX idx_web_elements_file_line ON web_elements(file, line);');
      // web_styles is looked up by selector (impact "X", the per-page unmatched view, which then reads that selector's few
      // rows for the page) and by element (its own index); no query leads with the page alone, so the (page, element)
      // and (selector, page) composites, a quarter of a styles-heavy file, are not kept (C-05)
      db.exec('CREATE INDEX idx_web_styles_selector ON web_styles(selector_uid);');
      db.exec('CREATE INDEX idx_web_page_carriers ON web_page_carriers(page_uid, kind, token);');
      db.exec('CREATE INDEX idx_web_page_carriers_lc ON web_page_carriers(page_uid, kind, token_lc);');
      for (const f of WEB_FINALIZE) db.exec(f + ';');
      db.exec('COMMIT;');
      // sqlite_stat1 for the planner: with an index on most id columns and none on others, it otherwise guesses (V2-07)
      db.exec('ANALYZE;');
    } finally {
      db.close();
    }
  }
}
