/**
 * DISCOVERING AND BUILDING A PROJECT'S PROGRAMS, shared by the two project-scale oracles.
 *
 * Lifted out of ground-truth/tsc-oracle.mjs unchanged. A real project's answers depend on
 * its tsconfig chain, its path mappings and its @types; a directory walk with default
 * options builds a DIFFERENT program that does not typecheck, and an oracle built that way
 * reports on a program nobody wrote. The member oracle (#663) has to build the same
 * programs the call oracle does, and copying eighty lines of discovery is how the two
 * would come to disagree about what the project even is.
 *
 *   makeProjects(ts, projectDir) -> { configPaths, programsOf, relPath }
 *
 * `programsOf()` is a generator: one program per discovered tsconfig, built lazily, so a
 * caller walks them one at a time rather than holding every checker alive at once.
 */
import fs from 'node:fs';
import path from 'node:path';

export function makeProjects(ts, projectDir) {
  // The roots the PARSER used, so a file is emitted relative to the same base the IR's
  // filePath carries. Written by run-evaluation.sh into PARSER_PROJECT_ROOTS; see the note
  // above relPath in tsc-oracle.mjs for why one normalisation applied to both sides is the
  // only thing that makes the two joinable.
  const ROOTS = (() => {
    const f = process.env.PARSER_PROJECT_ROOTS;
    if (!f) return [];
    try {
      return fs.readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)
        .map((x) => fs.realpathSync(x))
        .sort((a, b) => b.length - a.length);
    } catch { return []; }
  })();
  const REAL_PROJECT_DIR = (() => { try { return fs.realpathSync(projectDir); } catch { return projectDir; } })();

  const toPosix = path.sep === '/' ? (p) => p : (p) => p.split(path.sep).join('/');
  function relPath(fileName) {
    let real = fileName;
    try { real = fs.realpathSync(fileName); } catch { /* keep */ }
    for (const r of ROOTS) {
      const rel = path.relative(r, real);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
    }
    return toPosix(path.relative(REAL_PROJECT_DIR, real));
  }

  function discoverConfigs(dir) {
    const up = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
    // findConfigFile walks up past the project; only accept one INSIDE it.
    if (up && !path.relative(dir, up).startsWith('..')) return [up];

    const found = [];
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
    const walk = (d, depth) => {
      if (depth > 4) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      const here = path.join(d, 'tsconfig.json');
      if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) {
        found.push(here);
        // Do not descend past a project root: a package's own sub-tsconfigs (for tests,
        // for a build variant) describe the same sources and would duplicate every row.
        return;
      }
      for (const e of entries) {
        if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
          walk(path.join(d, e.name), depth + 1);
        }
      }
    };
    walk(dir, 0);
    return found;
  }

  function rootsOf(configPath, seen = new Set()) {
    const real = path.resolve(configPath);
    if (seen.has(real)) return { fileNames: [], options: undefined };
    seen.add(real);
    const configFile = ts.readConfigFile(real, ts.sys.readFile);
    if (configFile.error || !configFile.config) return { fileNames: [], options: undefined };
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(real));
    if (parsed.fileNames.length > 0) return { fileNames: parsed.fileNames, options: parsed.options };
    // No files of its own. If it delegates, take what it delegates to.
    const refs = parsed.projectReferences ?? [];
    const names = [];
    let options = parsed.options;
    for (const r of refs) {
      // A reference path may name a directory (implying tsconfig.json) or a file.
      let rp = path.resolve(r.path);
      try { if (fs.statSync(rp).isDirectory()) rp = path.join(rp, 'tsconfig.json'); } catch { /* as given */ }
      const sub = rootsOf(rp, seen);
      if (sub.fileNames.length) {
        names.push(...sub.fileNames);
        // The referenced project's own options are the ones its files were written
        // against; the solution file carries none worth having.
        if (sub.options) options = sub.options;
      }
    }
    return { fileNames: names, options };
  }

  const configPaths = discoverConfigs(projectDir);

  function* programsOf() {
    for (const configPath of configPaths) {
      const resolved = rootsOf(configPath);
      const parsed = resolved.options
        ? resolved
        : ts.parseJsonConfigFileContent(
            ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath));
      yield ts.createProgram(parsed.fileNames, parsed.options);
    }
  }

  return { configPaths, programsOf, relPath };
}
