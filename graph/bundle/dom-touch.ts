/**
 * THE DOM-TOUCH TABLE of a JavaScript (or TypeScript) graph (#1908, SPEC §4.2): every site where script text names
 * the page's markup — a selector, id, class, tag, event, attribute or style property — with the literal it names.
 *
 * The engine (graph/javascript/engine/framework-behavior/dom-touch.dl) finds the sites and the literals; this stage
 * adds the TOKENS a selector or an HTML string names (`.a #b div [data-x]`), so `.btn` is found in
 * `querySelectorAll('nav .btn > a')`. A table of the JavaScript graph: no row names a node of the web graph.
 */
import * as fs from 'fs';
import * as path from 'path';

import { readRaw } from '@/bundle/csv';

const COLUMNS = ['site_id', 'method_id', 'module_id', 'file', 'line', 'column', 'api', 'arg_index', 'literal', 'literal_kind', 'tokens', 'status'];

/** The class, id, tag and attribute tokens a selector names, in order, deduplicated. */
export function selectorTokens(sel: string): string[] {
  const out: string[] = [];
  const s = sel.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const re = /([.#])((?:\\.|[\w-])+)|\[\s*([\w:-]+)|(?:^|[\s>+~,(])([a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) out.push(m[1] + m[2]!.replace(/\\(.)/g, '$1'));
    else if (m[3]) out.push(`[${m[3]}]`);
    else if (m[4]) out.push(m[4].toLowerCase());
  }
  return [...new Set(out)];
}

/** The tokens an HTML string names: its tags, ids, class tokens and attribute names. */
export function htmlTokens(html: string): string[] {
  const out: string[] = [];
  for (const t of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    out.push(t[1]!.toLowerCase());
    const attrs = t[2] ?? '';
    for (const a of attrs.matchAll(/([\w:-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      const name = a[1]!.toLowerCase(); const v = (a[2] ?? '').replace(/^["']|["']$/g, '');
      if (name === 'class') for (const c of v.split(/\s+/).filter(Boolean)) out.push('.' + c);
      else if (name === 'id' && v) out.push('#' + v);
      else out.push(`[${name}]`);
    }
  }
  return [...new Set(out)];
}

export function tokensOf(literal: string, kind: string): string[] {
  if (!literal) return [];
  switch (kind) {
    case 'selector': return /^\s*</.test(literal) ? htmlTokens(literal) : selectorTokens(literal);
    case 'html': return htmlTokens(literal);
    case 'id': return ['#' + literal.replace(/^#/, '')];
    case 'class': return literal.split(/\s+/).filter(Boolean).map((c) => '.' + c);
    case 'tag': return [literal.toLowerCase()];
    case 'attribute': return [`[${literal}]`];
    default: return [];
  }
}

export async function writeDomTouch(dbPath: string, rawDir: string, log: (s: string) => void): Promise<void> {
  const raw = path.join(rawDir, 'dom-touch.csv');
  if (!fs.existsSync(raw)) return;
  const files = new Map<string, string>();
  for await (const r of readRaw(path.join(rawDir, 'dom-touch-file.csv'))) files.set(r[0]!, r[1]!);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN;');
    db.exec(`CREATE TABLE IF NOT EXISTS dom_touch (${COLUMNS.map((c) => `${c} ${c === 'line' || c === 'column' ? 'INTEGER' : 'TEXT'}`).join(', ')});`);
    const ins = db.prepare(`INSERT INTO dom_touch VALUES (${COLUMNS.map(() => '?').join(', ')})`);
    let n = 0;
    for await (const r of readRaw(raw)) {
      if (r.length !== 10) continue;
      const [site, method, mod, line, col, api, idx, literal, kind, status] = r as string[];
      ins.run(site!, method || null, mod!, files.get(site!) ?? null, Number(line) || null, Number(col) || null, api!, idx!, literal!, kind!,
        tokensOf(literal!, kind!).join(','), status!);
      n++;
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_dom_touch_file ON dom_touch(file, line); CREATE INDEX IF NOT EXISTS idx_dom_touch_literal ON dom_touch(literal);');
    const tab = db.prepare('INSERT INTO schema_tables VALUES (?, ?, ?, ?)');
    tab.run('dom_touch', 'ext', null, 'Where script text names the page\'s markup: the API (querySelector, getElementById, classList.add, addEventListener, style.<prop>=, innerHTML=, jquery:$ …), the literal argument as written, what it names (selector, id, class, tag, name, event, attribute, css_property, html) and the tokens it contains (`.a,#b,div,[data-x]`). status literal | non_literal (a variable or concatenation: listed, never guessed). A table of this language\'s graph; it points at no node of another graph.');
    db.exec('COMMIT;');
    if (n > 0) log(`  sqlite dom_touch: ${n} rows`);
  } finally {
    db.close();
  }
}
