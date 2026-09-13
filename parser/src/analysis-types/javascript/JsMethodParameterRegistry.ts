import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsParameterBindingForm,
} from '@/enums/javascript/method-parameters';
import { JsDeclaredTypeSource } from '@/enums/javascript/common';
import { JsBindingRegime } from '@/enums/javascript/variables';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One declared parameter — schema §3.5, 22 columns.
 *
 * ## A destructured parameter is ONE row, plus N variables
 *
 * 6,909 destructuring patterns were measured. The row keeps `position` and
 * records `patternBindingCount`; the names it binds are `js_variable` rows with
 * `bindingRegime = PARAMETER`.
 *
 * Both alternatives are wrong and both are tempting. **N parameter rows** breaks
 * `position` — `function f({ a, b }, c)` has `c` at position 1, and emitting
 * `a` and `b` as parameters puts it at 2, so every arity join is off by one.
 * **One row with no binding information** loses every name, so a call through a
 * destructured parameter resolves to nothing. That is the §3 defect class, and
 * the fix is Java's: one node for the construct, its parts parented to it, and
 * the variant in a column.
 *
 * ## `declaredTypeSource` is where the language's type channel actually is
 *
 * 62.1% of parameters carry no declared type, **37.9% carry a JSDoc one**, and
 * effectively none carry a syntactic one: 64 syntactic annotations were once
 * reported, all of them Flow, and the replication corpus measures 0 because all
 * 64 were in one package it does not contain. TypeScript's
 * schema is Java-shaped because 85.3% of its parameters are annotated; that
 * mechanism is absent from this language's syntax entirely.
 */
export class JsMethodParameterRegistry implements EntityIdentifiable {
  static readonly ARITY = 22;

  readonly name: string;
  readonly position: number;
  readonly ownerMethodLinkHash: string;
  readonly declaredTypeName: string;
  readonly declaredTypeSource: JsDeclaredTypeSource;
  private typeReferenceLinkHash = ABSENT;
  readonly isOptional: boolean;
  readonly hasDefault: boolean;
  readonly defaultValueText: string;
  readonly isRest: boolean;
  readonly bindingForm: JsParameterBindingForm;
  /** How many names this parameter actually binds; > 0 for a destructuring pattern. */
  readonly patternBindingCount: number;
  /** Always `PARAMETER`. */
  readonly bindingRegime: JsBindingRegime;
  readonly scopeLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  /** Parity slot with TypeScript, always `false`. */
  readonly isParameterProperty: boolean;
  private jsdocCommentLinkHash = ABSENT;
  readonly ownerModuleLinkHash: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsMethodParameterUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    position: number;
    ownerMethodLinkHash: string;
    declaredTypeName: string;
    declaredTypeSource: JsDeclaredTypeSource;
    isOptional: boolean;
    hasDefault: boolean;
    defaultValueText: string;
    isRest: boolean;
    bindingForm: JsParameterBindingForm;
    patternBindingCount: number;
    bindingRegime: JsBindingRegime;
    scopeLinkHash: string;
    startLine: number;
    startColumn: number;
    isParameterProperty: boolean;
    ownerModuleLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.position = props.position;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.declaredTypeName = props.declaredTypeName;
    this.declaredTypeSource = props.declaredTypeSource;
    this.isOptional = props.isOptional;
    this.hasDefault = props.hasDefault;
    this.defaultValueText = props.defaultValueText;
    this.isRest = props.isRest;
    this.bindingForm = props.bindingForm;
    this.patternBindingCount = props.patternBindingCount;
    this.bindingRegime = props.bindingRegime;
    this.scopeLinkHash = props.scopeLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.isParameterProperty = props.isParameterProperty;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsMethodParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_METHOD_PARAMETER,
      keyOf(this.ownerMethodLinkHash, this.position, this.name)
    );
  }

  getHash(): string {
    return this.jsMethodParameterUniqueHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }
  setJsdocCommentLinkHash(hash: string): void {
    this.jsdocCommentLinkHash = hash;
  }

  getEntryCombined(): string {
    return `js_method_parameter[hash=${this.jsMethodParameterUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        num(this.position),
        this.ownerMethodLinkHash,
        text(this.declaredTypeName),
        this.declaredTypeSource,
        this.typeReferenceLinkHash,
        bool(this.isOptional),
        bool(this.hasDefault),
        text(this.defaultValueText),
        bool(this.isRest),
        this.bindingForm,
        num(this.patternBindingCount),
        this.bindingRegime,
        this.scopeLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isParameterProperty),
        this.jsdocCommentLinkHash,
        this.ownerModuleLinkHash,
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsMethodParameterUniqueHash,
      ],
      JsMethodParameterRegistry.ARITY,
      'js_method_parameter'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name',
        'position',
        'ownerMethodLinkHash',
        'declaredTypeName',
        'declaredTypeSource',
        'typeReferenceLinkHash',
        'isOptional',
        'hasDefault',
        'defaultValueText',
        'isRest',
        'bindingForm',
        'patternBindingCount',
        'bindingRegime',
        'scopeLinkHash',
        'startLine',
        'startColumn',
        'isParameterProperty',
        'jsdocCommentLinkHash',
        'ownerModuleLinkHash',
        'isExternal',
        'serviceVersionLinkHash',
        'jsMethodParameterUniqueHash',
      ],
      JsMethodParameterRegistry.ARITY,
      'js_method_parameter'
    );
  }
}
