/**
 * CERTIFICATION — facts a human can actually read, then sign.
 *
 *     npx tsx src/test/python-oracle/certify.ts <corpus>            # render
 *     npx tsx src/test/python-oracle/certify.ts <corpus> --sign     # freeze
 *     npx tsx src/test/python-oracle/certify.ts <corpus> --check    # CI
 *
 * WHY THIS EXISTS. Every other instrument here is comparative: jedi, CPython's
 * MRO, symtable, the bytecode. Each is strong, and every one of them answers a
 * DIFFERENT question from "is this fact right" — jedi is a peer that can be wrong,
 * symtable does not model expressions, and MRO needs an import. So the whole tower
 * rests on approximations agreeing with each other, and a defect they SHARE is
 * invisible. Two of mine were, until someone challenged them by hand.
 *
 * The fix is not another approximation. It is one corpus small enough that a human
 * reads every fact once and signs it. closed-world/ is 6 files and 507 facts —
 * roughly ten printed pages. After that it is a golden file, and any drift is a
 * diff a human reads rather than a percentage a human trusts.
 *
 * This does NOT hand-write expected facts, which stays forbidden: the parser
 * proposes, the human only accepts or rejects. That keeps the author separation
 * intact while giving us one place where the answer is known rather than inferred.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const OUT = '.certify-out';
/** Columns that carry no meaning to a reader — hashes and the constant version. */
const NOISE = /Hash$|^serviceVersionLinkHash$/;

function tsv(f: string): Record<string, string>[] {
  if (!fs.existsSync(f)) return [];
  const L = fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean);
  if (!L.length) return [];   // an emitted-but-empty relation is legal
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? '']));
  });
}

/** One fact as a single line: only the columns that are actually set. */
function render(rel: string, r: Record<string, string>): string {
  const kv = Object.entries(r)
    .filter(([k, v]) => v !== '' && v !== 'false' && !NOISE.test(k))
    .map(([k, v]) => `${k}=${v.length > 40 ? v.slice(0, 40) + '…' : v}`);
  return `${rel.padEnd(20)} ${kv.join('  ')}`;
}

export async function certify(corpus: string, mode: 'render' | 'sign' | 'check'): Promise<number> {
  fs.rmSync(OUT, { recursive: true, force: true });
  const summary = await new PythonProjectAnalyzer().analyze({
    rootDir: corpus, outputDir: OUT, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const modules = tsv(path.join(OUT, 'all-python-modules.csv'));
  const fileOf = new Map(modules.map((m) => [m['pyModuleUniqueHash']!, m['filePath']!]));

  // Read every relation once, then resolve each row to a file. Child relations
  // such as method-parameters carry no pyModuleLinkHash — they reach the module
  // only THROUGH their parent — so a direct lookup drops them into "(no file)",
  // which is exactly where a reader stops reading. Walk the FK chain instead.
  const all: { rel: string; rows: Record<string, string>[] }[] = [];
  for (const f of fs.readdirSync(OUT).filter((x) => x.startsWith('all-python-'))) {
    all.push({ rel: f.replace('all-python-', '').replace('.csv', ''), rows: tsv(path.join(OUT, f)) });
  }
  const ownerFile = new Map<string, string>();      // any PK -> its file
  for (let pass = 0; pass < 4; pass++) {            // depth of the deepest chain
    for (const { rows } of all) {
      for (const r of rows) {
        const pk = Object.entries(r).find(([k]) => k.endsWith('UniqueHash'))?.[1];
        let file = fileOf.get(r['pyModuleLinkHash'] ?? '') ?? r['filePath'];
        if (!file) {
          for (const [k, v] of Object.entries(r)) {
            if (k.endsWith('LinkHash') && ownerFile.has(v)) { file = ownerFile.get(v); break; }
          }
        }
        if (file && pk) ownerFile.set(pk, file);
      }
    }
  }

  // Group every fact by (file, line) so the reader sees source and facts together.
  const byFile = new Map<string, Map<number, string[]>>();
  let total = 0;
  let unplaced = 0;
  for (const { rel, rows } of all) {
    for (const r of rows) {
      total++;
      const pk = Object.entries(r).find(([k]) => k.endsWith('UniqueHash'))?.[1] ?? '';
      let file = fileOf.get(r['pyModuleLinkHash'] ?? '') ?? r['filePath'] ?? ownerFile.get(pk);
      if (!file) {
        // py_field_position is 3 columns by Java parity — no PK, no module link —
        // so it can only be placed through a parent's hash.
        for (const [k, v] of Object.entries(r)) {
          if (k.endsWith('LinkHash') && ownerFile.has(v)) { file = ownerFile.get(v); break; }
        }
      }
      if (!file) unplaced++;
      const line = Number(r['startLine'] ?? 0);
      const key = file ?? '(UNPLACED — no FK path to a module)';
      const m = byFile.get(key) ?? byFile.set(key, new Map()).get(key)!;
      (m.get(line) ?? m.set(line, []).get(line)!).push(render(rel, r));
    }
  }

  const out: string[] = [];
  out.push(`# CERTIFICATION — ${corpus}`);
  out.push(`# ${summary.filesAnalysed} files, ${summary.extractionErrors} errors, ${total} facts`);
  // A row that cannot be traced to a file is unreviewable, so it is reported as a
  // defect of this report rather than quietly filed under "(no file)".
  out.push(`# unplaced (no FK path to a module): ${unplaced}`);
  out.push('#');
  out.push('# Read the source line, then every fact derived from it. Reject anything');
  out.push('# wrong or missing. Silence is assent, so read all of it.');
  for (const file of [...byFile.keys()].sort()) {
    const abs = path.join(corpus, file);
    const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8').split('\n') : [];
    out.push('', '='.repeat(78), `FILE  ${file}`, '='.repeat(78));
    const lines = byFile.get(file)!;
    for (const line of [...lines.keys()].sort((a, b) => a - b)) {
      const code = line > 0 && src[line - 1] !== undefined ? src[line - 1]!.trim() : '';
      out.push('', `L${String(line).padStart(4)}  │ ${code}`);
      for (const fact of lines.get(line)!.sort()) out.push(`        ${fact}`);
    }
  }
  const body = out.join('\n') + '\n';
  const sigFile = path.join(corpus, 'CERTIFIED.txt');
  const digest = crypto.createHash('sha256').update(body).digest('hex');

  if (mode === 'render') {
    fs.writeFileSync('.certify-report.txt', body);
    console.log(body.split('\n').slice(0, 40).join('\n'));
    console.log(`\n… ${total} facts, full report in .certify-report.txt (sha256 ${digest.slice(0, 12)})`);
    console.log('Read it, then re-run with --sign to freeze it as the reference.');
    return 0;
  }
  if (mode === 'sign') {
    fs.writeFileSync(sigFile, body);
    console.log(`signed ${total} facts -> ${sigFile}  (sha256 ${digest.slice(0, 12)})`);
    return 0;
  }
  if (!fs.existsSync(sigFile)) {
    console.log(`FAIL no certification for ${corpus} — run --sign after reading the report`);
    return 1;
  }
  const prev = fs.readFileSync(sigFile, 'utf-8');
  if (prev === body) {
    console.log(`PASS certified facts unchanged (${total} facts)`);
    return 0;
  }
  // A diff here is not automatically a regression — it is a fact a human approved
  // that no longer holds. Someone has to look.
  const a = prev.split('\n'), b = body.split('\n');
  const added = b.filter((l) => !a.includes(l)), removed = a.filter((l) => !b.includes(l));
  console.log(`FAIL certified facts changed: ${removed.length} gone, ${added.length} new`);
  for (const l of removed.slice(0, 15)) console.log(`  - ${l}`);
  for (const l of added.slice(0, 15)) console.log(`  + ${l}`);
  console.log('\nRe-read and --sign only if every change is correct.');
  return 1;
}

if (require.main === module) {
  const corpus = process.argv[2] ?? 'src/test-data/python/closed-world';
  const mode = process.argv.includes('--sign') ? 'sign'
             : process.argv.includes('--check') ? 'check' : 'render';
  certify(corpus, mode).then((c) => process.exit(c));
}
