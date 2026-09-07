import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a `module-info.java` module declaration (JLS 7.7).
 *
 * A module declaration is the only place the JPMS module graph is written down. It is not
 * derivable from imports: `requires` names a module, not a package, and `exports` decides
 * whether a public type is reachable at all from outside the module.
 *
 * ```java
 * // module-info.java
 * open module com.example.app {
 *     requires java.sql;
 *     exports com.example.api;
 * }
 * // name:   "com.example.app"
 * // isOpen: true
 * ```
 *
 * ## Field descriptions
 *
 * - **name** — the module name as written, e.g. `com.example.app`
 * - **isOpen** — `open module ...`, which opens every package for deep reflection. A directive
 *   list may then contain no `opens`, because the whole module is already open.
 * - **filePath** — the declaring file, always named `module-info.java`
 * - **startLine** / **endLine** — the extent of the declaration
 */
export class ModuleRegistry implements EntityIdentifiable {
  private readonly name: string;
  private readonly isOpen: boolean;
  private readonly filePath: string;
  private readonly startLine: number;
  private readonly endLine: number;
  private readonly serviceVersionLinkHash: string;
  private moduleUniqueHash = '';

  constructor(
    name: string,
    isOpen: boolean,
    filePath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!filePath || filePath.trim().length === 0) {
      throw new Error('filePath is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.name = name;
    this.isOpen = isOpen;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getName(): string {
    return this.name;
  }

  getIsOpen(): boolean {
    return this.isOpen;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getHash(): string {
    return this.moduleUniqueHash;
  }

  generateHash(): void {
    const content = this.filePath + '||' + this.name + '||' + this.startLine;
    this.moduleUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.MODULE_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_module[name=${this.name}, isOpen=${this.isOpen}, lines ${this.startLine}-${this.endLine}, hash=${this.moduleUniqueHash}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      this.isOpen.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.moduleUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'isOpen',
      'filePath',
      'startLine',
      'endLine',
      'serviceVersionLinkHash',
      'moduleUniqueHash',
    ].join('\t');
  }
}
