import * as fs from 'fs';
import * as path from 'path';

/**
 * Is `parent/name` a directory a BUILD wrote, so its JavaScript and TypeScript are
 * not the project's (#1545)?
 *
 * Recognised by what owns the directory, never by its name alone. A name is not
 * evidence: `build`, `out` and `dist` are real Java package names, and pruning them
 * by name is how the Java walk silently loses source (#531). So each rule here is
 * anchored:
 *
 *   `target` beside a `pom.xml`   Maven's build directory. `mvn javadoc:javadoc`
 *                                 writes `target/site/apidocs/script.js`, and a
 *                                 Maven site or a frontend plugin writes more; a
 *                                 `target` with no `pom.xml` beside it is walked.
 *   a javadoc output directory    `index.html` with `element-list` (JDK 9 and
 *                                 later) or `package-list` (JDK 8) beside it,
 *                                 wherever it is: a javadoc committed for a docs
 *                                 site (`docs/apidocs/`) is as generated as one
 *                                 under `target/`. The two list files are what
 *                                 javadoc writes for `-link` to read; no hand-kept
 *                                 JavaScript source names a file that way.
 *   a Dokka HTML output directory `index.html` with `navigation.html` and
 *                                 `scripts/sourceset_dependencies.js` beside it:
 *                                 the Kotlin documentation engine a Java library
 *                                 with Kotlin modules publishes beside its
 *                                 javadoc. Its per-module `package-list` sits one
 *                                 level down, so the javadoc rule misses it.
 *
 * Without this, one generated `script.js` made a Maven repository a JavaScript
 * repository too: axiomcode-build counted it, built a second graph from javadoc's
 * own helpers, and every query asked that graph as well.
 * axiomcode-build's language count (ax_fresh.py `webcount`) applies the same
 * rules, so the language it detects is one the parser then finds files for.
 */
export function isGeneratedOutputDirectory(parent: string, name: string): boolean {
  if (name === 'target' && fs.existsSync(path.join(parent, 'pom.xml'))) {
    return true;
  }
  const directory = path.join(parent, name);
  if (!fs.existsSync(path.join(directory, 'index.html'))) {
    return false;
  }
  return fs.existsSync(path.join(directory, 'element-list'))
    || fs.existsSync(path.join(directory, 'package-list'))
    || (fs.existsSync(path.join(directory, 'navigation.html'))
      && fs.existsSync(path.join(directory, 'scripts', 'sourceset_dependencies.js')));
}
