#!/usr/bin/env node
/**
 * Materialise and verify the pinned measurement corpus.
 *
 *   node corpus/materialise.mjs            clone/verify against the private identity file
 *   node corpus/materialise.mjs --verify   check only, no network
 *   node corpus/materialise.mjs --digest   recompute stratum digests and compare
 *
 * THREE LAYERS. Shape and digest are in CORPUS.json and publish. IDENTITY — which
 * package is which — is private and read from $JS_CORPUS_IDENTITY. This script
 * FAILS LOUDLY when that file is absent rather than measuring a partial corpus,
 * because a silently partial corpus is the failure the whole manifest exists to
 * prevent.
 *
 * WHY THE DIGEST EXISTS. It is not decoration. Verifying that eight SHAs resolve
 * and that a second run is idempotent proves the MECHANISM works; it does not
 * prove the tree matches the population the numbers were measured on. Computing
 * the digest is what caught that it does not — see CORPUS.json `reproduces`.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const PUBLIC = JSON.parse(fs.readFileSync(path.join(HERE, 'CORPUS.json'), 'utf8'));
const ROOT = path.resolve(REPO_ROOT, PUBLIC.materialiseRoot);
const mode = process.argv.includes('--digest') ? 'digest'
  : process.argv.includes('--verify') ? 'verify' : 'materialise';

if (/\/(tmp|scratchpad)(\/|$)/.test(ROOT)) {
  console.error(`FATAL: materialiseRoot resolves into a scratchpad (${ROOT}).`);
  console.error('       That is the failure this manifest exists to prevent.');
  process.exit(2);
}

function loadIdentity() {
  const p = process.env[PUBLIC.identityFrom.env];
  if (!p) {
    console.error(`FATAL: $${PUBLIC.identityFrom.env} is not set.`);
    console.error('       The identity layer is private and out of tree. Without it this tool');
    console.error('       cannot name a single package, and measuring whatever happens to be on');
    console.error('       disk would report a number for a corpus nobody specified.');
    process.exit(2);
  }
  if (!fs.existsSync(p)) { console.error(`FATAL: identity file not found at ${p}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);
function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(f, out); }
    else if (EXT.has(path.extname(e.name))) out.push(f);
  }
  return out;
}

/** SHA-256 over the stratum's sorted (relative path, file sha256) list. */
function digestStrata(identity) {
  const byStratum = new Map();
  for (const p of identity.packages) {
    const name = p.repo.split('/')[1];
    const pkgRoot = path.join(ROOT, name);
    const base = p.subtree === '.' ? pkgRoot : path.join(pkgRoot, p.subtree);
    const rows = walk(base).map(f => [
      path.relative(pkgRoot, f),
      crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),
    ]);
    const acc = byStratum.get(p.stratum) ?? [];
    acc.push(...rows); byStratum.set(p.stratum, acc);
  }
  const out = {};
  for (const [st, rows] of byStratum) {
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    out[st] = { files: rows.length,
      sha256: crypto.createHash('sha256').update(rows.map(r => `${r[0]}\t${r[1]}`).join('\n')).digest('hex') };
  }
  return out;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const identity = loadIdentity();

if (mode === 'digest') {
  const got = digestStrata(identity);
  let bad = 0;
  console.log('stratum digests — computed against published:');
  for (const [st, want] of Object.entries(PUBLIC.strata)) {
    const g = got[st];
    const ok = g && g.sha256 === want.sha256 && g.files === want.files;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${st.padEnd(16)} ${String(g?.files ?? 0).padStart(5)} files  ${(g?.sha256 ?? '-').slice(0, 16)}…  (published ${want.files} / ${want.sha256.slice(0, 16)}…)`);
  }
  const total = Object.values(got).reduce((a, s) => a + s.files, 0);
  console.log(`\n  materialised ${total} files; section 0.3 reports ${PUBLIC.reproduces.documentedPopulation}`);
  if (PUBLIC.reproduces.status !== 'COMPLETE')
    console.log(`  reproduces: ${PUBLIC.reproduces.status} — see CORPUS.json 'reproduces.causes'`);
  process.exit(bad ? 1 : 0);
}

fs.mkdirSync(ROOT, { recursive: true });
let ok = 0, missing = 0, drifted = 0;
for (const p of identity.packages) {
  const name = p.repo.split('/')[1];
  const dir = path.join(ROOT, name);
  if (fs.existsSync(path.join(dir, '.git'))) {
    const head = git(['rev-parse', 'HEAD'], dir);
    if (head === p.sha) { console.log(`  ok       ${name.padEnd(12)} ${p.sha.slice(0, 12)}  ${p.stratum}`); ok++; continue; }
    console.log(`  DRIFTED  ${name.padEnd(12)} head ${head.slice(0, 12)} != pinned ${p.sha.slice(0, 12)}`);
    drifted++;
    if (mode === 'verify') continue;
    git(['fetch', '--depth', '1', 'origin', p.sha], dir);
    git(['checkout', '--detach', p.sha], dir);
    continue;
  }
  missing++;
  if (mode === 'verify') { console.log(`  MISSING  ${name.padEnd(12)} ${p.stratum}`); continue; }
  console.log(`  cloning  ${name.padEnd(12)} ${p.sha.slice(0, 12)}`);
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '--quiet'], dir);
  // scrub-allow: a URL TEMPLATE is the mechanism by which names are fetched, not a
  // reference to one. `p.repo` comes from the PRIVATE identity file and is never in
  // this tree; the host is infrastructure. Ruled 2026-09-12.
  git(['remote', 'add', 'origin', `https://github.com/${p.repo}`], dir);  // scrub-allow: URL template, not a reference — the name comes from the private identity file
  git(['fetch', '--depth', '1', '--quiet', 'origin', p.sha], dir);
  git(['checkout', '--quiet', '--detach', p.sha], dir);
}
console.log(`\n  root: ${ROOT}`);
console.log(`  ${identity.packages.length} pinned: ${ok} at pin, ${drifted} drifted, ${missing} missing`);
console.log(`  held back, not materialised: ${identity.heldBack.length} (${PUBLIC.heldBack.attestation})`);
if (PUBLIC.reproduces.status !== 'COMPLETE')
  console.log(`\n  !! reproduces: ${PUBLIC.reproduces.status} — ${PUBLIC.reproduces.manifestMaterialises} of ${PUBLIC.reproduces.documentedPopulation} files`);
if (mode === 'verify' && (drifted || missing)) process.exit(1);
