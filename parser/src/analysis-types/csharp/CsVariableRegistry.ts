import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsRefKind,
  CsVariableDeclarationKind,
  CsVariableScopeKind,
} from '@/enums/csharp/variables';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A local — schema §3.12, **28 columns**.
 *
 * ## Four of the nine declaration kinds bind in an EXPRESSION, not a statement
 *
 * `OUT_VAR`, `PATTERN`, `DECONSTRUCTION` and `QUERY_RANGE` have no
 * `local_declaration_statement` anywhere. `int.TryParse(s, out var n)` declares
 * `n` inside an argument list, and a walker that reads only statements finds no
 * declaration at all — the engine then sees `n` used with nothing declaring it.
 *
 * That is why the relation exists rather than the locals being inferred from
 * expressions: the binding SITE is a fact, and half the sites are not statements.
 *
 * ## `refKind` is dataflow, not spelling
 *
 * `ref var x = ref array[0]` makes `x` an ALIAS — `x = 5` writes into the array.
 * An engine treating it as a copy loses the write. `isScoped` is separate
 * because `scoped` is a LIFETIME constraint with two tree shapes, and folding
 * them loses one of the two facts.
 */
export class CsVariableRegistry implements EntityIdentifiable {
  static readonly ARITY = 28;
  static readonly RELATION = 'cs_variable';

  readonly name: string;
  readonly variableTypeName: string;
  readonly completeTypeName: string;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  readonly isImplicitlyTyped: boolean;
  readonly isNullableAnnotated: boolean;
  readonly declarationKind: CsVariableDeclarationKind;
  readonly scopeKind: CsVariableScopeKind;
  readonly scopeDepth: number;
  readonly isConst: boolean;
  readonly refKind: CsRefKind;
  readonly isScoped: boolean;
  readonly csTypeLinkHash: string;
  readonly csMethodLinkHash: string;
  readonly csModuleLinkHash: string;
  private csBlockLinkHash = ABSENT;
  readonly hasInitializer: boolean;
  private initializerExpressionLinkHash = ABSENT;
  private typeReferenceLinkHash = ABSENT;
  readonly deconstructionIndex: number;
  readonly declarationIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csVariableUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    variableTypeName: string;
    completeTypeName: string;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    isImplicitlyTyped: boolean;
    isNullableAnnotated: boolean;
    declarationKind: CsVariableDeclarationKind;
    scopeKind: CsVariableScopeKind;
    scopeDepth: number;
    isConst: boolean;
    refKind: CsRefKind;
    isScoped: boolean;
    csTypeLinkHash: string;
    csMethodLinkHash: string;
    csModuleLinkHash: string;
    hasInitializer: boolean;
    deconstructionIndex: number;
    declarationIndex: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.variableTypeName = props.variableTypeName;
    this.completeTypeName = props.completeTypeName;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.isImplicitlyTyped = props.isImplicitlyTyped;
    this.isNullableAnnotated = props.isNullableAnnotated;
    this.declarationKind = props.declarationKind;
    this.scopeKind = props.scopeKind;
    this.scopeDepth = props.scopeDepth;
    this.isConst = props.isConst;
    this.refKind = props.refKind;
    this.isScoped = props.isScoped;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csMethodLinkHash = props.csMethodLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.hasInitializer = props.hasInitializer;
    this.deconstructionIndex = props.deconstructionIndex;
    this.declarationIndex = props.declarationIndex;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_VARIABLE_md5(csMethodLinkHash ‖ name ‖ declarationKind ‖
   * deconstructionIndex ‖ startLine ‖ startColumn)`
   *
   * `deconstructionIndex` is load-bearing for the same reason `declarationIndex`
   * is on a field: `var (a, b) = t` declares two locals whose declarator node is
   * the SAME tuple pattern, so position within it is what separates them.
   */
  /**
   * The owning method's hash, always. Top-level statements once had no
   * method — the compiler's `Program.<Main>$` was thought to exist in no
   * source file — so this fell back to the module hash to keep two
   * `Program.cs` files apart (duplicates measured at 6 per relation across
   * 5,773 files of one stratum). Ruling v1.6 §4.0.3 answered it: `<Main>$` IS
   * a method row, positioned at the compilation unit, so every block and
   * local has a method owner and the fallback is gone. An empty owner here is
   * a defect upstream, and the integrity check is what finds it.
   */
  private ownerKeyComponent(): string {
    return this.csMethodLinkHash;
  }

  generateHash(): void {
    this.csVariableUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_VARIABLE,
      keyOf(
        this.ownerKeyComponent(),
        this.name,
        this.declarationKind,
        this.deconstructionIndex,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csVariableUniqueHash;
  }

  setBlockLinkHash(hash: string): void {
    this.csBlockLinkHash = hash;
  }

  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_variable[name=${this.name}, kind=${this.declarationKind}, ` +
      `scope=${this.scopeKind}@${this.scopeDepth}, hash=${this.csVariableUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.variableTypeName),
        text(this.completeTypeName),
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        bool(this.isImplicitlyTyped),
        bool(this.isNullableAnnotated),
        this.declarationKind,
        this.scopeKind,
        num(this.scopeDepth),
        bool(this.isConst),
        this.refKind,
        bool(this.isScoped),
        this.csTypeLinkHash,
        this.csMethodLinkHash,
        this.csModuleLinkHash,
        this.csBlockLinkHash,
        bool(this.hasInitializer),
        this.initializerExpressionLinkHash,
        this.typeReferenceLinkHash,
        num(this.deconstructionIndex),
        num(this.declarationIndex),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csVariableUniqueHash,
      ],
      CsVariableRegistry.ARITY,
      CsVariableRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'variableTypeName', 'completeTypeName', 'potentialQualifiedName',
        'isAmbiguous', 'isImplicitlyTyped', 'isNullableAnnotated', 'declarationKind',
        'scopeKind', 'scopeDepth', 'isConst', 'refKind', 'isScoped', 'csTypeLinkHash',
        'csMethodLinkHash', 'csModuleLinkHash', 'csBlockLinkHash', 'hasInitializer',
        'initializerExpressionLinkHash', 'typeReferenceLinkHash', 'deconstructionIndex',
        'declarationIndex', 'startLine', 'endLine', 'startColumn', 'isExternal',
        'serviceVersionLinkHash', 'csVariableUniqueHash',
      ],
      CsVariableRegistry.ARITY,
      CsVariableRegistry.RELATION
    );
  }
}
