/**
 * NO TRACKED FILE MAY NAME A CORPUS OR BENCHMARK WE MEASURED AGAINST.
 *
 *     npx tsx src/test/oss-scrub-gate.ts                 every tracked file
 *     npx tsx src/test/oss-scrub-gate.ts --scope src/x   one subtree
 *     npx tsx src/test/oss-scrub-gate.ts --self-test     prove it can fail
 *     npx tsx src/test/oss-scrub-gate.ts --inventory     write OSS-SCRUB-INVENTORY.md
 *
 * Every mode but --self-test needs `JS_SCRUB_DENYLIST=<path>`: the token list
 * is PRIVATE and lives outside every repository (see below). Without it the
 * gate refuses rather than scanning with an empty list and reporting clean.
 *
 * ## The inventory is an ARTEFACT, written by this instrument, at a SHA
 *
 * Five repo-wide counts from four agents existed at once — 144, 104, 140, 82,
 * 57 — none wrong through carelessness. They were taken at different moments
 * with different pattern sets, and every one lived in a message. One of them,
 * sent to two owners as their targets, described a tree that had already been
 * scrubbed by a commit the sender had not yet merged. A number nobody can
 * re-derive is not a measurement.
 *
 * So `--inventory` writes `src/test/OSS-SCRUB-INVENTORY.md`: the SHA it was
 * taken at, the active and excluded tokens, totals by subtree and owner, and
 * every hit as file:line. It is committed. Owners run `--scope` and reconcile
 * against it; nobody greps. The file is exempt from the scan, because it names
 * what it counts.
 *
 * ## A grep is a claim; a committed check is a guarantee
 *
 * This repository is going open source. A one-time scrub finds today's names;
 * the next fixture, comment or commit reintroduces one and nobody knows. So the
 * denylist lives here, the walk is over `git ls-files` — the set that actually
 * ships — and a hit is a non-zero exit with file and line.
 *
 * The merge to main is a squash. That keeps intermediate commits out of main's
 * history and does NOTHING about the tree: a squash publishes the final tree in
 * one commit instead of forty. This gate is a tree operation.
 *
 * ## What is on the list, and what is deliberately not
 *
 * Names of corpora and benchmarks we MEASURED AGAINST. Real build dependencies
 * are not on it — `typescript` and `tree-sitter` are what this parser is made
 * of, not what it was measured against — and neither are technical terms that
 * happen to be product names (`eslint` names a directive kind that exists in
 * the language, `moment` is a word). Matching is on word boundaries, case-
 * insensitive, so `Zorbulon`, `zorbulon-dom` and `prezorbulon` would be three
 * entries and `zorbulonic` is not a hit.
 *
 * Replace, do not delete: "894 references lost in one package" is still the
 * finding. The package name is the problem.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Word-boundary tokens. Extend by owner; every language's corpora belong here.
 *
 * ## Tokens that name a DEPENDENCY are excluded BY CONSTRUCTION
 *
 * A corpus was named `vite`; `vitest` is a real devDependency and `vite` is in
 * its dependency graph. A gate cannot tell "what we were measured against" from
 * "what we are made of" by spelling, so a token in both is unusable — and vite
 * will not be the last. The rule is therefore derived at runtime, not
 * hand-maintained: every package name in `package.json`'s dependency graph, as
 * resolved by `package-lock.json`, is removed from the denylist before the scan
 * and the exclusion is PRINTED. A hand-kept exception list would be the
 * shared-string defect again — a list that is right until the next install.
 *
 * `vite` is listed below on purpose, so the derivation is exercised on every
 * run: if it ever stops being a dependency, the token goes live automatically.
 */
/**
 * DOCUMENTS THAT DESCRIBE THE SCRUB ARE SCANNED WITH THE SAME PATTERNS AS SOURCES.
 *
 * This is not an obvious rule and it was learned three times independently before
 * anyone wrote it down:
 *
 *   - a fixtures MANIFEST named a UI library as an example of "a bare word excluded",
 *     inside the very section documenting the scrub;
 *   - a scrub log quoted the name it had just removed;
 *   - a schema document's prose, explaining a regex false positive, contained the
 *     literal package name it was explaining.
 *
 * All three survived a careful manual pass and two censuses, and all three fell to
 * this gate in one run. The reason they survive human review is that IN A DOCUMENT
 * ABOUT THE SCRUB, A NAME READS AS A CITATION RATHER THAN A REFERENCE — the reader's
 * eye classifies it as an example of the thing rather than an instance of it. A
 * publication tarball does not draw that distinction.
 *
 * So: no exemption for documentation, for changelogs, for manifests, or for the
 * scrub's own records. A sentence about a leak is still a leak.
 *
 * COMMIT MESSAGES ARE OUT OF SCOPE and deliberately so: the merge to main is a
 * SQUASH, so intermediate messages never reach the published history. TRACKED PROSE
 * IS IN SCOPE, because it ships as-is. The distinction is what the tree carries, not
 * what the history remembers.
 */
/**
 * THE DENYLIST IS NOT IN THE TREE.
 *
 * It was, and it published exactly what it existed to hide: every corpus
 * member's name and both holdout organisations, in plain text, twenty lines
 * below the comment saying a holdout's entire value is that it is unnamed —
 * found by js-corpus's second opinion, a scan derived from the private
 * identity rather than from a token list, which this gate could not see
 * because it excluded its own list. A plain-text list conceals less than the
 * bare hash the human had already ruled conceals nothing.
 *
 * So the list lives beside the private corpus identity, outside every
 * repository, and is read from `$JS_SCRUB_DENYLIST`: one token per line, `#`
 * comments, and a second word `ambiguous` for a token that is also ordinary
 * English or a code identifier (a verb, a noun, a two-character fixture
 * identifier) and is matched only where it names a package —
 * quoted, capitalised as a proper noun, or in a path or specifier. The gate
 * FAILS LOUDLY when the variable is unset or the file is missing: the same
 * design as `$JS_CORPUS_IDENTITY`, and the reason it is a design rather than
 * an omission. The inventory records the list's size and digest, never a
 * token. `--self-test` writes its own synthetic list and needs nothing.
 *
 * What stays in the tree names no corpus member: benchmark families and
 * infrastructure hosts that a shared lesson may cite.
 */
const GENERIC_DENYLIST: readonly string[] = [
  'owasp', 'cwe-bench', 'benchmarkjava', 'camel_', 'github.com', 'facebook', // scrub-allow: generic benchmark families and hosts, kept in the tree by ruling
];

interface Denylist { readonly strict: readonly string[]; readonly ambiguous: readonly string[]; readonly digest: string }

function parseDenylist(text: string): Denylist {
  const strict: string[] = []; const ambiguous: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') { continue; }
    const [token, flag] = line.split(/\s+/);
    if (token === undefined) { continue; }
    (flag === 'ambiguous' ? ambiguous : strict).push(token);
  }
  return {
    strict: [...GENERIC_DENYLIST, ...strict],
    ambiguous,
    digest: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
}

function loadDenylist(): Denylist {
  const file = process.env['JS_SCRUB_DENYLIST'];
  if (file === undefined || file === '') {
    console.log('REFUSED: $JS_SCRUB_DENYLIST is not set. The denylist lives beside the private '
      + 'corpus identity, outside every repository, and this gate does not run without it — a '
      + 'list in the tree publishes the names it exists to hide.');
    process.exit(2);
  }
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    console.log(`REFUSED: $JS_SCRUB_DENYLIST names ${file}, which cannot be read.`);
    process.exit(2);
  }
  return parseDenylist(text);
}

/**
 * A line carrying `scrub-allow: <reason>` is exempt, and the allowance is
 * RECORDED in the inventory with its reason.
 *
 * For the case a term removal would get wrong: a platform global's name in a
 * list of platform globals is the platform's, not a corpus — but elsewhere it is the
 * corpus, and removing the token would lose it everywhere. So the allowance is
 * per line, must state why, and is printed so it can be audited rather than
 * accumulate.
 */
const ALLOW_MARKER = /scrub-allow:\s*(\S.*)$/;

/**
 * An ABSOLUTE HOME PATH is a different kind of disclosure from a corpus name,
 * and it passed everything until a blessing tool wrote one into a golden:
 * `/Users/<name>/…` as a merged-group name, tracked, heading to OSS. The
 * denylist could not see it because a machine path is not a corpus identity.
 * cs-oracle had this check as a pre-staging audit when it versioned
 * parser-oracle — in one repository and not the one being published.
 *
 * The user segment is what leaks, so the form is the three home roots plus
 * one path segment; a bare `/home/` in prose does not match. Windows spelled
 * both ways.
 */
const HOME_PATH = /(?:\/Users\/|\/home\/|\/root\/|[A-Za-z]:\\{1,2}Users\\{1,2})[A-Za-z0-9._-]+/;

/** Extensions never scanned: binary or generated. */
const SKIP = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz',
  '.jar', '.class', '.wasm', '.lock']);

function tracked(scope: string | undefined): string[] {
  const out = execFileSync('git', ['ls-files', '-z', ...(scope === undefined ? [] : [scope])],
    { encoding: 'utf-8' });
  return out.split('\0').filter((f) => f !== '');
}

/**
 * Every package name in the dependency graph: declared in `package.json`, and
 * everything `package-lock.json` resolved beneath them. The lock file is the
 * authority because a transitive dependency is as real as a direct one.
 */
function dependencyGraph(root: string): Set<string> {
  const names = new Set<string>();
  const strip = (key: string): string => key.replace(/^.*node_modules\//, '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    for (const name of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
      names.add(name.toLowerCase());
    }
  } catch { /* no package.json: nothing declared */ }
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf-8')) as {
      packages?: Record<string, unknown>;
    };
    for (const key of Object.keys(lock.packages ?? {})) {
      if (key !== '') { names.add(strip(key).toLowerCase()); }
    }
  } catch { /* no lock file: only the declared names */ }
  return names;
}

function effectiveDenylist(root: string, list: Denylist): { active: string[]; excluded: string[] } {
  const graph = dependencyGraph(root);
  const active: string[] = []; const excluded: string[] = [];
  for (const token of list.strict) {
    (graph.has(token.toLowerCase()) ? excluded : active).push(token);
  }
  return { active, excluded };
}

type Allowance = { file: string; line: number; reason: string };
const allowances: Allowance[] = [];

function scan(
  files: readonly string[], root: string, tokens: readonly string[], proseAmbiguous: readonly string[]
): Array<{ file: string; line: number; hit: string }> {
  allowances.length = 0;
  const escape = (t: string): string => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const strict = `(?<![A-Za-z0-9_])(${tokens.map(escape).join('|')})(?![A-Za-z0-9_])`;
  // A prose-ambiguous token counts only as a package: quoted, in a path or
  // specifier, or capitalised as a proper noun. An empty ambiguous list must
  // match nothing, not everything: an empty alternation matches the empty string.
  const ambiguousList = proseAmbiguous.length > 0 ? proseAmbiguous : ['(?!)'];
  const ambiguous = ambiguousList.map((t) => (t === '(?!)' ? t : escape(t))).join('|');
  const capitalised = ambiguousList.map((t) => (t === '(?!)' ? t : escape(t[0]!.toUpperCase() + t.slice(1)))).join('|');
  const packageContext = `(?:['"\`](${ambiguous})['"\`/@]|(?<![A-Za-z0-9_])(${ambiguous})[/@]|`
    + `/(${ambiguous})(?![A-Za-z0-9_])|`
    + `(?<![A-Za-z0-9_])(${capitalised})(?![A-Za-z0-9_]))`;
  // GLOBAL, because a line is scanned for its FIRST QUALIFYING match, not its
  // first match. The capitalised alternative matches lowercase prose under the
  // `i` flag and is then rejected by the proper-noun test — and a single exec
  // that returned on that rejection abandoned the line, so
  // `import gloam from "gloam"` missed the quoted form four characters later.
  const pattern = new RegExp(`${strict}|${packageContext}`, 'gi');
  const proper = new RegExp(`^(${capitalised})$`);
  const hits: Array<{ file: string; line: number; hit: string }> = [];
  for (const file of files) {
    if (SKIP.has(path.extname(file).toLowerCase())) { continue; }
    const full = path.join(root, file);
    let text: string;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) { continue; }
      text = fs.readFileSync(full, 'utf-8');
    } catch { continue; }
    // A lock file is a generated manifest of DEPENDENCIES — the npm registry's
    // names, which are exempt by the rule that build dependencies stay. The
    // gate no longer excludes ITSELF: it carries no list, so it is scanned like
    // any other file. The inventory IS excluded, because it is this scan's own
    // output: it names categories and never tokens, and scanning it would
    // count its previous self — three hits at 6476ee3, two of them the old
    // artefact's own lines.
    if (path.basename(file) === 'package-lock.json' || file.endsWith(INVENTORY_FILE)) {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      pattern.lastIndex = 0;
      let hit: string | undefined;
      for (let m = pattern.exec(line); m !== null; m = pattern.exec(line)) {
        // The case-insensitive flag lets lowercase prose through the
        // proper-noun alternative; require the capital there and keep looking.
        if (m[5] !== undefined && !proper.test(m[5])) { continue; }
        // THE CATEGORY, NOT THE TOKEN. A hit that printed the name — to the
        // terminal, and into the inventory that is itself tracked — would
        // republish what it found. The owner finds the token on the line.
        hit = m[1] !== undefined ? 'denylist token' : 'denylist token, package form';
        break;
      }
      if (hit === undefined) {
        const home = HOME_PATH.exec(line);
        if (home === null) { return; }
        hit = 'absolute home path';
      }
      const allow = ALLOW_MARKER.exec(line);
      if (allow !== null) {
        // A marker's reason runs to end of line, so a marker placed MID-LINE
        // swallows the code after it — and a second marker, and any identity
        // inside either — into an allowance nobody wrote. Reproduced by
        // js-corpus: `new Set(['<global>', // scrub-allow: mine 'describe' …
        // // scrub-allow: theirs`. A reason is prose; a code character in it,
        // or a second marker, means the marker sits inside code, and the line
        // is REFUSED as a hit rather than exempted.
        const reason = allow[1]!.trim();
        const markers = line.split('scrub-allow:').length - 1;
        if (markers === 1 && !/['"()[\]{};]/.test(reason)) {
          allowances.push({ file, line: index + 1, reason });
          return;
        }
        hits.push({ file, line: index + 1, hit: `${hit} (scrub-allow refused: `
          + `${markers > 1 ? 'two markers on one line' : 'the reason contains code'})` });
        return;
      }
      hits.push({ file, line: index + 1, hit });
    });
  }
  return hits;
}

const INVENTORY_FILE = 'src/test/OSS-SCRUB-INVENTORY.md';

/** Who scrubs a subtree. Prefix-matched; the first match wins. */
const OWNERS: ReadonlyArray<readonly [string, string]> = [
  ['src/test-data/javascript/', 'js-fixtures'],
  ['src/schema/javascript/', 'js-oracle'],
  ['src/parsers/javascript/', 'js-impl'], ['src/enums/javascript/', 'js-impl'],
  ['src/analysis-types/javascript/', 'js-impl'], ['src/utils/javascript/', 'js-impl'],
  ['src/workflows/javascript/', 'js-impl'], ['src/constants/javascript-constants.ts', 'js-impl'],
  ['src/language-detectors/javascript-detector.ts', 'js-impl'], ['src/test/javascript', 'js-impl'],
];
const ownerOf = (file: string): string =>
  OWNERS.find(([prefix]) => file.startsWith(prefix))?.[1] ?? 'unassigned (main, no active agent)';

function writeInventory(root: string): number {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ':!' + INVENTORY_FILE],
    { encoding: 'utf-8' }).trim() !== '';
  // REFUSED on a dirty tree. The inventory is only valid at a SHA that contains
  // every scrub it claims to measure, and a tree with uncommitted changes has no
  // such SHA: the header would name a commit that does not reproduce the count.
  // That happened — an artefact stamped 6f03862 recorded 14 hits while 6f03862
  // itself measures 16, because two allowances were uncommitted when it was
  // written. The header even said so, in a parenthesis nobody would read.
  // Commit first, then generate, so the artefact is the SHA's child with no
  // other change in it.
  if (dirty) {
    console.log('REFUSED: the working tree has uncommitted changes. An inventory is valid only '
      + 'at a SHA that contains every scrub it measures — commit, then regenerate, so the '
      + 'header names a tree that reproduces the count.');
    return 1;
  }
  const list = loadDenylist();
  const { active, excluded } = effectiveDenylist(root, list);
  const files = tracked(undefined);
  const hits = scan(files, root, active, list.ambiguous);
  const byOwner = new Map<string, Array<{ file: string; line: number; hit: string }>>();
  for (const h of hits) {
    const owner = ownerOf(h.file);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), h]);
  }
  const bySubtree = new Map<string, number>();
  for (const h of hits) {
    const top = h.file.split('/').slice(0, 3).join('/');
    bySubtree.set(top, (bySubtree.get(top) ?? 0) + 1);
  }
  const lines: string[] = [
    '# OSS scrub inventory',
    '',
    'GENERATED by `npx tsx src/test/oss-scrub-gate.ts --inventory`. Do not edit; re-run.',
    '',
    `- tree measured: \`${sha}\` — re-derive with \`git checkout ${sha.slice(0, 7)} && npx tsx src/test/oss-scrub-gate.ts\``,
    `- tracked files scanned: ${files.length}`,
    `- hits: **${hits.length}**`,
    // Never the tokens: the list is private, and an inventory that printed it
    // would be the leak the move out of the tree closed. The digest lets a
    // holder confirm which list produced this count.
    `- denylist: ${active.length + list.ambiguous.length} active token(s) (${list.ambiguous.length} matched by form), `
      + `read from $JS_SCRUB_DENYLIST, sha256 prefix \`${list.digest}\``,
    `- excluded because they name a dependency in package.json's graph: ${excluded.length}`,
    '',
    '## By owner',
    '',
    ...[...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([owner, list]) => `- ${owner}: **${list.length}**`),
    '',
    '## By subtree',
    '',
    ...[...bySubtree.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `- ${d}: ${n}`),
    '',
    '## Per-line allowances (scrub-allow:), with the stated reason',
    '',
    ...(allowances.length === 0 ? ['- none']
      : allowances.map((a) => `- ${a.file}:${a.line} — ${a.reason}`)),
    '',
    '## Every hit',
    '',
    'Reconcile with `npx tsx src/test/oss-scrub-gate.ts --scope <your subtree>`.',
    '',
  ];
  for (const [owner, list] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${owner} (${list.length})`, '');
    for (const h of list) { lines.push(`- ${h.file}:${h.line} — ${h.hit}`); }
    lines.push('');
  }
  fs.writeFileSync(path.join(root, INVENTORY_FILE), lines.join('\n'));
  console.log(`wrote ${INVENTORY_FILE}: ${hits.length} hit(s) at ${sha.slice(0, 7)}`);
  return 0;
}

function selfTest(): number {
  // Plant a name in a COPY, in a throwaway git repository, and show it caught.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-scrub-self-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // SYNTHETIC tokens in a list the test writes itself: the self-test must
    // not carry a real name either, and must not need the private file.
    const list = parseDenylist([
      '# synthetic', 'zorbulon', 'quxtown', 'gloam ambiguous', 'plinth ambiguous', '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'clean.ts'), [
      '// measured on a large framework checkout',
      '// a gloam figure in prose',           // ambiguous, lowercase, bare: the word
      '// plinth was the logger',             // ambiguous, lowercase, bare
      '// the home directory, in prose, is not a path',  // no user segment: not flagged
      'const g = ["zorbulon"]; // scrub-allow: platform global name, not the corpus',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'planted.ts'), [
      '// found 894 misses in Zorbulon',       // strict token, capitalised
      'import gloam from "gloam";',            // ambiguous, quoted — after a bare prose miss
      '// Plinth with milk',                   // ambiguous, capitalised
      '// see example.org/gloamjs/gloam',      // ambiguous, URL path
      '// measured on quxtown',                // a holdout-shaped strict token
      // A MID-LINE marker: two markers, the first's reason full of code.
      // Refused — the line stays a hit — rather than exempting a Set literal.
      "const s = new Set(['zorbulon', // scrub-allow: mine 'x']); // scrub-allow: theirs",
      // An absolute home path: not a corpus name, a different disclosure.
      '  "name": "/Users/somebody/Documents/checkout/src/fixture"', // scrub-allow: a planted self-test path, synthetic
      '',
    ].join('\n'));
    execFileSync('git', ['add', '.'], { cwd: dir });
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf-8' })
      .split('\0').filter((f) => f !== '');
    const hits = scan(files, dir, list.strict, list.ambiguous);
    const planted = hits.filter((h) => h.file === 'planted.ts').map((h) => h.line);
    const clean = hits.filter((h) => h.file === 'clean.ts');
    const allowed = allowances.filter((a) => a.file === 'clean.ts');
    const want = [1, 2, 3, 4, 5, 6, 7];
    if (planted.join(',') !== want.join(',') || clean.length !== 0 || allowed.length !== 1) {
      console.log(`SELF-TEST FAIL: planted lines ${planted.join(',')} (want ${want.join(',')}), `
        + `clean=${clean.length} (want 0), allowed=${allowed.length} (want 1)`);
      return 1;
    }
    console.log('SELF-TEST PASS: strict, quoted-after-prose, capitalised, URL-path, holdout, mid-line-marker and home-path '
      + 'forms each caught; two prose uses and one scrub-allow line not flagged');
    return 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(): number {
  if (process.argv.includes('--self-test')) { return selfTest(); }
  if (process.argv.includes('--inventory')) {
    return writeInventory(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim());
  }
  const at = process.argv.indexOf('--scope');
  const scope = at >= 0 ? process.argv[at + 1] : undefined;
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  const list = loadDenylist();
  const { active, excluded } = effectiveDenylist(root, list);
  if (excluded.length > 0) {
    console.log(`${excluded.length} denylist token(s) excluded because they name a dependency in `
      + "package.json's graph (derived from package-lock.json, not hand-kept)");
  }
  const files = tracked(scope);
  const hits = scan(files, root, active, list.ambiguous);
  const byDir = new Map<string, number>();
  for (const h of hits) {
    const top = h.file.split('/').slice(0, 3).join('/');
    byDir.set(top, (byDir.get(top) ?? 0) + 1);
  }
  for (const h of hits) { console.log(`${h.file}:${h.line}: ${h.hit}`); }
  for (const a of allowances) { console.log(`${a.file}:${a.line}: ALLOWED — ${a.reason}`); }
  console.log(`\n${files.length} tracked file(s) scanned${scope === undefined ? '' : ` under ${scope}`}, `
    + `${hits.length} hit(s)`);
  if (byDir.size > 0) {
    console.log('  by subtree:');
    for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) { console.log(`    ${String(n).padStart(5)}  ${d}`); }
  }
  return hits.length === 0 ? 0 : 1;
}
process.exit(main());
