import * as path from 'path';

import {
  PyBindingRegistry,
  PyBlockRegistry,
  PyCallSiteRegistry,
  PyCommentRegistry,
  PyDecoratorArgumentRegistry,
  PyDecoratorRegistry,
  PyExpressionRegistry,
  PyFieldPositionRegistry,
  PyFieldRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyParseGapRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeParameterRegistry,
  PyTypeRegistry,
  PyTypeReferenceRegistry,
} from '@/analysis-types/python';
import { PythonFactSet } from '@/parsers/python/extractors/python-fact-extractor';
import {
  FrozenTable,
  freezeTable,
  runParsePool,
  thawTable,
} from '@/workflows/parse-pool-core';
export { parsePoolJobs } from '@/workflows/parse-pool-core';

/**
 * The Python half of the parallel parse stage: which prototype each table's
 * rows get back, and the shape of a dispatch and a reply. Everything thread-
 * and shape-related lives in parse-pool-core.ts.
 *
 * `linkProject` MUTATES rows after this (that is why it runs before export),
 * which is exactly why rows must come back as real instances before it runs —
 * a plain snapshot would take the mutation and lose the `toCsv`.
 */
const TABLE_PROTOTYPES = {
  scopes: PyScopeRegistry.prototype,
  bindings: PyBindingRegistry.prototype,
  types: PyTypeRegistry.prototype,
  typeBases: PyTypeBaseRegistry.prototype,
  methods: PyMethodRegistry.prototype,
  methodParameters: PyMethodParameterRegistry.prototype,
  imports: PyImportRegistry.prototype,
  expressions: PyExpressionRegistry.prototype,
  callSites: PyCallSiteRegistry.prototype,
  typeReferences: PyTypeReferenceRegistry.prototype,
  fields: PyFieldRegistry.prototype,
  fieldPositions: PyFieldPositionRegistry.prototype,
  blocks: PyBlockRegistry.prototype,
  comments: PyCommentRegistry.prototype,
  parseGaps: PyParseGapRegistry.prototype,
  typeParameters: PyTypeParameterRegistry.prototype,
  decorators: PyDecoratorRegistry.prototype,
  decoratorArguments: PyDecoratorArgumentRegistry.prototype,
} as const;

type TableKey = keyof typeof TABLE_PROTOTYPES;
const TABLE_KEYS = Object.keys(TABLE_PROTOTYPES) as TableKey[];

/** What the analyzer sends a worker for one file: strings only. */
export interface PythonParseDispatch {
  i: number;
  /** Absolute path, read inside the worker. */
  filePath: string;
  /** The path recorded on rows — `recordedFilePath`, computed by the caller. */
  recordedFilePath: string;
  moduleQualifiedName?: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
}

/** One file's outcome, the same three cases the serial loop distinguishes. */
export interface PythonParseOutcome {
  readError?: string;
  extractError?: string;
  facts?: PythonFactSet;
}

/** The worker's reply: `facts` is the frozen (prototype-less) snapshot. */
export interface PythonParseReply {
  i: number;
  readError?: string;
  extractError?: string;
  facts?: Record<string, unknown>;
}

/** Worker side: a fact set as columns structured clone can carry cheaply. */
export function freezeFactSet(facts: PythonFactSet): Record<string, unknown> {
  const out: Record<string, unknown> = {
    module: facts.module ? { ...facts.module } : undefined,
    fieldHashByTypeAndName: facts.fieldHashByTypeAndName,
    receiverNameByMethodHash: facts.receiverNameByMethodHash,
    assignedValueByTargetRange: facts.assignedValueByTargetRange,
    expressionByByteRange: facts.expressionByByteRange,
    dialect: facts.dialect,
    skippedReason: facts.skippedReason,
    python2Findings: facts.python2Findings,
  };
  for (const key of TABLE_KEYS) out[key] = freezeTable(facts[key]);
  return out;
}

/** Main-thread side: the columns back as rows with each table's prototype. */
export function thawFactSet(frozen: Record<string, unknown>): PythonFactSet {
  const out = { ...frozen } as unknown as PythonFactSet;
  if (frozen.module) {
    out.module = Object.assign(Object.create(PyModuleRegistry.prototype), frozen.module);
  }
  for (const key of TABLE_KEYS) {
    (out as unknown as Record<string, unknown>)[key] = thawTable(
      frozen[key] as FrozenTable,
      TABLE_PROTOTYPES[key]
    );
  }
  return out;
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN
 * FILE ORDER as results become available. `false` means no compiled worker:
 * the caller falls back to its serial loop.
 */
export async function parseFilesInPool(
  dispatches: PythonParseDispatch[],
  jobs: number,
  consume: (i: number, outcome: PythonParseOutcome) => void
): Promise<boolean> {
  return runParsePool<PythonParseDispatch, PythonParseReply>(
    path.join(__dirname, 'python-parse-worker.js'),
    dispatches,
    jobs,
    reply =>
      consume(
        reply.i,
        reply.facts
          ? { facts: thawFactSet(reply.facts) }
          : { readError: reply.readError, extractError: reply.extractError }
      )
  );
}
