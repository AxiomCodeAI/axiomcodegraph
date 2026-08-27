import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { GradleDependencyNotation } from '@/enums/gradle/declarations/GradleDependencyNotation';
import { GradleVersionSource } from '@/enums/gradle/dependencies/GradleVersionSource';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A dependency declaration split into its parts.
 *
 * Chains 1:1 off a DEPENDENCY declaration. The declaration says what the build
 * file literally wrote; this says what that means as a coordinate.
 *
 * The split is a separate relation rather than extra columns on the
 * declaration for one reason: `implementation libs.bundles.spring` is one
 * declaration and several coordinates, and a map-notation dependency written
 * across three lines is one declaration whose group, name and version each
 * need their own resolved value. Widening the declaration row would force
 * either a packed column or a lie about cardinality.
 *
 * `versionSource` distinguishes the empty `version` that means "a BOM supplies
 * it" from the empty `version` that means "this parser could not read it". A
 * "which projects pin log4j below 2.17" query gets a wrong answer if those two
 * are merged, and gets it confidently.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. configuration, notation, group, artifact, version, classifier, extension
 * 2. versionSource, resolvedVersion, catalogAlias, projectPath, fileSpec
 * 3. isTransitive, isChanging, isForced, hasConfigBlock
 * 4. catalogEntryHash, versionReferenceHash, declarationHash, blockHash, scriptHash
 * 5. filePath, baseMservPath, startLine, endLine
 * 6. serviceVersionLinkHash
 * 7. gradleDependencyCoordinateUniqueHash (LAST)
 */
export class GradleDependencyCoordinate implements EntityIdentifiable {
  private configuration: string;
  private notation: GradleDependencyNotation;
  private group: string;
  private artifact: string;
  private version: string;
  private classifier: string;
  private extension: string;
  private versionSource: GradleVersionSource;
  private resolvedVersion: string;
  private catalogAlias: string;
  private projectPath: string;
  private fileSpec: string;
  private isTransitive: string;
  private isChanging: boolean;
  private isForced: boolean;
  private hasConfigBlock: boolean;
  private catalogEntryHash: string;
  private versionReferenceHash: string;
  private declarationHash: string;
  private blockHash: string;
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private serviceVersionLinkHash: string;
  private gradleDependencyCoordinateUniqueHash: string = '';

  private constructor(builder: GradleDependencyCoordinateBuilder) {
    this.configuration = builder.configuration;
    this.notation = builder.notation;
    this.group = builder.group;
    this.artifact = builder.artifact;
    this.version = builder.version;
    this.classifier = builder.classifier;
    this.extension = builder.extension;
    this.versionSource = builder.versionSource;
    this.resolvedVersion = builder.resolvedVersion;
    this.catalogAlias = builder.catalogAlias;
    this.projectPath = builder.projectPath;
    this.fileSpec = builder.fileSpec;
    this.isTransitive = builder.isTransitive;
    this.isChanging = builder.isChanging;
    this.isForced = builder.isForced;
    this.hasConfigBlock = builder.hasConfigBlock;
    this.catalogEntryHash = builder.catalogEntryHash;
    this.versionReferenceHash = builder.versionReferenceHash;
    this.declarationHash = builder.declarationHash;
    this.blockHash = builder.blockHash;
    this.scriptHash = builder.scriptHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    configuration: string,
    notation: GradleDependencyNotation,
    declarationHash: string,
    blockHash: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): GradleDependencyCoordinateBuilder {
    return new GradleDependencyCoordinateBuilder(
      configuration, notation, declarationHash, blockHash, scriptHash,
      filePath, baseMservPath, startLine, endLine, serviceVersionLinkHash
    );
  }

  getConfiguration(): string { return this.configuration; }
  getNotation(): GradleDependencyNotation { return this.notation; }
  getGroup(): string { return this.group; }
  getArtifact(): string { return this.artifact; }
  getVersion(): string { return this.version; }
  getClassifier(): string { return this.classifier; }
  getExtension(): string { return this.extension; }
  getVersionSource(): GradleVersionSource { return this.versionSource; }
  getResolvedVersion(): string { return this.resolvedVersion; }
  getCatalogAlias(): string { return this.catalogAlias; }
  getProjectPath(): string { return this.projectPath; }
  getFileSpec(): string { return this.fileSpec; }
  getIsTransitive(): string { return this.isTransitive; }
  getIsChanging(): boolean { return this.isChanging; }
  getIsForced(): boolean { return this.isForced; }
  getHasConfigBlock(): boolean { return this.hasConfigBlock; }
  getCatalogEntryHash(): string { return this.catalogEntryHash; }
  getVersionReferenceHash(): string { return this.versionReferenceHash; }
  getDeclarationHash(): string { return this.declarationHash; }
  getBlockHash(): string { return this.blockHash; }
  getScriptHash(): string { return this.scriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Filled by the project pass when the catalog alias or the interpolated
   * version reference is matched. Never invents a version: an unmatched
   * accessor leaves `resolvedVersion` empty and `versionSource` unchanged.
   */
  setResolvedFromCatalog(entry: {
    hash: string; group: string; artifact: string; version: string;
  }): void {
    this.catalogEntryHash = entry.hash;
    if (!this.group) this.group = entry.group;
    if (!this.artifact) this.artifact = entry.artifact;
    if (entry.version) {
      this.resolvedVersion = entry.version;
      this.versionSource = GradleVersionSource.CATALOG;
    }
  }

  setResolvedVersion(version: string, versionReferenceHash: string, source: GradleVersionSource): void {
    this.resolvedVersion = version;
    this.versionReferenceHash = versionReferenceHash;
    this.versionSource = source;
  }

  getHash(): string {
    return this.gradleDependencyCoordinateUniqueHash;
  }

  generateHash(): void {
    // Chains off the declaration. A declaration can yield more than one
    // coordinate (a bundle, a multi-arg files()), so the ordinal-free parts
    // that distinguish them — group, artifact, classifier — are mixed in too.
    const content =
      this.declarationHash +
      '||' + this.configuration +
      '||' + this.group +
      '||' + this.artifact +
      '||' + this.version +
      '||' + this.classifier +
      '||' + this.projectPath +
      '||' + this.fileSpec;

    this.gradleDependencyCoordinateUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_DEPENDENCY_COORDINATE,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_coordinate[config=${this.configuration}, ga=${this.group}:${this.artifact}, version=${this.version}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.configuration),
      this.notation,
      EntityUtils.escapeTsv(this.group),
      EntityUtils.escapeTsv(this.artifact),
      EntityUtils.escapeTsv(this.version),
      EntityUtils.escapeTsv(this.classifier),
      EntityUtils.escapeTsv(this.extension),
      this.versionSource,
      EntityUtils.escapeTsv(this.resolvedVersion),
      EntityUtils.escapeTsv(this.catalogAlias),
      EntityUtils.escapeTsv(this.projectPath),
      EntityUtils.escapeTsv(this.fileSpec),
      this.isTransitive,
      this.isChanging.toString(),
      this.isForced.toString(),
      this.hasConfigBlock.toString(),
      this.catalogEntryHash,
      this.versionReferenceHash,
      this.declarationHash,
      this.blockHash,
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.gradleDependencyCoordinateUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'configuration',
      'notation',
      'group',
      'artifact',
      'version',
      'classifier',
      'extension',
      'versionSource',
      'resolvedVersion',
      'catalogAlias',
      'projectPath',
      'fileSpec',
      'isTransitive',
      'isChanging',
      'isForced',
      'hasConfigBlock',
      'catalogEntryHash',
      'versionReferenceHash',
      'declarationHash',
      'blockHash',
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'serviceVersionLinkHash',
      'gradleDependencyCoordinateUniqueHash',
    ].join('\t');
  }
}

class GradleDependencyCoordinateBuilder {
  configuration: string;
  notation: GradleDependencyNotation;
  group: string = '';
  artifact: string = '';
  version: string = '';
  classifier: string = '';
  extension: string = '';
  versionSource: GradleVersionSource = GradleVersionSource.UNKNOWN;
  resolvedVersion: string = '';
  catalogAlias: string = '';
  projectPath: string = '';
  fileSpec: string = '';
  /** Tri-state on purpose: '' means the build said nothing, not "false". */
  isTransitive: string = '';
  isChanging: boolean = false;
  isForced: boolean = false;
  hasConfigBlock: boolean = false;
  catalogEntryHash: string = '';
  versionReferenceHash: string = '';
  declarationHash: string;
  blockHash: string;
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  serviceVersionLinkHash: string;

  constructor(
    configuration: string,
    notation: GradleDependencyNotation,
    declarationHash: string,
    blockHash: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.configuration = configuration;
    this.notation = notation;
    this.declarationHash = declarationHash;
    this.blockHash = blockHash;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withGroup(v: string): GradleDependencyCoordinateBuilder { this.group = v; return this; }
  withArtifact(v: string): GradleDependencyCoordinateBuilder { this.artifact = v; return this; }
  withVersion(v: string): GradleDependencyCoordinateBuilder { this.version = v; return this; }
  withClassifier(v: string): GradleDependencyCoordinateBuilder { this.classifier = v; return this; }
  withExtension(v: string): GradleDependencyCoordinateBuilder { this.extension = v; return this; }
  withVersionSource(v: GradleVersionSource): GradleDependencyCoordinateBuilder { this.versionSource = v; return this; }
  withResolvedVersion(v: string): GradleDependencyCoordinateBuilder { this.resolvedVersion = v; return this; }
  withCatalogAlias(v: string): GradleDependencyCoordinateBuilder { this.catalogAlias = v; return this; }
  withProjectPath(v: string): GradleDependencyCoordinateBuilder { this.projectPath = v; return this; }
  withFileSpec(v: string): GradleDependencyCoordinateBuilder { this.fileSpec = v; return this; }
  withIsTransitive(v: string): GradleDependencyCoordinateBuilder { this.isTransitive = v; return this; }
  withIsChanging(v: boolean): GradleDependencyCoordinateBuilder { this.isChanging = v; return this; }
  withIsForced(v: boolean): GradleDependencyCoordinateBuilder { this.isForced = v; return this; }
  withHasConfigBlock(v: boolean): GradleDependencyCoordinateBuilder { this.hasConfigBlock = v; return this; }
  withCatalogEntryHash(v: string): GradleDependencyCoordinateBuilder { this.catalogEntryHash = v; return this; }

  build(): GradleDependencyCoordinate {
    return new (GradleDependencyCoordinate as any)(this);
  }
}
