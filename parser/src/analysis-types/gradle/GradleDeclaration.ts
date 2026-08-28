import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { GradleDeclarationType } from '@/enums/gradle/declarations/GradleDeclarationType';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';

/**
 * Represents a single declaration/statement within a Gradle block.
 *
 * Uses `declarationType` as a discriminator — the meaning of `name`, `value`,
 * `notation`, and `qualifier` varies by type (see design doc §3.2.1).
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. declarationType, name, value, notation, qualifier
 * 2. hasConfigBlock, reason
 * 3. dslDialect
 * 4. parentBlockHash, scriptHash, resolvedTargetHash
 * 5. filePath, baseMservPath, startLine, endLine
 * 6. serviceVersionLinkHash
 * 7. gradleDeclarationUniqueHash (LAST)
 *
 * ## resolvedTargetHash
 *
 * A Gradle declaration can name another script: `include ':core'` names the
 * script that configures `:core`, `apply from: 'gradle/deps.gradle'` names the
 * script it pulls in, and `implementation project(':core')` names the same
 * subproject a second way. Where the named script is present in the analysed
 * corpus, its GRADLE_SCRIPT hash goes here, and the build's project graph
 * becomes an ordinary join.
 *
 * Where it is not present, this stays empty. It is never filled with a guess
 * or with the raw path: an unresolved edge and an edge to something outside
 * the corpus are both "no target", and a downstream traversal must be able to
 * stop rather than follow a fabricated one.
 */
export class GradleDeclaration implements EntityIdentifiable {
  private declarationType: GradleDeclarationType;
  private name: string;
  private value: string;
  private notation: string;
  private qualifier: string;
  private hasConfigBlock: boolean;
  private reason: string;
  private dslDialect: GradleDSLDialect;
  private parentBlockHash: string;
  private scriptHash: string;
  private resolvedTargetHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleDeclarationUniqueHash: string = '';

  private constructor(builder: GradleDeclarationBuilder) {
    this.declarationType = builder.declarationType;
    this.name = builder.name;
    this.value = builder.value;
    this.notation = builder.notation;
    this.qualifier = builder.qualifier;
    this.hasConfigBlock = builder.hasConfigBlock;
    this.reason = builder.reason;
    this.dslDialect = builder.dslDialect;
    this.parentBlockHash = builder.parentBlockHash;
    this.scriptHash = builder.scriptHash;
    this.resolvedTargetHash = builder.resolvedTargetHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startColumn = builder.startColumn;
    this.endColumn = builder.endColumn;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    declarationType: GradleDeclarationType,
    name: string,
    dslDialect: GradleDSLDialect,
    parentBlockHash: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleDeclarationBuilder {
    return new GradleDeclarationBuilder(
      declarationType, name, dslDialect, parentBlockHash, scriptHash,
      filePath, baseMservPath, startLine, endLine,
      startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getDeclarationType(): GradleDeclarationType { return this.declarationType; }
  getName(): string { return this.name; }
  getValue(): string { return this.value; }
  getNotation(): string { return this.notation; }
  getQualifier(): string { return this.qualifier; }
  getHasConfigBlock(): boolean { return this.hasConfigBlock; }
  getReason(): string { return this.reason; }
  getDslDialect(): GradleDSLDialect { return this.dslDialect; }
  getParentBlockHash(): string { return this.parentBlockHash; }
  getScriptHash(): string { return this.scriptHash; }
  getResolvedTargetHash(): string { return this.resolvedTargetHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Filled by the project pass, which is the only pass that can. A single-file
   * pass sees `include ':core'` and can conclude nothing except that ':core'
   * is not in this file — which is the weaker answer, and freezing it would
   * lock out the stronger one the project pass is about to produce.
   */
  setResolvedTargetHash(hash: string): void { this.resolvedTargetHash = hash; }

  getHash(): string {
    return this.gradleDeclarationUniqueHash;
  }

  generateHash(): void {
    // Chains off the owning block, which chains off the script. The byte range
    // rather than the start line, because `exclude group: 'a'; exclude group:
    // 'b'` is two declarations on one line, and a `dependencies` block can
    // hold two textually identical `implementation` lines that a name+value
    // key would fold into one row.
    const content =
      this.scriptHash +
      '||' + this.parentBlockHash +
      '||' + this.declarationType +
      '||' + this.name +
      '||' + this.value +
      '||' + this.startLine + ':' + this.startColumn +
      '||' + this.endLine + ':' + this.endColumn;

    this.gradleDeclarationUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_DECLARATION,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_declaration[type=${this.declarationType}, name=${this.name}, value=${this.value}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.declarationType,
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.value),
      this.notation,
      EntityUtils.escapeTsv(this.qualifier),
      this.hasConfigBlock.toString(),
      EntityUtils.escapeTsv(this.reason),
      this.dslDialect,
      this.parentBlockHash,
      this.scriptHash,
      this.resolvedTargetHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleDeclarationUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'declarationType',
      'name',
      'value',
      'notation',
      'qualifier',
      'hasConfigBlock',
      'reason',
      'dslDialect',
      'parentBlockHash',
      'scriptHash',
      'resolvedTargetHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleDeclarationUniqueHash',
    ].join('\t');
  }
}

class GradleDeclarationBuilder {
  declarationType: GradleDeclarationType;
  name: string;
  value: string = '';
  notation: string = '';
  qualifier: string = '';
  hasConfigBlock: boolean = false;
  reason: string = '';
  dslDialect: GradleDSLDialect;
  parentBlockHash: string;
  scriptHash: string;
  resolvedTargetHash: string = '';
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    declarationType: GradleDeclarationType,
    name: string,
    dslDialect: GradleDSLDialect,
    parentBlockHash: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.declarationType = declarationType;
    this.name = name;
    this.dslDialect = dslDialect;
    this.parentBlockHash = parentBlockHash;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withValue(value: string): GradleDeclarationBuilder {
    this.value = value;
    return this;
  }

  withNotation(notation: string): GradleDeclarationBuilder {
    this.notation = notation;
    return this;
  }

  withQualifier(qualifier: string): GradleDeclarationBuilder {
    this.qualifier = qualifier;
    return this;
  }

  withHasConfigBlock(hasConfigBlock: boolean): GradleDeclarationBuilder {
    this.hasConfigBlock = hasConfigBlock;
    return this;
  }

  withReason(reason: string): GradleDeclarationBuilder {
    this.reason = reason;
    return this;
  }

  withResolvedTargetHash(hash: string): GradleDeclarationBuilder {
    this.resolvedTargetHash = hash;
    return this;
  }

  build(): GradleDeclaration {
    return new (GradleDeclaration as any)(this);
  }
}
