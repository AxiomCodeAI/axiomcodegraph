/**
 * The fixture header, on every file js-corpus introduces — DERIVED, never typed.
 *
 *     node tools/javascript/fixture-headers.mjs --check     # exit 1 on any missing/wrong header
 *     node tools/javascript/fixture-headers.mjs --fix       # insert the derived header where absent
 *
 * ## Why this exists
 *
 * js-fixtures runs a header pass over staging/. Files that enter through
 * categories/ or verified/ — every repro this agent has ever added — bypass it,
 * and js-oracle found them failing the nature gate on js. Twenty-one files, all
 * mine, all missing `// nature:`. It recurred on every sweep that added a repro,
 * and it would have kept recurring.
 *
 * ## Why the label is derived and not written
 *
 * The gate's predicate IS the label: `statements.length === 0` is type-only,
 * anything else is runtime-bearing. js-fixtures argued that a declared label is
 * therefore redundant with the predicate and can only ever catch header hygiene.
 * That ruling is a handover to js-impl and has not landed in the gate, so the
 * header is still required — but there is no reason for a human to type it.
 * This tool computes it with the gate's own predicate and writes it. A label
 * this tool wrote cannot disagree with the gate.
 *
 * Scope: categories/ and verified/ — the directories js-corpus owns. staging/
 * is js-fixtures' and is not touched.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const ts = createRequire(import.meta.url)('typescript');

const ROOT = path.resolve(path.join(import.meta.dirname, '..', '..', 'src', 'test-data', 'javascript'));
const MINE = ['categories', 'verified'];
const FIX = process.argv.includes('--fix');
const CHECK = process.argv.includes('--check') || !FIX;

function derive(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false,
    /\.jsx$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
  return sf.statements.length === 0 ? 'type-only' : 'runtime-bearing';
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); } else if (/\.[cm]?jsx?$/.test(e.name)) { files.push(p); }
  }
};
for (const m of MINE) { if (fs.existsSync(path.join(ROOT, m))) { walk(path.join(ROOT, m)); } }
if (files.length === 0) { console.error('no fixtures found under ' + MINE.join('/') + ' — nothing checked'); process.exit(1); }

let missing = 0; let wrong = 0; let fixed = 0; let ok = 0;
for (const p of files) {
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  const text = fs.readFileSync(p, 'utf8');
  const derived = derive(p, text);
  const m = /nature:\s*(type-only|runtime-bearing)/i.exec(text);
  if (m !== null) {
    if (m[1].toLowerCase() === derived) { ok += 1; continue; }
    wrong += 1;
    console.log(`WRONG    ${rel}: declares ${m[1]}, derived ${derived}`);
    continue;
  }
  missing += 1;
  if (!FIX) { console.log(`MISSING  ${rel}  (would derive: ${derived})`); continue; }
  // Insert after a shebang if present, else at the top. `// fixture:` first so
  // the file names itself, then the derived nature.
  const header = `// fixture: ${rel}\n// nature: ${derived}\n`;
  const out = text.startsWith('#!')
    ? text.replace(/^(#![^\n]*\n)/, `$1${header}`)
    : header + text;
  fs.writeFileSync(p, out);
  fixed += 1;
  console.log(`FIXED    ${rel}  nature: ${derived}`);
}
console.log(`\n${files.length} fixture(s) under ${MINE.join('/ + ')}: ok=${ok} missing=${missing} wrong=${wrong}${FIX ? ` fixed=${fixed}` : ''}`);
if (CHECK && (missing > 0 || wrong > 0)) {
  console.log('run with --fix to insert the derived header; a WRONG label is never rewritten silently');
  process.exit(1);
}
