#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Hono torture oracle: the RUNTIME half.
//
// Runs the fixture with the pinned `hono` and reads what Hono itself built: `app.routes` of every
// Hono instance a module exports, in registration order, each handler mapped back to its source
// function through V8's [[FunctionLocation]] (node strips TypeScript types in place, so positions
// are the source's own). The static oracle's store for that app must hold the SAME sequence of
// (method, full path, handler). This is the strongest truth for route / basePath / mount: it is
// not a model of Hono, it is Hono.
//
// usage: node runtime-check.mjs <src-dir> <static-oracle --stores output file>
// stdout: `runtime agree <n entries compared> <apps>` | `runtime skip <reason>`; exit 1 on disagreement.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import inspector from 'node:inspector';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { loadTypeScript } = await import(new URL('../../ground-truth/load-typescript.mjs', import.meta.url).href);
const ts = loadTypeScript(HERE, { toolName: 'hono-runtime-check' });
const SRC = path.resolve(process.argv[2]);
const STATIC = fs.readFileSync(process.argv[3], 'utf8');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(ts|mts|js|mjs|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
  }
})(SRC);
if (fs.readdirSync(SRC, { recursive: true }).some(f => /\.(tsx|jsx)$/.test(f))) { console.log('runtime skip jsx'); process.exit(0); }
// a fixture that only exists to be parsed (a test file, a client, a worker entry) can opt out by name
const SKIP = /(\.test\.|\.spec\.|client)/;

// work copy: the fixture plus the oracle's node_modules, so `hono` is the pinned package
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'hono-rt-'));
fs.cpSync(SRC, W, { recursive: true });
fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(W, 'node_modules'));
if (!fs.existsSync(path.join(W, 'package.json'))) fs.writeFileSync(path.join(W, 'package.json'), '{"type":"module"}');
register(pathToFileURL(path.join(HERE, 'runtime-hooks.mjs')).href);

const session = new inspector.Session();
session.connect();
const scripts = new Map();
session.on('Debugger.scriptParsed', m => scripts.set(m.params.scriptId, m.params.url));
const post = (m, p) => new Promise((res, rej) => session.post(m, p, (e, r) => e ? rej(e) : res(r)));
await post('Debugger.enable');

const { HonoBase } = await import(pathToFileURL(path.join(HERE, 'node_modules/hono/dist/hono-base.js')).href);
const COMPOSED = '__COMPOSED_HANDLER'; // hono/dist/utils/constants.js
const realW = fs.realpathSync(W);
const exported = new Set();
let loadErr = null;
for (const f of files.map(f => path.join(realW, path.relative(SRC, f))).sort()) {
  if (SKIP.test(path.basename(f))) continue;
  try {
    const ns = await import(pathToFileURL(f).href);
    // a CommonJS fixture gets hono's cjs build, a different class object: recognise the instance by shape too
    for (const v of Object.values(ns)) if (v instanceof HonoBase || (v && Array.isArray(v.routes) && v.router && typeof v.fetch === 'function')) exported.add(v);
  } catch (e) { loadErr = `${path.relative(realW, f)}: ${String(e.message || e).split('\n')[0]}`; }
}
if (!exported.size) { console.log(`runtime skip ${loadErr ? 'not loadable (' + loadErr + ')' : 'no exported Hono instance'}`); cleanup(); process.exit(0); }

// function -> static key `<rel>:<line>:<col>` of the innermost function node containing V8's position
const sfCache = new Map();
function keyAt(file, line0, col0) {
  if (!sfCache.has(file)) sfCache.set(file, ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
  const sf = sfCache.get(file);
  const pos = sf.getPositionOfLineAndCharacter(line0, col0);
  let best = null;
  (function visit(n) {
    if (n.getStart(sf) <= pos && pos < n.end) {
      if (ts.isFunctionLike(n) && n.body) best = n;
      ts.forEachChild(n, visit);
    }
  })(sf);
  if (!best) return null;
  const p = sf.getLineAndCharacterOfPosition(best.getStart(sf));
  return `${path.relative(realW, file).split(path.sep).join('/')}:${p.line + 1}:${p.character + 1}`;
}
async function fnKey(fn) {
  if (fn[COMPOSED]) fn = fn[COMPOSED];
  globalThis.__probe = fn;
  const { result } = await post('Runtime.evaluate', { expression: 'globalThis.__probe' });
  const { internalProperties } = await post('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
  const fl = (internalProperties || []).find(p => p.name === '[[FunctionLocation]]');
  if (!fl) return 'lib';
  const url = scripts.get(fl.value.value.scriptId) || '';
  if (!url.startsWith('file:')) return 'lib';
  const file = fileURLToPath(url);
  if (!file.startsWith(realW + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) return 'lib';
  return keyAt(file, fl.value.value.lineNumber, fl.value.value.columnNumber) || 'lib';
}

// static stores: origin -> [{method,path,key}]
const stores = new Map();
for (const l of STATIC.split('\n')) {
  const c = l.split('\t');
  if (c[0] !== 'store') continue;
  if (!stores.has(c[1])) stores.set(c[1], []);
  const st = stores.get(c[1]), last = st[st.length - 1];
  // alternatives of one factory call (a branch returns one middleware, the rest another): one run registers ONE
  // of them, so the group is a single static entry that any of its keys satisfies
  if (c[8] && last && last.alt === c[8]) { last.keys.push(c[6]); continue; }
  st.push({ method: c[4], path: c[5], key: c[6], keys: [c[6]], alt: c[8] || '' });
}
// a registration the static half declared undetermined (a run-time path) is not in its store: the
// runtime value is one execution's answer, not the program's
const undetermined = new Set(STATIC.split('\n').filter(l => l.startsWith('partial\t')).map(l => l.split('\t')[1]));
// a registration behind a condition or in a loop: one run takes one path; compare only the rest
const conditional = new Set(STATIC.split('\n').filter(l => /^unknown\t.*\t(conditional|loop)_registration\t/.test(l)).map(l => l.split('\t')[3]));
for (const k of conditional) undetermined.add(k);
const staticRouteKeys = new Set(STATIC.split('\n').filter(l => l.startsWith('route\t')).map(l => l.split('\t')[3]).filter(k => !k.startsWith('lib')));
for (const [, st] of stores) for (let i = st.length - 1; i >= 0; i--) if (st[i].keys.some(k => conditional.has(k))) st.splice(i, 1);
function aligns(rt, st) {
  // user functions must align one for one; a runtime library entry the static model does not
  // spell (a validator a library inserts on its own) may be skipped, never a user function
  let i = 0, j = 0, n = 0;
  while (i < rt.length && j < st.length) {
    const a = rt[i], b = st[j];
    const same = a.method === b.method && a.path === b.path && b.keys.some(k => a.key === k || (a.key === 'lib' && k.startsWith('lib:')));
    if (same) { i++; j++; n++; continue; }
    if (a.key === 'lib') { i++; continue; }
    return { ok: false, at: `runtime #${i} ${a.method} ${a.path} ${a.key} vs static #${j} ${b.method} ${b.path} ${b.key}` };
  }
  while (i < rt.length && rt[i].key === 'lib') i++;
  return i === rt.length && j === st.length ? { ok: true, n } : { ok: false, at: `length runtime ${rt.length - i} left, static ${st.length - j} left` };
}
let compared = 0, bad = [];
const seen = new Set();
for (const app of exported) {
  if (seen.has(app.routes)) continue; seen.add(app.routes);
  const rt = [];
  for (const r of app.routes) { const key = await fnKey(r.handler); r.handlerKey = key; if (!undetermined.has(key)) rt.push({ method: r.method, path: r.path, key }); }
  if (!rt.length) continue; // every registration of this app is one the static half declared undetermined
  // an app whose every ROUTE the static half declared undetermined (partial): its middleware alone is no route list
  // to compare (the static half keeps a partial route's chain as `mwp` rows, without a store)
  if (rt.every(r => !staticRouteKeys.has(r.key)) && app.routes.some(r => undetermined.has(r.handlerKey))) continue;
  let best = null;
  for (const [origin, st] of stores) { const a = aligns(rt, st); if (a.ok) { best = a; break; } best = best || { ...a, origin }; }
  if (best && best.ok) compared += best.n;
  else bad.push(`no static store matches an exported app: ${best ? best.at : 'no stores'}\n    runtime: ${rt.map(r => `${r.method} ${r.path} ${r.key}`).join(' | ')}`);
}
cleanup();
if (bad.length) { console.log(`runtime DISAGREE\n  ${bad.join('\n  ')}`); process.exit(1); }
if (compared < 1) { console.log('runtime skip every exported route is declared undetermined by the static half'); process.exit(0); }
console.log(`runtime agree ${compared} entries over ${seen.size} app(s)`);
process.exit(0);
function cleanup() { try { fs.rmSync(W, { recursive: true, force: true }); } catch { } }
