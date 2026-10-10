import * as fs from 'fs';
import * as path from 'path';

import { moduleHashFor } from '@/parsers/typescript/extractors/ts-module-extractor';
import { stripTsExtension } from '@/parsers/typescript/ts-module-paths';
import { WorkspaceModule } from '@/parsers/typescript/extractors/ts-import-extractor';
import { WorkspacePackages } from '@/parsers/typescript/workspace-packages';

/**
 * The shared inputs a TypeScript file's extraction closes over, built from
 * PLAIN DATA so the analyzer's loop and a parse worker construct the same
 * three functions from the same values and cannot drift. The parts are pure
 * (`toProjectRelative`), derived from paths alone (`sourceModuleHashOf` — the
 * design that lets a module augmentation key under a file that has not been
 * parsed), or memoised pure lookups (`resolveWorkspaceModule`), which is what
 * makes per-file extraction order-free and therefore poolable at all.
 */
export interface TsResolutionInputs {
  pathAnchor: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;
  /** Directory NAMES excluded from the walk, as the analyzer resolved them. */
  excludes: ReadonlySet<string> | readonly string[];
  /** Every in-program file's module hash, keyed by normalized absolute path. */
  projectModuleHashes: Map<string, string>;
}

export interface TsResolutionContext {
  toProjectRelative: (absolutePath: string) => string;
  sourceModuleHashOf: (absolutePath: string) => string | undefined;
  resolveWorkspaceModule: (specifier: string) => WorkspaceModule | undefined;
}

export function toRelative(rootDir: string, file: string): string {
  return path.relative(rootDir, file).split(path.sep).join('/') || path.basename(file);
}

export function stripExtension(relativePath: string): string {
  return stripTsExtension(relativePath);
}

export function tsResolutionContext(
  inputs: TsResolutionInputs,
  workspacePackages: WorkspacePackages
): TsResolutionContext {
  const { pathAnchor, baseMservPath, serviceVersionLinkHash, projectModuleHashes } = inputs;
  const excludes = inputs.excludes instanceof Set ? inputs.excludes : new Set(inputs.excludes);

  const toProjectRelative = (absolutePath: string): string =>
    stripExtension(toRelative(pathAnchor, absolutePath));

  // A sibling package imported by its name binds to the source its entry is
  // built from. That source may belong to another program under the same
  // anchor, whose module hash is the same pure function of its path; a source
  // file outside the anchor or under a skipped directory is walked by no
  // program and binds nothing.
  const sourceModuleHashOf = (absolutePath: string): string | undefined => {
    const inProgram = projectModuleHashes.get(absolutePath);
    if (inProgram !== undefined) {
      return inProgram;
    }
    const relative = path.relative(pathAnchor, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || /\.d\.(m|c)?ts$/.test(relative)
      || relative.split(path.sep).some((segment) => excludes.has(segment))
      || !fs.existsSync(absolutePath)) {
      return undefined;
    }
    return moduleHashFor(toRelative(pathAnchor, absolutePath), baseMservPath, serviceVersionLinkHash);
  };

  const workspaceResolutions = new Map<string, WorkspaceModule | undefined>();
  const resolveWorkspaceModule = (specifier: string): WorkspaceModule | undefined => {
    if (workspacePackages.size === 0) {
      return undefined;
    }
    if (!workspaceResolutions.has(specifier)) {
      workspaceResolutions.set(specifier, workspacePackages.resolve(specifier, sourceModuleHashOf));
    }
    return workspaceResolutions.get(specifier);
  };

  return { toProjectRelative, sourceModuleHashOf, resolveWorkspaceModule };
}
