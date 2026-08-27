import { GradleDependencyNotation } from '@/enums/gradle/declarations/GradleDependencyNotation';
import { GradleVersionSource } from '@/enums/gradle/dependencies/GradleVersionSource';

/** One coordinate split out of a dependency declaration's argument text. */
export interface ParsedCoordinate {
  notation: GradleDependencyNotation;
  group: string;
  artifact: string;
  version: string;
  classifier: string;
  extension: string;
  versionSource: GradleVersionSource;
  /** `:core` for a project dependency. */
  projectPath: string;
  /** The file pattern for files()/fileTree(). */
  fileSpec: string;
  /** `spring.boot.starter` for `libs.spring.boot.starter`. */
  catalogAlias: string;
}

/**
 * Splits a dependency declaration's arguments into coordinates.
 *
 * ## Why a version is not just "the third colon-separated field"
 *
 * `implementation 'com.example:lib'` has two fields and is a complete, valid
 * dependency: a BOM or platform supplies the version. `implementation
 * 'com.example:lib:1.0:tests@jar'` has five things in it. `implementation
 * libs.spring.core` has none of them — the coordinate lives in a TOML file.
 * `implementation depString` has the whole thing behind a variable.
 *
 * All four produce a row. What separates them is `versionSource`, which says
 * whether an empty version column means "the build omitted it deliberately",
 * "the parser could not read it", or "it is in the catalog and the linker will
 * fill it in". A consumer asking which projects pin a vulnerable version needs
 * that distinction; without it, every unread version reads as "not pinned".
 *
 * ## Returns a list, not one coordinate
 *
 * `files('a.jar', 'b.jar')` is one declaration and two artifacts, and
 * `libs.bundles.spring` is one declaration and however many the bundle holds.
 * Returning a single coordinate would force the caller to either drop the rest
 * or pack them into one string.
 */
export class DependencyCoordinateParser {
  /**
   * @param argsText The declaration's argument text, quotes and all.
   */
  static parse(argsText: string): ParsedCoordinate[] {
    const text = argsText.trim();
    if (!text) return [];

    const wrapper = this.matchWrapper(text);
    if (wrapper) return this.parseWrapper(wrapper.name, wrapper.inner, text);

    if (this.isCatalogAccessor(text)) return [this.catalogCoordinate(text)];

    if (this.isMapNotation(text)) return [this.parseMapNotation(text)];

    const literal = this.stripQuotes(text);
    if (literal !== null) return [this.parseGav(literal)];

    // Not quoted, not a call, not a map: the coordinate is behind a name this
    // parser cannot evaluate. Recorded as such rather than guessed at.
    return [{
      ...this.empty(),
      notation: GradleDependencyNotation.VARIABLE_REFERENCE,
      versionSource: GradleVersionSource.VARIABLE,
    }];
  }

  // ── wrappers: project(), files(), platform(), testFixtures(), … ──────────

  private static readonly WRAPPER_NOTATIONS: Record<string, GradleDependencyNotation> = {
    project: GradleDependencyNotation.PROJECT,
    files: GradleDependencyNotation.FILES,
    fileTree: GradleDependencyNotation.FILE_TREE,
    platform: GradleDependencyNotation.PLATFORM,
    enforcedPlatform: GradleDependencyNotation.ENFORCED_PLATFORM,
    testFixtures: GradleDependencyNotation.TEST_FIXTURES,
    gradleApi: GradleDependencyNotation.GRADLE_API,
    gradleTestKit: GradleDependencyNotation.GRADLE_TEST_KIT,
    localGroovy: GradleDependencyNotation.LOCAL_GROOVY,
    create: GradleDependencyNotation.CREATE_METHOD,
  };

  private static matchWrapper(text: string): { name: string; inner: string } | null {
    const m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(([\s\S]*)\)$/.exec(text);
    if (!m) return null;
    const name = (m[1] ?? '').split('.').pop() ?? '';
    if (!(name in this.WRAPPER_NOTATIONS)) return null;
    return { name, inner: m[2] ?? '' };
  }

  private static parseWrapper(name: string, inner: string, whole: string): ParsedCoordinate[] {
    const notation = this.WRAPPER_NOTATIONS[name]!;
    const innerText = inner.trim();

    switch (notation) {
      case GradleDependencyNotation.PROJECT: {
        // project(':core') and project(path: ':core', configuration: 'x')
        const pathArg = /(?:^|[(,]\s*)path\s*:\s*(['"])([^'"]*)\1/.exec(whole);
        const projectPath = pathArg
          ? (pathArg[2] ?? '')
          : (this.stripQuotes(this.firstArgument(innerText)) ?? '');
        return [{ ...this.empty(), notation, projectPath, versionSource: GradleVersionSource.ABSENT }];
      }

      case GradleDependencyNotation.FILES:
      case GradleDependencyNotation.FILE_TREE: {
        // Every argument is its own artifact. One row each, so a query for a
        // jar by name does not have to split a packed column.
        const specs = this.splitTopLevel(innerText, ',')
          .map((a) => this.stripQuotes(a.trim()) ?? a.trim())
          .filter(Boolean);
        if (!specs.length) {
          return [{ ...this.empty(), notation, fileSpec: innerText, versionSource: GradleVersionSource.ABSENT }];
        }
        return specs.map((fileSpec) => ({
          ...this.empty(), notation, fileSpec, versionSource: GradleVersionSource.ABSENT,
        }));
      }

      case GradleDependencyNotation.GRADLE_API:
      case GradleDependencyNotation.GRADLE_TEST_KIT:
      case GradleDependencyNotation.LOCAL_GROOVY:
        // Supplied by the running Gradle distribution; version is its version.
        return [{ ...this.empty(), notation, versionSource: GradleVersionSource.ABSENT }];

      default: {
        // platform(…), enforcedPlatform(…), testFixtures(…), create(…) all
        // wrap a real coordinate. Parse the inside, keep the outer notation:
        // the fact that it is a platform is what makes the row mean something
        // different from the same coordinate declared directly.
        const innerCoords = this.parse(innerText);
        if (!innerCoords.length) {
          return [{ ...this.empty(), notation, versionSource: GradleVersionSource.UNKNOWN }];
        }
        return innerCoords.map((c) => ({ ...c, notation }));
      }
    }
  }

  // ── version catalog accessors ────────────────────────────────────────────

  /**
   * `libs.spring.core`, `libs.bundles.spring`, `libs.plugins.boot`.
   *
   * Matched structurally: a dotted chain of identifiers with no quotes, no
   * parentheses and no colon. The leading segment is the catalog name, which
   * is `libs` by convention but can be anything settings registered, so it is
   * not hard-coded — the alias is everything after the first dot, and the
   * linker matches it against the catalogs actually found.
   */
  private static isCatalogAccessor(text: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(text)
      && !text.includes(':');
  }

  private static catalogCoordinate(text: string): ParsedCoordinate {
    const segments = text.split('.');
    const rest = segments.slice(1);
    const isBundle = rest[0] === 'bundles';
    const alias = (isBundle || rest[0] === 'plugins' || rest[0] === 'versions')
      ? rest.slice(1).join('.')
      : rest.join('.');

    return {
      ...this.empty(),
      notation: isBundle
        ? GradleDependencyNotation.VERSION_CATALOG_BUNDLE
        : GradleDependencyNotation.VERSION_CATALOG_ACCESSOR,
      catalogAlias: alias,
      // Not CATALOG yet. The catalog may not be in the corpus at all, and
      // claiming the version came from one before the link is made would put a
      // source on a row that still has no version.
      versionSource: GradleVersionSource.UNKNOWN,
    };
  }

  // ── map notation ─────────────────────────────────────────────────────────

  private static isMapNotation(text: string): boolean {
    return /(^|[\s,(])(group|name|module|version|classifier|ext)\s*:/.test(text);
  }

  private static parseMapNotation(text: string): ParsedCoordinate {
    const read = (key: string): string => {
      const m = new RegExp(`(?:^|[\\s,(])${key}\\s*:\\s*(['"])([^'"]*)\\1`).exec(text);
      if (m) return m[2] ?? '';
      // Unquoted value — a variable rather than a literal.
      const bare = new RegExp(`(?:^|[\\s,(])${key}\\s*:\\s*([A-Za-z_$][\\w.$]*)`).exec(text);
      return bare ? (bare[1] ?? '') : '';
    };

    let group = read('group');
    let artifact = read('name');
    const module = read('module');
    if (module) {
      const colon = module.indexOf(':');
      group = colon >= 0 ? module.slice(0, colon) : module;
      artifact = colon >= 0 ? module.slice(colon + 1) : '';
    }

    const version = read('version');
    return {
      ...this.empty(),
      notation: GradleDependencyNotation.MAP_NOTATION,
      group,
      artifact,
      version,
      classifier: read('classifier'),
      extension: read('ext'),
      versionSource: this.versionSourceFor(version),
    };
  }

  // ── plain GAV strings ────────────────────────────────────────────────────

  /**
   * `group:artifact:version:classifier@ext`, with every field after the second
   * optional.
   */
  private static parseGav(literal: string): ParsedCoordinate {
    let text = literal;
    let extension = '';

    const at = text.lastIndexOf('@');
    // An `@` inside an interpolation is not an extension separator.
    if (at > 0 && !text.slice(at).includes('}')) {
      extension = text.slice(at + 1);
      text = text.slice(0, at);
    }

    const parts = this.splitGavOutsideInterpolation(text);
    const group = parts[0] ?? '';
    const artifact = parts[1] ?? '';
    const version = parts[2] ?? '';
    const classifier = parts[3] ?? '';

    let notation: GradleDependencyNotation;
    if (parts.length < 2) {
      // A single field is not a coordinate. Saying STRING_NOTATION here is what
      // hands a consumer a group with no artifact and no way to tell.
      notation = GradleDependencyNotation.UNKNOWN;
    } else if (text.includes('$')) {
      notation = GradleDependencyNotation.INTERPOLATED_STRING;
    } else if (extension) {
      notation = GradleDependencyNotation.STRING_WITH_EXTENSION;
    } else if (classifier) {
      notation = GradleDependencyNotation.STRING_WITH_CLASSIFIER;
    } else {
      notation = GradleDependencyNotation.STRING_NOTATION;
    }

    return {
      ...this.empty(),
      notation, group, artifact, version, classifier, extension,
      versionSource: this.versionSourceFor(version),
    };
  }

  /**
   * Splits on `:` at interpolation depth zero. `"g:a:${versions.x}"` must not
   * split inside the `${…}`, and a Groovy interpolation can legally contain a
   * colon — `${map['a:b']}` — so a plain split produces a version of `${map[`.
   */
  private static splitGavOutsideInterpolation(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '$' && text[i + 1] === '{') { depth++; i++; continue; }
      if (ch === '}' && depth > 0) { depth--; continue; }
      if (ch === ':' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
  }

  private static versionSourceFor(version: string): GradleVersionSource {
    if (!version) return GradleVersionSource.ABSENT;
    if (version.includes('$')) return GradleVersionSource.INTERPOLATED;
    return GradleVersionSource.LITERAL;
  }

  // ── shared text helpers ──────────────────────────────────────────────────

  private static firstArgument(text: string): string {
    return (this.splitTopLevel(text, ',')[0] ?? '').trim();
  }

  /** Splits on a separator outside quotes and outside brackets. */
  static splitTopLevel(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
      }
    }
    out.push(text.slice(start));
    return out;
  }

  /** Returns null when the text is not a quoted string. */
  private static stripQuotes(text: string): string | null {
    const t = text.trim();
    if (t.length < 2) return null;
    if (t.startsWith("'''") && t.endsWith("'''") && t.length >= 6) return t.slice(3, -3);
    if (t.startsWith('"""') && t.endsWith('"""') && t.length >= 6) return t.slice(3, -3);
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1);
    }
    return null;
  }

  private static empty(): ParsedCoordinate {
    return {
      notation: GradleDependencyNotation.UNKNOWN,
      group: '', artifact: '', version: '', classifier: '', extension: '',
      versionSource: GradleVersionSource.UNKNOWN,
      projectPath: '', fileSpec: '', catalogAlias: '',
    };
  }
}
