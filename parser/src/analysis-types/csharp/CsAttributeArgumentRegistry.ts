import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsAttributeArgumentValueKind } from '@/enums/csharp/attributes';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One argument of one attribute — schema §3.15, **14 columns**.
 *
 * ## `isNamedArgument` is a column because a name cannot say which
 *
 * `[X(1)]` and `[X(Name = 1)]` bind differently: the first goes to a
 * constructor parameter by POSITION, the second to a property or field by NAME.
 * A single `argumentName` column cannot distinguish "the third positional
 * argument" from "a named argument that happens to be third", and the two
 * resolve against different members of the attribute class.
 *
 * ## The argument that is an EDGE
 *
 * `typeof(MyConverter)` inside an attribute names a type that a framework
 * instantiates through reflection, from a stack that appears in no source file.
 * `referencedTypeReferenceLinkHash` is where that edge lives, and nothing else
 * in the fact base carries it.
 */
export class CsAttributeArgumentRegistry implements EntityIdentifiable {
  static readonly ARITY = 14;
  static readonly RELATION = 'cs_attribute_argument';

  readonly argumentName: string;
  readonly argumentValue: string;
  readonly valueKind: CsAttributeArgumentValueKind;
  readonly position: number;
  readonly isNamedArgument: boolean;
  readonly parentAttributeHash: string;
  private referencedTypeReferenceLinkHash = ABSENT;
  private csExpressionLinkHash = ABSENT;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csAttributeArgumentUniqueHash = ABSENT;

  constructor(props: {
    argumentName: string;
    argumentValue: string;
    valueKind: CsAttributeArgumentValueKind;
    position: number;
    isNamedArgument: boolean;
    parentAttributeHash: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.argumentName = props.argumentName;
    this.argumentValue = props.argumentValue;
    this.valueKind = props.valueKind;
    this.position = props.position;
    this.isNamedArgument = props.isNamedArgument;
    this.parentAttributeHash = props.parentAttributeHash;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_ATTRIBUTE_ARGUMENT_md5(parentAttributeHash ‖ position ‖
   * isNamedArgument ‖ argumentName)`
   *
   * Chained off the PARENT ATTRIBUTE's hash, as `FieldRegistry` chains off its
   * type's. Position alone is not enough: `[X(1, Name = 2)]` numbers its
   * arguments 0 and 1 across both kinds, and a schema change that renumbered
   * named arguments separately would collide them without `isNamedArgument` in
   * the key.
   */
  generateHash(): void {
    this.csAttributeArgumentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_ATTRIBUTE_ARGUMENT,
      keyOf(
        this.parentAttributeHash,
        this.position,
        this.isNamedArgument,
        this.argumentName
      )
    );
  }

  getHash(): string {
    return this.csAttributeArgumentUniqueHash;
  }

  setReferencedTypeReferenceLinkHash(hash: string): void {
    this.referencedTypeReferenceLinkHash = hash;
  }

  setExpressionLinkHash(hash: string): void {
    this.csExpressionLinkHash = hash;
  }

  getEntryCombined(): string {
    return (
      `cs_attribute_argument[name=${this.argumentName}, kind=${this.valueKind}, ` +
      `named=${this.isNamedArgument}, pos=${this.position}, ` +
      `hash=${this.csAttributeArgumentUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.argumentName),
        text(this.argumentValue),
        this.valueKind,
        num(this.position),
        bool(this.isNamedArgument),
        this.parentAttributeHash,
        this.referencedTypeReferenceLinkHash,
        this.csExpressionLinkHash,
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csAttributeArgumentUniqueHash,
      ],
      CsAttributeArgumentRegistry.ARITY,
      CsAttributeArgumentRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'argumentName', 'argumentValue', 'valueKind', 'position', 'isNamedArgument',
        'parentAttributeHash', 'referencedTypeReferenceLinkHash', 'csExpressionLinkHash',
        'startLine', 'endLine', 'startColumn',
        'isExternal', 'serviceVersionLinkHash', 'csAttributeArgumentUniqueHash',
      ],
      CsAttributeArgumentRegistry.ARITY,
      CsAttributeArgumentRegistry.RELATION
    );
  }
}
