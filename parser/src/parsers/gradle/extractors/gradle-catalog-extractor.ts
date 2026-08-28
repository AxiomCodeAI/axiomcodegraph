import * as path from 'path';

import { GradleCatalogEntry } from '@/analysis-types/gradle/GradleCatalogEntry';
import { GradleParseGap } from '@/analysis-types/gradle/GradleParseGap';
import { GradleCatalogEntryKind } from '@/enums/gradle/catalog/GradleCatalogEntryKind';
import { GradleCatalogNotation } from '@/enums/gradle/catalog/GradleCatalogNotation';
import { GradleParseGapReason } from '@/enums/gradle/parse-gaps/GradleParseGapReason';
import {
  CatalogTable, RawCatalogEntry, VersionCatalogParser,
} from '@/parsers/gradle/version-catalog-parser';

export interface CatalogExtractionResult {
  entries: GradleCatalogEntry[];
  parseGaps: GradleParseGap[];
}

/**
 * Turns a version catalog TOML file into classified catalog rows.
 *
 * The classification is the whole value here. A raw reader gives back
 * `{ module: "a:b", "version.ref": "c" }`; what a dependency query needs is a
 * group, an artifact, and an honest statement about where the version came
 * from. Those are different jobs and this is the second one.
 *
 * ## Version refs are resolved, but only within one catalog
 *
 * Gradle resolves `version.ref` against the `[versions]` table of the SAME
 * catalog — a ref never reaches across files. So the pass runs here, over one
 * file, rather than in the project linker. An entry whose ref names nothing
 * keeps an empty `resolvedVersion`: Gradle would fail that build, and echoing
 * the ref back as if it were a version number would hide a real defect in the
 * build under a plausible looking row.
 */
export class GradleCatalogExtractor {
  /**
   * @param catalogName The accessor prefix the build uses for this catalog.
   *                    `gradle/libs.versions.toml` is reached as `libs`; a
   *                    catalog registered under another name in settings is
   *                    reached under that name instead.
   */
  extract(
    filePath: string,
    fileContent: string,
    scriptHash: string,
    baseMservPath: string,
    serviceVersionHash: string,
    catalogName?: string
  ): CatalogExtractionResult {
    const name = catalogName ?? GradleCatalogExtractor.defaultCatalogName(filePath);
    const parsed = VersionCatalogParser.parse(fileContent);

    const entries: GradleCatalogEntry[] = [];
    for (const raw of parsed.entries) {
      const entry = this.toEntry(raw, name, scriptHash, filePath, baseMservPath, serviceVersionHash);
      if (entry) entries.push(entry);
    }

    this.resolveVersionRefs(entries);

    const parseGaps = parsed.unparsedLines.map((u) =>
      GradleParseGap.builder(
        GradleParseGapReason.ERROR_NODE,
        scriptHash, filePath, baseMservPath,
        u.line, u.line, 0, u.text.length,
        serviceVersionHash
      )
        .withNodeType('catalog_entry')
        .withOriginalText(u.text)
        .build()
    );

    return { entries, parseGaps };
  }

  /**
   * `gradle/libs.versions.toml` → `libs`.
   * `gradle/testLibs.versions.toml` → `testLibs`.
   */
  static defaultCatalogName(filePath: string): string {
    const base = path.basename(filePath);
    const stripped = base.replace(/\.versions\.toml$/i, '');
    return stripped === base ? 'libs' : stripped;
  }

  private toEntry(
    raw: RawCatalogEntry,
    catalogName: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): GradleCatalogEntry | null {
    const kind = GradleCatalogExtractor.KIND_BY_TABLE[raw.table];
    if (!kind) return null;

    switch (raw.table) {
      case 'versions': return this.versionEntry(raw, kind, catalogName, scriptHash, filePath, baseMservPath, serviceVersionHash);
      case 'bundles': return this.bundleEntry(raw, kind, catalogName, scriptHash, filePath, baseMservPath, serviceVersionHash);
      case 'plugins': return this.pluginEntry(raw, kind, catalogName, scriptHash, filePath, baseMservPath, serviceVersionHash);
      case 'libraries': return this.libraryEntry(raw, kind, catalogName, scriptHash, filePath, baseMservPath, serviceVersionHash);
      default: return null;
    }
  }

  private static readonly KIND_BY_TABLE: Record<CatalogTable, GradleCatalogEntryKind> = {
    versions: GradleCatalogEntryKind.VERSION,
    libraries: GradleCatalogEntryKind.LIBRARY,
    bundles: GradleCatalogEntryKind.BUNDLE,
    plugins: GradleCatalogEntryKind.PLUGIN,
  };

  private versionEntry(
    raw: RawCatalogEntry, kind: GradleCatalogEntryKind, catalogName: string,
    scriptHash: string, filePath: string, baseMservPath: string, svh: string
  ): GradleCatalogEntry {
    // A [versions] entry is either a plain string or a rich constraint.
    // A rich one is NOT collapsed to a single version: `strictly = "[1.0, 2.0["`
    // is a range, and writing it into the version column would turn a
    // constraint into a pin for every consumer downstream.
    if (raw.inlineTable) {
      const rich = this.richConstraintText(raw.inlineTable);
      const preferred = raw.inlineTable['require'] ?? raw.inlineTable['prefer'] ?? '';
      return this.build(kind, raw, GradleCatalogNotation.VERSION_RICH, catalogName, scriptHash, filePath, baseMservPath, svh)
        .withVersion(preferred)
        .withRichVersionConstraint(rich)
        .build();
    }
    return this.build(kind, raw, GradleCatalogNotation.VERSION_LITERAL, catalogName, scriptHash, filePath, baseMservPath, svh)
      .withVersion(raw.stringValue ?? '')
      .build();
  }

  private bundleEntry(
    raw: RawCatalogEntry, kind: GradleCatalogEntryKind, catalogName: string,
    scriptHash: string, filePath: string, baseMservPath: string, svh: string
  ): GradleCatalogEntry {
    return this.build(kind, raw, GradleCatalogNotation.BUNDLE_LIST, catalogName, scriptHash, filePath, baseMservPath, svh)
      .withBundleMembers((raw.arrayValue ?? []).join(','))
      .build();
  }

  private pluginEntry(
    raw: RawCatalogEntry, kind: GradleCatalogEntryKind, catalogName: string,
    scriptHash: string, filePath: string, baseMservPath: string, svh: string
  ): GradleCatalogEntry {
    if (raw.stringValue !== undefined) {
      // boot = "org.springframework.boot:3.2.2" — id and version on one colon.
      const idx = raw.stringValue.lastIndexOf(':');
      const id = idx > 0 ? raw.stringValue.slice(0, idx) : raw.stringValue;
      const version = idx > 0 ? raw.stringValue.slice(idx + 1) : '';
      return this.build(kind, raw, GradleCatalogNotation.PLUGIN_SHORTHAND, catalogName, scriptHash, filePath, baseMservPath, svh)
        .withPluginId(id)
        .withVersion(version)
        .build();
    }

    const t = raw.inlineTable ?? {};
    const versionRef = t['version.ref'] ?? '';
    const notation = versionRef
      ? GradleCatalogNotation.PLUGIN_ID_VERSION_REF
      : GradleCatalogNotation.PLUGIN_ID_LITERAL;

    return this.build(kind, raw, notation, catalogName, scriptHash, filePath, baseMservPath, svh)
      .withPluginId(t['id'] ?? '')
      .withVersion(t['version'] ?? '')
      .withVersionRef(versionRef)
      .withRichVersionConstraint(this.richConstraintText(t))
      .build();
  }

  private libraryEntry(
    raw: RawCatalogEntry, kind: GradleCatalogEntryKind, catalogName: string,
    scriptHash: string, filePath: string, baseMservPath: string, svh: string
  ): GradleCatalogEntry {
    if (raw.stringValue !== undefined) {
      // a = "com.example:lib:1.0" — the shorthand always carries its version.
      const parts = raw.stringValue.split(':');
      return this.build(kind, raw, GradleCatalogNotation.SHORTHAND_STRING, catalogName, scriptHash, filePath, baseMservPath, svh)
        .withGroup(parts[0] ?? '')
        .withArtifact(parts[1] ?? '')
        .withVersion(parts[2] ?? '')
        .build();
    }

    const t = raw.inlineTable ?? {};
    let group = t['group'] ?? '';
    let artifact = t['name'] ?? '';
    const module = t['module'] ?? '';
    if (module) {
      const colon = module.indexOf(':');
      group = colon >= 0 ? module.slice(0, colon) : module;
      artifact = colon >= 0 ? module.slice(colon + 1) : '';
    }

    const version = t['version'] ?? '';
    const versionRef = t['version.ref'] ?? '';
    const rich = this.richConstraintText(t);

    // The notation records which of the three version forms was used, so a
    // consumer can tell "no version because a BOM supplies it" from "no
    // version yet because the ref has not been resolved".
    let notation: GradleCatalogNotation;
    if (rich && !version && !versionRef) {
      notation = GradleCatalogNotation.VERSION_RICH;
    } else if (module) {
      notation = versionRef
        ? GradleCatalogNotation.MODULE_VERSION_REF
        : version
          ? GradleCatalogNotation.MODULE_LITERAL
          : GradleCatalogNotation.MODULE_NO_VERSION;
    } else {
      notation = versionRef
        ? GradleCatalogNotation.GROUP_NAME_VERSION_REF
        : version
          ? GradleCatalogNotation.GROUP_NAME_LITERAL
          : GradleCatalogNotation.GROUP_NAME_NO_VERSION;
    }

    return this.build(kind, raw, notation, catalogName, scriptHash, filePath, baseMservPath, svh)
      .withGroup(group)
      .withArtifact(artifact)
      .withVersion(version || (t['version.require'] ?? t['version.prefer'] ?? ''))
      .withVersionRef(versionRef)
      .withRichVersionConstraint(rich)
      .build();
  }

  /**
   * Flattens `strictly`/`require`/`prefer`/`reject`/`rejectAll` into one
   * readable constraint. Kept as text rather than columns because a rich
   * version is a constraint expression, and splitting it across five mostly
   * empty columns would suggest they can be queried independently. They cannot:
   * a `strictly` with a `reject` means something neither says alone.
   */
  private richConstraintText(t: Record<string, string>): string {
    const keys = ['strictly', 'require', 'prefer', 'reject', 'rejectAll'];
    const parts: string[] = [];
    for (const k of keys) {
      const direct = t[k];
      const dotted = t[`version.${k}`];
      const value = direct ?? dotted;
      if (value !== undefined && value !== '') parts.push(`${k}=${value}`);
    }
    return parts.join(';');
  }

  /**
   * Fills `resolvedVersion` on every entry whose `version.ref` names a
   * [versions] entry in the same catalog, and links the two rows.
   *
   * Refs are single-hop by design: Gradle does not allow a version entry to
   * reference another version entry, so there is no chain to follow and no
   * cycle to guard against.
   */
  private resolveVersionRefs(entries: GradleCatalogEntry[]): void {
    const versions = new Map<string, GradleCatalogEntry>();
    for (const e of entries) {
      if (e.getEntryKind() === GradleCatalogEntryKind.VERSION) {
        versions.set(e.getAlias(), e);
      }
    }

    for (const e of entries) {
      const ref = e.getVersionRef();
      if (!ref) continue;
      // Gradle matches a ref against the alias in its normalised form, so
      // `version.ref = "spring-boot"` and an entry keyed `spring.boot` are the
      // same version. Matching the literal alias alone misses that.
      const target = versions.get(ref)
        ?? versions.get(ref.replace(/[-_]/g, '.'))
        ?? [...versions.values()].find((v) => v.getAccessorPath() === GradleCatalogEntryHelper.accessor(ref));
      if (!target) continue;
      e.setResolvedVersion(target.getVersion(), target.getHash());
    }
  }

  private build(
    kind: GradleCatalogEntryKind,
    raw: RawCatalogEntry,
    notation: GradleCatalogNotation,
    catalogName: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    svh: string
  ) {
    return GradleCatalogEntry.builder(
      kind, raw.alias, notation, scriptHash, filePath, baseMservPath,
      raw.startLine, raw.endLine, svh
    ).withCatalogName(catalogName);
  }
}

/** Small indirection so the accessor rule lives in exactly one place. */
class GradleCatalogEntryHelper {
  static accessor(alias: string): string {
    return GradleCatalogEntry.toAccessorPath(alias);
  }
}
