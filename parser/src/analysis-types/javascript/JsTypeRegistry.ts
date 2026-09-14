import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsEvidenceKind,
  JsTypeCategory,
  JsTypeDeclarationForm,
} from '@/enums/javascript/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A type declaration — schema §3.2, 26 columns.
 *
 * An ES class, a constructor function with prototype members, or a JSDoc
 * `@typedef`/`@callback`. **Object literals are not here.** They are values, and
 * treating every one as a type is how a JavaScript fact base acquires 50,000
 * meaningless types — a tempting mistake, because the pre-ES6 module pattern
 * really does use an object literal where a modern codebase uses a class.
 *
 * ## There is no `declarationGroupKey`, and that is a decision
 *
 * TypeScript needs one because declaration merging makes `name -> single entity`
 * false: 1,986 multi-declaration symbols were measured there, one name reaching
 * 43 declarations. **JavaScript has no declaration merging.** A second
 * `class Foo` is a redeclaration error, and `Foo.prototype.x = …` after
 * `class Foo` mutates the *same* entity — which the FK from `js_method` already
 * expresses. Adding a merge key here would be porting a solution to a problem
 * this language does not have.
 *
 * ## The key chains off the module, not off a name
 *
 * `module.exports = class {}` yields a type whose only name is its file's, so
 * two such files in one directory would collide on any name-derived key.
 * `startColumn` is in the key because two class expressions can share a line.
 */
export class JsTypeRegistry implements EntityIdentifiable {
  static readonly ARITY = 26;

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly typeCategory: JsTypeCategory;
  readonly declarationForm: JsTypeDeclarationForm;
  /** Parity slot, always `false` — JavaScript has no `abstract`. */
  readonly isAbstract: boolean;
  /** Permanently `""`. A JavaScript class declaration carries no modifiers; `static` belongs to its MEMBERS and is on js_method/js_field. */
  readonly modifiers: string;
  readonly evidenceKind: JsEvidenceKind;
  /** True for `JSDOC_TYPEDEF`/`JSDOC_CALLBACK`. No call-graph rule may traverse these rows. */
  readonly isTypeOnly: boolean;
  private declaredMemberCount = 0;
  /** True when members arrived by assignment rather than in a class body. */
  private hasPrototypeMembers = false;
  private constructorMethodLinkHash = ABSENT;
  readonly ownerModuleLinkHash: string;
  readonly ownerScopeLinkHash: string;
  readonly enclosingMethodLinkHash: string;
  private sourceExpressionLinkHash = ABSENT;
  private jsdocCommentLinkHash = ABSENT;
  private isExported = false;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsTypeUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    filePath: string;
    baseMservPath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    typeCategory: JsTypeCategory;
    declarationForm: JsTypeDeclarationForm;
    isAbstract: boolean;
    modifiers: string;
    evidenceKind: JsEvidenceKind;
    isTypeOnly: boolean;
    ownerModuleLinkHash: string;
    ownerScopeLinkHash: string;
    enclosingMethodLinkHash: string;
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
    this.typeCategory = props.typeCategory;
    this.declarationForm = props.declarationForm;
    this.isAbstract = props.isAbstract;
    this.modifiers = props.modifiers;
    this.evidenceKind = props.evidenceKind;
    this.isTypeOnly = props.isTypeOnly;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.ownerScopeLinkHash = props.ownerScopeLinkHash;
    this.enclosingMethodLinkHash = props.enclosingMethodLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsTypeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_TYPE,
      keyOf(this.ownerModuleLinkHash, this.qualifiedName, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsTypeUniqueHash;
  }

  setDeclaredMemberCount(value: number): void {
    this.declaredMemberCount = value;
  }
  setHasPrototypeMembers(value = true): void {
    this.hasPrototypeMembers = value;
  }
  setConstructorMethodLinkHash(hash: string): void {
    this.constructorMethodLinkHash = hash;
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
    return `js_type[hash=${this.jsTypeUniqueHash}]`;
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
        this.typeCategory,
        this.declarationForm,
        bool(this.isAbstract),
        text(this.modifiers),
        this.evidenceKind,
        bool(this.isTypeOnly),
        num(this.declaredMemberCount),
        bool(this.hasPrototypeMembers),
        this.constructorMethodLinkHash,
        this.ownerModuleLinkHash,
        this.ownerScopeLinkHash,
        this.enclosingMethodLinkHash,
        this.sourceExpressionLinkHash,
        this.jsdocCommentLinkHash,
        bool(this.isExported),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsTypeUniqueHash,
      ],
      JsTypeRegistry.ARITY,
      'js_type'
    );
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
        'typeCategory',
        'declarationForm',
        'isAbstract',
        'modifiers',
        'evidenceKind',
        'isTypeOnly',
        'declaredMemberCount',
        'hasPrototypeMembers',
        'constructorMethodLinkHash',
        'ownerModuleLinkHash',
        'ownerScopeLinkHash',
        'enclosingMethodLinkHash',
        'sourceExpressionLinkHash',
        'jsdocCommentLinkHash',
        'isExported',
        'isExternal',
        'serviceVersionLinkHash',
        'jsTypeUniqueHash',
      ],
      JsTypeRegistry.ARITY,
      'js_type'
    );
  }
}
