/**
 * The directories git ignores under the tree being analysed, so that no walker reads them.
 *
 * Every walker in the parser skips a fixed list of names (node_modules, dist, .next, …). A generated tree
 * that only the repository's .gitignore names — a framework's build cache under another name, a vendored
 * bundle, a local export — was parsed as source: an index of a 431-file Next.js/TypeScript project read
 * 15,108 files and took 12 minutes. git already knows which directories are not the project, so it is asked
 * once per run:
 *
 *     git ls-files --others --ignored --exclude-standard --directory
 *
 * lists each ignored directory once (not its contents) and only when NOTHING under it is tracked, so a file
 * committed on purpose beneath an ignored name is still read, and so is everything outside a git work tree
 * (the command fails there, and nothing is skipped). Only directories are skipped, never single ignored
 * files: an ignored declaration file (`next-env.d.ts`) still contributes types. The background refresher
 * (plugins/axiomcode/skills/axiomcode/scripts/ax_fresh.py, git_ignored_dirs) asks the same question, so the
 * files it watches are the files the parser reads.
 *
 * Off for a library tree (`--library`: a dependency's own .gitignore names its build output, which for a
 * dependency is the source) and with AXIOMCODE_NO_GITIGNORE=1.
 *
 * VENDORED CODE IS NOT THE PROJECT EITHER, when the index detected its languages. With AXIOMCODE_SKIP_VENDORED=1
 * (set by the plugin's build when no --lang was given, unless AXIOMCODE_INCLUDE_VENDORED=1) a `vendor` directory in
 * any language but Java (where it is a package name and third-party code arrives as jars), an ASP.NET
 * `wwwroot/lib` (what libman and bower restore bootstrap and jQuery into), and a minified or bundled script
 * (`*.min.js`, `*.bundle.js`) are not read. A C# web application otherwise paid a JavaScript build for the copy
 * of jQuery it serves. An explicit --lang reads them as it always did. The plugin's file table
 * (ax_fresh.py, vendored_dir / vendored_file) applies the same rule.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

let ignored: ReadonlySet<string> = new Set();
let skipVendored = false;

const key = (p: string): string => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** Load the ignored directories under `root`; returns how many there are. Replaces what an earlier call loaded. */
export function loadGitIgnored(root: string): number {
  ignored = new Set();
  skipVendored = process.env.AXIOMCODE_SKIP_VENDORED === '1';
  if (process.env.AXIOMCODE_NO_GITIGNORE) return 0;
  let out: string;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', '.'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024, timeout: 120_000 });
  } catch {
    return 0;                                   // not a work tree, or no git: nothing is skipped
  }
  const set = new Set<string>();
  for (const entry of out.split('\0')) {
    if (entry.endsWith('/')) set.add(key(path.join(root, entry)));
  }
  ignored = set;
  return set.size;
}

/** Forget the loaded set (a library tree is parsed with nothing skipped). */
export function clearGitIgnored(): void {
  ignored = new Set();
  skipVendored = false;
}

/** True when `dir` is vendored third-party code the index skips (see the header); only with AXIOMCODE_SKIP_VENDORED=1. */
export function isVendoredDir(dir: string, language?: string): boolean {
  if (!skipVendored) return false;
  const name = path.basename(dir);
  if (name === 'vendor') return language !== 'java';
  return name === 'lib' && path.basename(path.dirname(dir)) === 'wwwroot';
}

/** True when a script file is minified or bundled output (`x.min.js`, `x.bundle.js`); only with AXIOMCODE_SKIP_VENDORED=1. */
export function isVendoredFile(name: string): boolean {
  return skipVendored && /\.(min|bundle)\.[cm]?js$/i.test(name);
}

/** True when git ignores the directory at `dir` (absolute, or relative to the working directory). */
export function isGitIgnoredDir(dir: string, language?: string): boolean {
  return (ignored.size > 0 && ignored.has(key(dir))) || isVendoredDir(dir, language);
}
