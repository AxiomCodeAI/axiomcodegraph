import * as fs from 'fs';
import * as path from 'path';

/**
 * A PORTABLE IDENTITY FOR AN ANALYSIS ROOT, for use in a primary key.
 *
 * ## Why a root belongs in the key at all
 *
 * `ts_module`'s key carries `filePath`, which is RELATIVE to the root being analysed, so
 * it does not identify a file on its own: a run stages the client and every dependency it
 * resolved into, each as its own root, and `index.d.ts` is the relative path of a great
 * many of them. Measured on one corpus member's staged libraries, `index.d.ts`,
 * `cjs/index.d.ts`, `esm/index.d.ts` and `ts/index.ts` each belong to two or more roots.
 * Drop the root and those collapse onto one key, which is the collision parser#70 is about.
 *
 * ## Why it may not be the root's PATH
 *
 * The path is absolute, so the key moved with the directory the analysis happened to run
 * in. Two runs of the same project at the same pin, differing only in work directory,
 * shared 0 of 487 client method ids and 4 of 68 library ones, over an identical set of 555
 * `file_path:start_line` pairs. Every type, field and method key derives from the module
 * key, so all of them moved. See #934.
 *
 * ## What is used instead, and why it is safe
 *
 * The root's own `name@version`. It names the same thing the path was standing in for, and
 * it is a property of the package rather than of the machine.
 *
 * The obvious cheaper choice, the path after the last `node_modules/`, was measured and
 * REJECTED: with nested duplicates included it collides on 198 of 1,307 tokens on one
 * corpus member, 84 on another and 197 on a third, because a transitive dependency
 * resolved at two depths is two roots with one package name.
 *
 * `name@version` collides only where the same package at the same version is installed at
 * two depths, which npm does routinely. Measured over 1,835 package roots: 100 tokens at
 * two or more roots, and of those, 6 whose top-level listings differ at all. Every one of
 * those 6 differs only by the presence of a nested `node_modules/` directory, with the
 * package's own sources byte-identical. Merging those roots onto one key is therefore
 * correct rather than merely tolerable: it is the same code.
 *
 * ## What this costs, which is not nothing
 *
 * A key now moves when the root's VERSION moves, even for a file that did not change. For
 * a dependency that is right, since a different version is different code. For the
 * analysed project itself it is a wart: bumping its own `version` re-keys every row in the
 * bundle. It is still strictly better than the path, which moved on a version bump AND on
 * every change of directory, and the narrower rule that would fix it (version only for
 * roots under `node_modules/`) is a second discriminator wanting its own evidence, so it
 * is not taken here.
 *
 * ## A root with no manifest keeps its path, and that is deliberate
 *
 * An earlier form of this returned `""` when no `package.json` could be read. That is a
 * COLLISION waiting to happen: two manifest-less roots in one run share the empty token
 * and their files merge. It is not hypothetical, and it is not only a Java or Python
 * concern: this repository's own JavaScript torture fixture has no `package.json`, and
 * neither do its Java and Python case directories. On one TypeScript corpus member the
 * staged standard-library source is already such a root; it is alone there, and a second
 * would have been silent, because a key collision cannot fail a golden.
 *
 * So the fallback is the path it replaced. A root that can be named portably is named
 * portably; a root that cannot keeps exactly the behaviour it had. The change is then
 * monotonic: strictly better where a manifest exists, and never worse where none does.
 */
const cache = new Map<string, string>();

export function stableRootId(rootPath: string): string {
  const hit = cache.get(rootPath);
  if (hit !== undefined) return hit;
  let id = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
    if (pkg && typeof pkg.name === 'string' && pkg.name) {
      id = pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
    }
  } catch {
    // No package.json, or not readable, or not JSON. Fall through to the path.
  }
  if (!id) id = rootPath;
  cache.set(rootPath, id);
  return id;
}
