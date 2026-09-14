/**
 * The bundle stage. Invoked by run-souffle.sh once the solve has converged:
 *
 *   node dist/bundle/cli.js --language L --src SRC --client-ir DIR --raw DIR --out DIR
 *        [--library ROOT,ROOT…] [--lib-facts DIR] [--meta key=value]…
 *
 * Reads the per-language Soufflé dump in --raw and the parser IR, and writes the
 * language-neutral bundle: <out>/graph.sqlite (and <out>/csv/*.csv with --debug). `--print-schema`
 * renders SCHEMA.md to stdout instead.
 */
import * as fs from 'fs';
import * as path from 'path';

// node:sqlite is flagged experimental on 22–24 and prints a warning on first use. It is a
// supported dependency here, gated on the version in write.ts; the notice is noise to the
// caller of a pipeline stage, so it is filtered — every other warning still prints.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.error(w.stack ?? w.message); });

import { buildCore } from '@/bundle/build';
import { catalogExt, readLibMap } from '@/bundle/catalog';
import { adapterFor } from '@/bundle/languages';
import { renderSchemaMarkdown, SCHEMA_VERSION } from '@/bundle/schema';
import { sqliteAvailable, writeCoreCsv, writeSqlite } from '@/bundle/write';

interface Args {
  language?: string; src?: string; clientIr?: string; raw?: string; out?: string;
  library: string[]; libFacts?: string; meta: Record<string, string>; printSchema: boolean; debug: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { library: [], meta: {}, printSchema: false, debug: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${arg} needs a value`); return v; };
    switch (arg) {
      case '--language': a.language = next(); break;
      case '--src': a.src = next(); break;
      case '--client-ir': a.clientIr = next(); break;
      case '--raw': a.raw = next(); break;
      case '--out': a.out = next(); break;
      case '--library': a.library.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--lib-facts': a.libFacts = next(); break;
      case '--meta': { const kv = next(); const eq = kv.indexOf('='); if (eq < 0) throw new Error(`--meta expects key=value, got ${kv}`); a.meta[kv.slice(0, eq)] = kv.slice(eq + 1); break; }
      case '--print-schema': a.printSchema = true; break;
      case '--debug': a.debug = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return a;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const a = parseArgs(argv);
  if (a.printSchema) { process.stdout.write(renderSchemaMarkdown() + '\n'); return; }
  for (const [k, v] of Object.entries({ '--language': a.language, '--src': a.src, '--client-ir': a.clientIr, '--raw': a.raw, '--out': a.out })) {
    if (!v) throw new Error(`${k} is required`);
  }
  const adapter = adapterFor(a.language!);
  const langDir = path.join(a.src!, adapter.language);
  const log = (s: string) => console.log(s);
  const t0 = Date.now();

  const meta: Record<string, string> = {
    schema_version: SCHEMA_VERSION,
    language: adapter.language,
    client_ir: path.resolve(a.clientIr!),
    library_roots: a.library.join(','),
    raw_dir: path.resolve(a.raw!),
    created_at: new Date().toISOString(),
    ...a.meta,
  };

  log(`▶ bundling ${adapter.language} output → ${a.out}`);
  const core = await buildCore({
    adapter, rawDir: a.raw!, clientIrDir: a.clientIr!, libraryRoots: a.library,
    libFactsDir: a.libFacts, libMap: readLibMap(langDir), meta, log,
  });
  // THE DATABASE IS THE DELIVERABLE; THE CSVs ARE A DEBUGGING VIEW OF IT. They carry the
  // same core tables and nothing more, so writing both by default doubles the output for
  // a consumer that reads neither by hand. `--debug` asks for them.
  //
  // The one case where they are written anyway is the one where they are not redundant:
  // an older Node has no `node:sqlite`, so without them the run would produce no
  // consumer-facing output at all.
  const graphDir = path.join(a.out!, 'csv');
  const haveSqlite = sqliteAvailable();
  const wantCsv = a.debug || !haveSqlite;
  fs.rmSync(graphDir, { recursive: true, force: true }); // owned: no table from an earlier run survives
  if (wantCsv) writeCoreCsv(graphDir, core, log);

  const dbPath = path.join(a.out!, 'graph.sqlite');
  if (haveSqlite) {
    await writeSqlite({ dbPath, language: adapter.language, core, ext: catalogExt(langDir), rawDir: a.raw!, log });
    log(`▶ wrote ${dbPath}${a.debug ? ' (+ csv/*.csv, --debug)' : ''}`);
  } else {
    fs.rmSync(dbPath, { force: true });
    console.error(`  ! node ${process.versions.node} has no node:sqlite (needs ≥ 22.5) — graph.sqlite NOT written; csv/*.csv is complete`);
  }
  log(`▶ bundle complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ bundle: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
