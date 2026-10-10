import * as fsp from 'fs/promises';
import { parentPort } from 'worker_threads';

import { JAVA_ENTITY_TYPES, LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { CodeExtractor } from '@/parsers/code-extractor';
import { ImportExtractor, TypeRegistryExtractor } from '@/parsers/java/extractors';
import { ProjectLanguage } from '@/types/ProjectInfo';
import {
  extractJavaFileFacts,
  freezeFileFacts,
  JavaParseDispatch,
  JavaParseReply,
} from '@/workflows/java/java-parse-pool';

/**
 * One parse worker: reads a file, applies the SAME three pre-extraction
 * rejections the analyzer's `readFiles` applies (unreadable, empty,
 * oversized), runs the same extractor stack the serial loop runs, and posts
 * the file's tables back as prototype-less column snapshots
 * (`freezeFileFacts`).
 *
 * One CodeExtractor + ImportExtractor pair per worker, wired exactly as the
 * analyzer wires its own (`registerExtractors`), reused across files — the
 * extractor resets its per-file arrays at the top of every `extract`, so
 * reuse matches the analyzer's single-instance semantics.
 */
const codeExtractor = new CodeExtractor();
codeExtractor.registerExtractor(
  ProjectLanguage.JAVA,
  JAVA_ENTITY_TYPES.TYPE_REGISTRY,
  new TypeRegistryExtractor()
);
const importExtractor = new ImportExtractor();

const port = parentPort;
if (!port) throw new Error('java-parse-worker must run as a worker thread');

port.on('message', (job: JavaParseDispatch) => {
  void (async () => {
    let content: string;
    try {
      content = await fsp.readFile(job.filePath, 'utf-8');
    } catch (error) {
      port.postMessage({
        i: job.i,
        skipReason: SkippedFileReason.READ_ERROR,
        readErrorDetail: String(error),
      } satisfies JavaParseReply);
      return;
    }
    if (!content || content.trim().length === 0) {
      port.postMessage({
        i: job.i,
        skipReason: SkippedFileReason.EMPTY_CONTENT,
      } satisfies JavaParseReply);
      return;
    }
    const lineCount = content.split('\n').length;
    if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
      port.postMessage({
        i: job.i,
        skipReason: SkippedFileReason.FILE_TOO_LARGE,
        lineCount,
      } satisfies JavaParseReply);
      return;
    }
    const facts = extractJavaFileFacts(
      codeExtractor,
      importExtractor,
      job.filePath,
      content,
      job.serviceVersionHash
    );
    port.postMessage({ i: job.i, facts: freezeFileFacts(facts) } satisfies JavaParseReply);
  })();
});
