import * as path from 'path';

import { TsExportRegistry } from '@/analysis-types/typescript/TsExportRegistry';
import { TsImportRegistry } from '@/analysis-types/typescript/TsImportRegistry';
import { TsModuleRegistry } from '@/analysis-types/typescript/TsModuleRegistry';
import { TYPESCRIPT_CSV_FILES } from '@/constants/typescript-constants';
import { TsFileFacts } from '@/parsers/typescript/extractors/ts-fact-extractor';
import {
  accumulateFileCompleteness,
  CompletenessAccumulator,
  DeferredVerdict,
  IrGap,
  newCompletenessAccumulator,
} from '@/parsers/typescript/extractors/ts-ir-completeness';
import {
  FrozenTable,
  freezeTable,
  runParsePool,
  thawTable,
} from '@/workflows/parse-pool-core';
export { parsePoolJobs } from '@/workflows/parse-pool-core';

/**
 * The TypeScript half of the parallel parse stage. Extraction here is
 * per-file by DESIGN — cross-file call resolution was retracted to the
 * engine, and the module link passes run after every file on the main
 * thread — so a worker runs `extractTypeScriptFile` exactly as the serial
 * loop does (ts-parse-worker.ts rebuilds the shared closures from plain data
 * through the same `tsResolutionContext` the analyzer uses).
 *
 * WHAT CROSSES THE BOUNDARY IS NOT THE FACT SET. Seventeen of the twenty
 * relations are write-only after extraction — the analyzer streams them to
 * disk and nothing reads them back — so the worker renders their CSV LINES
 * (`toCsv` runs beside the extraction, on the worker's core) and the main
 * thread appends strings. The worker also runs the per-file completeness
 * measurement itself and sends the counters, gaps and deferred verdicts.
 * Only three tables cross as rows — `modules`, `imports`, `exports` — because
 * the module link passes MUTATE them after every file is parsed, and the
 * deferred verdicts are read against those same mutated rows: identity is
 * kept by sending row INDEXES and re-binding on the main thread.
 */
export const STREAMED_TABLES = {
  types: TYPESCRIPT_CSV_FILES.TYPES,
  heritages: TYPESCRIPT_CSV_FILES.TYPE_HERITAGES,
  typeParameters: TYPESCRIPT_CSV_FILES.TYPE_PARAMETERS,
  typeReferences: TYPESCRIPT_CSV_FILES.TYPE_REFERENCES,
  methods: TYPESCRIPT_CSV_FILES.METHODS,
  methodParameters: TYPESCRIPT_CSV_FILES.METHOD_PARAMETERS,
  fields: TYPESCRIPT_CSV_FILES.FIELDS,
  variables: TYPESCRIPT_CSV_FILES.VARIABLES,
  expressions: TYPESCRIPT_CSV_FILES.EXPRESSIONS,
  callSites: TYPESCRIPT_CSV_FILES.CALL_SITES,
  blocks: TYPESCRIPT_CSV_FILES.BLOCKS,
  decorators: TYPESCRIPT_CSV_FILES.DECORATORS,
  decoratorArguments: TYPESCRIPT_CSV_FILES.DECORATOR_ARGUMENTS,
  enumMembers: TYPESCRIPT_CSV_FILES.ENUM_MEMBERS,
  fieldPositions: TYPESCRIPT_CSV_FILES.FIELD_POSITIONS,
  comments: TYPESCRIPT_CSV_FILES.COMMENTS,
  parseGaps: TYPESCRIPT_CSV_FILES.PARSE_GAPS,
} as const;

export type StreamedTableKey = keyof typeof STREAMED_TABLES;
export const STREAMED_KEYS = Object.keys(STREAMED_TABLES) as StreamedTableKey[];

const HELD_PROTOTYPES = {
  modules: TsModuleRegistry.prototype,
  imports: TsImportRegistry.prototype,
  exports: TsExportRegistry.prototype,
} as const;
type HeldKey = keyof typeof HELD_PROTOTYPES;
const HELD_KEYS = Object.keys(HELD_PROTOTYPES) as HeldKey[];

/** What the analyzer sends a worker for one file: strings only. */
export interface TsParseDispatch {
  i: number;
  /** Absolute path; the worker reads it unless `sourceText` rode along. */
  file: string;
  /** The closure walk's prefetched text, so the file is still read once. */
  sourceText?: string;
  filePath: string;
  moduleQualifiedName: string;
}

export interface RenderedTable {
  header: string;
  lines: string[];
}

interface FrozenDeferred {
  shape: string;
  where: string;
  calleeName: string;
  missingSoFar: string[];
  hop: DeferredVerdict['hop'];
  /** DYNAMIC_IMPORT: index into the file's imports, or -1 for undefined. */
  importRowIndex?: number;
  /** IMPORTED_NAME / RECEIVER_TYPE: the file's import map as (name, index). */
  importEntries?: [string, number][];
  localName?: string;
  localTypeNames?: string[];
  typeName?: string;
}

export interface FrozenCompleteness {
  report: Record<string, unknown>;
  gaps: IrGap[];
  deferred: FrozenDeferred[];
}

export interface TsParseReply {
  i: number;
  readError?: string;
  extractError?: string;
  rendered?: Partial<Record<StreamedTableKey, RenderedTable>>;
  held?: Record<HeldKey, FrozenTable>;
  completeness?: FrozenCompleteness;
  filePath?: string;
}

/** What the main thread consumes per file once a worker reply is re-bound. */
export interface TsPooledFile {
  rendered: Partial<Record<StreamedTableKey, RenderedTable>>;
  modules: TsModuleRegistry[];
  imports: TsImportRegistry[];
  exports: TsExportRegistry[];
  completeness: { gaps: IrGap[]; deferred: DeferredVerdict[]; report: Record<string, unknown> };
  filePath: string;
}

export interface TsParseOutcome {
  readError?: string;
  extractError?: string;
  file?: TsPooledFile;
}

/** Worker side: render the streamed tables, measure, freeze the held rows. */
export function freezeTsReply(i: number, facts: TsFileFacts): TsParseReply {
  const rendered: Partial<Record<StreamedTableKey, RenderedTable>> = {};
  for (const key of STREAMED_KEYS) {
    const rows = facts[key] as readonly { toCsv(): string; getCsvHeader(): string }[];
    if (rows.length === 0) continue;
    rendered[key] = {
      header: (rows[0] as { getCsvHeader(): string }).getCsvHeader(),
      lines: rows.map(r => r.toCsv()),
    };
  }

  // The same call the serial loop makes, against this worker's live facts.
  const accumulator = newCompletenessAccumulator();
  accumulateFileCompleteness(facts, accumulator);

  const importIndex = new Map<TsImportRegistry, number>();
  facts.imports.forEach((row, idx) => importIndex.set(row, idx));
  const freezeImportMap = (m: ReadonlyMap<string, TsImportRegistry>): [string, number][] =>
    [...m].map(([name, row]) => [name, importIndex.get(row) ?? -1]);

  const deferred: FrozenDeferred[] = accumulator.deferred.map(d => {
    const base = {
      shape: d.shape,
      where: d.where,
      calleeName: d.calleeName,
      missingSoFar: [...d.missingSoFar],
      hop: d.hop,
    };
    switch (d.hop) {
      case 'DYNAMIC_IMPORT':
        return {
          ...base,
          importRowIndex: d.importRow === undefined ? -1 : (importIndex.get(d.importRow) ?? -1),
        };
      case 'IMPORTED_NAME':
        return { ...base, importEntries: freezeImportMap(d.imports), localName: d.localName };
      case 'RECEIVER_TYPE':
        return {
          ...base,
          importEntries: freezeImportMap(d.imports),
          localTypeNames: [...d.localTypeNames],
          typeName: d.typeName,
        };
    }
  });

  return {
    i,
    rendered,
    held: {
      modules: freezeTable(facts.modules as unknown as object[]),
      imports: freezeTable(facts.imports as unknown as object[]),
      exports: freezeTable(facts.exports as unknown as object[]),
    },
    completeness: {
      report: accumulator.report as unknown as Record<string, unknown>,
      gaps: accumulator.gaps,
      deferred,
    },
    filePath: facts.filePath,
  };
}

/** Main-thread side: held rows with their prototypes, verdicts re-bound. */
export function thawTsReply(reply: TsParseReply): TsPooledFile {
  const held = reply.held as Record<HeldKey, FrozenTable>;
  const tables = {} as Record<HeldKey, object[]>;
  for (const key of HELD_KEYS) tables[key] = thawTable(held[key], HELD_PROTOTYPES[key]);
  const imports = tables.imports as TsImportRegistry[];

  const thawImportMap = (entries: [string, number][]): Map<string, TsImportRegistry> =>
    new Map(entries.map(([name, idx]) => [name, imports[idx] as TsImportRegistry]));

  const completeness = reply.completeness as FrozenCompleteness;
  const deferred: DeferredVerdict[] = completeness.deferred.map(d => {
    const base = {
      shape: d.shape,
      where: d.where,
      calleeName: d.calleeName,
      missingSoFar: d.missingSoFar,
    };
    switch (d.hop) {
      case 'DYNAMIC_IMPORT':
        return {
          ...base,
          hop: d.hop,
          importRow: d.importRowIndex === -1 ? undefined : imports[d.importRowIndex as number],
        };
      case 'IMPORTED_NAME':
        return {
          ...base,
          hop: d.hop,
          imports: thawImportMap(d.importEntries ?? []),
          localName: d.localName as string,
        };
      case 'RECEIVER_TYPE':
        return {
          ...base,
          hop: d.hop,
          imports: thawImportMap(d.importEntries ?? []),
          localTypeNames: new Set(d.localTypeNames ?? []),
          typeName: d.typeName as string,
        };
    }
  });

  return {
    rendered: reply.rendered ?? {},
    modules: tables.modules as TsModuleRegistry[],
    imports,
    exports: tables.exports as TsExportRegistry[],
    completeness: { gaps: completeness.gaps, deferred, report: completeness.report },
    filePath: reply.filePath as string,
  };
}

/**
 * Folds one file's completeness measurement into the shared accumulator, in
 * file order, exactly as the serial loop's `accumulateFileCompleteness` call
 * would have: counters add, per-shape counters add shape by shape, and the
 * ordered lists concatenate.
 */
export function mergeCompleteness(
  accumulator: CompletenessAccumulator,
  delta: { gaps: IrGap[]; deferred: DeferredVerdict[]; report: Record<string, unknown> }
): void {
  const report = accumulator.report as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(delta.report)) {
    if (typeof value === 'number') {
      report[key] = ((report[key] as number) ?? 0) + value;
    } else if (key === 'byReceiverKind') {
      const into = report[key] as Record<string, Record<string, number>>;
      for (const [shape, counts] of Object.entries(value as Record<string, Record<string, number>>)) {
        const bucket = into[shape] ?? (into[shape] = Object.fromEntries(
          Object.keys(counts).map(k => [k, 0])
        ) as Record<string, number>);
        for (const [k, n] of Object.entries(counts)) bucket[k] = (bucket[k] ?? 0) + n;
      }
    } else if (Array.isArray(value)) {
      (report[key] as unknown[]).push(...value);
    }
  }
  accumulator.gaps.push(...delta.gaps);
  accumulator.deferred.push(...delta.deferred);
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN
 * FILE ORDER as results become available; `consume` may await its writes.
 * `false` means no compiled worker: the caller falls back to its serial loop.
 */
export async function parseTsFilesInPool(
  workerData: Record<string, unknown>,
  dispatches: TsParseDispatch[],
  jobs: number,
  consume: (i: number, outcome: TsParseOutcome) => Promise<void>
): Promise<boolean> {
  return runParsePool<TsParseDispatch, TsParseReply>(
    path.join(__dirname, 'ts-parse-worker.js'),
    dispatches,
    jobs,
    reply =>
      consume(
        reply.i,
        reply.held
          ? { file: thawTsReply(reply) }
          : { readError: reply.readError, extractError: reply.extractError }
      ),
    workerData
  );
}
