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
 * Used by the JavaScript and TypeScript walks and detectors, and by the project
 * scan (project-scanner.ts), which must not register such a directory as a
 * JavaScript root of its own: a walk never tests its own root. axiomcode-build's
 * language count and the refresher's file table (ax_fresh.py `generated_output`)
 * apply the same rules, so the language it detects is one the parser then finds
 * files for.
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

/**
 * The files that make a directory the root of a Gradle project or module. Gradle writes that
 * project's output (compiled classes, processed resources, and generated sources such as
 * `build/generated/sources/annotationProcessor/java/main`) into a `build` directory beside them.
 */
export const GRADLE_BUILD_FILES = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] as const;

/**
 * Is `parent/name` a Gradle project's output directory, whose `.java` files a build wrote?
 *
 * Anchored on its owner, the way `target` is anchored on a `pom.xml` above: a `build` beside a
 * Gradle build or settings script. `build` is also an ordinary Java package name (builders, build
 * steps: `src/main/java/app/build/StepBuilder.java`), and pruning every directory of that name
 * dropped such a package from the graph with no skipped-file row to say so. A `build` inside a
 * source tree or a package path has no build script beside it, so it is walked.
 * Used by the Java source walk (java-project-analyzer.ts); the refresher's file table
 * (ax_fresh.py `gradle_output`) applies the same rule, so freshness and the language count agree.
 */
export function isGradleBuildOutput(parent: string, name: string): boolean {
  return name === 'build' && GRADLE_BUILD_FILES.some((file) => fs.existsSync(path.join(parent, file)));
}
