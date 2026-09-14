import { ABSENT, bool, joinHeader, joinRow, keyOf, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JsPackageEntryOutcome, JsPackageEntrySource } from '@/enums/javascript/packages';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * What a package EXPOSES under a specifier: schema §3.17, 11 columns (#616).
 *
 * `js_module.packageName` says which package a module belongs to; this says
 * which module the package hands out for `require('pkg')`, `import 'pkg/sub'`
 * and under which `exports` condition. It is the fact that lets a library IR
 * built once be linked against a client analysed without its `node_modules`,
 * and it makes `exports` conditions (`require` vs `import`) visible to the
 * engine instead of being decided only inside the resolver call.
 *
 * `targetModuleLinkHash` is set only when `targetOutcome` is `RESOLVED`. Every
 * other outcome is a named absence: the entry is written down and the module is
 * not in this parse, and the column says why.
 */
export class JsPackageEntryRegistry implements EntityIdentifiable {
  static readonly ARITY = 11;

  readonly packageName: string;
  /** `"."` for the package itself, else the subpath as written. */
  readonly subpath: string;
  /** `""` when unconditional; nested conditions joined with `.`. */
  readonly condition: string;
  readonly entrySource: JsPackageEntrySource;
  /** The target as written, without the leading `./`; `""` for a blocked subpath. */
  readonly targetPath: string;
  readonly targetModuleLinkHash: string;
  readonly targetOutcome: JsPackageEntryOutcome;
  /** The `package.json`, as `js_module.governingPackageJsonPath` records it. */
  readonly packageJsonPath: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsPackageEntryUniqueHash = ABSENT;

  constructor(props: {
    packageName: string;
    subpath: string;
    condition: string;
    entrySource: JsPackageEntrySource;
    targetPath: string;
    targetModuleLinkHash: string;
    targetOutcome: JsPackageEntryOutcome;
    packageJsonPath: string;
    serviceVersionLinkHash: string;
  }) {
    this.packageName = props.packageName;
    this.subpath = props.subpath;
    this.condition = props.condition;
    this.entrySource = props.entrySource;
    this.targetPath = props.targetPath;
    this.targetModuleLinkHash = props.targetModuleLinkHash;
    this.targetOutcome = props.targetOutcome;
    this.packageJsonPath = props.packageJsonPath;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `JS_PACKAGE_ENTRY_md5(packageJsonPath ‖ subpath ‖ condition ‖ entrySource ‖ targetPath ‖ serviceVersionLinkHash)`
   *
   * The `package.json` rather than the package NAME, because two copies of one
   * package can sit in one tree (a nested second version) and each has its own
   * entries. `targetPath` is in the key because an `exports` fallback array
   * lists several targets under one subpath and condition, and each is a fact.
   */
  generateHash(): void {
    this.jsPackageEntryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_PACKAGE_ENTRY,
      keyOf(this.packageJsonPath, this.subpath, this.condition, this.entrySource,
        this.targetPath, this.serviceVersionLinkHash)
    );
  }

  getHash(): string {
    return this.jsPackageEntryUniqueHash;
  }

  getEntryCombined(): string {
    return `js_package_entry[hash=${this.jsPackageEntryUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.packageName),
        text(this.subpath),
        text(this.condition),
        this.entrySource,
        text(this.targetPath),
        this.targetModuleLinkHash,
        this.targetOutcome,
        text(this.packageJsonPath),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsPackageEntryUniqueHash,
      ],
      JsPackageEntryRegistry.ARITY,
      'js_package_entry'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'packageName',
        'subpath',
        'condition',
        'entrySource',
        'targetPath',
        'targetModuleLinkHash',
        'targetOutcome',
        'packageJsonPath',
        'isExternal',
        'serviceVersionLinkHash',
        'jsPackageEntryUniqueHash',
      ],
      JsPackageEntryRegistry.ARITY,
      'js_package_entry'
    );
  }
}
