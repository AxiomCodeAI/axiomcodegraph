import * as path from 'path';

import { FILE_EXTENSIONS } from '@/constants/consts';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';
import { GradleScriptKind } from '@/enums/gradle/files/GradleScriptKind';

/** Everything the classifier can decide about a file from its path alone. */
export interface GradleScriptIdentity {
  scriptKind: GradleScriptKind;
  dialect: GradleDSLDialect;
  /** Directory that holds the settings file governing this script, if found. */
  buildRoot: string;
  /** Best-effort Gradle project path (`:core:api`). Empty when not a build script. */
  gradleProjectPath: string;
  /** Path relative to the build root, always with forward slashes. */
  relativePath: string;
  fileName: string;
}

/**
 * Decides what role a file plays in a Gradle build.
 *
 * Every other Gradle relation depends on this being right, because a build
 * file's meaning is positional. `core/build.gradle` configures `:core`. The
 * root `build.gradle` beside `settings.gradle` may configure every project in
 * the build through `subprojects { }`. `buildSrc/build.gradle` configures the
 * machinery that builds the build and contributes nothing to the product's
 * dependency graph — counting its `implementation` lines as product
 * dependencies is a common and completely silent error.
 *
 * ## The project path is provisional
 *
 * The path derived here comes from directory layout, which is the convention
 * but not the rule: `include ':core'` can be followed by
 * `project(':core').projectDir = file('modules/core-impl')`, and then the
 * directory says one thing and the build another. The resolution linker
 * overwrites this with the path the settings file actually declares wherever
 * a settings file was analysed. This is the fallback, not the answer.
 */
export class GradleScriptClassifier {
  private static readonly SETTINGS_BASENAMES = new Set([
    'settings.gradle', 'settings.gradle.kts',
  ]);

  private static readonly BUILD_BASENAMES = new Set([
    'build.gradle', 'build.gradle.kts',
  ]);

  /** Gradle's own conventional catalog name; others are declared in settings. */
  private static readonly CATALOG_BASENAME = 'libs.versions.toml';

  /**
   * @param filePath      Absolute path of the file.
   * @param settingsDirs  Directories in the corpus that hold a settings file.
   *                      Supplying the real set is what separates a ROOT_BUILD
   *                      from a PROJECT_BUILD; without it every build script
   *                      that is not obviously nested reads as a root.
   */
  static classify(filePath: string, settingsDirs: ReadonlySet<string>): GradleScriptIdentity {
    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);
    const dialect = this.detectDialect(filePath);
    const inBuildSrc = this.isUnderBuildSrc(filePath);

    const buildRoot = this.findBuildRoot(dir, settingsDirs);
    const relativePath = this.toPosix(path.relative(buildRoot, filePath)) || fileName;

    const scriptKind = this.detectKind(fileName, dir, inBuildSrc, settingsDirs);
    const gradleProjectPath = this.deriveProjectPath(scriptKind, dir, buildRoot);

    return { scriptKind, dialect, buildRoot, gradleProjectPath, relativePath, fileName };
  }

  /**
   * The dialect is the file extension and nothing else. Note that this is a
   * claim about the SOURCE, not about the parser: tree-sitter-groovy is the
   * only grammar available, so a KOTLIN row means "Kotlin source, read through
   * a Groovy grammar after rewriting", which is why the parse-gap relation
   * matters most on exactly these files.
   */
  static detectDialect(filePath: string): GradleDSLDialect {
    if (filePath.endsWith(FILE_EXTENSIONS.TOML)) return GradleDSLDialect.TOML;
    return filePath.endsWith(FILE_EXTENSIONS.KOTLIN_SCRIPT)
      ? GradleDSLDialect.KOTLIN
      : GradleDSLDialect.GROOVY;
  }

  /** Whether the path is a Gradle script or a version catalog this parser reads. */
  static isGradleFile(fileName: string): boolean {
    return fileName.endsWith(FILE_EXTENSIONS.GRADLE)
      || fileName.endsWith(FILE_EXTENSIONS.GRADLE_KTS)
      || fileName === this.CATALOG_BASENAME
      || (fileName.endsWith('.versions' + FILE_EXTENSIONS.TOML));
  }

  static isSettingsFile(fileName: string): boolean {
    return this.SETTINGS_BASENAMES.has(fileName);
  }

  static isCatalogFile(fileName: string): boolean {
    return fileName === this.CATALOG_BASENAME
      || fileName.endsWith('.versions' + FILE_EXTENSIONS.TOML);
  }

  private static detectKind(
    fileName: string,
    dir: string,
    inBuildSrc: boolean,
    settingsDirs: ReadonlySet<string>
  ): GradleScriptKind {
    if (this.isCatalogFile(fileName)) {
      return GradleScriptKind.VERSION_CATALOG;
    }

    if (this.SETTINGS_BASENAMES.has(fileName)) {
      return inBuildSrc ? GradleScriptKind.BUILD_SRC_SETTINGS : GradleScriptKind.SETTINGS;
    }

    // init.gradle / foo.init.gradle — applied before any project is evaluated,
    // so nothing it declares belongs to a project.
    if (fileName === 'init.gradle' || fileName === 'init.gradle.kts'
        || fileName.endsWith('.init.gradle') || fileName.endsWith('.init.gradle.kts')) {
      return GradleScriptKind.INIT;
    }

    if (this.BUILD_BASENAMES.has(fileName)) {
      if (inBuildSrc) return GradleScriptKind.BUILD_SRC_BUILD;
      return settingsDirs.has(dir) ? GradleScriptKind.ROOT_BUILD : GradleScriptKind.PROJECT_BUILD;
    }

    // Any other .gradle file is only ever reached through `apply from:`. It
    // configures whichever script applied it, which is not knowable from the
    // path — the resolution linker fills that edge in from the apply side.
    return GradleScriptKind.SCRIPT_PLUGIN;
  }

  /**
   * Nearest ancestor directory holding a settings file. Falls back to the
   * file's own directory so a lone build script still gets a stable relative
   * path rather than an absolute one.
   */
  private static findBuildRoot(dir: string, settingsDirs: ReadonlySet<string>): string {
    let current = dir;
    while (true) {
      if (settingsDirs.has(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) return dir;
      current = parent;
    }
  }

  /**
   * Directory layout to Gradle path. `core/api/build.gradle` under a root
   * holding settings.gradle becomes `:core:api`; the root build itself is `:`.
   *
   * Only build scripts get a path. A script plugin has no project of its own —
   * it takes on the project of whoever applied it, and inventing one from its
   * directory would attribute every dependency it declares to a project that
   * may never apply it.
   */
  private static deriveProjectPath(
    kind: GradleScriptKind,
    dir: string,
    buildRoot: string
  ): string {
    if (kind === GradleScriptKind.ROOT_BUILD || kind === GradleScriptKind.SETTINGS) return ':';
    if (kind !== GradleScriptKind.PROJECT_BUILD) return '';

    const rel = this.toPosix(path.relative(buildRoot, dir));
    if (!rel || rel === '.') return ':';
    if (rel.startsWith('..')) return '';
    return ':' + rel.split('/').filter(Boolean).join(':');
  }

  private static isUnderBuildSrc(filePath: string): boolean {
    return this.toPosix(filePath).split('/').includes('buildSrc');
  }

  private static toPosix(p: string): string {
    return p.split(path.sep).join('/');
  }
}
