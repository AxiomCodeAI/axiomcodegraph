import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { GradleReferenceResolution } from '@/enums/gradle/value-references/GradleReferenceResolution';
import { GradleValueReferenceType } from '@/enums/gradle/value-references/GradleValueReferenceType';

/**
 * Represents a value reference found within a Gradle declaration or block.
 *
 * Captures every `${...}`, `$var`, `System.getenv()`, `findProperty()`,
 * provider call, ext property access, etc. Linked to both the owning
 * declaration AND owning block via hash.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. referenceExpression, referenceType, rawFragment, defaultValue
 * 2. resolutionKind, resolvedContext
 * 3. ownerDeclarationHash, ownerBlockHash, scriptHash
 * 4. filePath, baseMservPath, startLine, endLine, startColumn, endColumn
 * 5. serviceVersionLinkHash
 * 6. gradleValueReferenceUniqueHash (LAST)
 *
 * ## resolutionKind and resolvedContext are a pair
 *
 * `resolvedContext` carries the hash of whatever the reference resolved to and
 * is empty when nothing was found. `resolutionKind` says what kind of thing
 * that was — or, when the hash is empty, WHY it is empty.
 *
 * That second case is the one that matters. `UNRESOLVED_IN_CORPUS` means a
 * declaration by that name exists in the analysed files and the link was still
 * not made: the parser's gap, and the only bucket that should shrink as it
 * improves. `EXTERNAL` means nothing by that name exists anywhere in the
 * corpus — `System.getenv('CI')` has no declaration to point at and never
 * will. Collapsing the two makes a coverage number that tracks how many
 * environment variables a build reads.
 */
export class GradleValueReference implements EntityIdentifiable {
  private referenceExpression: string;
  private referenceType: GradleValueReferenceType;
  private rawFragment: string;
  private resolvedContext: string;
  private resolutionKind: GradleReferenceResolution;
  private defaultValue: string;
  private ownerDeclarationHash: string;
  private ownerBlockHash: string;
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleValueReferenceUniqueHash: string = '';

  private constructor(builder: GradleValueReferenceBuilder) {
    this.referenceExpression = builder.referenceExpression;
    this.referenceType = builder.referenceType;
    this.rawFragment = builder.rawFragment;
    this.resolvedContext = builder.resolvedContext;
    this.resolutionKind = builder.resolutionKind;
    this.defaultValue = builder.defaultValue;
    this.ownerDeclarationHash = builder.ownerDeclarationHash;
    this.ownerBlockHash = builder.ownerBlockHash;
    this.scriptHash = builder.scriptHash;
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
    referenceExpression: string,
    referenceType: GradleValueReferenceType,
    rawFragment: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleValueReferenceBuilder {
    return new GradleValueReferenceBuilder(
      referenceExpression, referenceType, rawFragment, scriptHash,
      filePath, baseMservPath, startLine, endLine,
      startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getReferenceExpression(): string { return this.referenceExpression; }
  getReferenceType(): GradleValueReferenceType { return this.referenceType; }
  getRawFragment(): string { return this.rawFragment; }
  getResolvedContext(): string { return this.resolvedContext; }
  getResolutionKind(): GradleReferenceResolution { return this.resolutionKind; }
  getScriptHash(): string { return this.scriptHash; }
  getDefaultValue(): string { return this.defaultValue; }
  getOwnerDeclarationHash(): string { return this.ownerDeclarationHash; }
  getOwnerBlockHash(): string { return this.ownerBlockHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Both halves are written together so a hash can never be recorded without
   * saying what kind of thing it points at, and a kind can never claim a
   * resolution that left no target behind.
   */
  setResolution(kind: GradleReferenceResolution, targetHash: string = ''): void {
    this.resolutionKind = kind;
    this.resolvedContext = targetHash;
  }

  getHash(): string {
    return this.gradleValueReferenceUniqueHash;
  }

  generateHash(): void {
    // Chains off the owning declaration. The byte range is part of the key
    // because one declaration routinely holds several references —
    // `"$group:$name:$version"` is three — and they differ only by position.
    const content =
      this.ownerDeclarationHash +
      '||' + this.referenceType +
      '||' + this.referenceExpression +
      '||' + this.rawFragment +
      '||' + this.startLine + ':' + this.startColumn +
      '||' + this.endLine + ':' + this.endColumn;

    this.gradleValueReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_VALUE_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_value_ref[expr=${this.referenceExpression}, type=${this.referenceType}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.referenceExpression),
      this.referenceType,
      EntityUtils.escapeTsv(this.rawFragment),
      EntityUtils.escapeTsv(this.defaultValue),
      this.resolutionKind,
      this.resolvedContext,
      this.ownerDeclarationHash,
      this.ownerBlockHash,
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleValueReferenceUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'referenceExpression',
      'referenceType',
      'rawFragment',
      'defaultValue',
      'resolutionKind',
      'resolvedContext',
      'ownerDeclarationHash',
      'ownerBlockHash',
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleValueReferenceUniqueHash',
    ].join('\t');
  }
}

class GradleValueReferenceBuilder {
  referenceExpression: string;
  referenceType: GradleValueReferenceType;
  rawFragment: string;
  resolvedContext: string = '';
  resolutionKind: GradleReferenceResolution = GradleReferenceResolution.UNRESOLVED_IN_CORPUS;
  defaultValue: string = '';
  ownerDeclarationHash: string = '';
  ownerBlockHash: string = '';
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    referenceExpression: string,
    referenceType: GradleValueReferenceType,
    rawFragment: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.referenceExpression = referenceExpression;
    this.referenceType = referenceType;
    this.rawFragment = rawFragment;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withResolvedContext(context: string): GradleValueReferenceBuilder {
    this.resolvedContext = context;
    return this;
  }

  withResolutionKind(kind: GradleReferenceResolution): GradleValueReferenceBuilder {
    this.resolutionKind = kind;
    return this;
  }

  withDefaultValue(defaultValue: string): GradleValueReferenceBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withOwnerDeclarationHash(hash: string): GradleValueReferenceBuilder {
    this.ownerDeclarationHash = hash;
    return this;
  }

  withOwnerBlockHash(hash: string): GradleValueReferenceBuilder {
    this.ownerBlockHash = hash;
    return this;
  }

  build(): GradleValueReference {
    return new (GradleValueReference as any)(this);
  }
}
