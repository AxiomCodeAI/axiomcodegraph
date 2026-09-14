import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './ts-row';
import { TsBindingSourceKind } from '@/enums/typescript/variables/TsBindingSourceKind';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsVariableDeclarationKind,
  TsVariableInitializerKind,
  TsVariableScopeKind,
} from '@/enums/typescript/variables';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A variable declaration at module, function, block or global scope —
 * schema §4.11, 29 columns. Positions 0–8 mirror `java_local_variable` 0–8.
 *
 * Widened beyond Java's "local" because a module-level `const` is a first-class
 * declaration here: it merges (a module-scope variable can merge with a
 * namespace of the same name, which is why it carries a
 * {@link declarationGroupKey}), it is exported, and it is imported by name.
 *
 * ## `boundFunctionLinkHash` is what makes `const f = () => {}; f()` resolvable
 *
 * 161 measured call targets are arrow functions, and every one of them is
 * reached through the variable that binds it — the arrow has no name of its own
 * for a call site to match. Java never needed this link and Python folded the
 * equivalent into `py_binding`.
 *
 * ## Why there is no `ts_scope` relation
 *
 * Measured, not assumed (OQ-6): 34,798 identifier references resolve to a
 * declaration and the `ts_block -> ts_method -> ts_type -> ts_module` chain
 * reaches **every one**, with zero unreachable. A scope table would carry no
 * information the FKs do not already carry. {@link tsBlockLinkHash} is the
 * lexical link that makes that true for `let`/`const`.
 */
export class TsVariableRegistry implements EntityIdentifiable {
  static readonly ARITY = 31;

  readonly name: string;
  readonly variableTypeName: string;
  readonly variableBaseType: string;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly scopeKind: TsVariableScopeKind;
  readonly scopeDepth: number;
  readonly isConst: boolean;
  readonly isTypeInferred: boolean;
  readonly tsTypeLinkHash: string;
  readonly tsMethodLinkHash: string;
  readonly tsModuleLinkHash: string;
  readonly tsBlockLinkHash: string;
  readonly declarationKind: TsVariableDeclarationKind;
  readonly hasInitializer: boolean;
  readonly initializerKind: TsVariableInitializerKind;
  private boundFunctionLinkHash = ABSENT;
  private typeReferenceLinkHash = ABSENT;
  private initializerExpressionLinkHash = ABSENT;
  readonly isExported: boolean;
  readonly isAmbientDeclare: boolean;
  readonly isDestructuring: boolean;
  readonly bindingSourceKind: TsBindingSourceKind;
  readonly bindingSource: string;
  readonly declarationGroupKey: string;
  readonly startColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsVariableUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    variableTypeName: string;
    variableBaseType: string;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    filePath: string;
    startLine: number;
    endLine: number;
    scopeKind: TsVariableScopeKind;
    scopeDepth: number;
    isConst: boolean;
    isTypeInferred: boolean;
    tsTypeLinkHash: string;
    tsMethodLinkHash: string;
    tsModuleLinkHash: string;
    tsBlockLinkHash: string;
    declarationKind: TsVariableDeclarationKind;
    hasInitializer: boolean;
    initializerKind: TsVariableInitializerKind;
    isExported: boolean;
    isAmbientDeclare: boolean;
    isDestructuring: boolean;
    bindingSourceKind?: TsBindingSourceKind;
    bindingSource?: string;
    declarationGroupKey: string;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.variableTypeName = props.variableTypeName;
    this.variableBaseType = props.variableBaseType;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.scopeKind = props.scopeKind;
    this.scopeDepth = props.scopeDepth;
    this.isConst = props.isConst;
    this.isTypeInferred = props.isTypeInferred;
    this.tsTypeLinkHash = props.tsTypeLinkHash;
    this.tsMethodLinkHash = props.tsMethodLinkHash;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.tsBlockLinkHash = props.tsBlockLinkHash;
    this.declarationKind = props.declarationKind;
    this.hasInitializer = props.hasInitializer;
    this.initializerKind = props.initializerKind;
    this.isExported = props.isExported;
    this.isAmbientDeclare = props.isAmbientDeclare;
    this.isDestructuring = props.isDestructuring;
    this.bindingSourceKind = props.bindingSourceKind ?? TsBindingSourceKind.NONE;
    this.bindingSource = props.bindingSource ?? '';
    this.declarationGroupKey = props.declarationGroupKey;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_VARIABLE_md5(tsModuleLinkHash ‖ tsMethodLinkHash ‖ tsBlockLinkHash ‖ name ‖ startLine ‖ startColumn)` */
  generateHash(): void {
    this.tsVariableUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_VARIABLE,
      keyOf(
        this.tsModuleLinkHash,
        this.tsMethodLinkHash,
        this.tsBlockLinkHash,
        this.name,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsVariableUniqueHash;
  }

  /** The arrow or function expression this variable binds. See the class note. */
  setBoundFunctionLinkHash(hash: string): void {
    this.boundFunctionLinkHash = hash;
  }

  getBoundFunctionLinkHash(): string {
    return this.boundFunctionLinkHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }

  getTypeReferenceLinkHash(): string {
    return this.typeReferenceLinkHash;
  }

  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_variable[name=${this.name}, kind=${this.declarationKind}, scope=${this.scopeKind}, hash=${this.tsVariableUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.variableTypeName),
        text(this.variableBaseType),
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        text(this.filePath),
        num(this.startLine),
        num(this.endLine),
        this.scopeKind,
        num(this.scopeDepth),
        bool(this.isConst),
        bool(this.isTypeInferred),
        this.tsTypeLinkHash,
        this.tsMethodLinkHash,
        this.tsModuleLinkHash,
        this.tsBlockLinkHash,
        this.declarationKind,
        bool(this.hasInitializer),
        this.initializerKind,
        this.boundFunctionLinkHash,
        this.typeReferenceLinkHash,
        this.initializerExpressionLinkHash,
        bool(this.isExported),
        bool(this.isAmbientDeclare),
        bool(this.isDestructuring),
        this.bindingSourceKind,
        text(this.bindingSource),
        this.declarationGroupKey,
        num(this.startColumn),
        this.serviceVersionLinkHash,
        this.tsVariableUniqueHash,
      ],
      TsVariableRegistry.ARITY,
      'ts_variable'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'variableTypeName', 'variableBaseType', 'potentialQualifiedName', 'isAmbiguous',
        'filePath', 'startLine', 'endLine', 'scopeKind', 'scopeDepth', 'isConst',
        'isTypeInferred', 'tsTypeLinkHash', 'tsMethodLinkHash', 'tsModuleLinkHash',
        'tsBlockLinkHash', 'declarationKind', 'hasInitializer', 'initializerKind',
        'boundFunctionLinkHash', 'typeReferenceLinkHash', 'initializerExpressionLinkHash',
        'isExported', 'isAmbientDeclare', 'isDestructuring', 'bindingSourceKind', 'bindingSource',
        'declarationGroupKey',
        'startColumn', 'serviceVersionLinkHash', 'tsVariableUniqueHash',
      ],
      TsVariableRegistry.ARITY,
      'ts_variable'
    );
  }
}
