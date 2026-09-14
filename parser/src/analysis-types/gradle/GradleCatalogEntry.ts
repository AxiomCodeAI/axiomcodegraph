import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { GradleCatalogEntryKind } from '@/enums/gradle/catalog/GradleCatalogEntryKind';
import { GradleCatalogNotation } from '@/enums/gradle/catalog/GradleCatalogNotation';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One entry from a Gradle version catalog (`gradle/libs.versions.toml`).
 *
 * This relation is what makes a modern Gradle build legible. In a build that
 * uses a catalog, `implementation libs.spring.boot.starter.web` is the entire
 * dependency declaration — the group, the artifact and the version are all in
 * the TOML file, and the build script names only an alias. Parsing the build
 * script alone yields a dependency on a string with no coordinate in it.
 *
 * `accessorPath` is the join column. Gradle derives an accessor from an alias
 * by replacing `-` and `_` with `.`, so the alias `spring-boot-starter-web`
 * is reached as `libs.spring.boot.starter.web`. Storing the derived form means
 * a value reference found in a build file joins here directly rather than
 * through a normalisation step every consumer would have to reimplement.
 *
 * `versionRef` and `resolvedVersion` are kept apart on purpose. `versionRef`
 * is what the entry literally says; `resolvedVersion` is filled in only when
 * that ref was found in the same catalog's `[versions]` table. An entry whose
 * ref points at nothing keeps an empty `resolvedVersion` rather than echoing
 * the ref back as though it were a version.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. entryKind, alias, accessorPath, notation
 * 2. group, artifact, pluginId, version, versionRef, resolvedVersion, richVersionConstraint
 * 3. bundleMembers, catalogName
 * 4. versionEntryHash, scriptHash
 * 5. filePath, baseMservPath, startLine, endLine
 * 6. serviceVersionLinkHash
 * 7. gradleCatalogEntryUniqueHash (LAST)
 */
export class GradleCatalogEntry implements EntityIdentifiable {
  private entryKind: GradleCatalogEntryKind;
  private alias: string;
  private accessorPath: string;
  private notation: GradleCatalogNotation;
  private group: string;
  private artifact: string;
  private pluginId: string;
  private version: string;
  private versionRef: string;
  private resolvedVersion: string;
  private richVersionConstraint: string;
  private bundleMembers: string;
  private catalogName: string;
  private versionEntryHash: string;
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private serviceVersionLinkHash: string;
  private gradleCatalogEntryUniqueHash: string = '';

  private constructor(builder: GradleCatalogEntryBuilder) {
    this.entryKind = builder.entryKind;
    this.alias = builder.alias;
    this.accessorPath = builder.accessorPath;
    this.notation = builder.notation;
    this.group = builder.group;
    this.artifact = builder.artifact;
    this.pluginId = builder.pluginId;
    this.version = builder.version;
    this.versionRef = builder.versionRef;
    this.resolvedVersion = builder.resolvedVersion;
    this.richVersionConstraint = builder.richVersionConstraint;
    this.bundleMembers = builder.bundleMembers;
    this.catalogName = builder.catalogName;
    this.versionEntryHash = builder.versionEntryHash;
    this.scriptHash = builder.scriptHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    entryKind: GradleCatalogEntryKind,
    alias: string,
    notation: GradleCatalogNotation,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): GradleCatalogEntryBuilder {
    return new GradleCatalogEntryBuilder(
      entryKind, alias, notation, scriptHash,
      filePath, baseMservPath, startLine, endLine, serviceVersionLinkHash
    );
  }

  /**
   * Gradle's alias-to-accessor rule: `-` and `_` both become `.`.
   * `spring-boot-starter-web` is reached as `libs.spring.boot.starter.web`.
   */
  static toAccessorPath(alias: string): string {
    return alias.replace(/[-_]/g, '.');
  }

  getEntryKind(): GradleCatalogEntryKind { return this.entryKind; }
  getAlias(): string { return this.alias; }
  getAccessorPath(): string { return this.accessorPath; }
  getNotation(): GradleCatalogNotation { return this.notation; }
  getGroup(): string { return this.group; }
  getArtifact(): string { return this.artifact; }
  getPluginId(): string { return this.pluginId; }
  getVersion(): string { return this.version; }
  getVersionRef(): string { return this.versionRef; }
  getResolvedVersion(): string { return this.resolvedVersion; }
  getRichVersionConstraint(): string { return this.richVersionConstraint; }
  getBundleMembers(): string { return this.bundleMembers; }
  getCatalogName(): string { return this.catalogName; }
  getVersionEntryHash(): string { return this.versionEntryHash; }
  getScriptHash(): string { return this.scriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Filled by the version-ref pass once every [versions] entry is known.
   * Does not re-key: the entry's identity is its alias within its catalog,
   * and resolving its ref did not make it a different entry.
   */
  setResolvedVersion(version: string, versionEntryHash: string): void {
    this.resolvedVersion = version;
    this.versionEntryHash = versionEntryHash;
  }

  getHash(): string {
    return this.gradleCatalogEntryUniqueHash;
  }

  generateHash(): void {
    const content =
      this.scriptHash +
      '||' + this.entryKind +
      '||' + this.alias;

    this.gradleCatalogEntryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_CATALOG_ENTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_catalog_entry[kind=${this.entryKind}, alias=${this.alias}, accessor=${this.accessorPath}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.entryKind,
      EntityUtils.escapeTsv(this.alias),
      EntityUtils.escapeTsv(this.accessorPath),
      this.notation,
      EntityUtils.escapeTsv(this.group),
      EntityUtils.escapeTsv(this.artifact),
      EntityUtils.escapeTsv(this.pluginId),
      EntityUtils.escapeTsv(this.version),
      EntityUtils.escapeTsv(this.versionRef),
      EntityUtils.escapeTsv(this.resolvedVersion),
      EntityUtils.escapeTsv(this.richVersionConstraint),
      EntityUtils.escapeTsv(this.bundleMembers),
      EntityUtils.escapeTsv(this.catalogName),
      this.versionEntryHash,
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.gradleCatalogEntryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'entryKind',
      'alias',
      'accessorPath',
      'notation',
      'group',
      'artifact',
      'pluginId',
      'version',
      'versionRef',
      'resolvedVersion',
      'richVersionConstraint',
      'bundleMembers',
      'catalogName',
      'versionEntryHash',
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'serviceVersionLinkHash',
      'gradleCatalogEntryUniqueHash',
    ].join('\t');
  }
}

class GradleCatalogEntryBuilder {
  entryKind: GradleCatalogEntryKind;
  alias: string;
  accessorPath: string;
  notation: GradleCatalogNotation;
  group: string = '';
  artifact: string = '';
  pluginId: string = '';
  version: string = '';
  versionRef: string = '';
  resolvedVersion: string = '';
  richVersionConstraint: string = '';
  bundleMembers: string = '';
  catalogName: string = '';
  versionEntryHash: string = '';
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  serviceVersionLinkHash: string;

  constructor(
    entryKind: GradleCatalogEntryKind,
    alias: string,
    notation: GradleCatalogNotation,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.entryKind = entryKind;
    this.alias = alias;
    this.accessorPath = GradleCatalogEntry.toAccessorPath(alias);
    this.notation = notation;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withGroup(v: string): GradleCatalogEntryBuilder { this.group = v; return this; }
  withArtifact(v: string): GradleCatalogEntryBuilder { this.artifact = v; return this; }
  withPluginId(v: string): GradleCatalogEntryBuilder { this.pluginId = v; return this; }
  withVersion(v: string): GradleCatalogEntryBuilder { this.version = v; return this; }
  withVersionRef(v: string): GradleCatalogEntryBuilder { this.versionRef = v; return this; }
  withResolvedVersion(v: string): GradleCatalogEntryBuilder { this.resolvedVersion = v; return this; }
  withRichVersionConstraint(v: string): GradleCatalogEntryBuilder { this.richVersionConstraint = v; return this; }
  withBundleMembers(v: string): GradleCatalogEntryBuilder { this.bundleMembers = v; return this; }
  withCatalogName(v: string): GradleCatalogEntryBuilder { this.catalogName = v; return this; }

  build(): GradleCatalogEntry {
    return new (GradleCatalogEntry as any)(this);
  }
}
