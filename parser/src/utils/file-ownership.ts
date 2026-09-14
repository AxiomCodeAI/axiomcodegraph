import * as path from 'path';

import { ProjectInfo } from '@/types/ProjectInfo';

/**
 * Attributes each discovered file to the single project that owns it.
 *
 * The scan targets `extractProject` supplies OVERLAP by construction: the
 * repository root is a target so root-level config is never missed, and every
 * project detected beneath it is a target too. A walk of the root therefore
 * re-reaches every file a walk of a sub-project reaches, and analysing per
 * target independently emits the same file once per containing target.
 *
 * Those duplicate rows are not even identical — `baseMservPath` carries the
 * target path and feeds the unique hash, so the copies get different keys,
 * slip past any uniqueness check, and read downstream as two distinct entities
 * rather than as one entity counted twice.
 *
 * The most specific containing target wins, because that is the project the
 * file actually belongs to and therefore the correct `baseMservPath`: a file in
 * `repo/core` is attributed to `repo/core`, not to `repo`.
 *
 * `GradleProjectAnalyzer` and `ServicesProjectAnalyzer` each resolve ownership
 * their own way — Gradle also needs the owner to classify a script, services
 * needs only the path — so they are left as they are; this is the same rule for
 * the analyzers that had no ownership pass at all.
 *
 * @param projects Overlapping scan targets.
 * @param findFiles Recursive file walk for one target root.
 */
export async function resolveFileOwners(
  projects: ReadonlyArray<ProjectInfo>,
  findFiles: (root: string) => Promise<string[]>
): Promise<Map<string, ProjectInfo>> {
  const owners = new Map<string, ProjectInfo>();

  for (const project of projects) {
    const files = await findFiles(project.path);
    for (const filePath of files) {
      const current = owners.get(filePath);
      if (!current || isMoreSpecific(project, current)) {
        owners.set(filePath, project);
      }
    }
  }

  return owners;
}

/**
 * Inverts an ownership map so each project can be analysed once with the files
 * it actually owns, preserving the per-project reporting the analyzers print.
 */
export function groupOwnedFiles(
  owners: ReadonlyMap<string, ProjectInfo>
): Map<ProjectInfo, string[]> {
  const grouped = new Map<ProjectInfo, string[]>();

  for (const [filePath, project] of owners) {
    const existing = grouped.get(project);
    if (existing) {
      existing.push(filePath);
    } else {
      grouped.set(project, [filePath]);
    }
  }

  return grouped;
}

function isMoreSpecific(candidate: ProjectInfo, current: ProjectInfo): boolean {
  return path.resolve(candidate.path).length > path.resolve(current.path).length;
}
