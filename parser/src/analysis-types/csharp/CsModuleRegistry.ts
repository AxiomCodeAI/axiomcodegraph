import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsNamespaceStyle, CsNullableContext } from '@/enums/csharp/modules';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One C# compilation unit — schema §3.1, **26 columns**.
 *
 * The root of every key chain in this fact base. Nothing else has a hash until
 * its module does.
 *
 * ## Minted from the PATH, before any file is parsed
 *
 * Every component of the primary key is known from the file path and the
 * governing project configuration alone. That is what lets a declaration in file
 * B key itself under file A's scope without file A having been parsed, which is
 * what makes cross-file merging need no dependency order — and `partial` makes
 * that a requirement rather than a convenience: 88 declarations of one linq-heavy-A
 * type live in 88 files.
 *
 * ## `targetFramework` and `defineConstantsKey` are IN THE KEY
 *
 * Schema §2.2, ruled: **option 3, one emission per target framework.** A
 * multi-targeting project has more than one answer for the same file —
 *
 * ```csharp
 * #if NET8_0_OR_GREATER
 *     public void Handle(Span<byte> b) { }
 * #else
 *     public void Handle(byte[] b) { }
 * #endif
 * ```
 *
 * — and there is no single fact base in which both of those rows are true. So
 * the framework is part of the module's identity, exactly as `emissionRegime` is
 * for `py_module` and `ts_module`, and the two emissions never collide.
 *
 * Both are **parser INPUTS and never inferred**. 33 of 33 `DefineConstants`
 * declarations in the corpus resolve from the `.csproj` XML plus a condition
 * evaluator, and the implicit `NET*_OR_GREATER` symbols come from a table
 * verified against the csc command line. **No MSBuild and no .NET runs in this
 * process** — the same hermeticity constraint that keeps Roslyn out of it.
 *
 * ## `grammarRegime` and `emissionRegime` are coarse ON PURPOSE
 *
 * A version string in a primary key would rewrite every hash in the fact base on
 * a patch bump, because the module hash chains into every child key. What has to
 * be distinguishable from inside the fact table is the regime — which grammar
 * family, which patches, in-process or out — not the patch level.
 */
export class CsModuleRegistry implements EntityIdentifiable {
  static readonly ARITY = 26;
  static readonly RELATION = 'cs_module';

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly targetFramework: string;
  readonly defineConstantsKey: string;
  readonly langVersion: string;
  readonly emissionRegime: string;
  readonly grammarRegime: string;
  readonly serviceVersionLinkHash: string;

  /**
   * Everything below is learned by PARSING, so it is back-patched rather than
   * constructed. The hash is already fixed by then and does not move — which is
   * the whole point of minting keys from paths.
   */
  private namespaceStyle: CsNamespaceStyle = CsNamespaceStyle.NONE;
  private namespaceCount = 0;
  private nullableContextDefault: CsNullableContext = CsNullableContext.INHERITED;
  private hasTopLevelStatements = false;
  private implicitUsingsEnabled = false;
  private projectPath = ABSENT;
  private assemblyName = ABSENT;
  private startLine = 1;
  private endLine = 1;
  private parseErrorCount = 0;
  private parseErrorBytes = 0;
  private isGeneratedOutput = false;
  private csModuleInitMethodLinkHash = ABSENT;

  /** Parity slot. Always `false` on parser output; the ENGINE stages `lib_cs_*`. */
  private readonly isExternal = false;

  private csModuleUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    filePath: string;
    baseMservPath: string;
    targetFramework: string;
    defineConstantsKey: string;
    langVersion: string;
    emissionRegime: string;
    grammarRegime: string;
    startLine: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.targetFramework = props.targetFramework;
    this.defineConstantsKey = props.defineConstantsKey;
    this.langVersion = props.langVersion;
    this.emissionRegime = props.emissionRegime;
    this.grammarRegime = props.grammarRegime;
    this.startLine = props.startLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_MODULE_md5(filePath ‖ baseMservPath ‖ targetFramework ‖
   * defineConstantsKey ‖ startLine ‖ emissionRegime ‖ serviceVersion)`
   *
   * `langVersion` is deliberately NOT in the key. It changes which programs
   * parse, not which module a file is, and putting it in would make a
   * `<LangVersion>` bump on one project rewrite the hashes of every file in it.
   */
  generateHash(): void {
    this.csModuleUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_MODULE,
      keyOf(
        this.filePath,
        this.baseMservPath,
        this.targetFramework,
        this.defineConstantsKey,
        this.startLine,
        this.emissionRegime,
        this.serviceVersionLinkHash
      )
    );
  }

  getHash(): string {
    return this.csModuleUniqueHash;
  }

  /** Records what parsing found. Never touches the hash. */
  setParsedShape(shape: {
    namespaceStyle: CsNamespaceStyle;
    namespaceCount: number;
    nullableContextDefault: CsNullableContext;
    hasTopLevelStatements: boolean;
    startLine: number;
    endLine: number;
    parseErrorCount: number;
    parseErrorBytes: number;
  }): void {
    this.namespaceStyle = shape.namespaceStyle;
    this.namespaceCount = shape.namespaceCount;
    this.nullableContextDefault = shape.nullableContextDefault;
    this.hasTopLevelStatements = shape.hasTopLevelStatements;
    this.startLine = shape.startLine;
    this.endLine = shape.endLine;
    this.parseErrorCount = shape.parseErrorCount;
    this.parseErrorBytes = shape.parseErrorBytes;
  }

  /** What the governing `.csproj` said, when one governs this file. */
  setProjectContext(context: {
    projectPath: string;
    assemblyName: string;
    implicitUsingsEnabled: boolean;
  }): void {
    this.projectPath = context.projectPath;
    this.assemblyName = context.assemblyName;
    this.implicitUsingsEnabled = context.implicitUsingsEnabled;
  }

  /**
   * Marks the file as build output.
   *
   * Provenance, not a skip: a `*.g.cs` is real code with real call edges, and it
   * is also half of a `partial` whose other half is hand-written. The engine
   * needs to know which half it is looking at — 76.5% of partial identities have
   * exactly one part in SOURCE precisely because the other part is generated.
   */
  setGeneratedOutput(value: boolean): void {
    this.isGeneratedOutput = value;
  }

  /** The synthetic `<module>` method that owns top-level statements. */
  setModuleInitMethodLinkHash(hash: string): void {
    this.csModuleInitMethodLinkHash = hash;
  }

  getEntryCombined(): string {
    return `cs_module[path=${this.filePath}, tfm=${this.targetFramework}, hash=${this.csModuleUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        text(this.fileName),
        text(this.filePath),
        text(this.baseMservPath),
        this.namespaceStyle,
        num(this.namespaceCount),
        text(this.targetFramework),
        this.defineConstantsKey,
        text(this.langVersion),
        this.nullableContextDefault,
        bool(this.hasTopLevelStatements),
        bool(this.implicitUsingsEnabled),
        text(this.projectPath),
        text(this.assemblyName),
        this.emissionRegime,
        this.grammarRegime,
        num(this.startLine),
        num(this.endLine),
        num(this.parseErrorCount),
        num(this.parseErrorBytes),
        bool(this.isGeneratedOutput),
        this.csModuleInitMethodLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csModuleUniqueHash,
      ],
      CsModuleRegistry.ARITY,
      CsModuleRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'fileName', 'filePath', 'baseMservPath', 'namespaceStyle',
        'namespaceCount', 'targetFramework', 'defineConstantsKey', 'langVersion',
        'nullableContextDefault', 'hasTopLevelStatements', 'implicitUsingsEnabled',
        'projectPath', 'assemblyName', 'emissionRegime', 'grammarRegime', 'startLine',
        'endLine', 'parseErrorCount', 'parseErrorBytes', 'isGeneratedOutput',
        'csModuleInitMethodLinkHash', 'isExternal', 'serviceVersionLinkHash',
        'csModuleUniqueHash',
      ],
      CsModuleRegistry.ARITY,
      CsModuleRegistry.RELATION
    );
  }
}
