import * as fsp from 'fs/promises';
import { parentPort } from 'worker_threads';

import { CsFactExtractor } from '@/parsers/csharp/extractors/cs-fact-extractor';
import {
  CsParseDispatch,
  CsParseReply,
  freezeFileFacts,
} from '@/workflows/csharp/cs-parse-pool';

/**
 * One C# parse worker: reads a file once, runs the SAME extractor the serial
 * loop runs — once per emission, in the dispatch's framework order — and
 * posts the fact sets back as prototype-less snapshots (`freezeFileFacts`).
 *
 * The two error cases mirror the serial loop exactly. A read failure is the
 * OUTER catch: the whole file is one `filesRejected` and no emission runs. An
 * extractor throw is the INNER catch, per emission: it carries the error's
 * `.message` — the string the serial loop prints — and the other emissions of
 * the same file still run, as they do serially.
 *
 * One extractor per worker, reused across files, as the analyzer reuses its
 * one extractor across the whole project: constructing a CsFactExtractor runs
 * the grammar gate, and sharing the instance keeps that a startup cost. The
 * governing project's configuration is NOT read here — it arrives resolved in
 * the dispatch, so cs-project-config's caches stay on the main thread.
 */
const extractor = new CsFactExtractor();
const port = parentPort;
if (!port) throw new Error('cs-parse-worker must run as a worker thread');

port.on('message', (job: CsParseDispatch) => {
  void (async () => {
    let sourceText: string;
    try {
      sourceText = await fsp.readFile(job.absoluteFilePath, 'utf-8');
    } catch (error) {
      port.postMessage({ i: job.i, readError: String(error) } satisfies CsParseReply);
      return;
    }
    const emissions = job.emissions.map((emission) => {
      try {
        const facts = extractor.extractFile({
          absoluteFilePath: job.absoluteFilePath,
          filePath: job.filePath,
          baseMservPath: job.baseMservPath,
          sourceText,
          serviceVersionLinkHash: job.serviceVersionLinkHash,
          context: emission.context,
          defineConstants: emission.defineConstants,
          implicitUsings: emission.implicitUsings,
          implicitFrameworkDefines: emission.implicitFrameworkDefines,
        });
        return { facts: freezeFileFacts(facts) };
      } catch (error) {
        // `.message`, not String(error): the serial loop's console.error
        // interpolates exactly this, and the two paths must print the same.
        return { extractError: `${(error as Error).message}` };
      }
    });
    port.postMessage({ i: job.i, emissions } satisfies CsParseReply);
  })();
});
