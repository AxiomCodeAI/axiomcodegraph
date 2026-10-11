import * as path from 'path';

import { CsAttributeArgumentRegistry } from '@/analysis-types/csharp/CsAttributeArgumentRegistry';
import { CsAttributeRegistry } from '@/analysis-types/csharp/CsAttributeRegistry';
import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsCallSiteRegistry } from '@/analysis-types/csharp/CsCallSiteRegistry';
import { CsCommentRegistry } from '@/analysis-types/csharp/CsCommentRegistry';
import { CsEnumMemberRegistry } from '@/analysis-types/csharp/CsEnumMemberRegistry';
import { CsEventRegistry } from '@/analysis-types/csharp/CsEventRegistry';
import { CsExpressionRegistry } from '@/analysis-types/csharp/CsExpressionRegistry';
import { CsFieldRegistry } from '@/analysis-types/csharp/CsFieldRegistry';
import { CsMethodParameterRegistry } from '@/analysis-types/csharp/CsMethodParameterRegistry';
import { CsMethodRegistry } from '@/analysis-types/csharp/CsMethodRegistry';
import { CsModuleRegistry } from '@/analysis-types/csharp/CsModuleRegistry';
import { CsParseGapRegistry } from '@/analysis-types/csharp/CsParseGapRegistry';
import { CsPreprocRegionRegistry } from '@/analysis-types/csharp/CsPreprocRegionRegistry';
import { CsPropertyRegistry } from '@/analysis-types/csharp/CsPropertyRegistry';
import { CsQueryClauseRegistry } from '@/analysis-types/csharp/CsQueryClauseRegistry';
import { CsTypeHeritageRegistry } from '@/analysis-types/csharp/CsTypeHeritageRegistry';
import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsTypeRegistry } from '@/analysis-types/csharp/CsTypeRegistry';
import { CsUsingRegistry } from '@/analysis-types/csharp/CsUsingRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import { CsFileFacts } from '@/parsers/csharp/extractors/cs-fact-extractor';
import { CsModuleContext } from '@/parsers/csharp/extractors/cs-module-extractor';
import {
  FrozenTable,
  freezeTable,
  runParsePool,
  thawTable,
} from '@/workflows/parse-pool-core';
export { parsePoolJobs } from '@/workflows/parse-pool-core';

/**
 * The C# half of the parallel parse stage: which prototype each table's rows
 * get back, and the shape of a dispatch and a reply. Everything thread- and
 * shape-related lives in parse-pool-core.ts.
 *
 * C# has no cross-file linking pass — rows go straight from a file's
 * extraction to the relation writers — but the writers call `toCsv()` and
 * `getCsvHeader()` on every row, so rows still have to come back as REAL
 * class instances, prototype reattached, before the main thread appends them.
 *
 * The one shape Python's tables do not have: a C# row can carry a `Set`
 * (`typeModifiers`, `fieldModifiers`, `methodModifiers`, `xmlDocTags`).
 * Structured clone carries a Set natively, so it crosses inside the frozen
 * column values untouched and `toCsv` reads it as the set it was.
 */
const TABLE_PROTOTYPES = {
  modules: CsModuleRegistry.prototype,
  types: CsTypeRegistry.prototype,
  heritages: CsTypeHeritageRegistry.prototype,
  typeParameters: CsTypeParameterRegistry.prototype,
  methods: CsMethodRegistry.prototype,
  methodParameters: CsMethodParameterRegistry.prototype,
  properties: CsPropertyRegistry.prototype,
  events: CsEventRegistry.prototype,
  typeReferences: CsTypeReferenceRegistry.prototype,
  usings: CsUsingRegistry.prototype,
  parseGaps: CsParseGapRegistry.prototype,
  fields: CsFieldRegistry.prototype,
  enumMembers: CsEnumMemberRegistry.prototype,
  expressions: CsExpressionRegistry.prototype,
  callSites: CsCallSiteRegistry.prototype,
  queryClauses: CsQueryClauseRegistry.prototype,
  blocks: CsBlockRegistry.prototype,
  variables: CsVariableRegistry.prototype,
  attributes: CsAttributeRegistry.prototype,
  attributeArguments: CsAttributeArgumentRegistry.prototype,
  comments: CsCommentRegistry.prototype,
  preprocRegions: CsPreprocRegionRegistry.prototype,
} as const;

type TableKey = keyof typeof TABLE_PROTOTYPES;
const TABLE_KEYS = Object.keys(TABLE_PROTOTYPES) as TableKey[];

/**
 * Everything one emission of one file needs beyond the file itself, resolved
 * ON THE MAIN THREAD before dispatch: the governing project's configuration
 * comes from cs-project-config's process-wide caches, and resolving it once
 * on one thread keeps one cache — and one answer — however many workers
 * parse. Plain data throughout, so it crosses a thread as-is.
 */
export interface CsEmissionInputs {
  readonly context: CsModuleContext;
  readonly defineConstants: readonly string[];
  readonly implicitUsings?: readonly string[];
  readonly implicitFrameworkDefines: boolean;
}

/** What the analyzer sends a worker for one file: strings and flags only. */
export interface CsParseDispatch {
  i: number;
  /** Absolute path, read inside the worker. */
  absoluteFilePath: string;
  /** The path recorded on rows — relative to the mserv, computed by the caller. */
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  /** One per target framework, in the serial loop's framework order. */
  emissions: readonly CsEmissionInputs[];
}

/**
 * One emission's outcome — the same two cases the serial loop's inner
 * try/catch distinguishes. `extractError` is the thrown error's `.message`,
 * exactly the string the serial loop prints.
 */
export interface CsEmissionOutcome {
  extractError?: string;
  facts?: CsFileFacts;
}

/**
 * One file's outcome. `readError` set means the file never reached the
 * extractor (the serial loop's outer catch: one `filesRejected`, no
 * emissions); otherwise `emissions` has one entry per dispatched emission,
 * in order.
 */
export interface CsParseOutcome {
  readError?: string;
  emissions?: CsEmissionOutcome[];
}

/** The worker's reply: each emission's `facts` is the frozen snapshot. */
export interface CsParseReply {
  i: number;
  readError?: string;
  emissions?: { extractError?: string; facts?: Record<string, FrozenTable> }[];
}

/** Worker side: one emission's fact set as columns structured clone carries cheaply. */
export function freezeFileFacts(facts: CsFileFacts): Record<string, FrozenTable> {
  const out: Record<string, FrozenTable> = {};
  for (const key of TABLE_KEYS) {
    out[key] = freezeTable(facts[key] as unknown as object[]);
  }
  return out;
}

/** Main-thread side: the columns back as rows with each table's prototype. */
export function thawFileFacts(frozen: Record<string, FrozenTable>): CsFileFacts {
  const out: Record<string, unknown> = {};
  for (const key of TABLE_KEYS) {
    out[key] = thawTable(frozen[key] as FrozenTable, TABLE_PROTOTYPES[key]);
  }
  return out as unknown as CsFileFacts;
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN
 * FILE ORDER as results become available. `false` means no compiled worker:
 * the caller falls back to its serial loop.
 */
export async function parseCsFilesInPool(
  dispatches: CsParseDispatch[],
  jobs: number,
  consume: (i: number, outcome: CsParseOutcome) => void
): Promise<boolean> {
  return runParsePool<CsParseDispatch, CsParseReply>(
    path.join(__dirname, 'cs-parse-worker.js'),
    dispatches,
    jobs,
    (reply) =>
      consume(
        reply.i,
        reply.emissions
          ? {
              emissions: reply.emissions.map((emission) =>
                emission.facts
                  ? { facts: thawFileFacts(emission.facts) }
                  : { extractError: emission.extractError }
              ),
            }
          : { readError: reply.readError ?? 'worker returned no emissions' }
      )
  );
}
