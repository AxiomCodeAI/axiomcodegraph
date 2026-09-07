import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { BlockKind } from '@/enums/java/blocks';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a code block that can contain expressions and local variables.
 *
 * BlockRegistry captures block-level constructs including:
 * - Exception handling: try, catch, finally, try-with-resources
 * - Loops: for, enhanced-for, while, do-while
 * - Conditionals: if, else, switch case
 * - Synchronization: synchronized blocks
 *
 * ## Ownership Model
 *
 * Blocks form a hierarchy where:
 * - `parentContainerHash` links to the containing block or lambda expression
 * - `methodOwnerHash` always points to the containing method (for quick lookup)
 * - `tryStatementHash` groups TRY + CATCH + FINALLY blocks together
 *
 * ## Example: Nested Try Blocks
 *
 * ```java
 * void process() {                              // METHOD_abc
 *     try {                                      // BLOCK_try1 (parentContainerHash=null)
 *         try {                                  // BLOCK_try2 (parentContainerHash=try1)
 *             riskyOp();
 *         } catch (IOException e) {              // BLOCK_catch2 (tryStatementHash=try2)
 *             handle(e);
 *         }
 *     } catch (Exception e) {                    // BLOCK_catch1 (tryStatementHash=try1)
 *         log(e);
 *     }
 * }
 * ```
 *
 * ## Example: Lambda with Try Block
 *
 * ```java
 * Future<Result> future = executor.submit(() -> {  // EXPR_lambda1
 *     try {                                         // BLOCK_try1 (parentContainerHash=lambda1)
 *         return doWork();
 *     } catch (Exception e) {                       // BLOCK_catch1 (tryStatementHash=try1)
 *         return Result.failure(e);
 *     }
 * });
 * ```
 *
 * ## Links
 *
 * - **parentContainerHash**: Immediate container (block hash or lambda expression hash)
 * - **methodOwnerHash**: The method containing this block (for quick queries)
 * - **tryStatementHash**: Groups TRY + CATCH + FINALLY (only for exception blocks)
 * - **typeRegistryLinkHash**: The enclosing type
 */
export class BlockRegistry implements EntityIdentifiable {
  private kind: BlockKind;
  private order: number;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private nestingDepth: number;
  private typeRegistryLinkHash: string;
  private methodOwnerHash: string;
  private parentContainerHash?: string;
  private tryStatementHash?: string;
  private resourceCount?: number;
  private caughtExceptionTypes?: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private ownerMethodName: string;
  private blockRegistryUniqueHash: string = '';

  private constructor(builder: BlockRegistryBuilder) {
    this.kind = builder.kind;
    this.order = builder.order;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startColumn = builder.startColumn;
    this.endColumn = builder.endColumn;
    this.nestingDepth = builder.nestingDepth;
    this.typeRegistryLinkHash = builder.typeRegistryLinkHash;
    this.methodOwnerHash = builder.methodOwnerHash;
    this.parentContainerHash = builder.parentContainerHash;
    this.tryStatementHash = builder.tryStatementHash;
    this.resourceCount = builder.resourceCount;
    this.caughtExceptionTypes = builder.caughtExceptionTypes;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.ownerMethodName = builder.ownerMethodName;

    this.generateHash();
  }

  /**
   * Pre-computes the hash for a block based on its properties.
   * Useful for computing block hash before building, so it can be used
   * as parentContainerHash for nested blocks or tryStatementHash for CATCH/FINALLY.
   */
  static computeHash(
    kind: BlockKind,
    filePath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    typeRegistryLinkHash: string,
    methodOwnerHash: string
  ): string {
    const content =
      filePath +
      '||' +
      typeRegistryLinkHash +
      '||' +
      methodOwnerHash +
      '||' +
      kind +
      '||' +
      startLine +
      '||' +
      startColumn +
      '||' +
      endLine +
      '||' +
      endColumn;

    return EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.BLOCK_REGISTRY,
      content
    );
  }

  static builder(
    kind: BlockKind,
    order: number,
    filePath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    typeRegistryLinkHash: string,
    methodOwnerHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string
  ): BlockRegistryBuilder {
    return new BlockRegistryBuilder(
      kind,
      order,
      filePath,
      startLine,
      endLine,
      startColumn,
      endColumn,
      typeRegistryLinkHash,
      methodOwnerHash,
      ownerTypeName,
      ownerQualifiedName,
      ownerMethodName
    );
  }

  // === Getters ===

  getKind(): BlockKind {
    return this.kind;
  }

  getOrder(): number {
    return this.order;
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

  getStartColumn(): number {
    return this.startColumn;
  }

  getEndColumn(): number {
    return this.endColumn;
  }

  getNestingDepth(): number {
    return this.nestingDepth;
  }

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getMethodOwnerHash(): string {
    return this.methodOwnerHash;
  }

  getParentContainerHash(): string | undefined {
    return this.parentContainerHash;
  }

  getTryStatementHash(): string | undefined {
    return this.tryStatementHash;
  }

  getResourceCount(): number | undefined {
    return this.resourceCount;
  }

  getCaughtExceptionTypes(): string | undefined {
    return this.caughtExceptionTypes;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getOwnerMethodName(): string {
    return this.ownerMethodName;
  }

  getBlockRegistryUniqueHash(): string {
    return this.blockRegistryUniqueHash;
  }

  getHash(): string {
    return this.blockRegistryUniqueHash;
  }

  getEntryCombined(): string {
    return `java_block[kind=${this.kind}, method=${this.ownerMethodName}, depth=${this.nestingDepth}, lines=${this.startLine}-${this.endLine}, hash=${this.blockRegistryUniqueHash}]`;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.typeRegistryLinkHash +
      '||' +
      this.methodOwnerHash +
      '||' +
      this.kind +
      '||' +
      this.startLine +
      '||' +
      this.startColumn +
      '||' +
      this.endLine +
      '||' +
      this.endColumn;

    this.blockRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.BLOCK_REGISTRY,
      content
    );
  }

  toCsv(): string {
    return [
      this.kind,
      this.order.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.nestingDepth.toString(),
      this.typeRegistryLinkHash,
      this.methodOwnerHash,
      this.parentContainerHash || '',
      this.tryStatementHash || '',
      this.resourceCount?.toString() || '',
      EntityUtils.escapeTsv(this.caughtExceptionTypes || ''),
      EntityUtils.escapeTsv(this.ownerTypeName),
      EntityUtils.escapeTsv(this.ownerQualifiedName),
      EntityUtils.escapeTsv(this.ownerMethodName),
      this.blockRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'order',
      'filePath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'nestingDepth',
      'typeRegistryLinkHash',
      'methodOwnerHash',
      'parentContainerHash',
      'tryStatementHash',
      'resourceCount',
      'caughtExceptionTypes',
      'ownerTypeName',
      'ownerQualifiedName',
      'ownerMethodName',
      'blockRegistryUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for BlockRegistry
 */
class BlockRegistryBuilder {
  kind: BlockKind;
  order: number;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  nestingDepth: number = 0;
  typeRegistryLinkHash: string;
  methodOwnerHash: string;
  parentContainerHash?: string;
  tryStatementHash?: string;
  resourceCount?: number;
  caughtExceptionTypes?: string;
  ownerTypeName: string;
  ownerQualifiedName: string;
  ownerMethodName: string;

  constructor(
    kind: BlockKind,
    order: number,
    filePath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    typeRegistryLinkHash: string,
    methodOwnerHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string
  ) {
    this.kind = kind;
    this.order = order;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.methodOwnerHash = methodOwnerHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.ownerMethodName = ownerMethodName;
  }

  withNestingDepth(depth: number): BlockRegistryBuilder {
    this.nestingDepth = depth;
    return this;
  }

  withParentContainerHash(hash: string): BlockRegistryBuilder {
    this.parentContainerHash = hash;
    return this;
  }

  withTryStatementHash(hash: string): BlockRegistryBuilder {
    this.tryStatementHash = hash;
    return this;
  }

  withResourceCount(count: number): BlockRegistryBuilder {
    this.resourceCount = count;
    return this;
  }

  withCaughtExceptionTypes(types: string): BlockRegistryBuilder {
    this.caughtExceptionTypes = types;
    return this;
  }

  build(): BlockRegistry {
    return new (BlockRegistry as any)(this);
  }
}
