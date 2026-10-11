import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { parentPort } from 'worker_threads';

import { extractJavaScriptFile } from '@/parsers/javascript/extractors/js-fact-extractor';
import { WorkspacePackages } from '@/parsers/typescript/workspace-packages';
import { scriptTextOf } from '@/utils/vue-sfc';
import {
  compilerOptionsFor,
  JS_SOURCE_EXTENSIONS,
  PathAliasResolver,
  stripExtension,
  toRelative,
} from '@/workflows/javascript/javascript-project-analyzer';
import {
  freezeFactSet,
  JsParseDispatch,
  JsParseReply,
  JsParseSharedState,
} from '@/workflows/javascript/js-parse-pool';

/**
 * One parse worker: reads a file, runs the SAME extraction the serial loop
 * runs, and posts the fact set back as a prototype-less snapshot
 * (`freezeFactSet`). The error cases mirror the serial loop's exactly — a
 * read failure, a component with nothing to read, and an extractor throw are
 * three different facts, and the analyzer records them under three reasons.
 *
 * ## The worker's caches are rebuilt from disk, not shipped from the thread
 *
 * The serial loop reuses one `PathAliasResolver`, one `WorkspacePackages`
 * discovery and one memo of workspace resolutions across the whole project.
 * Every one of those is a pure function of the filesystem and of
 * `projectModuleHashes` — which the main thread minted from paths alone,
 * before any file was parsed — so a per-worker rebuild answers identically
 * whatever order files reach whichever worker. Seeding them from main-thread
 * state instead would HIDE an order dependence rather than prove there is
 * none; the byte-gate against the serial run is what proves it.
 */
interface RunContext {
  sharedPath: string;
  shared: JsParseSharedState;
  projectModuleHashes: Map<string, string>;
  pathAliases: PathAliasResolver;
  toProjectRelative: (absolutePath: string) => string;
  resolveWorkspaceModule: (specifier: string) => string | undefined;
}

let context: RunContext | undefined;

/** The run-wide state, loaded once per run (the path is identical on every dispatch). */
function contextFor(sharedPath: string): RunContext {
  if (context !== undefined && context.sharedPath === sharedPath) {
    return context;
  }
  const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf-8')) as JsParseSharedState;
  const projectModuleHashes = new Map(shared.moduleHashes);
  const excludes = new Set(shared.excludeDirs);
  const toProjectRelative = (absolutePath: string): string =>
    stripExtension(toRelative(shared.pathAnchor, absolutePath));
  // Discovered lazily, as the serial loop's is built once up front: the walk
  // only happens at all when a file holds a bare specifier to resolve.
  let workspacePackages: WorkspacePackages | undefined;
  const workspaceResolutions = new Map<string, string | undefined>();
  const resolveWorkspaceModule = (specifier: string): string | undefined => {
    workspacePackages ??= WorkspacePackages.discover(shared.pathAnchor, excludes);
    if (workspacePackages.size === 0) {
      return undefined;
    }
    if (!workspaceResolutions.has(specifier)) {
      workspaceResolutions.set(specifier, workspacePackages.resolve(specifier,
        (absolutePath) => projectModuleHashes.get(absolutePath), JS_SOURCE_EXTENSIONS)?.absolutePath);
    }
    return workspaceResolutions.get(specifier);
  };
  context = {
    sharedPath,
    shared,
    projectModuleHashes,
    pathAliases: new PathAliasResolver(),
    toProjectRelative,
    resolveWorkspaceModule,
  };
  return context;
}

const port = parentPort;
if (!port) throw new Error('js-parse-worker must run as a worker thread');

port.on('message', (job: JsParseDispatch) => {
  void (async () => {
    const run = contextFor(job.sharedPath);
    let sourceText: string;
    try {
      sourceText = await fsp.readFile(job.filePath, 'utf-8');
    } catch (error) {
      port.postMessage({ i: job.i, readError: String(error) } satisfies JsParseReply);
      return;
    }
    const script = scriptTextOf(job.filePath, sourceText);
    if (script.unread !== undefined) {
      port.postMessage({ i: job.i, unread: script.unread } satisfies JsParseReply);
      return;
    }
    try {
      const facts = extractJavaScriptFile({
        absoluteFilePath: job.filePath,
        filePath: toRelative(run.shared.pathAnchor, job.filePath),
        baseMservPath: run.shared.baseMservPath,
        moduleQualifiedName: run.toProjectRelative(job.filePath),
        sourceText: script.text,
        scriptKind: script.scriptKind,
        serviceVersionLinkHash: run.shared.serviceVersionLinkHash,
        moduleSystem: job.governing.moduleSystem,
        moduleSystemSource: job.governing.moduleSystemSource,
        governingPackageJsonPath: job.governing.packageJsonPath === ''
          ? ''
          : toRelative(run.shared.pathAnchor, job.governing.packageJsonPath),
        packageName: job.governing.packageName,
        compilerOptions: compilerOptionsFor(
          job.governing.moduleSystem,
          run.pathAliases.aliasesFor(job.filePath)
        ),
        projectModuleHashes: run.projectModuleHashes,
        toProjectRelative: run.toProjectRelative,
        resolveWorkspaceModule: run.resolveWorkspaceModule,
      });
      port.postMessage({ i: job.i, facts: freezeFactSet(facts) } satisfies JsParseReply);
    } catch (error) {
      port.postMessage({ i: job.i, extractError: String(error) } satisfies JsParseReply);
    }
  })();
});
