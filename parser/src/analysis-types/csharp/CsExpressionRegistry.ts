import { ABSENT, bool, joinHeader, joinRow, keyOf, num, optionalNum, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CsEdgeRole,
  CsExpressionKind,
  CsExpressionOwnerKind,
  CsLiteralKind,
  CsMethodReferenceKind,
  CsReferencedEntityKind,
  CsRootContext,
  CsUnaryFixity,
} from '@/enums/csharp/expressions';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One expression node — schema §3.16, **35 columns. The spine.**
 *
 * Ported from `ts_expression` (34), not invented. Every later relation chains
 * off this hash.
 *
 * ## `methodReferenceKind` is the column TypeScript could not fill
 *
 * In TypeScript it is a documented **parity slot, always `""`**, because the
 * language has no `::` and no method groups. **C# fills it**, and that is the
 * single most C#-specific thing in this relation: `Action a = M;` is a
 * reference to a method with **no call syntax at all** — no parentheses, no
 * arguments. The call happens later through `a()`, from a stack `M`'s
 * declaration never appears on. Without this column an engine sees a delegate
 * invoked with no target and a method that is never referenced.
 *
 * ## `castTypeReferenceLinkHash` is a call edge wearing a type reference
 *
 * `(Bar)foo` may invoke a user-defined `explicit operator`, and an implicit
 * conversion runs with no syntax at the call site at all. 582 conversion
 * operators measured. The expression carries the target type reference so the
 * engine can decide whether user code runs; the parser does not resolve it.
 *
 * ## `PARENTHESIZED` gets a row
 *
 * §6: a tree rooted at a non-emitting node dies before its children are
 * enqueued. `return (a && b.c())` cost admin-ui **1,808 expressions**, and
 * `{t(msg)}` in JSX cost **4,488 of 14,335 call sites**. Unwrap at the root —
 * in ONE place — but emit the row.
 */
export class CsExpressionRegistry implements EntityIdentifiable {
  static readonly ARITY = 35;
  static readonly RELATION = 'cs_expression';

  readonly kind: CsExpressionKind;
  readonly edgeRole: CsEdgeRole;
  readonly rootContext: CsRootContext;
  readonly expressionOwnerKind: CsExpressionOwnerKind;
  readonly expressionOwnerHash: string;
  readonly parentExpressionHash: string;
  readonly position: number;
  readonly depth: number;
  readonly csTypeLinkHash: string;
  readonly csModuleLinkHash: string;
  readonly literalKind: CsLiteralKind;
  readonly literalValue: string;
  readonly operatorString: string;
  readonly unaryFixity: CsUnaryFixity;
  readonly methodReferenceKind: CsMethodReferenceKind;
  readonly referencedEntityKind: CsReferencedEntityKind;
  private referencedEntityHash = ABSENT;
  private anonymousDeclarationHash = ABSENT;
  readonly potentialQualifiedName: string;
  readonly isAmbiguous: boolean;
  readonly argumentCount: number;
  readonly typeArgumentCount: number;
  readonly isSpread: boolean;
  readonly isNullConditional: boolean;
  readonly isNullForgiving: boolean;
  private castTypeReferenceLinkHash = ABSENT;
  readonly isCheckedContext: boolean;
  readonly returnStatementIndex: number | undefined;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csExpressionUniqueHash = ABSENT;

  constructor(props: {
    kind: CsExpressionKind;
    edgeRole: CsEdgeRole;
    rootContext: CsRootContext;
    expressionOwnerKind: CsExpressionOwnerKind;
    expressionOwnerHash: string;
    parentExpressionHash: string;
    position: number;
    depth: number;
    csTypeLinkHash: string;
    csModuleLinkHash: string;
    literalKind: CsLiteralKind;
    literalValue: string;
    operatorString: string;
    unaryFixity: CsUnaryFixity;
    methodReferenceKind: CsMethodReferenceKind;
    referencedEntityKind: CsReferencedEntityKind;
    potentialQualifiedName: string;
    isAmbiguous: boolean;
    argumentCount: number;
    typeArgumentCount: number;
    isSpread: boolean;
    isNullConditional: boolean;
    isNullForgiving: boolean;
    isCheckedContext: boolean;
    returnStatementIndex: number | undefined;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.kind = props.kind;
    this.edgeRole = props.edgeRole;
    this.rootContext = props.rootContext;
    this.expressionOwnerKind = props.expressionOwnerKind;
    this.expressionOwnerHash = props.expressionOwnerHash;
    this.parentExpressionHash = props.parentExpressionHash;
    this.position = props.position;
    this.depth = props.depth;
    this.csTypeLinkHash = props.csTypeLinkHash;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.literalKind = props.literalKind;
    this.literalValue = props.literalValue;
    this.operatorString = props.operatorString;
    this.unaryFixity = props.unaryFixity;
    this.methodReferenceKind = props.methodReferenceKind;
    this.referencedEntityKind = props.referencedEntityKind;
    this.potentialQualifiedName = props.potentialQualifiedName;
    this.isAmbiguous = props.isAmbiguous;
    this.argumentCount = props.argumentCount;
    this.typeArgumentCount = props.typeArgumentCount;
    this.isSpread = props.isSpread;
    this.isNullConditional = props.isNullConditional;
    this.isNullForgiving = props.isNullForgiving;
    this.isCheckedContext = props.isCheckedContext;
    this.returnStatementIndex = props.returnStatementIndex;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_EXPRESSION_md5(csModuleLinkHash ‖ expressionOwnerHash ‖
   * parentExpressionHash ‖ position ‖ startLine ‖ startColumn)`
   *
   * Chained off the PARENT expression. `a.B(c, c)` has two identical `c`
   * arguments at the same depth with the same owner and the same text — only
   * position and column separate them, and a name-derived key would collide on
   * exactly the shape this relation exists to represent.
   *
   * `startColumn` and not just `startLine`: `f(g(), h())` puts four expressions
   * on one line, and `a += 1; b += 2` — the case that motivated wrapper nodes in
   * the first place — puts two whole trees there.
   */
  generateHash(): void {
    this.csExpressionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_EXPRESSION,
      keyOf(
        this.csModuleLinkHash,
        this.expressionOwnerHash,
        this.parentExpressionHash,
        this.position,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.csExpressionUniqueHash;
  }

  /**
   * A SAME-FILE, ONE-HOP link to what this name refers to.
   *
   * Filled only where syntax decides it — a parameter of the enclosing method, a
   * local in an enclosing block, `this`, `base`. Never a cross-file link: the
   * parser emits IR and the engine resolves.
   */
  setReferencedEntityHash(hash: string): void {
    this.referencedEntityHash = hash;
  }

  /** The `cs_method` row minted for a lambda or anonymous method. */
  setAnonymousDeclarationHash(hash: string): void {
    this.anonymousDeclarationHash = hash;
  }

  /** The target type of a cast — a call edge wearing a type reference. */
  setCastTypeReferenceLinkHash(hash: string): void {
    this.castTypeReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_expression[kind=${this.kind}, role=${this.edgeRole}, depth=${this.depth}, ` +
      `position=${this.position}, hash=${this.csExpressionUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.kind,
        this.edgeRole,
        this.rootContext,
        this.expressionOwnerKind,
        this.expressionOwnerHash,
        this.parentExpressionHash,
        num(this.position),
        num(this.depth),
        this.csTypeLinkHash,
        this.csModuleLinkHash,
        this.literalKind,
        text(this.literalValue),
        text(this.operatorString),
        this.unaryFixity,
        this.methodReferenceKind,
        this.referencedEntityKind,
        this.referencedEntityHash,
        this.anonymousDeclarationHash,
        text(this.potentialQualifiedName),
        bool(this.isAmbiguous),
        num(this.argumentCount),
        num(this.typeArgumentCount),
        bool(this.isSpread),
        bool(this.isNullConditional),
        bool(this.isNullForgiving),
        this.castTypeReferenceLinkHash,
        bool(this.isCheckedContext),
        // `""` and NOT -1: a return statement's index is legitimately 0, so a
        // sentinel would be indistinguishable from the first return in a method.
        optionalNum(this.returnStatementIndex),
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        num(this.endColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csExpressionUniqueHash,
      ],
      CsExpressionRegistry.ARITY,
      CsExpressionRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'kind', 'edgeRole', 'rootContext', 'expressionOwnerKind', 'expressionOwnerHash',
        'parentExpressionHash', 'position', 'depth', 'csTypeLinkHash', 'csModuleLinkHash',
        'literalKind', 'literalValue', 'operatorString', 'unaryFixity',
        'methodReferenceKind', 'referencedEntityKind', 'referencedEntityHash',
        'anonymousDeclarationHash', 'potentialQualifiedName', 'isAmbiguous',
        'argumentCount', 'typeArgumentCount', 'isSpread', 'isNullConditional',
        'isNullForgiving', 'castTypeReferenceLinkHash', 'isCheckedContext',
        'returnStatementIndex', 'startLine', 'startColumn', 'endLine', 'endColumn',
        'isExternal', 'serviceVersionLinkHash', 'csExpressionUniqueHash',
      ],
      CsExpressionRegistry.ARITY,
      CsExpressionRegistry.RELATION
    );
  }
}
