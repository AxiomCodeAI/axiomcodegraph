/**
 * WEB PLUMBING TESTS — what the web graph (graph/web) needs from the parser, end to end through extractProject.
 *
 *     npx tsx src/test/web-plumbing-tests.ts
 *
 * Each check builds a small tree in a temp directory, runs the parser in per-language mode exactly as
 * `axiomcode parser` does, and reads the CSVs it wrote. Every check asserts that it compared at least one row:
 * a missing file or an empty relation is a FAIL, never a vacuous pass.
 *
 *   web-folder        pages and stylesheets alone get an <ir>/web/ folder (#1908): no java/javascript/typescript
 *                     project is needed for HTML and CSS to be a language.
 *   dist-walk         a stylesheet under dist/, build/ or out/ that a page links is read (#1909).
 *   brace-comment     a comment holding braces inside a declaration value keeps every declaration and invents
 *                     no selector (#1909).
 *   inline-js         inline classic/module <script> bodies and on* attribute values are JavaScript modules of
 *                     their page (`page.html#script-<n>`, `#on-<n>`), with lines into the .html file (#1908).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractProject } from '@/extract';

type Row = Record<string, string>;

function readCsv(file: string): Row[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t'); const r: Row = {};
    header.forEach((h, i) => { r[h] = (cells[i] ?? '').replace(/^"(.*)"$/, '$1').replace(/""/g, '"'); });
    return r;
  });
}

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-web-plumb-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

async function parse(root: string): Promise<string> {
  const out = path.join(root, '.ir');
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    await extractProject({ projectPath: root, versionLink: 'PLUMBING', outputDir: out, layout: 'per-language' } as never);
  } finally {
    console.log = log; console.error = err;
  }
  return out;
}

let bad = 0; let ran = 0;
const fail = (m: string) => { console.log('  ✗ ' + m); bad++; };
const ok = (m: string) => console.log('  ✓ ' + m);

async function webFolder(): Promise<void> {
  const root = tree({
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><p class="a">x</p></body></html>\n',
    'style.css': '.a { color: red }\n',
  });
  const ir = await parse(root);
  const docs = readCsv(path.join(ir, 'web', 'all-html-documents.csv'));
  const sheets = readCsv(path.join(ir, 'web', 'all-css-stylesheets.csv'));
  ran++;
  if (docs.length !== 1 || sheets.length !== 1) fail(`web-folder: expected 1 page and 1 sheet in <ir>/web, got ${docs.length} and ${sheets.length}`);
  else ok('web-folder: a pure HTML+CSS tree gets <ir>/web/ (1 page, 1 sheet)');
}

async function distWalk(): Promise<void> {
  const root = tree({
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="dist/css/site.css"><link rel="stylesheet" href="build/b.css"><link rel="stylesheet" href="out/o.css"></head><body></body></html>\n',
    'dist/css/site.css': '.btn { color: red }\n',
    'build/b.css': '.b { color: red }\n',
    'out/o.css': '.o { color: red }\n',
    'node_modules/x/n.css': '.n { color: red }\n',
  });
  const ir = await parse(root);
  const sheets = readCsv(path.join(ir, 'web', 'all-css-stylesheets.csv')).map((r) => r.relativePath ?? '');
  const sels = readCsv(path.join(ir, 'web', 'all-css-selectors.csv')).map((r) => r.selectorText ?? '');
  ran++;
  const want = ['build/b.css', 'dist/css/site.css', 'out/o.css'];
  const missing = want.filter((w) => !sheets.includes(w));
  if (missing.length > 0) fail(`dist-walk: sheets not read: ${missing.join(', ')} (read: ${sheets.join(', ')})`);
  else if (!sels.includes('.btn')) fail(`dist-walk: no selector .btn from dist/css/site.css (selectors: ${sels.join(', ')})`);
  else if (sheets.some((s) => s.startsWith('node_modules/'))) fail('dist-walk: node_modules was walked');
  else ok(`dist-walk: ${want.length} sheets under dist/build/out read, node_modules still skipped`);
}

async function braceComment(): Promise<void> {
  const root = tree({
    'theme.css': '.w { border: 1px solid #ddd/*{borderColor}*/; color: #333/*{fc}*/; font-family: Arial; }\n/* theme {x} */\n.next { margin: 0 }\n',
  });
  const ir = await parse(root);
  const decls = readCsv(path.join(ir, 'web', 'all-css-declarations.csv')).map((r) => r.property ?? '');
  const sels = readCsv(path.join(ir, 'web', 'all-css-selectors.csv')).map((r) => r.selectorText ?? '');
  const comments = readCsv(path.join(ir, 'web', 'all-css-comments.csv')).map((r) => r.text ?? '');
  ran++;
  const wantDecls = ['border', 'color', 'font-family', 'margin'];
  const lost = wantDecls.filter((d) => !decls.includes(d));
  const bogus = sels.filter((s) => s !== '.w' && s !== '.next');
  if (lost.length > 0) fail(`brace-comment: declarations lost: ${lost.join(', ')} (have ${decls.join(', ')})`);
  else if (bogus.length > 0) fail(`brace-comment: bogus selectors: ${bogus.join(' | ')}`);
  else if (!comments.includes(' theme {x} ')) fail(`brace-comment: comment text not kept as written (${comments.join(' | ')})`);
  else ok(`brace-comment: ${decls.length} declarations kept, selectors exactly .w and .next, comment text as written`);
}

async function keyframeLists(): Promise<void> {
  const root = tree({ 'anim.css': '@keyframes b{0%,20%,53%,to{opacity:1}40%,43%{opacity:0}}\n' });
  const ir = await parse(root);
  const preludes = readCsv(path.join(ir, 'web', 'all-css-rules.csv')).filter((r) => r.ruleKind === 'STYLE_RULE').map((r) => r.preludeText ?? '').sort();
  ran++;
  if (JSON.stringify(preludes) !== JSON.stringify(['0%,20%,53%,to', '40%,43%'])) fail(`keyframe-lists: keyframe block preludes ${JSON.stringify(preludes)}`);
  else ok('keyframe-lists: a minified keyframe selector list is one block with its whole list');
}

async function inlineJs(): Promise<void> {
  const page = [
    '<!doctype html>',
    '<html><head>',
    '<script>',
    'function initCalendar() { return 1; }',
    '</script>',
    '<script type="application/json">{"not": "js"}</script>',
    '<script type="module">',
    'export function boot() { initCalendar(); }',
    '</script>',
    '</head><body>',
    '<button onclick="initCalendar(); track(\'x\')">go</button>',
    '<div onmouseover="hover(this)"></div>',
    '</body></html>',
  ].join('\n') + '\n';
  const root = tree({ 'pages/cal.html': page });
  const ir = await parse(root);
  const modules = readCsv(path.join(ir, 'javascript', 'all-javascript-modules.csv'));
  const methods = readCsv(path.join(ir, 'javascript', 'all-javascript-methods.csv'));
  ran++;
  const names = modules.map((m) => m.qualifiedName).sort();
  const want = ['pages/cal.html#on-1', 'pages/cal.html#on-2', 'pages/cal.html#script-1', 'pages/cal.html#script-2'];
  if (JSON.stringify(names) !== JSON.stringify(want)) { fail(`inline-js: modules ${JSON.stringify(names)}, want ${JSON.stringify(want)}`); return; }
  if (new Set(modules.map((m) => m.jsModuleUniqueHash)).size !== 4) { fail('inline-js: two virtual modules share a key'); return; }
  if (!modules.every((m) => m.filePath === 'pages/cal.html')) { fail(`inline-js: module file paths ${modules.map((m) => m.filePath).join(', ')}`); return; }
  const init = methods.find((m) => m.name === 'initCalendar');
  const boot = methods.find((m) => m.name === 'boot');
  if (!init || init.startLine !== '4') { fail(`inline-js: initCalendar not at pages/cal.html:4 (${init ? init.startLine : 'absent'})`); return; }
  if (!boot || boot.startLine !== '8') { fail(`inline-js: boot not at pages/cal.html:8 (${boot ? boot.startLine : 'absent'})`); return; }
  ok('inline-js: 2 inline scripts + 2 on* bodies are modules of pages/cal.html; initCalendar at :4, boot at :8; the JSON block is not JS');
  // the control: a page with no inline script adds no module
  const root2 = tree({ 'plain.html': '<!doctype html><html><body><script src="a.js"></script></body></html>\n', 'a.js': 'function a() {}\n' });
  const ir2 = await parse(root2);
  const mods2 = readCsv(path.join(ir2, 'javascript', 'all-javascript-modules.csv')).map((m) => m.qualifiedName ?? '');
  ran++;
  if (mods2.length !== 1 || mods2.some((m) => m.includes('#'))) fail(`inline-js control: modules ${JSON.stringify(mods2)}, want only a.js`);
  else ok('inline-js control: a page with only an external script adds no virtual module');
}

async function main(): Promise<number> {
  for (const t of [webFolder, distWalk, braceComment, keyframeLists, inlineJs]) {
    try { await t(); } catch (e) { ran++; fail(`${t.name} threw ${e instanceof Error ? e.stack : String(e)}`); }
  }
  if (ran < 1) { console.log('FAIL  no check ran'); return 1; }
  console.log(bad === 0 ? `\nOK  ${ran} check(s)` : `\nFAIL  ${bad} problem(s) in ${ran} check(s)`);
  return bad === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(2); });
