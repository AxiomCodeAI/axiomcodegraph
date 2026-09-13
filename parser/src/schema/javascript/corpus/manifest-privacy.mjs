#!/usr/bin/env node
/**
 * SPLIT A CORPUS MANIFEST INTO A PUBLISHABLE HALF AND A PRIVATE HALF.
 *
 *   node manifest-privacy.mjs split  <manifest.json> --private <out.json> [--public <out.json>]
 *   node manifest-privacy.mjs verify <public.json> --root <corpus root>
 *   node manifest-privacy.mjs digest <dir> [--salt-file <f>]
 *   node manifest-privacy.mjs commit <name> --salt-file <f>
 *
 * WHY THE DIGEST LIVES HERE AND NOT ON materialise.mjs. It was offered as either, and
 * one of the two is structurally wrong: THE HOLDOUT MUST NEVER BE MATERIALISED. A
 * digest emitted as materialise.mjs's last act can only ever fingerprint something
 * that was cloned, so it could not fingerprint the one thing the salted commitment
 * exists for. A digest is a privacy primitive — a fingerprint without a name — and it
 * belongs with the tool that separates names from shape.
 *
 * Generic on purpose. This is the mechanism the JavaScript corpus design (schema §0.3b, now in commit history)
 * describes, extracted from the js-oracle corpus manifest so that any manifest
 * naming corpora can use it — `src/test-data/javascript/CORPUS-MANIFEST.json`
 * is the one it was extracted for.
 *
 * THE THREE LAYERS
 *
 *   shape    published   counts, ratios, strata, anything derived from the corpus
 *   digest   published   SHA-256 over each group's sorted (relative path, file sha256)
 *   identity PRIVATE     names, URLs, commits, refs, paths — everything that says WHICH
 *
 * WHY A DIGEST AND NOT JUST DELETION. Deleting the names leaves a document whose
 * numbers nobody can check and whose holdout attestation has no referent. The digest
 * is a fingerprint: a holder of the private half can prove their tree is byte-identical
 * to the measured one, and a reader without it can still see that such a proof exists
 * and what it covers. It converts "trust these numbers" into "this corpus has a
 * fingerprint, and here it is".
 *
 * ONE DISTINCTION WORTH KEEPING, contributed by js-corpus when it classified the keys
 * this tool refused on: a PARSER COMMIT SHA is shape, not identity. It identifies what
 * the corpus was measured WITH, not what was measured. The same holds for a compiler
 * version and a fixture revision. Only a value naming the corpus itself is identity.
 *
 * WHAT THIS TOOL WILL NOT DO. It will not guess which fields are identity. Identity
 * keys are declared, because a tool that infers them will one day meet a new field
 * and publish it. Unknown keys are reported, never silently classified.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Keys whose VALUE names a corpus. Declared, never inferred. */
const IDENTITY_KEYS = new Set([
  'package', 'url', 'repo', 'repository', 'commit', 'sha', 'ref', 'tag',
  'subtree', 'subtrees', 'path', 'paths', 'name', 'member',
  'source', 'origin', 'remote', 'clone',
]);

/**
 * CONTAINERS, split ELEMENT-WISE rather than sent wholesale to the private half.
 *
 * Getting this wrong is not a nuance. A first version treated `members` as an
 * identity key, which sent the entire array private and took the per-member file
 * counts and stratum splits with it — destroying exactly the shape the public half
 * exists to carry. An entry is split like any other object: its identity keys go
 * private, its shape keys publish, and ORDER is preserved so the two halves rejoin
 * positionally.
 */
const CONTAINER_KEYS = new Set(['members', 'packages', 'corpora', 'entries']);

/**
 * LABEL MAPS — objects whose KEYS are data labels rather than schema fields, so the
 * key names are shape and must not be reported as unclassified. `strata` is one:
 * its keys are stratum names. Without this the tool refuses on every corpus that
 * adds a stratum, which is a refusal that teaches nothing.
 */
const LABEL_MAP_KEYS = new Set(['strata', 'byStratum', 'counts', 'byOwner', 'bySubtree',
  'byStratumDirectory',   // js-corpus: keys are stratum directory names, values are {files, sha256}
  'byMember',             // js-corpus: keys are holdout ROLES ("flow-detector holdout"), never slugs
]);

/** Keys that are pure shape and always publish. */
const SHAPE_KEYS = new Set([
  'files', 'callSites', 'strata', 'stratum', 'totals', 'bytes', 'count', 'counts',
  'discoveredFiles', 'walkedByParser', 'nonProjectProvenance', 'convergence',
  'compiler', 'parser', 'fixtures', 'generatedBy', 'measuredAgainst', 'attestation',
  'checksRun', 'conclusion', 'askedAt', 'note', 'scopeOfTheRecallNumber',
  'heldBack', 'digest',
  // ---- declared by js-corpus for src/test-data/javascript/CORPUS-MANIFEST.json ----
  // Every key below was reported unclassified by this tool and classified by the
  // manifest's owner, not inferred. Each is a COUNT, a RATE, a CHECK DESCRIPTION
  // or a PARSER COMMIT SHA — none names a corpus. Parser commit SHAs are shape:
  // they identify what was measured WITH, not what was measured.
  'projectFiles', 'flowExcluded', 'bundledExcluded', 'generatedMonolith', 'rows',
  'callSitesAdjudicated', 'recallMisses', 'requireEdgeMisses', 'kindMismatches',
  'optionalityMismatches', 'duplicatePrimaryKeys', 'extractionErrors',
  'shippedSourceFiles', 'testSpecFiles',                      // totals.*: counts
  'priorSweeps', 'reVerifiedAgainst',                          // parser commits measured with
  'adjudicationSweep', 'caveat', 'latestSweep',                // convergence prose, name-free
  'opened', 'at', 'measuredRef', 'sequence', 'commitmentsMatched', 'verdict', 'verifiedAfterMeasurement', 'spent', 'openExposure', 'rerunAtFixedSha',
                                      // js-corpus: heldBack.opened — WHEN, against WHICH parser SHA,
                                      // in what order, whether the pre-registration held, and the
                                      // verdict in class terms. None of it names a repository.
                                      // The member digests are a label map (below).
  'check', 'result', 'canFail', 'summary',                     // attestation rows, rewritten name-free
  'roles', 'identityFrom', 'env', 'onMissing',                 // holdout roles; env-var pointer
  'corpus', 'sha256', 'identities', 'byStratumDirectory', 'byMember',
  'commitments', 'salted',            // js-corpus: a list of hashes is publishable BY DESIGN,
                                      // and `salted` tells a reader which kind they hold
  'algorithm', 'values',              // js-corpus: commitments.* — the FORMULA is shape (it is the
                                      // tool's own commitTo()), and the VALUES are salted hashes,
                                      // which is the whole point of publishing them: checkable by
                                      // a salt holder, opaque to everyone else. The slug and the
                                      // salt are the identity, and neither is under this key.
  // `byStratumDirectory` appears HERE and in LABEL_MAP_KEYS, and needs both: this entry
  // classifies the KEY, the label-map entry classifies its CHILDREN. It looks redundant
  // and is not — removing it from either list makes the tool refuse. js-corpus had it
  // right; an attempt to tidy the duplicate away broke the split immediately.
  // `identities` is a CONTAINER whose
                                      // member `name`s go private — arity publishes, names do not.
                                      // `byStratumDirectory` is declared above as a label map.
  'order', 'alsoSplit',                                        // strata description
]);

function classify(key) {
  if (IDENTITY_KEYS.has(key)) return 'identity';
  if (SHAPE_KEYS.has(key)) return 'shape';
  return 'unknown';
}

/** Split, reporting every key it could not classify rather than guessing. */
function split(node, unknown = new Set(), trail = []) {
  if (Array.isArray(node)) {
    const pub = [], priv = [];
    for (const v of node) { const r = split(v, unknown, trail); pub.push(r.pub); priv.push(r.priv); }
    return { pub, priv };
  }
  if (typeof node === 'string' && trail.length && CONTAINER_KEYS.has(trail[trail.length - 1])) {
    return { pub: null, priv: node };        // a bare name in a container IS the identity
  }
  if (node === null || typeof node !== 'object') return { pub: node, priv: node };
  const pub = {}, priv = {};
  const inLabelMap = trail.length > 0 && LABEL_MAP_KEYS.has(trail[trail.length - 1]);
  for (const [k, v] of Object.entries(node)) {
    if (inLabelMap) { pub[k] = v; continue; }   // keys here are data labels, and shape
    if (CONTAINER_KEYS.has(k)) {
      const r = split(v, unknown, [...trail, k]);
      pub[k] = r.pub; priv[k] = r.priv;      // element-wise; order preserved
      continue;
    }
    const kind = k.startsWith('$') ? 'shape' : classify(k);
    if (kind === 'unknown') unknown.add([...trail, k].join('.'));
    if (kind === 'identity') { priv[k] = v; continue; }
    const r = split(v, unknown, [...trail, k]);
    pub[k] = r.pub;
    const pr = JSON.stringify(r.priv);
    if (r.priv !== undefined && pr !== JSON.stringify(r.pub) && pr !== '{}' && pr !== '[]') priv[k] = r.priv;
  }
  return { pub, priv };
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);
function walk(dir, out = []) {
  let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    const f = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f, out); }
    else if (EXT.has(path.extname(x.name))) out.push(f);
  }
  return out;
}

/**
 * A TREE digest. Salted when a salt is given, and it should be.
 *
 * commitTo() salts a NAME; this salts a TREE, and the tree is the one that is actually
 * enumerable: a stratum with two members has a candidate space small enough to brute
 * force, so an unsalted tree digest identifies its corpus to anyone willing to clone a
 * few dozen repositories and hash them. Same argument as the name commitment, one level
 * down — a fingerprint is only a fingerprint if it cannot be reversed by guessing.
 *
 * The salt is prefixed to the JOINED rows rather than to each row, so the sorted
 * (path, sha) input is identical either way and a salted digest cannot be matched to an
 * unsalted one over the same tree.
 */
export function digestOf(root, salt) {
  const rows = walk(root).map(f => [
    path.relative(root, f),
    crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),
  ]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const joined = rows.map(r => `${r[0]}\t${r[1]}`).join('\n');
  if (salt !== undefined && salt !== null && String(salt).length < 16) {
    throw new Error('refusing to salt a tree digest with a salt under 16 chars — a short salt is enumerable alongside the tree');
  }
  const input = salt ? `${salt}\u0000${joined}` : joined;
  return { files: rows.length, salted: Boolean(salt),
    sha256: crypto.createHash('sha256').update(input).digest('hex') };
}

/**
 * A SALTED COMMITMENT to a name that is not published.
 *
 * A bare sha256(name) conceals nothing: the space of plausible corpus and holdout
 * names is a few thousand well-known repositories, enumerable in seconds. Salted,
 * with the salt in the private manifest, the commitment is checkable by a holder and
 * opaque to everyone else. A fingerprint is only a fingerprint if it cannot be
 * reversed by guessing.
 *
 * Its purpose is PRE-REGISTRATION: when a holdout is finally opened, it can be proved
 * to be the one named at the start, which is what stops a quiet swap for an easier
 * one and turns "chosen before anyone believed they were finished" into evidence.
 */
export function commitTo(name, salt) {
  if (!salt || salt.length < 16) {
    throw new Error('refusing to commit with a short or absent salt — an unsalted digest of a well-known name is reversible by enumeration');
  }
  return crypto.createHash('sha256').update(`${salt}\u0000${name}`).digest('hex');
}

function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
  if (cmd === 'split') {
    if (!file || !opt('--private')) {
      console.error('usage: manifest-privacy.mjs split <manifest.json> --private <out> [--public <out>]');
      return 2;
    }
    const src = JSON.parse(fs.readFileSync(file, 'utf8'));
    const unknown = new Set();
    const { pub, priv } = split(src, unknown);
    if (unknown.size) {
      console.error('REFUSING TO SPLIT — unclassified keys. Declare each as identity or shape:');
      for (const k of [...unknown].sort()) console.error(`  ${k}`);
      console.error('\nA tool that guesses will one day meet a new field and publish it.');
      return 1;
    }
    fs.writeFileSync(opt('--private'), JSON.stringify(priv, null, 2) + '\n');
    const out = opt('--public') ?? file;
    fs.writeFileSync(out, JSON.stringify(pub, null, 2) + '\n');
    console.log(`  public  -> ${out}`);
    console.log(`  private -> ${opt('--private')}   (must NOT be committed)`);
    return 0;
  }
  if (cmd === 'digest') {
    if (!file) { console.error('usage: manifest-privacy.mjs digest <dir> [--salt-file <f>]'); return 2; }
    const sf = opt('--salt-file');
    if (sf && !fs.existsSync(sf)) { console.error(`FATAL: salt file not found at ${sf}`); return 2; }
    const salt = sf ? fs.readFileSync(sf, 'utf8').trim() : undefined;
    let d; try { d = digestOf(path.resolve(file), salt); } catch (e) { console.error(`FATAL: ${e.message}`); return 2; }
    console.log(`  ${d.files} files  sha256 ${d.sha256}  salted=${d.salted}`);
    if (!d.salted) { console.log('  NOTE: unsalted. A small stratum is enumerable — pass --salt-file before publishing.'); }
    return 0;
  }
  if (cmd === 'commit') {
    const saltFile = opt('--salt-file');
    if (!file || !saltFile) { console.error('usage: manifest-privacy.mjs commit <name> --salt-file <f>'); return 2; }
    if (!fs.existsSync(saltFile)) { console.error(`FATAL: salt file not found at ${saltFile}`); return 2; }
    const salt = fs.readFileSync(saltFile, 'utf8').trim();
    try { console.log(`  ${commitTo(file, salt)}`); } catch (e) { console.error(`FATAL: ${e.message}`); return 2; }
    return 0;
  }
  if (cmd === 'verify') {
    const root = opt('--root');
    if (!file || !root) { console.error('usage: manifest-privacy.mjs verify <public.json> --root <dir> [--salt-file <f>]'); return 2; }
    const pub = JSON.parse(fs.readFileSync(file, 'utf8'));
    const want = pub.digest;
    const sf2 = opt('--salt-file');
    // A salted published digest cannot be checked without the salt, and pretending
    // otherwise would report DIFFER on a tree that matches — a false accusation.
    if (want && want.salted && !sf2) {
      console.error('REFUSING TO VERIFY — the published digest is marked salted and no --salt-file was given.');
      console.error('       Recomputing unsalted would report a mismatch on a tree that matches.');
      return 2;
    }
    if (sf2 && !fs.existsSync(sf2)) { console.error(`FATAL: salt file not found at ${sf2}`); return 2; }
    const got = digestOf(root, sf2 ? fs.readFileSync(sf2, 'utf8').trim() : undefined);
    if (!want) { console.error('no `digest` in the public manifest — nothing to verify against'); return 1; }
    const ok = got.sha256 === want.sha256 && got.files === want.files && Boolean(got.salted) === Boolean(want.salted);
    console.log(`  ${ok ? 'MATCH' : 'DIFFER'}  ${got.files} files  ${got.sha256.slice(0, 16)}…  salted=${got.salted}  (published ${want.files} / ${want.sha256.slice(0, 16)}… salted=${Boolean(want.salted)})`);
    return ok ? 0 : 1;
  }
  console.error('usage: manifest-privacy.mjs split|verify|digest|commit …');
  return 2;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
