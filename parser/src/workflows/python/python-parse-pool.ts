import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';

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

/**
 * The per-file parse work (read, tree-sitter parse, mirror, extract, hash) is
 * independent between files — everything cross-module happens later, in
 * `linkProject` — so it runs on a pool of worker threads. The MAIN thread still
 * consumes the results in sorted file order, through the same code the serial
 * loop runs, so the accumulated rows, the skip records and therefore the output
 * bytes are identical whatever order the workers finish in.
 *
 * ## What crosses the thread boundary
 *
 * A worker cannot post class instances: structured clone keeps own properties
 * and drops the prototype. The registry rows are flat value holders — every
 * field a string, number or enum — so the worker posts `{...row}` and `thaw`
 * reattaches the one prototype each table's rows share. The four `Map`s in a
 * fact set clone natively. Nothing is re-hashed and nothing is re-parsed: the
 * bytes that cross are the bytes the extractor produced.
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

/**
 * Worker side: a fact set as COLUMNS structured clone can carry cheaply. A
 * per-object snapshot encodes every property name once per row; a table's
 * million rows share one class, so the names go once per table and each row
 * crosses as a value array. The difference decided whether a 1.9 GB subject
 * fit: the main thread's accumulated rows already peak near V8's default old
 * space, and per-object clones of the same rows pushed it over.
 */
interface FrozenTable {
  keys: string[];
  rows: unknown[][];
}

function freezeTable(rows: object[]): FrozenTable {
  if (rows.length === 0) return { keys: [], rows: [] };
  // One pass, no per-row key arrays: a first cut did a union prepass with
  // Object.keys per row and it was a third of the worker's CPU. Columns are
  // discovered as rows mention them (a conditional assignment can leave a
  // property off an instance), so an early row encoded before a late column
  // existed is short, and thaw reads the tail as undefined — which is what
  // the absent property read as everywhere it is used.
  const index = new Map<string, number>();
  const keys: string[] = [];
  const out: unknown[][] = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as Record<string, unknown>;
    const vals: unknown[] = [];
    for (const key in row) {
      let i = index.get(key);
      if (i === undefined) {
        i = keys.length;
        index.set(key, i);
        keys.push(key);
      }
      vals[i] = row[key];
    }
    out[r] = vals;
  }
  return { keys, rows: out };
}

// A row built by `Object.create` plus one store per property lands in V8's
// dictionary mode: measured on a 25-field row, 1M of them cost 1.6 GB against
// 230 MB constructor-built — the difference WAS the main thread's OOM on a
// large subject. An object literal with `__proto__` gets the same fast shape
// the constructor makes, so each table gets a compiled literal, cached by its
// key list. Keys come from our own row classes, but they cross a thread as
// data, so anything that is not a plain identifier falls back to the slow
// shape instead of reaching the compiled source.
const IDENT = /^[A-Za-z_$][\w$]*$/;
const factories = new Map<string, (v: unknown[], proto: object) => object>();

function rowFactory(keys: string[]): ((v: unknown[], proto: object) => object) | null {
  const signature = keys.join('\t');
  const cached = factories.get(signature);
  if (cached) return cached;
  if (!keys.every(k => IDENT.test(k))) return null;
  const body =
    'return {__proto__: proto,' + keys.map((k, i) => `${k}: v[${i}]`).join(',') + '};';
  const made = new Function('v', 'proto', body) as (v: unknown[], proto: object) => object;
  factories.set(signature, made);
  return made;
}

function thawTable(frozen: FrozenTable, proto: object): object[] {
  const { keys, rows } = frozen;
  const make = rowFactory(keys);
  if (make) return rows.map(values => make(values, proto));
  return rows.map(values => {
    const out = Object.create(proto) as Record<string, unknown>;
    for (let i = 0; i < keys.length; i++) out[keys[i] as string] = values[i];
    return out;
  });
}

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
 * How many parse workers to run. `AXIOMCODE_PARSE_JOBS` decides; `1` restores
 * the strict serial path (the two produce identical bytes — `1` exists for
 * memory-tight hosts and for bisecting). The default leaves a core for the
 * main thread and caps at 4: consume runs single-threaded on the main thread,
 * so workers saturate it — on a 2,932-file subject the extract phase went
 * 18.5s serial / 17.4s at 2 / 12.9s at 4 / 10.9s at 6 jobs, but past 4 the
 * subject's whole run stopped improving (GC against more worker heaps), so 4
 * is where the default stops.
 */
export function parsePoolJobs(fileCount: number): number {
  const env = Number(process.env.AXIOMCODE_PARSE_JOBS || '');
  const cores = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const jobs = Number.isFinite(env) && env >= 1
    ? Math.floor(env)
    : Math.max(1, Math.min(4, cores - 1));
  // Under ~2 files per worker the pool's startup (a thread, a module graph, a
  // tree-sitter instance each) costs more than it hides.
  return fileCount >= jobs * 2 ? jobs : 1;
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN FILE
 * ORDER as results become available — never after collecting them all. The
 * rows of a repository already fill the main thread's heap once, in
 * `accumulated`; buffering every worker's snapshot beside them held the whole
 * project TWICE and took a 1.9 GB subject over the default heap. So a result
 * is thawed, consumed and dropped the moment its turn comes, and the DISPATCH
 * WINDOW below caps what can wait out of order: one slow file holds back at
 * most `jobs * 6` finished snapshots, not the rest of the repository.
 *
 * Returns `false` when the compiled worker is not there (a source-tree run
 * under a TS test runner has no `dist/`): the caller falls back to the serial
 * loop rather than fail, so an environment that cannot pool still answers.
 */
export async function parseFilesInPool(
  dispatches: PythonParseDispatch[],
  jobs: number,
  consume: (i: number, outcome: PythonParseOutcome) => void
): Promise<boolean> {
  const workerPath = path.join(__dirname, 'python-parse-worker.js');
  if (!fs.existsSync(workerPath)) return false;
  if (dispatches.length === 0) return true;

  const window = jobs * 6;
  const ready = new Map<number, PythonParseReply>();
  const workers: Worker[] = [];
  let nextToDispatch = 0;
  let nextToConsume = 0;
  const idle: Worker[] = [];

  await new Promise<void>((resolve, reject) => {
    const drain = () => {
      for (let reply = ready.get(nextToConsume); reply; reply = ready.get(nextToConsume)) {
        ready.delete(nextToConsume);
        consume(
          nextToConsume,
          reply.facts
            ? { facts: thawFactSet(reply.facts) }
            : { readError: reply.readError, extractError: reply.extractError }
        );
        nextToConsume += 1;
      }
    };
    const feed = (worker: Worker) => {
      if (nextToDispatch >= dispatches.length) {
        idle.push(worker);
        if (nextToConsume >= dispatches.length) resolve();
        return;
      }
      if (nextToDispatch - nextToConsume >= window) {
        idle.push(worker); // drain() wakes it once its result's turn has come
        return;
      }
      worker.postMessage(dispatches[nextToDispatch]);
      nextToDispatch += 1;
    };
    for (let w = 0; w < Math.min(jobs, dispatches.length); w++) {
      const worker = new Worker(workerPath);
      workers.push(worker);
      worker.on('message', (reply: PythonParseReply) => {
        ready.set(reply.i, reply);
        drain();
        feed(worker);
        while (idle.length > 0 && nextToDispatch - nextToConsume < window
               && nextToDispatch < dispatches.length) {
          feed(idle.pop() as Worker);
        }
        if (nextToConsume >= dispatches.length) resolve();
      });
      worker.on('error', reject);
      feed(worker);
    }
  }).finally(() => {
    for (const worker of workers) void worker.terminate();
  });
  return true;
}
