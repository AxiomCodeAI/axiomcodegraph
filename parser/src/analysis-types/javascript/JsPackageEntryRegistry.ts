import { ABSENT, bool, joinHeader, joinRow, keyOf, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * What a package EXPOSES — one row per (specifier, condition) its `package.json`
 * publishes. Schema §3.17, 9 columns.
 *
 * `js_module.packageName` says which package a module belongs to; nothing said
 * which module the package hands out for `require('pkg')`, `import 'pkg/sub'`,
 * or under which `exports` condition. A library IR built on its own therefore
 * could not answer what a client loads, and the engine linked a staged
 * dependency only through the client's installed `node_modules` (#616, #602).
 *
 * `main` (and the `index.js` fallback) is `condition = default`. An `exports`
 * map contributes every subpath as written (`pkg/sub`; a pattern stays literal,
 * `pkg/*`), with the condition PATH for a nested target (`require`, `import`,
 * `node,import`, ...) and `default` for a plain string target. A target that
 * does not exist on disk keeps its path and links no module: a named absence.
 */
export class JsPackageEntryRegistry implements EntityIdentifiable {
  static readonly ARITY = 9;

  readonly packageName: string;
  /** The bare specifier a consumer writes: `pkg`, `pkg/sub`, `pkg/*`. */
  readonly specifier: string;
  /** `default`, or the `exports` condition path (`require`, `import`, `node,import`). */
  readonly condition: string;
  /** Project-relative, like js_module.filePath; the target as the resolver would answer it. */
  readonly targetFilePath: string;
  /** The js_module at targetFilePath when it was extracted; empty when the file is absent. */
  private targetModuleLinkHash: string;
  /** Project-relative path of the package.json the row was read from. */
  readonly packageJsonPath: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsPackageEntryUniqueHash = ABSENT;

  constructor(props: {
    packageName: string;
    specifier: string;
    condition: string;
    targetFilePath: string;
    targetModuleLinkHash: string;
    packageJsonPath: string;
    serviceVersionLinkHash: string;
  }) {
    this.packageName = props.packageName;
    this.specifier = props.specifier;
    this.condition = props.condition;
    this.targetFilePath = props.targetFilePath;
    this.targetModuleLinkHash = props.targetModuleLinkHash;
    this.packageJsonPath = props.packageJsonPath;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `JS_PACKAGE_ENTRY_md5(packageJsonPath ‖ specifier ‖ condition ‖ serviceVersionLinkHash)` — one package.json states each (specifier, condition) once. */
  generateHash(): void {
    this.jsPackageEntryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_PACKAGE_ENTRY,
      keyOf(this.packageJsonPath, this.specifier, this.condition, this.serviceVersionLinkHash)
    );
  }

  getHash(): string {
    return this.jsPackageEntryUniqueHash;
  }

  getTargetModuleLinkHash(): string {
    return this.targetModuleLinkHash;
  }

  getEntryCombined(): string {
    return `js_package_entry[hash=${this.jsPackageEntryUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.packageName),
        text(this.specifier),
        text(this.condition),
        text(this.targetFilePath),
        this.targetModuleLinkHash,
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
        'specifier',
        'condition',
        'targetFilePath',
        'targetModuleLinkHash',
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
