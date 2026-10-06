import * as fs from 'fs';
import * as os from 'os';
import { Worker } from 'worker_threads';

/**
 * The language-independent half of a parallel parse stage. A language's
 * analyzer keeps its own loop body; what every language shares is:
 *
 *  - rows cross the thread boundary as COLUMNS (`freezeTable` / `thawTable`):
 *    a per-object snapshot encodes every property name once per row, a
 *    table's rows share one class, so the names go once per table and each
 *    row crosses as a value array;
 *  - rows rehydrate through a compiled object literal with `__proto__`
 *    (`rowFactory`): `Object.create` plus one store per property lands in
 *    V8's dictionary mode — measured on a 25-field row, 1M of them cost
 *    1.6 GB against 230 MB constructor-built, which was the difference
 *    between fitting the default heap and not;
 *  - results stream IN FILE ORDER (`runParsePool`): a worker's outcome is
 *    consumed and dropped the moment its file's turn comes, and the dispatch
 *    window caps what can wait out of order, so the project's rows fill the
 *    main thread's heap once, not twice;
 *  - `parsePoolJobs` reads AXIOMCODE_PARSE_JOBS, where 1 is the strict
 *    serial path and the default caps at 4 — consume runs single-threaded on
 *    the main thread, and past 4 workers it is what saturates (measured on a
 *    2,932-file Python subject: extract 18.5s serial, 17.4s at 2, 12.9s at
 *    4, 10.9s at 6 jobs, with the whole run flat past 4).
 *
 * The language half is small: a prototype per table, a freeze/thaw of its
 * fact-set shape built on these helpers, and a worker entry that runs the
 * same extractor the serial loop runs.
 */
export interface FrozenTable {
  keys: string[];
  rows: unknown[][];
}

export function freezeTable(rows: object[]): FrozenTable {
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

// Keys come from our own row classes, but they cross a thread as data, so
// anything that is not a plain identifier falls back to the slow shape
// instead of reaching the compiled source.
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

export function thawTable(frozen: FrozenTable, proto: object): object[] {
  const { keys, rows } = frozen;
  const make = rowFactory(keys);
  if (make) return rows.map(values => make(values, proto));
  return rows.map(values => {
    const out = Object.create(proto) as Record<string, unknown>;
    for (let i = 0; i < keys.length; i++) out[keys[i] as string] = values[i];
    return out;
  });
}

/** `1` restores the strict serial path; the two produce identical bytes. */
export function parsePoolJobs(fileCount: number): number {
  const env = Number(process.env.AXIOMCODE_PARSE_JOBS || '');
  const cores =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const jobs =
    Number.isFinite(env) && env >= 1 ? Math.floor(env) : Math.max(1, Math.min(4, cores - 1));
  // Under ~2 files per worker the pool's startup (a thread, a module graph, a
  // parser instance each) costs more than it hides.
  return fileCount >= jobs * 2 ? jobs : 1;
}

/**
 * Runs every dispatch on `jobs` workers and calls `consume` once per index,
 * in index order, as results arrive. Replies must carry the dispatch's `i`.
 *
 * Returns `false` when the compiled worker is not there (a source-tree run
 * under a TS test runner has no `dist/`): the caller falls back to its serial
 * loop rather than fail, so an environment that cannot pool still answers.
 */
export async function runParsePool<D extends { i: number }, R extends { i: number }>(
  workerPath: string,
  dispatches: D[],
  jobs: number,
  consume: (reply: R) => void
): Promise<boolean> {
  if (!fs.existsSync(workerPath)) return false;
  if (dispatches.length === 0) return true;

  const window = jobs * 6;
  const ready = new Map<number, R>();
  const workers: Worker[] = [];
  let nextToDispatch = 0;
  let nextToConsume = 0;
  const idle: Worker[] = [];

  await new Promise<void>((resolve, reject) => {
    const drain = () => {
      for (let reply = ready.get(nextToConsume); reply; reply = ready.get(nextToConsume)) {
        ready.delete(nextToConsume);
        consume(reply);
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
      worker.on('message', (reply: R) => {
        ready.set(reply.i, reply);
        drain();
        feed(worker);
        while (
          idle.length > 0 &&
          nextToDispatch - nextToConsume < window &&
          nextToDispatch < dispatches.length
        ) {
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
