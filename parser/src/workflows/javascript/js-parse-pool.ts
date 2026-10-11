import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { JsBlockRegistry } from '@/analysis-types/javascript/JsBlockRegistry';
import { JsCallSiteRegistry } from '@/analysis-types/javascript/JsCallSiteRegistry';
import { JsCommentRegistry } from '@/analysis-types/javascript/JsCommentRegistry';
import { JsExportRegistry } from '@/analysis-types/javascript/JsExportRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import { JsFieldRegistry } from '@/analysis-types/javascript/JsFieldRegistry';
import { JsImportRegistry } from '@/analysis-types/javascript/JsImportRegistry';
import { JsMethodParameterRegistry } from '@/analysis-types/javascript/JsMethodParameterRegistry';
import { JsMethodRegistry } from '@/analysis-types/javascript/JsMethodRegistry';
import { JsModuleRegistry } from '@/analysis-types/javascript/JsModuleRegistry';
import { JsParseGapRegistry } from '@/analysis-types/javascript/JsParseGapRegistry';
import { JsScopeRegistry } from '@/analysis-types/javascript/JsScopeRegistry';
import { JsTypeHeritageRegistry } from '@/analysis-types/javascript/JsTypeHeritageRegistry';
import { JsTypeReferenceRegistry } from '@/analysis-types/javascript/JsTypeReferenceRegistry';
import { JsTypeRegistry } from '@/analysis-types/javascript/JsTypeRegistry';
import { JsVariableRegistry } from '@/analysis-types/javascript/JsVariableRegistry';
import { JsFileFacts } from '@/parsers/javascript/extractors/js-fact-extractor';
import { GoverningPackageJson } from '@/parsers/javascript/package-json-resolver';
import {
  FrozenTable,
  freezeTable,
  runParsePool,
  thawTable,
} from '@/workflows/parse-pool-core';
export { parsePoolJobs } from '@/workflows/parse-pool-core';

/**
 * The JavaScript half of the parallel parse stage: which prototype each
 * table's rows get back, and the shape of a dispatch and a reply. Everything
 * thread- and shape-related lives in parse-pool-core.ts.
 *
 * Rows must come back as REAL instances, not snapshots: the writers call
 * `toCsv()` on every row, and the completeness measure calls `getHash()` on
 * imports and `importLinkHashValue()` on call sites — all prototype methods.
 *
 * ## Two things Python's half does not have
 *
 * 1. **A project-wide input.** `extractJavaScriptFile` consumes
 *    `projectModuleHashes` — one entry per file in the whole analysis, minted
 *    from paths alone BEFORE any file is parsed, so it is fixed input to the
 *    pool, not cross-file state. Cloning it into every dispatch would copy the
 *    whole map once per FILE; instead it crosses once per RUN, through a
 *    temporary JSON file whose path rides on each dispatch and that each
 *    worker reads a single time (`JsParseSharedState`).
 * 2. **Derived-from-disk inputs.** The alias configs, workspace packages and
 *    the governing `package.json` are all functions of the filesystem, which
 *    every worker shares — so each worker rebuilds its own resolver caches
 *    rather than shipping closures across the thread boundary. The per-file
 *    CONCLUSION of `PackageJsonResolver` does ride on the dispatch, because
 *    the main thread has already computed it for the module-hash mint and two
 *    computations of one answer is one more than needed.
 */
const TABLE_PROTOTYPES = {
  modules: JsModuleRegistry.prototype,
  scopes: JsScopeRegistry.prototype,
  types: JsTypeRegistry.prototype,
  heritages: JsTypeHeritageRegistry.prototype,
  methods: JsMethodRegistry.prototype,
  methodParameters: JsMethodParameterRegistry.prototype,
  fields: JsFieldRegistry.prototype,
  variables: JsVariableRegistry.prototype,
  blocks: JsBlockRegistry.prototype,
  expressions: JsExpressionRegistry.prototype,
  callSites: JsCallSiteRegistry.prototype,
  imports: JsImportRegistry.prototype,
  exports: JsExportRegistry.prototype,
  comments: JsCommentRegistry.prototype,
  typeReferences: JsTypeReferenceRegistry.prototype,
  parseGaps: JsParseGapRegistry.prototype,
} as const;

type TableKey = keyof typeof TABLE_PROTOTYPES;
const TABLE_KEYS = Object.keys(TABLE_PROTOTYPES) as TableKey[];

/**
 * The run-wide input every file's extraction consumes, written ONCE to a
 * temporary JSON file rather than cloned into every dispatch. Everything in
 * it is either a scalar of the run or derived from paths alone before any
 * file was parsed — nothing in it depends on another file's extraction, which
 * is what lets the files parse in any order.
 */
export interface JsParseSharedState {
  /** Canonical anchor every emitted path hangs off — see `pathAnchorFor`. */
  pathAnchor: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  /** The walk's directory excludes, for the worker's workspace discovery. */
  excludeDirs: string[];
  /** Absolute path -> `js_module` hash, for every file in the analysis. */
  moduleHashes: [string, string][];
}

/** What the analyzer sends a worker for one file: strings and one small record. */
export interface JsParseDispatch {
  i: number;
  /** Absolute path, read inside the worker. */
  filePath: string;
  /** Where this run's `JsParseSharedState` sits; identical on every dispatch. */
  sharedPath: string;
  /**
   * The governing `package.json`'s verdict, as the main thread resolved it
   * for the module-hash mint. Dispatched rather than re-resolved so the hash
   * a worker emits and the hash the mint produced cannot disagree.
   */
  governing: GoverningPackageJson;
}

/** One file's outcome: the same four cases the serial loop distinguishes. */
export interface JsParseOutcome {
  readError?: string;
  /** `scriptTextOf` found nothing this analyzer can read (a lang="ts" Vue script). */
  unread?: string;
  extractError?: string;
  facts?: JsFileFacts;
}

/** The worker's reply: `facts` is the frozen (prototype-less) snapshot. */
export interface JsParseReply {
  i: number;
  readError?: string;
  unread?: string;
  extractError?: string;
  facts?: Record<string, unknown>;
}

/**
 * Worker side: a fact set as columns structured clone can carry cheaply.
 *
 * Only the sixteen row tables cross. The linking fields (`declarations`,
 * `binder`, `sourceFile`, …) are dropped deliberately: they hold extractor
 * instances and `ts.SourceFile`s, which structured clone cannot carry, and
 * `JsFileFacts` documents that nothing outside the extractor consumes them —
 * the analyzer reads exactly the tables and the module row's own columns.
 */
export function freezeFactSet(facts: JsFileFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TABLE_KEYS) {
    out[key] = freezeTable(facts[key] as unknown as object[]);
  }
  return out;
}

/** Main-thread side: the columns back as rows with each table's prototype. */
export function thawFactSet(frozen: Record<string, unknown>): JsFileFacts {
  const out: Record<string, unknown> = {};
  for (const key of TABLE_KEYS) {
    out[key] = thawTable(frozen[key] as FrozenTable, TABLE_PROTOTYPES[key]);
  }
  return out as unknown as JsFileFacts;
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN
 * FILE ORDER as results become available. `false` means no compiled worker:
 * the caller falls back to its serial loop.
 */
export async function parseFilesInPool(
  shared: JsParseSharedState,
  files: { filePath: string; governing: GoverningPackageJson }[],
  jobs: number,
  consume: (i: number, outcome: JsParseOutcome) => void
): Promise<boolean> {
  const workerPath = path.join(__dirname, 'js-parse-worker.js');
  // Checked here as well as in the core, because the shared file should not
  // be written for a run that is about to decline the pool.
  if (!fs.existsSync(workerPath)) {
    return false;
  }
  const sharedPath = path.join(
    os.tmpdir(),
    `axiomcode-js-parse-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`
  );
  await fsp.writeFile(sharedPath, JSON.stringify(shared), 'utf-8');
  try {
    return await runParsePool<JsParseDispatch, JsParseReply>(
      workerPath,
      files.map((file, i) => ({ i, filePath: file.filePath, sharedPath, governing: file.governing })),
      jobs,
      reply =>
        consume(
          reply.i,
          reply.facts
            ? { facts: thawFactSet(reply.facts) }
            : { readError: reply.readError, unread: reply.unread, extractError: reply.extractError }
        )
    );
  } finally {
    await fsp.rm(sharedPath, { force: true });
  }
}
