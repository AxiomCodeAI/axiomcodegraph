import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { ImportKind } from '@/enums/java/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents an import declaration in Java source code.
 *
 * ImportRegistry captures all import declarations across the codebase, supporting
 * all five Java import types (as of Java 23):
 * - Single type imports (import java.util.List;)
 * - Type on-demand imports (import java.util.*;)
 * - Single static imports (import static java.lang.Math.PI;)
 * - Static on-demand imports (import static java.lang.Math.*;)
 * - Module imports - Java 23+ (import module java.base;)
 *
 * ## Examples
 *
 * ```java
 * // SINGLE_TYPE - imports a specific type
 * import java.util.List;
 * // importedPath: "java.util.List"
 * // packageOrTypeName: "java.util"
 * // simpleName: "List"
 *
 * // TYPE_ON_DEMAND - imports all public types from a package
 * import java.util.*;
 * // importedPath: "java.util.*"
 * // packageOrTypeName: "java.util"
 * // simpleName: "*"
 *
 * // SINGLE_STATIC - imports a specific static member
 * import static java.lang.Math.PI;
 * // importedPath: "java.lang.Math.PI"
 * // packageOrTypeName: "java.lang.Math"
 * // simpleName: "PI"
 *
 * // STATIC_ON_DEMAND - imports all static members from a type
 * import static java.lang.Math.*;
 * // importedPath: "java.lang.Math.*"
 * // packageOrTypeName: "java.lang.Math"
 * // simpleName: "*"
 *
 * // MODULE (Java 23+) - imports all public types from all packages exported by a module
 * import module java.base;
 * // importedPath: "java.base"
 * // packageOrTypeName: "" (not applicable for modules)
 * // simpleName: "java.base" (module name)
 * ```
 *
 * ## Field Descriptions
 *
 * - **importKind**: The type of import (SINGLE_TYPE, TYPE_ON_DEMAND, etc.)
 * - **importedPath**: The full import path as written in source
 * - **packageOrTypeName**: The package (for type imports) or containing type (for static imports)
 * - **simpleName**: The imported type/member name, "*" for on-demand, or module name for module imports
 * - **filePath**: The file containing this import
 * - **lineNumber**: Line number of the import declaration
 * - **isStatic**: true for SINGLE_STATIC and STATIC_ON_DEMAND
 * - **isOnDemand**: true for TYPE_ON_DEMAND and STATIC_ON_DEMAND (wildcard imports)
 * - **isModuleImport**: true for MODULE imports (Java 23+)
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. importKind, importedPath, packageOrTypeName, simpleName
 * 2. filePath, lineNumber
 * 3. isStatic, isOnDemand, isModuleImport
 * 4. serviceVersionLinkHash
 * 5. importRegistryUniqueHash
 */
export class ImportRegistry implements EntityIdentifiable {
  private importKind: ImportKind;
  private importedPath: string;
  private packageOrTypeName: string;
  private simpleName: string;
  private filePath: string;
  private lineNumber: number;
  private isStatic: boolean;
  private isOnDemand: boolean;
  private isModuleImport: boolean;
  private serviceVersionLinkHash: string;
  private importRegistryUniqueHash: string = '';

  constructor(
    importKind: ImportKind,
    importedPath: string,
    packageOrTypeName: string,
    simpleName: string,
    filePath: string,
    lineNumber: number,
    isStatic: boolean,
    isOnDemand: boolean,
    isModuleImport: boolean,
    serviceVersionLinkHash: string
  ) {
    // Validate required fields
    if (!importKind) {
      throw new Error('importKind is required');
    }
    if (!importedPath || importedPath.trim().length === 0) {
      throw new Error('importedPath is required');
    }
    if (!filePath || filePath.trim().length === 0) {
      throw new Error('filePath is required');
    }
    if (lineNumber <= 0) {
      throw new Error('lineNumber must be > 0');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    // Validate consistency between importKind and boolean flags
    if (importKind === ImportKind.MODULE && !isModuleImport) {
      throw new Error('MODULE import kind must have isModuleImport = true');
    }
    if (importKind !== ImportKind.MODULE && isModuleImport) {
      throw new Error('Only MODULE import kind can have isModuleImport = true');
    }

    const staticKinds = [ImportKind.SINGLE_STATIC, ImportKind.STATIC_ON_DEMAND];
    if (staticKinds.includes(importKind) && !isStatic) {
      throw new Error(`${importKind} must have isStatic = true`);
    }
    if (!staticKinds.includes(importKind) && isStatic && importKind !== ImportKind.MODULE) {
      throw new Error(`${importKind} cannot have isStatic = true`);
    }

    const onDemandKinds = [ImportKind.TYPE_ON_DEMAND, ImportKind.STATIC_ON_DEMAND];
    if (onDemandKinds.includes(importKind) && !isOnDemand) {
      throw new Error(`${importKind} must have isOnDemand = true`);
    }
    if (!onDemandKinds.includes(importKind) && isOnDemand && importKind !== ImportKind.MODULE) {
      throw new Error(`${importKind} cannot have isOnDemand = true`);
    }

    this.importKind = importKind;
    this.importedPath = importedPath;
    this.packageOrTypeName = packageOrTypeName;
    this.simpleName = simpleName;
    this.filePath = filePath;
    this.lineNumber = lineNumber;
    this.isStatic = isStatic;
    this.isOnDemand = isOnDemand;
    this.isModuleImport = isModuleImport;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getImportKind(): ImportKind {
    return this.importKind;
  }

  getImportedPath(): string {
    return this.importedPath;
  }

  getPackageOrTypeName(): string {
    return this.packageOrTypeName;
  }

  getSimpleName(): string {
    return this.simpleName;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getLineNumber(): number {
    return this.lineNumber;
  }

  getIsStatic(): boolean {
    return this.isStatic;
  }

  getIsOnDemand(): boolean {
    return this.isOnDemand;
  }

  getIsModuleImport(): boolean {
    return this.isModuleImport;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getImportRegistryUniqueHash(): string {
    return this.importRegistryUniqueHash;
  }

  getHash(): string {
    return this.importRegistryUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.importKind +
      '||' +
      this.importedPath +
      '||' +
      this.lineNumber +
      '||' +
      this.serviceVersionLinkHash;

    this.importRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.IMPORT_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_import[kind=${this.importKind}, path=${this.importedPath}, simple=${this.simpleName}, static=${this.isStatic}, onDemand=${this.isOnDemand}, module=${this.isModuleImport}, file=${this.filePath}, line=${this.lineNumber}, hash=${this.importRegistryUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.importKind,
      this.importedPath,
      this.packageOrTypeName,
      this.simpleName,
      this.filePath,
      this.lineNumber.toString(),
      this.isStatic.toString(),
      this.isOnDemand.toString(),
      this.isModuleImport.toString(),
      this.serviceVersionLinkHash,
      this.importRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'importKind',
      'importedPath',
      'packageOrTypeName',
      'simpleName',
      'filePath',
      'lineNumber',
      'isStatic',
      'isOnDemand',
      'isModuleImport',
      'serviceVersionLinkHash',
      'importRegistryUniqueHash',
    ].join('\t');
  }
}
