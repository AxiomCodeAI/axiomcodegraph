import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';
import { GradleParseStatus } from '@/enums/gradle/files/GradleParseStatus';
import { GradleScriptKind } from '@/enums/gradle/files/GradleScriptKind';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One row per Gradle file, and the root of the Gradle key chain.
 *
 * Everything else in the Gradle relation set — blocks, declarations, value
 * references, coordinates, comments, parse gaps — chains off a script hash.
 * Without this anchor there is no way to answer "which project does this
 * dependency belong to", because a `.gradle` file's meaning depends entirely
 * on where it sits: `core/build.gradle` configures `:core`, the root
 * `build.gradle` may configure every project through `subprojects { }`, and a
 * script plugin configures whoever applied it.
 *
 * `parseStatus` and the count columns are what let a consumer tell an empty
 * result from an unanalysed one. A script with zero declarations and
 * `parseStatus = OK` declares nothing; the same script with `PARTIAL` and a
 * non-zero `parseGapCount` was not fully read, and the parse-gap relation says
 * which regions.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. scriptKind, dslDialect, gradleProjectPath, relativePath, fileName
 * 2. parseStatus, lineCount
 * 3. blockCount, declarationCount, valueReferenceCount, coordinateCount,
 *    commentCount, parseGapCount
 * 4. settingsScriptHash, rootScriptHash
 * 5. filePath, baseMservPath
 * 6. serviceVersionLinkHash
 * 7. gradleScriptUniqueHash (LAST)
 */
export class GradleScript implements EntityIdentifiable {
  private scriptKind: GradleScriptKind;
  private dslDialect: GradleDSLDialect;
  private gradleProjectPath: string;
  private relativePath: string;
  private fileName: string;
  private parseStatus: GradleParseStatus;
  private lineCount: number;
  private blockCount: number = 0;
  private declarationCount: number = 0;
  private valueReferenceCount: number = 0;
  private coordinateCount: number = 0;
  private commentCount: number = 0;
  private parseGapCount: number = 0;
  private settingsScriptHash: string;
  private rootScriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private serviceVersionLinkHash: string;
  private gradleScriptUniqueHash: string = '';

  private constructor(builder: GradleScriptBuilder) {
    this.scriptKind = builder.scriptKind;
    this.dslDialect = builder.dslDialect;
    this.gradleProjectPath = builder.gradleProjectPath;
    this.relativePath = builder.relativePath;
    this.fileName = builder.fileName;
    this.parseStatus = builder.parseStatus;
    this.lineCount = builder.lineCount;
    this.settingsScriptHash = builder.settingsScriptHash;
    this.rootScriptHash = builder.rootScriptHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    scriptKind: GradleScriptKind,
    dslDialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): GradleScriptBuilder {
    return new GradleScriptBuilder(
      scriptKind, dslDialect, filePath, baseMservPath, serviceVersionLinkHash
    );
  }

  getScriptKind(): GradleScriptKind { return this.scriptKind; }
  getDslDialect(): GradleDSLDialect { return this.dslDialect; }
  getGradleProjectPath(): string { return this.gradleProjectPath; }
  getRelativePath(): string { return this.relativePath; }
  getFileName(): string { return this.fileName; }
  getParseStatus(): GradleParseStatus { return this.parseStatus; }
  getLineCount(): number { return this.lineCount; }
  getBlockCount(): number { return this.blockCount; }
  getDeclarationCount(): number { return this.declarationCount; }
  getValueReferenceCount(): number { return this.valueReferenceCount; }
  getCoordinateCount(): number { return this.coordinateCount; }
  getCommentCount(): number { return this.commentCount; }
  getParseGapCount(): number { return this.parseGapCount; }
  getSettingsScriptHash(): string { return this.settingsScriptHash; }
  getRootScriptHash(): string { return this.rootScriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Counts and status are written after extraction, not at build time: the
   * script row has to exist before anything can chain off it, and the totals
   * are only known once everything has. Mutating them does NOT re-key the row —
   * the identity is the file, and a file that gained a declaration is the same
   * file. Re-hashing here would silently orphan every child that already
   * chained off the old key.
   */
  setCounts(counts: {
    blocks: number; declarations: number; valueReferences: number;
    coordinates: number; comments: number; parseGaps: number;
  }): void {
    this.blockCount = counts.blocks;
    this.declarationCount = counts.declarations;
    this.valueReferenceCount = counts.valueReferences;
    this.coordinateCount = counts.coordinates;
    this.commentCount = counts.comments;
    this.parseGapCount = counts.parseGaps;
  }

  setParseStatus(status: GradleParseStatus): void {
    this.parseStatus = status;
  }

  setSettingsScriptHash(hash: string): void {
    this.settingsScriptHash = hash;
  }

  setRootScriptHash(hash: string): void {
    this.rootScriptHash = hash;
  }

  setGradleProjectPath(projectPath: string): void {
    this.gradleProjectPath = projectPath;
  }

  getHash(): string {
    return this.gradleScriptUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' + this.baseMservPath +
      '||' + this.serviceVersionLinkHash;

    this.gradleScriptUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_SCRIPT,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_script[kind=${this.scriptKind}, project=${this.gradleProjectPath}, file=${this.relativePath}]`;
  }

  toCsv(): string {
    return [
      this.scriptKind,
      this.dslDialect,
      EntityUtils.escapeTsv(this.gradleProjectPath),
      EntityUtils.escapeTsv(this.relativePath),
      EntityUtils.escapeTsv(this.fileName),
      this.parseStatus,
      this.lineCount.toString(),
      this.blockCount.toString(),
      this.declarationCount.toString(),
      this.valueReferenceCount.toString(),
      this.coordinateCount.toString(),
      this.commentCount.toString(),
      this.parseGapCount.toString(),
      this.settingsScriptHash,
      this.rootScriptHash,
      this.filePath,
      this.baseMservPath,
      this.serviceVersionLinkHash,
      this.gradleScriptUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'scriptKind',
      'dslDialect',
      'gradleProjectPath',
      'relativePath',
      'fileName',
      'parseStatus',
      'lineCount',
      'blockCount',
      'declarationCount',
      'valueReferenceCount',
      'coordinateCount',
      'commentCount',
      'parseGapCount',
      'settingsScriptHash',
      'rootScriptHash',
      'filePath',
      'baseMservPath',
      'serviceVersionLinkHash',
      'gradleScriptUniqueHash',
    ].join('\t');
  }
}

class GradleScriptBuilder {
  scriptKind: GradleScriptKind;
  dslDialect: GradleDSLDialect;
  gradleProjectPath: string = '';
  relativePath: string = '';
  fileName: string = '';
  parseStatus: GradleParseStatus = GradleParseStatus.OK;
  lineCount: number = 0;
  settingsScriptHash: string = '';
  rootScriptHash: string = '';
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;

  constructor(
    scriptKind: GradleScriptKind,
    dslDialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ) {
    this.scriptKind = scriptKind;
    this.dslDialect = dslDialect;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withGradleProjectPath(v: string): GradleScriptBuilder { this.gradleProjectPath = v; return this; }
  withRelativePath(v: string): GradleScriptBuilder { this.relativePath = v; return this; }
  withFileName(v: string): GradleScriptBuilder { this.fileName = v; return this; }
  withParseStatus(v: GradleParseStatus): GradleScriptBuilder { this.parseStatus = v; return this; }
  withLineCount(v: number): GradleScriptBuilder { this.lineCount = v; return this; }
  withSettingsScriptHash(v: string): GradleScriptBuilder { this.settingsScriptHash = v; return this; }
  withRootScriptHash(v: string): GradleScriptBuilder { this.rootScriptHash = v; return this; }

  build(): GradleScript {
    return new (GradleScript as any)(this);
  }
}
