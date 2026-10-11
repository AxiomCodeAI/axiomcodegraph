import * as fsp from 'fs/promises';
import { parentPort, workerData } from 'worker_threads';

import { TS_SKIP_DIRECTORIES } from '@/constants/typescript-constants';
import { extractTypeScriptFile, TsFileFacts } from '@/parsers/typescript/extractors/ts-fact-extractor';
import { TsConfigResolver } from '@/parsers/typescript/tsconfig-resolver';
import { WorkspacePackages } from '@/parsers/typescript/workspace-packages';
import { scriptTextOf } from '@/utils/vue-sfc';
import { freezeTsReply, TsParseDispatch, TsParseReply } from '@/workflows/typescript/ts-parse-pool';
import { toRelative, tsResolutionContext } from '@/workflows/typescript/ts-resolution-context';

/**
 * One TypeScript parse worker: the same per-file extraction the serial loop
 * runs, from the same shared inputs. The closures extraction needs are
 * rebuilt here from the plain values in `workerData` through the SAME
 * `tsResolutionContext` the analyzer uses, and the per-file tsconfig comes
 * from this worker's own `TsConfigResolver`, which reads the same files from
 * disk the analyzer's did. The two error cases mirror the serial loop's two
 * catch blocks exactly.
 */
const init = workerData as {
  pathAnchor: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  excludes: string[];
  projectModuleHashes: Map<string, string>;
};

const configResolver = new TsConfigResolver();
const workspacePackages = WorkspacePackages.discover(
  init.pathAnchor,
  new Set<string>(TS_SKIP_DIRECTORIES)
);
const { toProjectRelative, resolveWorkspaceModule } = tsResolutionContext(
  init,
  workspacePackages
);

const port = parentPort;
if (!port) throw new Error('ts-parse-worker must run as a worker thread');

port.on('message', (job: TsParseDispatch) => {
  void (async () => {
    let sourceText: string;
    try {
      sourceText = job.sourceText ?? (await fsp.readFile(job.file, 'utf-8'));
    } catch (error) {
      port.postMessage({ i: job.i, readError: String(error) } satisfies TsParseReply);
      return;
    }
    try {
      const governing = configResolver.resolve(job.file);
      const script = scriptTextOf(job.file, sourceText);
      const facts: TsFileFacts = extractTypeScriptFile({
        absoluteFilePath: job.file,
        filePath: job.filePath,
        baseMservPath: init.baseMservPath,
        moduleQualifiedName: job.moduleQualifiedName,
        sourceText: script.text,
        scriptKind: script.scriptKind,
        serviceVersionLinkHash: init.serviceVersionLinkHash,
        tsConfigPath: governing.configPath === ''
          ? ''
          : toRelative(init.pathAnchor, governing.configPath),
        moduleResolutionMode: governing.moduleResolutionMode,
        decoratorSystem: governing.decoratorSystem,
        compilerOptions: governing.options,
        packageName: '',
        projectModuleHashes: init.projectModuleHashes,
        toProjectRelative,
        resolveWorkspaceModule,
      });
      port.postMessage(freezeTsReply(job.i, facts));
    } catch (error) {
      port.postMessage({ i: job.i, extractError: String(error) } satisfies TsParseReply);
    }
  })();
});
