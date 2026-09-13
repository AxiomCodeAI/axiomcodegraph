import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsAccessorPairKind,
  JsFieldDeclarationForm,
} from '@/enums/javascript/fields';
import { JsDeclaredTypeSource } from '@/enums/javascript/common';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A class field, a prototype property, or a member installed by
 * `Object.defineProperty` — schema §3.6, 23 columns.
 *
 * ## `declarationForm` is in the primary key, and it earns its place
 *
 * `this.x = 1` in a constructor and `Foo.prototype.x = 1` at module level are
 * **two declarations of one member**, at different lines, and both are real: one
 * sets an own property per instance, the other a shared prototype property.
 * Keying without the form would merge them into one row and lose the
 * distinction; keying with it keeps both and lets the engine choose.
 *
 * ## `accessorPairKind` is the declaration half of a reserved call kind
 *
 * 1,225 getters and 137 setters were measured. Each means that somewhere,
 * `obj.x` is a **function call written as a property read**. The parser emits
 * the declaration — `get x() {}` is right there — and cannot emit the
 * invocation, because whether a given `obj.x` hits an accessor depends on what
 * `obj` turns out to be. `GETTER_INVOCATION` is therefore reserved with a
 * zero-row assertion, and this column carries the half syntax can answer.
 *
 * `isPrivateName` is `#x` specifically, and not `_x`: the first is a real access
 * boundary the runtime enforces, the second is a naming convention.
 */
export class JsFieldRegistry implements EntityIdentifiable {
  static readonly ARITY = 23;

  readonly name: string;
  readonly qualifiedName: string;
  readonly ownerTypeLinkHash: string;
  readonly declarationForm: JsFieldDeclarationForm;
  readonly isStatic: boolean;
  /** `#x` — a real access boundary the runtime enforces, unlike the `_x` convention. */
  readonly isPrivateName: boolean;
  /** `writable: false` via `Object.defineProperty`. */
  private isReadonly = false;
  private declaredTypeName: string;
  private declaredTypeSource: JsDeclaredTypeSource;
  private typeReferenceLinkHash = ABSENT;
  readonly hasInitializer: boolean;
  private initializerExpressionLinkHash = ABSENT;
  private accessorPairKind: JsAccessorPairKind;
  private getterMethodLinkHash = ABSENT;
  private setterMethodLinkHash = ABSENT;
  readonly isComputedName: boolean;
  private sourceExpressionLinkHash = ABSENT;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerModuleLinkHash: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsFieldUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    ownerTypeLinkHash: string;
    declarationForm: JsFieldDeclarationForm;
    isStatic: boolean;
    isPrivateName: boolean;
    declaredTypeName: string;
    declaredTypeSource: JsDeclaredTypeSource;
    hasInitializer: boolean;
    accessorPairKind: JsAccessorPairKind;
    isComputedName: boolean;
    startLine: number;
    startColumn: number;
    ownerModuleLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.ownerTypeLinkHash = props.ownerTypeLinkHash;
    this.declarationForm = props.declarationForm;
    this.isStatic = props.isStatic;
    this.isPrivateName = props.isPrivateName;
    this.declaredTypeName = props.declaredTypeName;
    this.declaredTypeSource = props.declaredTypeSource;
    this.hasInitializer = props.hasInitializer;
    this.accessorPairKind = props.accessorPairKind;
    this.isComputedName = props.isComputedName;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsFieldUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_FIELD,
      keyOf(this.ownerTypeLinkHash, this.name, this.startLine, this.startColumn, this.declarationForm)
    );
  }

  getHash(): string {
    return this.jsFieldUniqueHash;
  }

  setIsReadonly(value = true): void {
    this.isReadonly = value;
  }
  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }
  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }
  setAccessorPairKind(value: JsAccessorPairKind): void {
    this.accessorPairKind = value;
  }
  /**
   * An accessor PAIR is one field row, minted at whichever accessor comes
   * first — and the `@type` may sit on the other one. `get x() {}` then
   * `/** @type {boolean} *\/ set x(v) {}` typed nothing, because the row was
   * built at the getter with no type and the setter's tag had no row to land on.
   */
  setDeclaredType(name: string, source: JsDeclaredTypeSource): void {
    this.declaredTypeName = name;
    this.declaredTypeSource = source;
  }
  declaredTypeNameValue(): string {
    return this.declaredTypeName;
  }
  setGetterMethodLinkHash(hash: string): void {
    this.getterMethodLinkHash = hash;
  }
  setSetterMethodLinkHash(hash: string): void {
    this.setterMethodLinkHash = hash;
  }
  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_field[hash=${this.jsFieldUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        this.ownerTypeLinkHash,
        this.declarationForm,
        bool(this.isStatic),
        bool(this.isPrivateName),
        bool(this.isReadonly),
        text(this.declaredTypeName),
        this.declaredTypeSource,
        this.typeReferenceLinkHash,
        bool(this.hasInitializer),
        this.initializerExpressionLinkHash,
        this.accessorPairKind,
        this.getterMethodLinkHash,
        this.setterMethodLinkHash,
        bool(this.isComputedName),
        this.sourceExpressionLinkHash,
        num(this.startLine),
        num(this.startColumn),
        this.ownerModuleLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsFieldUniqueHash,
      ],
      JsFieldRegistry.ARITY,
      'js_field'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name',
        'qualifiedName',
        'ownerTypeLinkHash',
        'declarationForm',
        'isStatic',
        'isPrivateName',
        'isReadonly',
        'declaredTypeName',
        'declaredTypeSource',
        'typeReferenceLinkHash',
        'hasInitializer',
        'initializerExpressionLinkHash',
        'accessorPairKind',
        'getterMethodLinkHash',
        'setterMethodLinkHash',
        'isComputedName',
        'sourceExpressionLinkHash',
        'startLine',
        'startColumn',
        'ownerModuleLinkHash',
        'isExternal',
        'serviceVersionLinkHash',
        'jsFieldUniqueHash',
      ],
      JsFieldRegistry.ARITY,
      'js_field'
    );
  }
}
