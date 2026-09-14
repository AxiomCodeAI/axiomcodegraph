import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One row per `META-INF/services/<binary-name>` provider-configuration file,
 * and the root of the service-loader key chain.
 *
 * The file NAME is the fact this row exists to carry: `ServiceLoader` locates a
 * provider-configuration file by the binary name of the service it configures,
 * so `META-INF/services/org.acme.Codec` says "these are the providers of
 * `org.acme.Codec`" without any of that appearing in Java source. Every
 * `ServiceProvider` row chains off this hash, because a provider class name on
 * its own does not say WHAT it provides — the same class may be named in two
 * files for two different services.
 *
 * `providerCount` is what lets a consumer tell an empty descriptor from an
 * unanalysed one, and the distinction is load-bearing here: a file holding
 * nothing but an Apache licence header is a real, correctly-parsed descriptor
 * that declares zero providers, and it must not read as a parse failure. On one
 * corpus 2,839 of 3,736 lines across 272 such files were comment lines, so an
 * extractor that reported line counts instead of provider counts would report
 * mostly licence text.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. serviceInterface, serviceInterfaceBinaryName, simpleName, packageName
 * 2. isNestedServiceName, isWellFormedServiceName
 * 3. providerCount, wellFormedProviderCount, lineCount
 * 4. relativePath, filePath, baseMservPath
 * 5. serviceVersionLinkHash
 * 6. serviceDescriptorUniqueHash (LAST)
 */
export class ServiceDescriptor implements EntityIdentifiable {
  private serviceInterface: string;
  private serviceInterfaceBinaryName: string;
  private simpleName: string;
  private packageName: string;
  private isNestedServiceName: boolean;
  private isWellFormedServiceName: boolean;
  private providerCount: number = 0;
  private wellFormedProviderCount: number = 0;
  private lineCount: number = 0;
  private relativePath: string;
  private filePath: string;
  private baseMservPath: string;
  private serviceVersionLinkHash: string;
  private serviceDescriptorUniqueHash: string = '';

  private constructor(builder: ServiceDescriptorBuilder) {
    this.serviceInterface = builder.serviceInterface;
    this.serviceInterfaceBinaryName = builder.serviceInterfaceBinaryName;
    this.simpleName = builder.simpleName;
    this.packageName = builder.packageName;
    this.isNestedServiceName = builder.isNestedServiceName;
    this.isWellFormedServiceName = builder.isWellFormedServiceName;
    this.providerCount = builder.providerCount;
    this.wellFormedProviderCount = builder.wellFormedProviderCount;
    this.lineCount = builder.lineCount;
    this.relativePath = builder.relativePath;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    serviceInterfaceBinaryName: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): ServiceDescriptorBuilder {
    return new ServiceDescriptorBuilder(
      serviceInterfaceBinaryName,
      filePath,
      baseMservPath,
      serviceVersionLinkHash
    );
  }

  getServiceInterface(): string { return this.serviceInterface; }
  getServiceInterfaceBinaryName(): string { return this.serviceInterfaceBinaryName; }
  getSimpleName(): string { return this.simpleName; }
  getPackageName(): string { return this.packageName; }
  getIsNestedServiceName(): boolean { return this.isNestedServiceName; }
  getIsWellFormedServiceName(): boolean { return this.isWellFormedServiceName; }
  getProviderCount(): number { return this.providerCount; }
  getWellFormedProviderCount(): number { return this.wellFormedProviderCount; }
  getLineCount(): number { return this.lineCount; }
  getRelativePath(): string { return this.relativePath; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }
  getServiceDescriptorUniqueHash(): string { return this.serviceDescriptorUniqueHash; }

  getHash(): string {
    return this.serviceDescriptorUniqueHash;
  }

  /**
   * Keyed on the file, not on the service name.
   *
   * Two modules may each ship a `META-INF/services/org.acme.Codec`, and both are
   * real and separately citable; keying on the service name would collapse them
   * into one row and lose half the providers in the corpus.
   */
  generateHash(): void {
    const content =
      this.filePath +
      '||' + this.baseMservPath +
      '||' + this.serviceVersionLinkHash;

    this.serviceDescriptorUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_DESCRIPTOR,
      content
    );
  }

  /**
   * Records the provider tallies after the provider rows have been built.
   *
   * Safe to set post-construction, and deliberately does NOT regenerate the
   * hash: the key is derived from the file's identity alone, so the counts can
   * never move it. The alternative — building the descriptor last — is what
   * forces a second hash derivation for the providers to chain off, and two
   * places deriving one key is how the two drift apart.
   */
  setProviderCounts(providerCount: number, wellFormedProviderCount: number): void {
    this.providerCount = providerCount;
    this.wellFormedProviderCount = wellFormedProviderCount;
  }

  getEntryCombined(): string {
    return `service_descriptor[service=${this.serviceInterface}, providers=${this.providerCount}, file=${this.relativePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.serviceInterface),
      EntityUtils.escapeTsv(this.serviceInterfaceBinaryName),
      EntityUtils.escapeTsv(this.simpleName),
      EntityUtils.escapeTsv(this.packageName),
      this.isNestedServiceName.toString(),
      this.isWellFormedServiceName.toString(),
      this.providerCount.toString(),
      this.wellFormedProviderCount.toString(),
      this.lineCount.toString(),
      EntityUtils.escapeTsv(this.relativePath),
      this.filePath,
      this.baseMservPath,
      this.serviceVersionLinkHash,
      this.serviceDescriptorUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'serviceInterface',
      'serviceInterfaceBinaryName',
      'simpleName',
      'packageName',
      'isNestedServiceName',
      'isWellFormedServiceName',
      'providerCount',
      'wellFormedProviderCount',
      'lineCount',
      'relativePath',
      'filePath',
      'baseMservPath',
      'serviceVersionLinkHash',
      'serviceDescriptorUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for ServiceDescriptor
 */
class ServiceDescriptorBuilder {
  serviceInterface: string;
  serviceInterfaceBinaryName: string;
  simpleName: string = '';
  packageName: string = '';
  isNestedServiceName: boolean = false;
  isWellFormedServiceName: boolean = false;
  providerCount: number = 0;
  wellFormedProviderCount: number = 0;
  lineCount: number = 0;
  relativePath: string = '';
  filePath: string;
  baseMservPath: string;
  serviceVersionLinkHash: string;

  constructor(
    serviceInterfaceBinaryName: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ) {
    this.serviceInterfaceBinaryName = serviceInterfaceBinaryName;
    this.serviceInterface = serviceInterfaceBinaryName;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withServiceInterface(serviceInterface: string): ServiceDescriptorBuilder {
    this.serviceInterface = serviceInterface;
    return this;
  }

  withSimpleName(simpleName: string): ServiceDescriptorBuilder {
    this.simpleName = simpleName;
    return this;
  }

  withPackageName(packageName: string): ServiceDescriptorBuilder {
    this.packageName = packageName;
    return this;
  }

  withIsNestedServiceName(isNested: boolean): ServiceDescriptorBuilder {
    this.isNestedServiceName = isNested;
    return this;
  }

  withIsWellFormedServiceName(isWellFormed: boolean): ServiceDescriptorBuilder {
    this.isWellFormedServiceName = isWellFormed;
    return this;
  }

  withProviderCount(providerCount: number): ServiceDescriptorBuilder {
    this.providerCount = providerCount;
    return this;
  }

  withWellFormedProviderCount(count: number): ServiceDescriptorBuilder {
    this.wellFormedProviderCount = count;
    return this;
  }

  withLineCount(lineCount: number): ServiceDescriptorBuilder {
    this.lineCount = lineCount;
    return this;
  }

  withRelativePath(relativePath: string): ServiceDescriptorBuilder {
    this.relativePath = relativePath;
    return this;
  }

  build(): ServiceDescriptor {
    return new (ServiceDescriptor as any)(this);
  }
}
