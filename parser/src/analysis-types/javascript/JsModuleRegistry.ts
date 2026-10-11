import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsContradictionKind,
  JsModuleKind,
  JsModuleSystem,
  JsModuleSystemSource,
  JsScriptKind,
  JsSourceProvenance,
} from '@/enums/javascript/modules';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { stableRootId } from '../stable-root-id';

/**
 * A JavaScript module — schema §3.1, 28 columns.
 *
 * **One row per file, always.** That is the first way this relation differs
 * from `ts_module`, which mints extra rows for `declare module "x"` and
 * `declare global`. JavaScript has neither, so there is no ambient-module
 * analogue and no `declaredSpecifier` in the key.
 *
 * ## `moduleSystem` is in the primary key, and that is the whole design
 *
 * The three columns c7–c9 are one decision recorded in three parts, and they
 * are load-bearing in a way no `ts_module` column is:
 *
 * - **c7 `moduleSystem`** is the conclusion, and it is **in the key**. `import`
 *   under a CommonJS config is a different program from `import` under an ESM
 *   one, and the deciding input is a `package.json` the file does not contain.
 *   Keying on it means a repo analysed before and after a `"type": "module"`
 *   edit yields two distinguishable fact sets rather than one silently
 *   overwriting the other.
 * - **c8 `moduleSystemSource`** is *how* it was decided. 91.4% of measured files
 *   are defaulted rather than declared, so without this a default is
 *   indistinguishable from a declaration.
 * - **c9 `governingPackageJsonPath`** is the evidence, and it is deliberately
 *   **out** of the key. Evidence moving without the conclusion moving must not
 *   cascade every child hash — and it moves often, because the governing file
 *   is frequently outside the repository entirely.
 *
 * ## `emissionRegime` is in the key; `targetTsVersion` is not
 *
 * Same split as `ts_module`, same reason. The regime is coarse
 * (`js-ts6-inproc`) and propagates into every child hash, so a 6.x fact base can
 * never be silently mixed with a future one. The exact version (`6.0.3`) is
 * provenance: in the key it would invalidate the entire fact base on a patch
 * bump, for a change that alters nothing about the facts.
 */
export class JsModuleRegistry implements EntityIdentifiable {
  static readonly ARITY = 28;

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleKind: JsModuleKind;
  readonly scriptKind: JsScriptKind;
  readonly moduleSystem: JsModuleSystem;
  readonly moduleSystemSource: JsModuleSystemSource;
  readonly governingPackageJsonPath: string;
  readonly contradictsGoverningConfig: boolean;
  readonly contradictionKind: JsContradictionKind;
  readonly packageName: string;
  readonly isExternalModule: boolean;
  readonly hasTopLevelAwait: boolean;
  readonly hasJsxContent: boolean;
  readonly hasFlowPragma: boolean;
  readonly emissionRegime: string;
  readonly targetTsVersion: string;
  readonly startLine: number;
  readonly endLine: number;

  /**
   * Back-patched: the module row is minted from the PATH ALONE, before the file
   * has been parsed and therefore before its `<module>` initializer, its root
   * scope or its default export exist.
   *
   * That ordering is not an accident of implementation — it is what lets a
   * declaration in file B key itself under file A's module hash without file A
   * having been read (§1 of `BUILDING-A-PARSER.md`).
   */
  private moduleInitMethodLinkHash = ABSENT;
  private moduleScopeLinkHash = ABSENT;
  private defaultExportLinkHash = ABSENT;

  readonly sourceProvenance: JsSourceProvenance;
  /** Parity slot, always `false` on parser output so `lib_js_module` is byte-identical. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsModuleUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    filePath: string;
    baseMservPath: string;
    moduleKind: JsModuleKind;
    scriptKind: JsScriptKind;
    moduleSystem: JsModuleSystem;
    moduleSystemSource: JsModuleSystemSource;
    governingPackageJsonPath: string;
    contradictsGoverningConfig: boolean;
    contradictionKind: JsContradictionKind;
    packageName: string;
    isExternalModule: boolean;
    hasTopLevelAwait: boolean;
    hasJsxContent: boolean;
    hasFlowPragma: boolean;
    emissionRegime: string;
    targetTsVersion: string;
    startLine: number;
    endLine: number;
    sourceProvenance: JsSourceProvenance;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.moduleKind = props.moduleKind;
    this.scriptKind = props.scriptKind;
    this.moduleSystem = props.moduleSystem;
    this.moduleSystemSource = props.moduleSystemSource;
    this.governingPackageJsonPath = props.governingPackageJsonPath;
    this.contradictsGoverningConfig = props.contradictsGoverningConfig;
    this.contradictionKind = props.contradictionKind;
    this.packageName = props.packageName;
    this.isExternalModule = props.isExternalModule;
    this.hasTopLevelAwait = props.hasTopLevelAwait;
    this.hasJsxContent = props.hasJsxContent;
    this.hasFlowPragma = props.hasFlowPragma;
    this.emissionRegime = props.emissionRegime;
    this.targetTsVersion = props.targetTsVersion;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.sourceProvenance = props.sourceProvenance;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `JS_MODULE_md5(filePath ‖ baseMservPath ‖ moduleSystem ‖ emissionRegime ‖ serviceVersionLinkHash)`
   *
   * Note what is absent: `startLine` (always 1 — one row per file),
   * `governingPackageJsonPath` (evidence, not conclusion) and `targetTsVersion`
   * (provenance). Each omission is argued in the class comment.
   */
  generateHash(): void {
    this.jsModuleUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_MODULE,
      keyOf(
        this.filePath,
        stableRootId(this.baseMservPath),
        this.moduleSystem,
        this.emissionRegime,
        this.serviceVersionLinkHash
      )
    );
  }

  getHash(): string {
    return this.jsModuleUniqueHash;
  }

  setModuleInitMethodLinkHash(hash: string): void {
    this.moduleInitMethodLinkHash = hash;
  }

  setModuleScopeLinkHash(hash: string): void {
    this.moduleScopeLinkHash = hash;
  }

  setDefaultExportLinkHash(hash: string): void {
    this.defaultExportLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_module[name=${this.name}, kind=${this.moduleKind}, system=${this.moduleSystem}, hash=${this.jsModuleUniqueHash}]`;
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
        this.moduleSystem,
        this.moduleSystemSource,
        text(this.governingPackageJsonPath),
        bool(this.contradictsGoverningConfig),
        this.contradictionKind,
        text(this.packageName),
        bool(this.isExternalModule),
        bool(this.hasTopLevelAwait),
        bool(this.hasJsxContent),
        bool(this.hasFlowPragma),
        this.emissionRegime,
        this.targetTsVersion,
        num(this.startLine),
        num(this.endLine),
        this.moduleInitMethodLinkHash,
        this.moduleScopeLinkHash,
        this.defaultExportLinkHash,
        this.sourceProvenance,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsModuleUniqueHash,
      ],
      JsModuleRegistry.ARITY,
      'js_module'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'fileName', 'filePath', 'baseMservPath', 'moduleKind',
        'scriptKind', 'moduleSystem', 'moduleSystemSource', 'governingPackageJsonPath',
        'contradictsGoverningConfig', 'contradictionKind', 'packageName', 'isExternalModule',
        'hasTopLevelAwait', 'hasJsxContent', 'hasFlowPragma', 'emissionRegime',
        'targetTsVersion', 'startLine', 'endLine', 'moduleInitMethodLinkHash',
        'moduleScopeLinkHash', 'defaultExportLinkHash', 'sourceProvenance', 'isExternal',
        'serviceVersionLinkHash', 'jsModuleUniqueHash',
      ],
      JsModuleRegistry.ARITY,
      'js_module'
    );
  }
}
