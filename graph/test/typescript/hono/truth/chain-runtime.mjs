#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Hono torture oracle: the RUNTIME half for call CHAINS (chains/ suite).
//
// The fixture is copied, every call site and function is instrumented by the repository's TypeScript runtime
// oracle (../../runtime-oracle/instrument.mjs + runtime.cjs: each call site records the declaration that actually
// ran), every module that exports a Hono app is loaded with the pinned `hono`, and each `chain` row's request is
// sent to every exported app with `app.request(path, { method })`. The observed edges are
// (function enclosing the site -> function entered); a framework hop such as middleware -> handler is observed too,
// because the handler is entered from the middleware's own `await next()` site.
//
// usage: node chain-runtime.mjs <src-dir> <case.chains> [--edges] [--routes <hono-oracle output>] [--requests <case.chains>]
// A `body VERB PATH JSON` row of the chains file sends that JSON body (content-type application/json) with that request.
// stdout: `runtime chains <n hops checked> over <m chains>` | `runtime skip <reason>`; one `rtedge FROM TO` line per
// observed project edge with --edges; exit 1 when a hop of a chain row was not observed, or an `edge .. rt` row of
// the golden was not observed.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RT = path.resolve(HERE, '../../runtime-oracle');
const SRC = path.resolve(process.argv[2]);
const CHAINS = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'));
const EDGES = process.argv.includes('--edges');
// --routes <hono-oracle output>: also request every route the static oracle lists (a sample value per parameter), so
// the trace covers every handler, not only the chains the golden names
const RI = process.argv.indexOf('--routes');
const ROUTES = RI > 0 ? fs.readFileSync(process.argv[RI + 1], 'utf8').split('\n').map(l => l.split('\t')).filter(r => r[0] === 'route') : [];
const sample = p => p.split('/').map(s => s.startsWith(':') ? 'x1' : s === '*' ? 'x' : s).join('/') || '/';

const chains = CHAINS.filter(r => r[0] === 'chain' && r[2] !== '-');
const rtEdges = CHAINS.filter(r => r[0] === 'edge' && r[3] === 'rt');
if (!chains.length && !rtEdges.length && !ROUTES.length && !(process.argv.includes('--requests') && fs.existsSync(process.argv[process.argv.indexOf('--requests') + 1]))) { console.log('runtime skip no chain with a request'); process.exit(0); }

const W = fs.mkdtempSync(path.join(os.tmpdir(), 'hono-chain-'));
const cleanup = () => { try { fs.rmSync(W, { recursive: true, force: true }); } catch { } };
fs.cpSync(SRC, W, { recursive: true });
const realW = fs.realpathSync(W);
// a JavaScript fixture (the JS twin suite): the repository's runtime instrumenter rewrites TypeScript files only, so
// each `.js` is traced as a `.ts` of the same text (JavaScript is TypeScript syntax; node strips no types from it,
// and runtime-hooks.mjs resolves `./x.js` to `./x.ts`); every key is spelled back with `.js` below
const renamed = new Set();
(function toTs(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) toTs(p);
    else if (e.name.endsWith('.js')) { const t = p.replace(/\.js$/, '.ts'); fs.renameSync(p, t); renamed.add(path.relative(realW, t).split(path.sep).join('/')); }
  }
})(realW);
const unTs = rel => renamed.has(rel) ? rel.replace(/\.ts$/, '.js') : rel;
const T = path.join(realW, '.ax-tables');
fs.mkdirSync(T);
const ins = spawnSync(process.execPath, [path.join(RT, 'instrument.mjs'), '--src', realW, '--out', realW, '--tables', T], { encoding: 'utf8' });
if (ins.status !== 0) { console.log(`runtime skip instrumenter failed: ${(ins.stderr || '').split('\n')[0]}`); cleanup(); process.exit(0); }
// the pinned packages are linked AFTER instrumenting: library code is never rewritten
fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(realW, 'node_modules'));
if (!fs.existsSync(path.join(realW, 'package.json'))) fs.writeFileSync(path.join(realW, 'package.json'), '{"type":"module"}');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(ts|mts|js|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts') && !/(\.test\.|\.spec\.|client)/.test(e.name)) files.push(p);
  }
})(realW);
// `body VERB PATH JSON` rows: the request carries that JSON body (a route behind a json validator is only entered
// when the body passes it); every other request has none
// --requests <case.chains>: the --edges run (no chains file) also sends that file's chain requests, with its bodies;
// a partial route is in no `route` row, so its chain's request is the only one that reaches it
const QI = process.argv.indexOf('--requests');
const QROWS = QI > 0 && fs.existsSync(process.argv[QI + 1]) ? fs.readFileSync(process.argv[QI + 1], 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t')) : [];
const bodies = new Map([...CHAINS, ...QROWS].filter(r => r[0] === 'body').map(r => [`${r[1]}\t${r[2]}`, r.slice(3).join('\t')]));
const requests = [...new Set([...[...chains, ...QROWS.filter(r => r[0] === 'chain' && r[2] !== '-')].map(r => `${r[2]}\t${r[3]}`),
  ...ROUTES.filter(r => r[1] !== 'ANY').map(r => `${r[1]}\t${sample(r[2])}`)])];
const driver = `
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(${JSON.stringify(pathToFileURL(path.join(HERE, 'runtime-hooks.mjs')).href)});
// the tracer runtime (CommonJS) is loaded by a dynamic import, which runs it exactly as a require would
await import(${JSON.stringify(pathToFileURL(path.join(RT, 'runtime.cjs')).href)});
const { HonoBase } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'node_modules/hono/dist/hono-base.js')).href)});
const apps = new Set(); let err = null;
for (const f of ${JSON.stringify(files.sort())}) {
  try { const ns = await import(pathToFileURL(f).href); for (const v of Object.values(ns)) if (v instanceof HonoBase) apps.add(v); }
  catch (e) { err = f + ': ' + String(e.message || e).split('\\n')[0]; }
}
if (!apps.size) { console.log('NOAPP ' + (err || '')); }
const bodies = ${JSON.stringify(Object.fromEntries(bodies))};
for (const rq of JSON.parse(process.env.AX_REQUESTS)) {
  const [method, p] = rq.split('\\t');
  const init = rq in bodies ? { method, body: bodies[rq], headers: { 'content-type': 'application/json' } } : { method };
  for (const app of apps) { try { await app.request(p, init); } catch (e) { console.log('REQERR ' + p + ' ' + e.message); } }
}
globalThis.__axFlush && globalThis.__axFlush();
`;
fs.writeFileSync(path.join(realW, '.ax-driver.mjs'), driver);
// one traced process per call: `requests` in order, each to every exported app; a fresh trace dir per call
let nrun = 0;
const traceRun = (rqs) => {
  const out = path.join(realW, `.ax-trace${nrun++}`); fs.mkdirSync(out);
  const run = spawnSync(process.execPath, [path.join(realW, '.ax-driver.mjs')], { cwd: realW, encoding: 'utf8', env: { ...process.env, AX_TRACE_OUT: out, AX_REQUESTS: JSON.stringify(rqs) } });
  const noapp = (run.stdout || '').split('\n').find(l => l.startsWith('NOAPP'));
  if (run.status !== 0 || noapp) return { skip: noapp ? noapp.slice(6) : (run.stderr || '').split('\n').find(Boolean) };
  return { out };
};
const first = traceRun(requests);
if (first.skip !== undefined) { console.log(`runtime skip not loadable (${first.skip})`); cleanup(); process.exit(0); }

// id tables -> `<rel>:<line>:<col>` keys, the same spelling as the static oracles
const tsv = f => fs.readFileSync(path.join(T, f), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
const relOf = f => unTs(path.relative(realW, path.resolve(realW, f)).split(path.sep).join('/'));
const declKey = new Map(tsv('decls.tsv').map(r => [r[0], `${relOf(r[1])}:${r[2]}:${r[3]}`]));
const siteFrom = new Map(tsv('sites.tsv').map(r => [r[0], r[8]]));
const siteLoc = new Map(tsv('sites.tsv').map(r => [r[0], `${relOf(r[1])}:${r[2]}:${r[3]}`]));
// a function expression handed over as an argument at a site in FROM (callbacks.tsv): when the host runs it later
// (a promise continuation, a timer) no site is open, so it is entered `unlinked`; the hop FROM -> it is then
// observed as "handed over by FROM, and ran"
const handed = new Set(tsv('callbacks.tsv').map(r => `${declKey.get(siteFrom.get(r[0]))}\t${declKey.get(r[1])}`));
const readTrace = (out) => {
  const t = { seen: new Set(), seenAt: new Set(), entered: new Set(), unlinked: new Set() };
  for (const f of fs.readdirSync(out)) for (const l of fs.readFileSync(path.join(out, f), 'utf8').split('\n')) {
    const c = l.split('\t');
    if (c[0] === 'unlinked' || c[0] === 'pair') { const d = declKey.get(c[2]); if (d) { t.entered.add(d); if (c[0] === 'unlinked') t.unlinked.add(d); } }
    if (c[0] !== 'pair') continue;
    const from = declKey.get(siteFrom.get(c[1])), to = declKey.get(c[2]);
    if (from && to) { t.seen.add(`${from}\t${to}`); t.seenAt.add(`${from}\t${to}\t${siteLoc.get(c[1])}`); }
  }
  return t;
};
const { seen, seenAt, entered, unlinked } = readTrace(first.out);
// with the call site: a callback a LIBRARY invokes (`xs.map(cb)`) is attributed to whatever site is open, so the
// checker keeps a run-time edge only at a site the compiler itself could not resolve
if (EDGES) for (const e of [...seenAt].sort()) console.log(`rtedge\t${e}`);
const bad = [];
let hops = 0, viaLib = 0;
for (const r of chains) {
  const fns = r.slice(4);
  let alone = null;
  for (let i = 0; i + 1 < fns.length; i++) {
    hops++; const k = `${fns[i]}\t${fns[i + 1]}`;
    if (seen.has(k) || (handed.has(k) && entered.has(fns[i + 1]))) continue;
    // a hop through LIBRARY code that awaits before it continues (a json validator reads the body, then calls
    // next): no project site is open when the next function is entered, so it is `unlinked`. It is observed when a
    // process that sends ONLY this chain's request runs both functions, the second entered from library code.
    if (unlinked.has(fns[i + 1])) {
      if (!alone) { const t = traceRun([`${r[2]}\t${r[3]}`]); alone = t.out ? readTrace(t.out) : { entered: new Set(), unlinked: new Set() }; }
      if (alone.entered.has(fns[i]) && alone.unlinked.has(fns[i + 1])) { viaLib++; continue; }
    }
    bad.push(`chain ${r[1]} hop ${i}: ${fns[i]} -> ${fns[i + 1]} not observed at run time`);
  }
}
for (const r of rtEdges) if (!seen.has(`${r[1]}\t${r[2]}`)) bad.push(`edge ${r[1]} -> ${r[2]} (rt) not observed at run time`);
cleanup();
if (bad.length) { for (const b of bad) console.log(`runtime DISAGREES ${b}`); process.exit(1); }
console.log(`runtime chains ${hops} hops over ${chains.length} chains, ${rtEdges.length} rt edges${viaLib ? `, ${viaLib} hops entered from library code in a one-request run` : ''}`);
