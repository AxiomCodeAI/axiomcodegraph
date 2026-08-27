import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsImportKind, TsImportResolutionKind } from '@/enums/typescript/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One bound import name — schema §4.12, 27 columns.
 *
 * Positions 0–8 mirror `java_import` 0–8 with two slots repurposed: Java's
 * `isStatic` becomes `isTypeOnly` and its `isOnDemand` becomes `isWildcard`, so
 * the `import_wildcard` projection keeps its name across both languages (§2).
 *
 * **One declaration with N named specifiers emits N ROWS.** Each binds a
 * distinct name and each may be individually type-only — `import { a, type B }`
 * is one declaration and two facts with different runtime existence.
 *
 * ## Resolution here is parser-legal
 *
 * {@link resolvedFilePath} is filled by `ts.resolveModuleName`, which was
 * verified to need **no Program**: it is a pure function of the specifier, the
 * compiler options and the file system, and it returns `undefined` for an
 * unresolvable specifier rather than guessing. That is what makes this a tier-2
 * column rather than engine work, and it matters beyond imports — §3.1's merge
 * key for a module augmentation uses the RESOLVED target module.
 *
 * {@link isExternalTarget} is an honest negative about **this analysis**, not a
 * claim about the outside world: it says the specifier did not resolve to a
 * `ts_module` row here, which is exactly the set the engine closes from
 * `lib_ts_*`.
 */
export class TsImportRegistry implements EntityIdentifiable {
  static readonly ARITY = 27;

  readonly importKind: TsImportKind;
  readonly importedPath: string;
  readonly moduleOrEntityName: string;
  readonly simpleName: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly isTypeOnly: boolean;
  readonly isWildcard: boolean;
  /** Parity slot with `java_import` 8; TypeScript has no analogue of JEP 476. */
  private readonly isModuleImport = false;
  readonly originalName: string;
  readonly aliasName: string;
  readonly isDefaultImport: boolean;
  readonly isSideEffectOnly: boolean;
  readonly tsModuleLinkHash: string;
  private resolvedModuleLinkHash = ABSENT;
  readonly resolvedFilePath: string;
  private resolutionKind: TsImportResolutionKind;
  readonly resolvedExtension: string;
  readonly isExternalTarget: boolean;
  readonly packageName: string;
  readonly specifierHasExtension: boolean;
  readonly importClauseIndex: number;
  private tsExpressionLinkHash = ABSENT;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private tsImportUniqueHash = ABSENT;

  constructor(props: {
    importKind: TsImportKind;
    importedPath: string;
    moduleOrEntityName: string;
    simpleName: string;
    filePath: string;
    lineNumber: number;
    isTypeOnly: boolean;
    isWildcard: boolean;
    originalName: string;
    aliasName: string;
    isDefaultImport: boolean;
    isSideEffectOnly: boolean;
    tsModuleLinkHash: string;
    resolvedFilePath: string;
    resolutionKind: TsImportResolutionKind;
    resolvedExtension: string;
    isExternalTarget: boolean;
    packageName: string;
    specifierHasExtension: boolean;
    importClauseIndex: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.importKind = props.importKind;
    this.importedPath = props.importedPath;
    this.moduleOrEntityName = props.moduleOrEntityName;
    this.simpleName = props.simpleName;
    this.filePath = props.filePath;
    this.lineNumber = props.lineNumber;
    this.isTypeOnly = props.isTypeOnly;
    this.isWildcard = props.isWildcard;
    this.originalName = props.originalName;
    this.aliasName = props.aliasName;
    this.isDefaultImport = props.isDefaultImport;
    this.isSideEffectOnly = props.isSideEffectOnly;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.resolvedFilePath = props.resolvedFilePath;
    this.resolutionKind = props.resolutionKind;
    this.resolvedExtension = props.resolvedExtension;
    this.isExternalTarget = props.isExternalTarget;
    this.packageName = props.packageName;
    this.specifierHasExtension = props.specifierHasExtension;
    this.importClauseIndex = props.importClauseIndex;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_IMPORT_md5(tsModuleLinkHash ‖ importedPath ‖ importKind ‖ simpleName ‖ lineNumber ‖ importClauseIndex)` */
  generateHash(): void {
    this.tsImportUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_IMPORT,
      keyOf(
        this.tsModuleLinkHash,
        this.importedPath,
        this.importKind,
        this.simpleName,
        this.lineNumber,
        this.importClauseIndex
      )
    );
  }

  getHash(): string {
    return this.tsImportUniqueHash;
  }

  /** Back-patched by the cross-module pass: the target module may be parsed after this one. */
  setResolvedModuleLinkHash(hash: string): void {
    this.resolvedModuleLinkHash = hash;
  }

  getResolvedModuleLinkHash(): string {
    return this.resolvedModuleLinkHash;
  }

  /**
   * The specifier named an AMBIENT MODULE declared in this analysis.
   *
   * `ts.resolveModuleName` returns nothing for `declare module "x"` because
   * there is no file — so `resolvedFilePath` stays empty and correct, while
   * `resolvedModuleLinkHash` and this kind carry the answer. Distinguishing the
   * two is the point: an empty path with an AMBIENT_MODULE kind is a resolved
   * import, and an empty path with an UNRESOLVED kind is not.
   */
  setAmbientModuleResolution(): void {
    this.resolutionKind = TsImportResolutionKind.AMBIENT_MODULE;
  }

  getResolutionKind(): TsImportResolutionKind {
    return this.resolutionKind;
  }

  setTsExpressionLinkHash(hash: string): void {
    this.tsExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_import[kind=${this.importKind}, path=${this.importedPath}, name=${this.simpleName}, hash=${this.tsImportUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.importKind,
        text(this.importedPath),
        text(this.moduleOrEntityName),
        text(this.simpleName),
        text(this.filePath),
        num(this.lineNumber),
        bool(this.isTypeOnly),
        bool(this.isWildcard),
        bool(this.isModuleImport),
        text(this.originalName),
        text(this.aliasName),
        bool(this.isDefaultImport),
        bool(this.isSideEffectOnly),
        this.tsModuleLinkHash,
        this.resolvedModuleLinkHash,
        text(this.resolvedFilePath),
        this.resolutionKind,
        this.resolvedExtension,
        bool(this.isExternalTarget),
        text(this.packageName),
        bool(this.specifierHasExtension),
        num(this.importClauseIndex),
        this.tsExpressionLinkHash,
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.tsImportUniqueHash,
      ],
      TsImportRegistry.ARITY,
      'ts_import'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'importKind', 'importedPath', 'moduleOrEntityName', 'simpleName', 'filePath',
        'lineNumber', 'isTypeOnly', 'isWildcard', 'isModuleImport', 'originalName', 'aliasName',
        'isDefaultImport', 'isSideEffectOnly', 'tsModuleLinkHash', 'resolvedModuleLinkHash',
        'resolvedFilePath', 'resolutionKind', 'resolvedExtension', 'isExternalTarget',
        'packageName', 'specifierHasExtension', 'importClauseIndex', 'tsExpressionLinkHash',
        'startColumn', 'isExternal', 'serviceVersionLinkHash', 'tsImportUniqueHash',
      ],
      TsImportRegistry.ARITY,
      'ts_import'
    );
  }
}
