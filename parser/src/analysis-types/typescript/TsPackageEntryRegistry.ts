import { ABSENT, bool, joinHeader, joinRow, keyOf, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsPackageEntryOutcome, TsPackageEntrySource } from '@/enums/typescript/packages';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * What a package PUBLISHES, and which TypeScript module each entry was built from
 * (#847). Same eleven columns as `js_package_entry`, so a rule reading one reads the
 * other.
 *
 * ## Why the IR has to say this
 *
 * A library's public surface is called by its CONSUMER, and the consumer is not in
 * the repository. The engine's structural stand-in -- a module nothing imports -- is
 * wrong exactly where it matters: a library's `index.ts` is imported by its own
 * tests, so it is not a root and neither is anything it exports. `package.json`
 * says which modules are published, and nothing downstream reads package.json.
 *
 * ## The target is build output; the row names the SOURCE
 *
 * `"main": "./dist/cjs/index.js"` names a file this parse never sees. The row
 * records the target as written and, in `targetModuleLinkHash`, the walked source
 * module it compiles from -- `RESOLVED` when the target is itself a walked file,
 * `RESOLVED_FROM_BUILD_OUTPUT` when the convention in
 * `ts-package-entry-extractor.ts` found it. Anything else carries no module hash.
 */
export class TsPackageEntryRegistry implements EntityIdentifiable {
  static readonly ARITY = 11;

  readonly packageName: string;
  /** `"."` for the package itself, else the subpath as written. */
  readonly subpath: string;
  /** `""` when unconditional; nested conditions joined with `.`. */
  readonly condition: string;
  readonly entrySource: TsPackageEntrySource;
  /** The target as written, without the leading `./`; `""` for a blocked subpath. */
  readonly targetPath: string;
  readonly targetModuleLinkHash: string;
  readonly targetOutcome: TsPackageEntryOutcome;
  /** The `package.json`, relative to the path anchor like every other path. */
  readonly packageJsonPath: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private tsPackageEntryUniqueHash = ABSENT;

  constructor(props: {
    packageName: string;
    subpath: string;
    condition: string;
    entrySource: TsPackageEntrySource;
    targetPath: string;
    targetModuleLinkHash: string;
    targetOutcome: TsPackageEntryOutcome;
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

  /** **PK** `TS_PACKAGE_ENTRY_md5(packageJsonPath ‖ subpath ‖ condition ‖ entrySource ‖ targetPath ‖ serviceVersionLinkHash)` */
  generateHash(): void {
    this.tsPackageEntryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_PACKAGE_ENTRY,
      keyOf(this.packageJsonPath, this.subpath, this.condition, this.entrySource,
        this.targetPath, this.serviceVersionLinkHash)
    );
  }

  getHash(): string {
    return this.tsPackageEntryUniqueHash;
  }

  getEntryCombined(): string {
    return `ts_package_entry[package=${this.packageName}, subpath=${this.subpath}, target=${this.targetPath}]`;
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
        this.tsPackageEntryUniqueHash,
      ],
      TsPackageEntryRegistry.ARITY,
      'ts_package_entry'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'packageName', 'subpath', 'condition', 'entrySource', 'targetPath',
        'targetModuleLinkHash', 'targetOutcome', 'packageJsonPath', 'isExternal',
        'serviceVersionLinkHash', 'tsPackageEntryUniqueHash',
      ],
      TsPackageEntryRegistry.ARITY,
      'ts_package_entry'
    );
  }
}
