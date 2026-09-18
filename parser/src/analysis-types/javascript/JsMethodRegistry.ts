import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsBodyPresence,
  JsHoisting,
  JsMethodDeclarationForm,
  JsMethodKind,
  JsThisBinding,
} from '@/enums/javascript/methods';
import { JsDeclaredTypeSource } from '@/enums/javascript/common';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Every callable — schema §3.4, 36 columns.
 *
 * Function declarations, function expressions, arrows, class methods,
 * accessors, prototype-assigned methods, and the synthetic `<module>`
 * initializer.
 *
 * ## `thisBinding` and `usesArguments` have no analogue in any other front end
 *
 * Both are load-bearing rather than descriptive:
 *
 * - **`thisBinding`.** 33,189 `this` references were measured, and what `this`
 *   refers to is decided by the **call form**, not the declaration.
 *   `obj.m()`, `m()`, `m.call(x)` and `m.bind(x)()` invoke one function body
 *   with four different receivers. An engine that treats every callable as
 *   rebinding `this` gets arrows wrong; one that treats none of them as
 *   rebinding gets the other four wrong.
 * - **`usesArguments`.** `arguments` is **a parameter list nobody declared.** A
 *   function reading it accepts arguments no `js_method_parameter` row
 *   describes, so an engine modelling only named parameters silently loses the
 *   whole channel.
 *
 * ## `hoisting` separates two things that look like one category
 *
 * 5,271 function declarations hoist entirely — name and body — so a call above
 * the declaration works. 4,325 function expressions do not hoist at all. Same
 * syntax category, opposite behaviour, decided by position.
 *
 * `startColumn` is in the primary key because 9,391 arrows were measured and
 * many share a line.
 */
export class JsMethodRegistry implements EntityIdentifiable {
  static readonly ARITY = 37;

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly methodKind: JsMethodKind;
  readonly declarationForm: JsMethodDeclarationForm;
  readonly hoisting: JsHoisting;
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
  readonly isStatic: boolean;
  readonly parameterCount: number;
  readonly hasRestParameter: boolean;
  /** A second parameter channel with no declaration. An engine modelling only named parameters loses it. */
  readonly usesArguments: boolean;
  readonly thisBinding: JsThisBinding;
  readonly returnTypeName: string;
  readonly declaredTypeSource: JsDeclaredTypeSource;
  private returnTypeReferenceLinkHash = ABSENT;
  readonly bodyPresence: JsBodyPresence;
  readonly ownerTypeLinkHash: string;
  readonly ownerModuleLinkHash: string;
  /** The scope this method is DECLARED IN. */
  readonly ownerScopeLinkHash: string;
  /** The scope this method OPENS. */
  readonly bodyScopeLinkHash: string;
  readonly enclosingMethodLinkHash: string;
  private sourceExpressionLinkHash = ABSENT;
  private jsdocCommentLinkHash = ABSENT;
  private isExported = false;
  /** Parity slot. JavaScript has no signature that marks an entry point — `main` is a convention, a bin script is a package.json field, and a Lambda handler is a deployment setting. Naming one from syntax would be guessing, so this is permanently false and the module-level `<module>` initializer is the honest entry. */
  readonly isEntryPoint: boolean;
  /** Parity slot with Java, always `""` — JavaScript has no `::`. */
  readonly methodReferenceKind: string;
  readonly modifiers: string;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsMethodUniqueHash = ABSENT;
  /**
   * FK->js_expression, the KEY of a member declared with a computed name
   * (`[kRun]() {}`, `{ [k]: function () {} }`, `[k] = () => {}`). Appended after the
   * primary key because the schema is frozen and appending is the only safe edit,
   * as js_expression.introducesDeclarationLinkHash was. Empty for a member named
   * by syntax; a computed key that is itself a literal (`['lit']() {}`) fills
   * `name` with the literal text AND links the key (#598).
   */
  private computedNameExpressionLinkHash = '';

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    filePath: string;
    baseMservPath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    methodKind: JsMethodKind;
    declarationForm: JsMethodDeclarationForm;
    hoisting: JsHoisting;
    isAsync: boolean;
    isGenerator: boolean;
    isStatic: boolean;
    parameterCount: number;
    hasRestParameter: boolean;
    usesArguments: boolean;
    thisBinding: JsThisBinding;
    returnTypeName: string;
    declaredTypeSource: JsDeclaredTypeSource;
    bodyPresence: JsBodyPresence;
    ownerTypeLinkHash: string;
    ownerModuleLinkHash: string;
    ownerScopeLinkHash: string;
    bodyScopeLinkHash: string;
    enclosingMethodLinkHash: string;
    isEntryPoint: boolean;
    methodReferenceKind: string;
    modifiers: string;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.fileName = props.fileName;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.methodKind = props.methodKind;
    this.declarationForm = props.declarationForm;
    this.hoisting = props.hoisting;
    this.isAsync = props.isAsync;
    this.isGenerator = props.isGenerator;
    this.isStatic = props.isStatic;
    this.parameterCount = props.parameterCount;
    this.hasRestParameter = props.hasRestParameter;
    this.usesArguments = props.usesArguments;
    this.thisBinding = props.thisBinding;
    this.returnTypeName = props.returnTypeName;
    this.declaredTypeSource = props.declaredTypeSource;
    this.bodyPresence = props.bodyPresence;
    this.ownerTypeLinkHash = props.ownerTypeLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.bodyScopeLinkHash = props.bodyScopeLinkHash;
    this.enclosingMethodLinkHash = props.enclosingMethodLinkHash;
    this.isEntryPoint = props.isEntryPoint;
    this.methodReferenceKind = props.methodReferenceKind;
    this.modifiers = props.modifiers;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsMethodUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_METHOD,
      keyOf(this.ownerModuleLinkHash, this.qualifiedName, this.startLine, this.startColumn, this.methodKind)
    );
  }

  getHash(): string {
    return this.jsMethodUniqueHash;
  }

  setReturnTypeReferenceLinkHash(hash: string): void {
    this.returnTypeReferenceLinkHash = hash;
  }
  setSourceExpressionLinkHash(hash: string): void {
    this.sourceExpressionLinkHash = hash;
  }
  setJsdocCommentLinkHash(hash: string): void {
    this.jsdocCommentLinkHash = hash;
  }
  setIsExported(value = true): void {
    this.isExported = value;
  }

  getEntryCombined(): string {
    return `js_method[hash=${this.jsMethodUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        text(this.fileName),
        text(this.filePath),
        text(this.baseMservPath),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        this.methodKind,
        this.declarationForm,
        this.hoisting,
        bool(this.isAsync),
        bool(this.isGenerator),
        bool(this.isStatic),
        num(this.parameterCount),
        bool(this.hasRestParameter),
        bool(this.usesArguments),
        this.thisBinding,
        text(this.returnTypeName),
        this.declaredTypeSource,
        this.returnTypeReferenceLinkHash,
        this.bodyPresence,
        this.ownerTypeLinkHash,
        this.ownerModuleLinkHash,
        this.ownerScopeLinkHash,
        this.bodyScopeLinkHash,
        this.enclosingMethodLinkHash,
        this.sourceExpressionLinkHash,
        this.jsdocCommentLinkHash,
        bool(this.isExported),
        bool(this.isEntryPoint),
        text(this.methodReferenceKind),
        text(this.modifiers),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsMethodUniqueHash,
        this.computedNameExpressionLinkHash,
      ],
      JsMethodRegistry.ARITY,
      'js_method'
    );
  }

  setComputedNameExpressionLinkHash(hash: string): void {
    this.computedNameExpressionLinkHash = hash;
  }

  getComputedNameExpressionLinkHash(): string {
    return this.computedNameExpressionLinkHash;
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name',
        'qualifiedName',
        'fileName',
        'filePath',
        'baseMservPath',
        'startLine',
        'endLine',
        'startColumn',
        'methodKind',
        'declarationForm',
        'hoisting',
        'isAsync',
        'isGenerator',
        'isStatic',
        'parameterCount',
        'hasRestParameter',
        'usesArguments',
        'thisBinding',
        'returnTypeName',
        'declaredTypeSource',
        'returnTypeReferenceLinkHash',
        'bodyPresence',
        'ownerTypeLinkHash',
        'ownerModuleLinkHash',
        'ownerScopeLinkHash',
        'bodyScopeLinkHash',
        'enclosingMethodLinkHash',
        'sourceExpressionLinkHash',
        'jsdocCommentLinkHash',
        'isExported',
        'isEntryPoint',
        'methodReferenceKind',
        'modifiers',
        'isExternal',
        'serviceVersionLinkHash',
        'jsMethodUniqueHash',
        'computedNameExpressionLinkHash',
      ],
      JsMethodRegistry.ARITY,
      'js_method'
    );
  }
}
