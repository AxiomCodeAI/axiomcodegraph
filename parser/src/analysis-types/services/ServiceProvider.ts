import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One row per provider class named on a line of a `META-INF/services` file.
 *
 * This is the written-down half of reflection. `ServiceLoader.load(Codec.class)`
 * is opaque because the LOOKUP is dynamic, but the class it instantiates is a
 * literal in a file in the repository, so the instantiation is statically
 * knowable. The platform also calls the provider's no-arg constructor and its
 * interface methods, so without these rows a provider reads as a dead root.
 *
 * ## Why the name appears three times
 *
 * `providerClassBinaryName` is the token exactly as written — the only column a
 * consumer can quote back to the user. `providerClass` is the same name with
 * nested-type separators normalised to dots, which is the form every other
 * relation in this schema uses for a qualified name, so it is the column a join
 * can actually use. `simpleName` is the innermost segment.
 *
 * They differ, and the difference is the whole reason this belongs in the parser
 * rather than in each consumer's own `split('.')`: `org.acme.Outer$Inner` names
 * a nested class whose dotted form is `org.acme.Outer.Inner`, its enclosing type
 * is `org.acme.Outer`, its package is `org.acme` and its simple name is `Inner`.
 * A consumer splitting on `.` gets the package wrong and the simple name right
 * by accident; one splitting on `$` unconditionally turns the synthetic name
 * `Outer$1` into the non-name `Outer.1`.
 *
 * ## Malformed names are emitted, not dropped
 *
 * `isWellFormedName` is false when the token is not a legal binary name.
 * Dropping those rows would be the wrong call twice over: a consumer that wants
 * the instantiation set can filter on the flag, and a consumer that wants to
 * report a broken configuration needs the row to exist. The population is real
 * — Arquillian writes `!org.jboss.arquillian.container.impl.ContainerExtension`
 * in a services file to mean "suppress this extension", which is not a class
 * name at all and would make `ServiceLoader` throw if the JDK were reading it.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. providerClass, providerClassBinaryName, simpleName, packageName,
 *    enclosingTypeName
 * 2. isNestedName, isWellFormedName, isDuplicateInFile, hasInlineComment
 * 3. position, startLine, endLine, startCol, endCol
 * 4. serviceDescriptorLinkHash
 * 5. filePath, baseMservPath, serviceVersionLinkHash
 * 6. serviceProviderUniqueHash (LAST)
 */
export class ServiceProvider implements EntityIdentifiable {
  private providerClass: string;
  private providerClassBinaryName: string;
  private simpleName: string;
  private packageName: string;
  private enclosingTypeName: string;
  private isNestedName: boolean;
  private isWellFormedName: boolean;
  private isDuplicateInFile: boolean;
  private hasInlineComment: boolean;
  private position: number;
  private startLine: number;
  private endLine: number;
  private startCol: number;
  private endCol: number;
  private serviceDescriptorLinkHash: string;
  private filePath: string;
  private baseMservPath: string;
  private serviceVersionLinkHash: string;
  private serviceProviderUniqueHash: string = '';

  private constructor(builder: ServiceProviderBuilder) {
    this.providerClass = builder.providerClass;
    this.providerClassBinaryName = builder.providerClassBinaryName;
    this.simpleName = builder.simpleName;
    this.packageName = builder.packageName;
    this.enclosingTypeName = builder.enclosingTypeName;
    this.isNestedName = builder.isNestedName;
    this.isWellFormedName = builder.isWellFormedName;
    this.isDuplicateInFile = builder.isDuplicateInFile;
    this.hasInlineComment = builder.hasInlineComment;
    this.position = builder.position;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startCol = builder.startCol;
    this.endCol = builder.endCol;
    this.serviceDescriptorLinkHash = builder.serviceDescriptorLinkHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    providerClassBinaryName: string,
    position: number,
    startLine: number,
    startCol: number,
    endCol: number,
    serviceDescriptorLinkHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): ServiceProviderBuilder {
    return new ServiceProviderBuilder(
      providerClassBinaryName,
      position,
      startLine,
      startCol,
      endCol,
      serviceDescriptorLinkHash,
      filePath,
      baseMservPath,
      serviceVersionLinkHash
    );
  }

  getProviderClass(): string { return this.providerClass; }
  getProviderClassBinaryName(): string { return this.providerClassBinaryName; }
  getSimpleName(): string { return this.simpleName; }
  getPackageName(): string { return this.packageName; }
  getEnclosingTypeName(): string { return this.enclosingTypeName; }
  getIsNestedName(): boolean { return this.isNestedName; }
  getIsWellFormedName(): boolean { return this.isWellFormedName; }
  getIsDuplicateInFile(): boolean { return this.isDuplicateInFile; }
  getHasInlineComment(): boolean { return this.hasInlineComment; }
  getPosition(): number { return this.position; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartCol(): number { return this.startCol; }
  getEndCol(): number { return this.endCol; }
  getServiceDescriptorLinkHash(): string { return this.serviceDescriptorLinkHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }
  getServiceProviderUniqueHash(): string { return this.serviceProviderUniqueHash; }

  getHash(): string {
    return this.serviceProviderUniqueHash;
  }

  /**
   * Chains off the descriptor hash and mixes in the LINE, not the name.
   *
   * `ServiceLoader` ignores a class named twice in the same file, but both
   * occurrences are separately citable and a key built from the name alone would
   * collide between them — turning a duplicate that a consumer should be able to
   * report into a row that silently overwrites its twin.
   */
  generateHash(): void {
    const content =
      this.serviceDescriptorLinkHash +
      '||' + this.providerClassBinaryName +
      '||' + this.startLine +
      '||' + this.startCol;

    this.serviceProviderUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_PROVIDER,
      content
    );
  }

  getEntryCombined(): string {
    return `service_provider[class=${this.providerClass}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.providerClass),
      EntityUtils.escapeTsv(this.providerClassBinaryName),
      EntityUtils.escapeTsv(this.simpleName),
      EntityUtils.escapeTsv(this.packageName),
      EntityUtils.escapeTsv(this.enclosingTypeName),
      this.isNestedName.toString(),
      this.isWellFormedName.toString(),
      this.isDuplicateInFile.toString(),
      this.hasInlineComment.toString(),
      this.position.toString(),
      this.startLine.toString(),
      this.endLine.toString(),
      this.startCol.toString(),
      this.endCol.toString(),
      this.serviceDescriptorLinkHash,
      this.filePath,
      this.baseMservPath,
      this.serviceVersionLinkHash,
      this.serviceProviderUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'providerClass',
      'providerClassBinaryName',
      'simpleName',
      'packageName',
      'enclosingTypeName',
      'isNestedName',
      'isWellFormedName',
      'isDuplicateInFile',
      'hasInlineComment',
      'position',
      'startLine',
      'endLine',
      'startCol',
      'endCol',
      'serviceDescriptorLinkHash',
      'filePath',
      'baseMservPath',
      'serviceVersionLinkHash',
      'serviceProviderUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for ServiceProvider
 */
class ServiceProviderBuilder {
  providerClass: string;
  providerClassBinaryName: string;
  simpleName: string = '';
  packageName: string = '';
  enclosingTypeName: string = '';
  isNestedName: boolean = false;
  isWellFormedName: boolean = false;
  isDuplicateInFile: boolean = false;
  hasInlineComment: boolean = false;
  position: number;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  serviceDescriptorLinkHash: string;
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;

  constructor(
    providerClassBinaryName: string,
    position: number,
    startLine: number,
    startCol: number,
    endCol: number,
    serviceDescriptorLinkHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ) {
    this.providerClassBinaryName = providerClassBinaryName;
    this.providerClass = providerClassBinaryName;
    this.position = position;
    this.startLine = startLine;
    // A provider name is always one line: `ServiceLoader` has no continuation
    // syntax. `endLine` is carried anyway so the column shape matches every
    // other positioned relation and a consumer's span query needs no special
    // case for this table.
    this.endLine = startLine;
    this.startCol = startCol;
    this.endCol = endCol;
    this.serviceDescriptorLinkHash = serviceDescriptorLinkHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withProviderClass(providerClass: string): ServiceProviderBuilder {
    this.providerClass = providerClass;
    return this;
  }

  withSimpleName(simpleName: string): ServiceProviderBuilder {
    this.simpleName = simpleName;
    return this;
  }

  withPackageName(packageName: string): ServiceProviderBuilder {
    this.packageName = packageName;
    return this;
  }

  withEnclosingTypeName(enclosingTypeName: string): ServiceProviderBuilder {
    this.enclosingTypeName = enclosingTypeName;
    return this;
  }

  withIsNestedName(isNestedName: boolean): ServiceProviderBuilder {
    this.isNestedName = isNestedName;
    return this;
  }

  withIsWellFormedName(isWellFormedName: boolean): ServiceProviderBuilder {
    this.isWellFormedName = isWellFormedName;
    return this;
  }

  withIsDuplicateInFile(isDuplicateInFile: boolean): ServiceProviderBuilder {
    this.isDuplicateInFile = isDuplicateInFile;
    return this;
  }

  withHasInlineComment(hasInlineComment: boolean): ServiceProviderBuilder {
    this.hasInlineComment = hasInlineComment;
    return this;
  }

  build(): ServiceProvider {
    return new (ServiceProvider as any)(this);
  }
}
