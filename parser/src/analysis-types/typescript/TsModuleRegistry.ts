import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsEmissionRegime,
  TsModuleKind,
  TsModuleResolutionMode,
  TsScriptKind,
} from '@/enums/typescript/modules';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { stableRootId } from './stable-root-id';

/**
 * A TypeScript module — schema §4.1, 28 columns.
 *
 * One row per `.ts`/`.tsx`/`.d.ts` file, **and** one per
 * `declare module "x" { … }`, **and** one per `declare global { … }`. Those last
 * two are not decoration: an ambient module declaration is an independently
 * importable namespace and a merge scope of its own, one file may hold many
 * (173 measured), which is why `declaredSpecifier` and `startLine` are in the
 * primary key.
 *
 * There is no Java analogue. Java's package is implicit in a type's qualified
 * name; a TypeScript module is simultaneously the unit of import resolution,
 * the symbol MERGE TABLE that §3.1 keys off, and the boundary between module
 * scope and global scope.
 *
 * ## `emissionRegime` is in the key; `targetTsVersion` is not
 *
 * Both record "which compiler", and they are deliberately separate. The regime
 * is coarse (`ts6-inproc`) and sits in the PRIMARY KEY, so it propagates into
 * every child hash and a 6.x fact base can never be silently mixed with a
 * future 7.x one. The exact version (`6.0.3`) is provenance only: putting it in
 * the key would invalidate the entire fact base on a patch bump, for a change
 * that alters nothing about the facts.
 */
export class TsModuleRegistry implements EntityIdentifiable {
  static readonly ARITY = 28;

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleKind: TsModuleKind;
  readonly scriptKind: TsScriptKind;
  readonly declaredSpecifier: string;
  readonly isDeclarationFile: boolean;
  readonly isExternalModule: boolean;
  readonly isAmbient: boolean;
  readonly packageName: string;
  readonly mergeTableKey: string;
  readonly moduleResolutionMode: TsModuleResolutionMode;
  readonly tsConfigPath: string;
  readonly targetTsVersion: string;
  readonly emissionRegime: TsEmissionRegime;
  readonly startLine: number;
  readonly endLine: number;
  readonly hasTopLevelAwait: boolean;
  readonly hasJsxContent: boolean;

  /** Back-patched: the module row is minted before its `<module>` initializer exists. */
  private moduleInitMethodLinkHash = ABSENT;
  private exportAssignmentLinkHash = ABSENT;
  private defaultExportLinkHash = ABSENT;

  /** Parity slot, always `false` on parser output so `lib_ts_module` is byte-identical. */
  private readonly isExternal = false;
  /**
   * `strictBindCallApply` as the CHECKER resolves it, not as the config states it.
   *
   * `lib.es5.d.ts` declares `call`, `apply` and `bind` twice -- on `Function`,
   * and again on `CallableFunction extends Function` with precise generic
   * signatures. Which one a call resolves to is decided by this flag, so a
   * consumer without it has two correct-looking candidates and no way to choose.
   *
   * RESOLVED is the whole point. `ts.parseJsonConfigFileContent` leaves this
   * `undefined` when only `strict` is set -- the checker applies
   * `strictBindCallApply ?? strict ?? false` itself -- so emitting the parsed
   * option would not answer the question. Reading the config file would also
   * leave a consumer to reimplement the implication and follow `extends`,
   * which the parser has already done.
   */
  readonly strictBindCallApply: boolean;

  readonly serviceVersionLinkHash: string;
  private tsModuleUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    filePath: string;
    baseMservPath: string;
    moduleKind: TsModuleKind;
    scriptKind: TsScriptKind;
    declaredSpecifier: string;
    isDeclarationFile: boolean;
    isExternalModule: boolean;
    isAmbient: boolean;
    packageName: string;
    mergeTableKey: string;
    moduleResolutionMode: TsModuleResolutionMode;
    tsConfigPath: string;
    targetTsVersion: string;
    emissionRegime: TsEmissionRegime;
    startLine: number;
    endLine: number;
    hasTopLevelAwait: boolean;
    hasJsxContent: boolean;
    strictBindCallApply: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.moduleKind = props.moduleKind;
    this.scriptKind = props.scriptKind;
    this.declaredSpecifier = props.declaredSpecifier;
    this.isDeclarationFile = props.isDeclarationFile;
    this.isExternalModule = props.isExternalModule;
    this.isAmbient = props.isAmbient;
    this.packageName = props.packageName;
    this.mergeTableKey = props.mergeTableKey;
    this.moduleResolutionMode = props.moduleResolutionMode;
    this.tsConfigPath = props.tsConfigPath;
    this.targetTsVersion = props.targetTsVersion;
    this.emissionRegime = props.emissionRegime;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.hasTopLevelAwait = props.hasTopLevelAwait;
    this.hasJsxContent = props.hasJsxContent;
    this.strictBindCallApply = props.strictBindCallApply;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_MODULE_md5(filePath ‖ stableRootId(baseMservPath) ‖ declaredSpecifier ‖ startLine ‖ emissionRegime ‖ serviceVersionLinkHash)`
   *
   * `declaredSpecifier` and `startLine` are both present because one file can
   * hold many ambient module declarations, and a key without them would collapse
   * them into one row.
   *
   * The ROOT enters as its `name@version` and not as its path, because the path is
   * absolute and made every key in the bundle move with the directory the analysis ran
   * in. `baseMservPath` stays as a payload column. See stable-root-id.ts and #934.
   */
  generateHash(): void {
    this.tsModuleUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_MODULE,
      keyOf(
        this.filePath,
        stableRootId(this.baseMservPath),
        this.declaredSpecifier,
        this.startLine,
        this.emissionRegime,
        this.serviceVersionLinkHash
      )
    );
  }

  getHash(): string {
    return this.tsModuleUniqueHash;
  }

  setModuleInitMethodLinkHash(hash: string): void {
    this.moduleInitMethodLinkHash = hash;
  }

  setExportAssignmentLinkHash(hash: string): void {
    this.exportAssignmentLinkHash = hash;
  }

  setDefaultExportLinkHash(hash: string): void {
    this.defaultExportLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_module[name=${this.name}, kind=${this.moduleKind}, specifier=${this.declaredSpecifier}, hash=${this.tsModuleUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        text(this.fileName),
        text(this.filePath),
        text(this.baseMservPath),
        this.moduleKind,
        this.scriptKind,
        text(this.declaredSpecifier),
        bool(this.isDeclarationFile),
        bool(this.isExternalModule),
        bool(this.isAmbient),
        text(this.packageName),
        text(this.mergeTableKey),
        this.moduleResolutionMode,
        text(this.tsConfigPath),
        this.targetTsVersion,
        this.emissionRegime,
        num(this.startLine),
        num(this.endLine),
        bool(this.hasTopLevelAwait),
        bool(this.hasJsxContent),
        this.moduleInitMethodLinkHash,
        this.exportAssignmentLinkHash,
        this.defaultExportLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.tsModuleUniqueHash,
        bool(this.strictBindCallApply),
      ],
      TsModuleRegistry.ARITY,
      'ts_module'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'fileName', 'filePath', 'baseMservPath', 'moduleKind',
        'scriptKind', 'declaredSpecifier', 'isDeclarationFile', 'isExternalModule',
        'isAmbient', 'packageName', 'mergeTableKey', 'moduleResolutionMode', 'tsConfigPath',
        'targetTsVersion', 'emissionRegime', 'startLine', 'endLine', 'hasTopLevelAwait',
        'hasJsxContent', 'moduleInitMethodLinkHash', 'exportAssignmentLinkHash',
        'defaultExportLinkHash', 'isExternal', 'serviceVersionLinkHash', 'tsModuleUniqueHash',
        'strictBindCallApply',
      ],
      TsModuleRegistry.ARITY,
      'ts_module'
    );
  }
}
