import * as path from 'path';

import { GradleCatalogEntry } from '@/analysis-types/gradle/GradleCatalogEntry';
import { GradleDeclaration } from '@/analysis-types/gradle/GradleDeclaration';
import { GradleDependencyCoordinate } from '@/analysis-types/gradle/GradleDependencyCoordinate';
import { GradleScript } from '@/analysis-types/gradle/GradleScript';
import { GradleValueReference } from '@/analysis-types/gradle/GradleValueReference';
import { GradleCatalogEntryKind } from '@/enums/gradle/catalog/GradleCatalogEntryKind';
import { GradleDeclarationType } from '@/enums/gradle/declarations/GradleDeclarationType';
import { GradlePropertyScope } from '@/enums/gradle/declarations/GradlePropertyScope';
import { GradleScriptKind } from '@/enums/gradle/files/GradleScriptKind';
import { GradleReferenceResolution } from '@/enums/gradle/value-references/GradleReferenceResolution';
import { GradleValueReferenceType } from '@/enums/gradle/value-references/GradleValueReferenceType';

/** Everything the project pass links across, gathered from every file. */
export interface GradleProjectFacts {
  scripts: GradleScript[];
  declarations: GradleDeclaration[];
  valueReferences: GradleValueReference[];
  coordinates: GradleDependencyCoordinate[];
  catalogEntries: GradleCatalogEntry[];
}

/**
 * The project pass: fills in every link that one file could not decide alone.
 *
 * ## Why this cannot be folded into the single-file pass
 *
 * A single file pass reading `include ':core'` can conclude only that `:core`
 * is not in this file. That is the weaker answer, and writing it down as final
 * locks out the stronger one — the actual `core/build.gradle`, which is
 * sitting right there in the corpus. The same is true of every catalog
 * accessor: `implementation libs.spring.core` has no coordinate at all until
 * `gradle/libs.versions.toml` has been read.
 *
 * So the rule is the one the rest of the parser follows: a link a single file
 * cannot decide is left empty and retried here, rather than being resolved
 * pessimistically the first time.
 *
 * ## What it deliberately will not do
 *
 * It does not match a property reference against any declaration anywhere in
 * the corpus that happens to share its name. `version` is declared in nearly
 * every build file in a multi-project build; matching on name alone would link
 * a subproject's reference to an unrelated sibling's declaration and report it
 * as resolved. Cross-script matching is restricted to scopes that genuinely
 * propagate — the build's own root script, `ext` properties, and scripts
 * actually applied by the referring one.
 */
export class GradleResolutionLinker {
  link(facts: GradleProjectFacts): void {
    const byPath = new Map<string, GradleScript>();
    for (const s of facts.scripts) byPath.set(this.norm(s.getFilePath()), s);

    this.linkIncludes(facts, byPath);
    this.linkAppliedScripts(facts, byPath);
    this.linkProjectDependencies(facts);
    this.linkCatalogs(facts);
    this.linkCrossScriptProperties(facts);
    this.classifyRemainingReferences(facts);
  }

  // ── settings includes → the scripts they name ────────────────────────────

  /**
   * `include ':core:api'` names a project; the script that configures it is
   * `core/api/build.gradle` under the settings file's directory.
   *
   * The included script's own `gradleProjectPath` is overwritten with the path
   * the settings file declares, because settings is the authority. Layout is
   * only the convention: `include ':core'` may be followed by
   * `project(':core').projectDir = file('modules/core-impl')`, and then the
   * directory-derived path is simply wrong.
   */
  private linkIncludes(facts: GradleProjectFacts, byPath: Map<string, GradleScript>): void {
    const scriptsByHash = new Map(facts.scripts.map((s) => [s.getHash(), s]));
    const renamingSettings = this.settingsThatRenameBuildFiles(facts);

    for (const decl of facts.declarations) {
      if (decl.getDeclarationType() !== GradleDeclarationType.INCLUDE) continue;
      if (decl.getQualifier() !== 'include') continue;

      const settings = scriptsByHash.get(decl.getScriptHash());
      if (!settings) continue;

      const projectPath = decl.getName();
      if (!projectPath.startsWith(':')) continue;

      const segments = projectPath.replace(/^:/, '').split(':').filter(Boolean);
      const relativeDir = segments.join('/');
      const projectName = segments[segments.length - 1] ?? '';
      const settingsDir = path.dirname(settings.getFilePath());

      const candidates = ['build.gradle', 'build.gradle.kts'];

      // Gradle lets a settings script rename every project's build file:
      //
      //     rootProject.children.each { it.buildFileName = "${it.name}.gradle" }
      //
      // Spring Framework does exactly this, and under the conventional names
      // alone not one of its 30-odd subprojects links to its own build script.
      //
      // The extra candidate is only tried when the settings script actually
      // contains such an assignment — the evidence is in the emitted rows for
      // that file, so this is reading what the build says rather than guessing
      // at a layout.
      if (projectName && renamingSettings.has(settings.getHash())) {
        candidates.push(`${projectName}.gradle`, `${projectName}.gradle.kts`);
      }

      for (const base of candidates) {
        const target = byPath.get(this.norm(path.join(settingsDir, relativeDir, base)));
        if (!target) continue;

        decl.setResolvedTargetHash(target.getHash());
        target.setGradleProjectPath(projectPath);
        target.setSettingsScriptHash(settings.getHash());
        // The settings file just said this script configures a project, which
        // outranks whatever its filename suggested.
        if (target.getScriptKind() === GradleScriptKind.SCRIPT_PLUGIN) {
          target.setScriptKind(GradleScriptKind.PROJECT_BUILD);
        }
        break;
      }
    }
  }

  /**
   * Settings scripts that assign `buildFileName`.
   *
   * The assignment is almost always inside a closure over `rootProject
   * .children`, so the value is a template this parser does not evaluate. What
   * it can tell is that the build renames its build files at all, which is
   * enough to know the conventional name is not the one to look for.
   */
  private settingsThatRenameBuildFiles(facts: GradleProjectFacts): Set<string> {
    const out = new Set<string>();
    for (const decl of facts.declarations) {
      if (!decl.getName().includes('buildFileName') && !decl.getValue().includes('buildFileName')) continue;
      out.add(decl.getScriptHash());
    }
    return out;
  }

  // ── apply from: → the script plugin it pulls in ──────────────────────────

  /**
   * `apply from: 'gradle/dependencies.gradle'` resolves relative to the
   * applying script's own directory, which is how Gradle resolves it.
   *
   * A remote `apply from: 'https://…'` is left unresolved on purpose. The
   * content is not in the corpus and never will be, and pointing the edge at
   * anything local would fabricate a link.
   */
  private linkAppliedScripts(facts: GradleProjectFacts, byPath: Map<string, GradleScript>): void {
    const scriptsByHash = new Map(facts.scripts.map((s) => [s.getHash(), s]));

    for (const decl of facts.declarations) {
      if (decl.getDeclarationType() !== GradleDeclarationType.PLUGIN) continue;
      const target = decl.getName();
      if (!target || target.startsWith('http://') || target.startsWith('https://')) continue;
      if (!target.endsWith('.gradle') && !target.endsWith('.gradle.kts')) continue;

      const owner = scriptsByHash.get(decl.getScriptHash());
      if (!owner) continue;

      const resolved = byPath.get(this.norm(path.resolve(path.dirname(owner.getFilePath()), target)));
      if (resolved) decl.setResolvedTargetHash(resolved.getHash());
    }
  }

  // ── project(':core') dependencies → the subproject's script ──────────────

  private linkProjectDependencies(facts: GradleProjectFacts): void {
    const byProjectPath = new Map<string, GradleScript>();
    for (const s of facts.scripts) {
      const p = s.getGradleProjectPath();
      if (p && p !== ':') byProjectPath.set(p, s);
    }
    if (!byProjectPath.size) return;

    const declByHash = new Map(facts.declarations.map((d) => [d.getHash(), d]));

    for (const coord of facts.coordinates) {
      const projectPath = coord.getProjectPath();
      if (!projectPath) continue;
      const target = byProjectPath.get(projectPath);
      if (!target) continue;

      const decl = declByHash.get(coord.getDeclarationHash());
      if (decl) decl.setResolvedTargetHash(target.getHash());
    }
  }

  // ── version catalogs → the coordinates and references that name them ─────

  /**
   * The join that makes a modern build legible. `implementation
   * libs.spring.core` carries no group, no artifact and no version until the
   * catalog is read; this is where the row stops being empty.
   *
   * Accessors are matched on the derived accessor path rather than the raw
   * alias, because Gradle turns `-` and `_` into `.` when it generates them:
   * `spring-boot-starter-web` in the TOML is `libs.spring.boot.starter.web` in
   * the build file, and matching the literal alias finds neither.
   */
  private linkCatalogs(facts: GradleProjectFacts): void {
    if (!facts.catalogEntries.length) return;

    // Keyed by catalog name so two catalogs cannot answer for each other.
    const byCatalog = new Map<string, Map<string, GradleCatalogEntry>>();
    for (const entry of facts.catalogEntries) {
      const name = entry.getCatalogName() || 'libs';
      let table = byCatalog.get(name);
      if (!table) { table = new Map(); byCatalog.set(name, table); }
      table.set(`${entry.getEntryKind()}|${entry.getAccessorPath()}`, entry);
    }

    const lookup = (
      accessor: string,
      kind: GradleCatalogEntryKind
    ): GradleCatalogEntry | undefined => {
      const normalised = GradleCatalogEntry.toAccessorPath(accessor);
      for (const table of byCatalog.values()) {
        const hit = table.get(`${kind}|${normalised}`);
        if (hit) return hit;
      }
      return undefined;
    };

    for (const coord of facts.coordinates) {
      const alias = coord.getCatalogAlias();
      if (!alias) continue;

      const entry = lookup(alias, GradleCatalogEntryKind.LIBRARY)
        ?? lookup(alias, GradleCatalogEntryKind.BUNDLE)
        ?? lookup(alias, GradleCatalogEntryKind.PLUGIN);
      if (!entry) continue;

      coord.setResolvedFromCatalog({
        hash: entry.getHash(),
        group: entry.getGroup(),
        artifact: entry.getArtifact(),
        // A ref-based entry has its version only after the catalog's own
        // version pass ran, so the resolved one is preferred and the literal
        // is the fallback.
        version: entry.getResolvedVersion() || entry.getVersion(),
      });
    }

    for (const ref of facts.valueReferences) {
      const type = ref.getReferenceType();
      if (type !== GradleValueReferenceType.VERSION_CATALOG_ACCESSOR
        && type !== GradleValueReferenceType.VERSION_CATALOG_BUNDLE
        && type !== GradleValueReferenceType.VERSION_CATALOG_PLUGIN) continue;

      const expr = ref.getReferenceExpression();
      const bundle = lookup(expr, GradleCatalogEntryKind.BUNDLE);
      if (bundle) { ref.setResolution(GradleReferenceResolution.CATALOG_BUNDLE, bundle.getHash()); continue; }

      const library = lookup(expr, GradleCatalogEntryKind.LIBRARY);
      if (library) { ref.setResolution(GradleReferenceResolution.CATALOG_LIBRARY, library.getHash()); continue; }

      const plugin = lookup(expr, GradleCatalogEntryKind.PLUGIN);
      if (plugin) { ref.setResolution(GradleReferenceResolution.CATALOG_PLUGIN, plugin.getHash()); continue; }

      const version = lookup(expr, GradleCatalogEntryKind.VERSION);
      if (version) ref.setResolution(GradleReferenceResolution.CATALOG_VERSION, version.getHash());
    }
  }

  // ── properties declared in another script of the same build ──────────────

  /**
   * Resolves a reference against a property declared elsewhere, but only where
   * Gradle would actually make that property visible.
   *
   * Two scopes qualify. An `ext` property on the root project is visible to
   * every subproject, which is the whole reason builds put their versions
   * there. And a script this one applies contributes its properties directly.
   *
   * A plain project property in an unrelated sibling does NOT qualify, however
   * well its name matches. In a build with forty subprojects, `version` is
   * declared forty times, and name-only matching would resolve every reference
   * to whichever one happened to be first.
   */
  private linkCrossScriptProperties(facts: GradleProjectFacts): void {
    const visible = new Map<string, GradleDeclaration>();

    const rootScriptHashes = new Set(
      facts.scripts
        .filter((s) => s.getScriptKind() === GradleScriptKind.ROOT_BUILD
          || s.getScriptKind() === GradleScriptKind.SETTINGS
          || s.getScriptKind() === GradleScriptKind.SCRIPT_PLUGIN
          || s.getScriptKind() === GradleScriptKind.INIT)
        .map((s) => s.getHash())
    );

    for (const decl of facts.declarations) {
      if (decl.getDeclarationType() !== GradleDeclarationType.PROPERTY) continue;

      const scope = decl.getQualifier();
      const isExt = scope === GradlePropertyScope.EXT_BLOCK
        || scope === GradlePropertyScope.EXT_SINGLE
        || scope === GradlePropertyScope.EXT_SET
        || scope === GradlePropertyScope.BUILDSCRIPT_EXT
        || scope === GradlePropertyScope.EXT_MAP_ENTRY;

      // A local `def` never leaves its own script, whatever it is called.
      if (scope === GradlePropertyScope.LOCAL_VARIABLE) continue;
      if (!isExt && !rootScriptHashes.has(decl.getScriptHash())) continue;

      // First declaration wins, so the result does not depend on file order
      // beyond the corpus order the caller already fixed.
      if (!visible.has(decl.getName())) visible.set(decl.getName(), decl);
    }

    if (!visible.size) return;

    for (const ref of facts.valueReferences) {
      if (ref.getResolutionKind() !== GradleReferenceResolution.UNRESOLVED_IN_CORPUS) continue;

      const expr = ref.getReferenceExpression();
      const direct = visible.get(expr);
      if (direct) {
        ref.setResolution(GradleReferenceResolution.CROSS_SCRIPT_PROPERTY, direct.getHash());
        continue;
      }

      // `rootProject.ext.springVersion` and `versions.spring` both name a
      // property by their last meaningful segment.
      const stripped = expr.replace(/^(rootProject|project)\./, '').replace(/^ext\./, '');
      const viaPrefix = visible.get(stripped);
      if (viaPrefix) {
        ref.setResolution(GradleReferenceResolution.CROSS_SCRIPT_PROPERTY, viaPrefix.getHash());
        continue;
      }

      const head = stripped.split('.')[0] ?? '';
      const viaHead = head ? visible.get(head) : undefined;
      if (viaHead) ref.setResolution(GradleReferenceResolution.CROSS_SCRIPT_PROPERTY, viaHead.getHash());
    }
  }

  // ── the coverage split ───────────────────────────────────────────────────

  /**
   * Separates the references that are the parser's gap from the ones that are
   * not resolvable by anything.
   *
   * This is the last pass because it needs every other link to have been
   * attempted first. A reference whose name matches a PROPERTY declared
   * somewhere in the corpus stays UNRESOLVED_IN_CORPUS — something was there
   * and the link was still not made, which is a defect worth counting. A
   * reference matching nothing anywhere becomes EXTERNAL and drops out of the
   * coverage denominator, because a build reading `-PbuildNumber` from the
   * command line is not a parser failure and counting it as one makes the
   * score track how parameterised the build is.
   */
  private classifyRemainingReferences(facts: GradleProjectFacts): void {
    const declaredNames = new Set<string>();
    for (const decl of facts.declarations) {
      if (decl.getDeclarationType() === GradleDeclarationType.PROPERTY) {
        declaredNames.add(decl.getName());
        const head = decl.getName().split('.')[0];
        if (head) declaredNames.add(head);
      }
    }
    for (const entry of facts.catalogEntries) {
      declaredNames.add(entry.getAccessorPath());
      declaredNames.add(entry.getAlias());
    }

    for (const ref of facts.valueReferences) {
      if (ref.getResolutionKind() !== GradleReferenceResolution.UNRESOLVED_IN_CORPUS) continue;

      const expr = ref.getReferenceExpression();
      const head = expr.split('.')[0] ?? expr;
      const known = declaredNames.has(expr)
        || declaredNames.has(head)
        || declaredNames.has(GradleCatalogEntry.toAccessorPath(expr));

      if (!known) ref.setResolution(GradleReferenceResolution.EXTERNAL);
    }
  }

  private norm(p: string): string {
    return path.resolve(p);
  }
}
