import * as fsp from 'fs/promises';
import { parentPort } from 'worker_threads';

import { PythonEmissionRegime } from '@/enums/python/modules';
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
import {
  freezeFactSet,
  PythonParseDispatch,
  PythonParseReply,
} from '@/workflows/python/python-parse-pool';

/**
 * One parse worker: reads a file, runs the SAME extractor the serial loop
 * runs, and posts the fact set back as a prototype-less snapshot
 * (`freezeFactSet`). The two error cases mirror the serial loop's two catch
 * blocks exactly — a read failure and an extractor throw are different facts,
 * and the analyzer records them under different reasons.
 *
 * One extractor per worker, reused across files, as the analyzer reuses its
 * one extractor across the whole project: its only cross-call state is a
 * per-file scratch field the next `extract` overwrites.
 */
const extractor = new PythonFactExtractor();
const port = parentPort;
if (!port) throw new Error('python-parse-worker must run as a worker thread');

port.on('message', (job: PythonParseDispatch) => {
  void (async () => {
    let sourceCode: string;
    try {
      sourceCode = await fsp.readFile(job.filePath, 'utf-8');
    } catch (error) {
      port.postMessage({ i: job.i, readError: String(error) } satisfies PythonParseReply);
      return;
    }
    try {
      const facts = extractor.extract({
        sourceCode,
        filePath: job.recordedFilePath,
        baseMservPath: job.baseMservPath,
        moduleQualifiedName: job.moduleQualifiedName,
        serviceVersionLinkHash: job.serviceVersionLinkHash,
        emissionRegime: PythonEmissionRegime.PY3_0_11,
      });
      port.postMessage({ i: job.i, facts: freezeFactSet(facts) } satisfies PythonParseReply);
    } catch (error) {
      port.postMessage({ i: job.i, extractError: String(error) } satisfies PythonParseReply);
    }
  })();
});
