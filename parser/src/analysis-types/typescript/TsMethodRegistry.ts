import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, optionalNum, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsBodyPresence,
  TsMethodAccess,
  TsMethodKind,
  TsMethodModifier,
  TsSignatureRole,
} from '@/enums/typescript/methods';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Every function-shaped declaration — schema §4.6, 43 columns.
 *
 * Functions, methods, constructors, accessors, arrows, function expressions,
 * class static blocks, the synthetic `<module>` initializer, **and every
 * bodiless signature**: method signatures, call and construct signatures, and
 * overload signatures. Positions 0–20 are byte-for-byte `java_method` 0–20.
 *
 * ## Two measurements shape this relation
 *
 * **11,599 overload signatures**, and **77.6% of overloaded calls resolve to a
 * non-first declaration.** A call site must therefore be able to name ONE
 * signature, which is why {@link signatureRole} is a column rather than a flag
 * and why the primary key is per signature. A parser that resolves a call to a
 * name and takes the first declaration is wrong on four overloaded calls in
 * five — that is not a rounding error, it is the majority case.
 *
 * **703 arrow functions, 161 of them resolved call targets.** Arrows are rows
 * here, not expression detail, and {@link startColumn} is in the key because
 * `const [a, b] = [() => 1, () => 2]` yields two arrows sharing name, signature
 * and line. That is the lambda hazard Python paid for, in a language with 703
 * of them.
 *
 * ## `bodyPresence` is the column that stops a `.d.ts` line becoming an implementation
 *
 * 44.3% of resolved call targets are bodiless. Reading one of those as the code
 * that runs attributes behaviour to a declaration file, and nothing downstream
 * can detect the mistake once made.
 */
export class TsMethodRegistry implements EntityIdentifiable {
  static readonly ARITY = 43;

  readonly name: string;
  readonly signature: string;
  readonly detailedSignature: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly tsTypeLinkHash: string;
  readonly ownerTypeName: string;
  readonly ownerQualifiedName: string;
  readonly methodAccess: TsMethodAccess;
  readonly methodModifiers: ReadonlySet<TsMethodModifier>;
  readonly returnTypeName: string;
  readonly isVarArgs: boolean;
  readonly hasReceiverParameter: boolean;
  /** Parity slot with `java_method` 15, unused in TypeScript. */
  private readonly defaultValueExpression = ABSENT;
  readonly methodKind: TsMethodKind;
  readonly parameterCount: number;
  readonly hasTypeParameters: boolean;
  readonly throwsExceptions: ReadonlySet<string>;
  readonly enclosingMemberLinkHash: string;

  readonly tsModuleLinkHash: string;
  readonly declarationGroupKey: string;
  readonly mergeScopeKey: string;
  readonly escapedName: string;
  private signatureRole: TsSignatureRole;
  private overloadIndex: number;
  readonly bodyPresence: TsBodyPresence;
  readonly isTypeOnly: boolean;
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
  readonly isAbstract: boolean;
  readonly isStatic: boolean;
  readonly optionalParameterCount: number;
  readonly restParameterIndex: number | undefined;
  readonly typeParameterCount: number;
  readonly thisParameterTypeName: string;
  private returnTypeReferenceLinkHash = ABSENT;
  readonly isTypePredicateReturn: boolean;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsMethodUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    signature: string;
    detailedSignature: string;
    qualifiedName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    tsTypeLinkHash: string;
    ownerTypeName: string;
    ownerQualifiedName: string;
    methodAccess: TsMethodAccess;
    methodModifiers: ReadonlySet<TsMethodModifier>;
    returnTypeName: string;
    isVarArgs: boolean;
    hasReceiverParameter: boolean;
    methodKind: TsMethodKind;
    parameterCount: number;
    hasTypeParameters: boolean;
    throwsExceptions: ReadonlySet<string>;
    enclosingMemberLinkHash: string;
    tsModuleLinkHash: string;
    declarationGroupKey: string;
    mergeScopeKey: string;
    escapedName: string;
    signatureRole: TsSignatureRole;
    overloadIndex: number;
    bodyPresence: TsBodyPresence;
    isTypeOnly: boolean;
    isAsync: boolean;
    isGenerator: boolean;
    isAbstract: boolean;
    isStatic: boolean;
    optionalParameterCount: number;
    restParameterIndex: number | undefined;
    typeParameterCount: number;
    thisParameterTypeName: string;
    isTypePredicateReturn: boolean;
    startColumn: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.signature = props.signature;
    this.detailedSignature = props.detailedSignature;
    this.qualifiedName = props.qualifiedName;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.ownerTypeName = props.ownerTypeName;
    this.ownerQualifiedName = props.ownerQualifiedName;
    this.methodAccess = props.methodAccess;
    this.methodModifiers = props.methodModifiers;
    this.returnTypeName = props.returnTypeName;
    this.isVarArgs = props.isVarArgs;
    this.hasReceiverParameter = props.hasReceiverParameter;
    this.methodKind = props.methodKind;
    this.parameterCount = props.parameterCount;
    this.hasTypeParameters = props.hasTypeParameters;
    this.throwsExceptions = props.throwsExceptions;
    this.enclosingMemberLinkHash = props.enclosingMemberLinkHash;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.declarationGroupKey = props.declarationGroupKey;
    this.mergeScopeKey = props.mergeScopeKey;
    this.escapedName = props.escapedName;
    this.signatureRole = props.signatureRole;
    this.overloadIndex = props.overloadIndex;
    this.bodyPresence = props.bodyPresence;
    this.isTypeOnly = props.isTypeOnly;
    this.isAsync = props.isAsync;
    this.isGenerator = props.isGenerator;
    this.isAbstract = props.isAbstract;
    this.isStatic = props.isStatic;
    this.optionalParameterCount = props.optionalParameterCount;
    this.restParameterIndex = props.restParameterIndex;
    this.typeParameterCount = props.typeParameterCount;
    this.thisParameterTypeName = props.thisParameterTypeName;
    this.isTypePredicateReturn = props.isTypePredicateReturn;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_METHOD_md5(tsModuleLinkHash ‖ tsTypeLinkHash ‖ qualifiedName ‖ signature ‖ startLine ‖ startColumn)`
   *
   * Deliberately does NOT include `signatureRole` or `overloadIndex`: both are
   * assigned after the whole overload set is seen, and a key that moved when
   * they were filled in would invalidate every child parameter row.
   */
  generateHash(): void {
    this.tsMethodUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_METHOD,
      keyOf(
        this.tsModuleLinkHash,
        this.tsTypeLinkHash,
        this.qualifiedName,
        this.signature,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsMethodUniqueHash;
  }

  /**
   * Assigns overload identity once the whole set is visible.
   *
   * Cannot be a constructor argument: whether a declaration is `SOLE` or an
   * `OVERLOAD_SIGNATURE` is only knowable after its siblings have been seen,
   * and the sibling may come later in the file. Safe to back-patch because
   * neither column is in the primary key.
   */
  setOverloadIdentity(role: TsSignatureRole, index: number): void {
    this.signatureRole = role;
    this.overloadIndex = index;
  }

  getSignatureRole(): TsSignatureRole {
    return this.signatureRole;
  }

  setReturnTypeReferenceLinkHash(hash: string): void {
    this.returnTypeReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_method[name=${this.name}, sig=${this.signature}, role=${this.signatureRole}, body=${this.bodyPresence}, hash=${this.tsMethodUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.signature),
        text(this.detailedSignature),
        text(this.qualifiedName),
        text(this.filePath),
        num(this.startLine),
        num(this.endLine),
        this.tsTypeLinkHash,
        text(this.ownerTypeName),
        text(this.ownerQualifiedName),
        this.methodAccess,
        commaSet(this.methodModifiers),
        text(this.returnTypeName),
        bool(this.isVarArgs),
        bool(this.hasReceiverParameter),
        this.defaultValueExpression,
        this.methodKind,
        num(this.parameterCount),
        bool(this.hasTypeParameters),
        commaSet(this.throwsExceptions),
        this.enclosingMemberLinkHash,
        this.tsModuleLinkHash,
        this.declarationGroupKey,
        text(this.mergeScopeKey),
        text(this.escapedName),
        this.signatureRole,
        num(this.overloadIndex),
        this.bodyPresence,
        bool(this.isTypeOnly),
        bool(this.isAsync),
        bool(this.isGenerator),
        bool(this.isAbstract),
        bool(this.isStatic),
        num(this.optionalParameterCount),
        optionalNum(this.restParameterIndex),
        num(this.typeParameterCount),
        text(this.thisParameterTypeName),
        this.returnTypeReferenceLinkHash,
        bool(this.isTypePredicateReturn),
        num(this.startColumn),
        num(this.endColumn),
        this.serviceVersionLinkHash,
        this.tsMethodUniqueHash,
      ],
      TsMethodRegistry.ARITY,
      'ts_method'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'signature', 'detailedSignature', 'qualifiedName', 'filePath', 'startLine',
        'endLine', 'tsTypeLinkHash', 'ownerTypeName', 'ownerQualifiedName', 'methodAccess',
        'methodModifier', 'returnTypeName', 'isVarArgs', 'hasReceiverParameter',
        'defaultValueExpression', 'methodKind', 'parameterCount', 'hasTypeParameters',
        'throwsExceptions', 'enclosingMemberLinkHash', 'tsModuleLinkHash',
        'declarationGroupKey', 'mergeScopeKey', 'escapedName', 'signatureRole',
        'overloadIndex', 'bodyPresence', 'isTypeOnly', 'isAsync', 'isGenerator', 'isAbstract',
        'isStatic', 'optionalParameterCount', 'restParameterIndex', 'typeParameterCount',
        'thisParameterTypeName', 'returnTypeReferenceLinkHash', 'isTypePredicateReturn',
        'startColumn', 'endColumn', 'serviceVersionLinkHash', 'tsMethodUniqueHash',
      ],
      TsMethodRegistry.ARITY,
      'ts_method'
    );
  }
}
