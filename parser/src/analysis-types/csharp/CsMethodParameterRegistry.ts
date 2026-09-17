import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsParameterMode, CsScopedModifier } from '@/enums/csharp/method-parameters';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One parameter — schema §3.7, **18 columns as listed**.
 *
 * > The schema heading says 17 and the column list beneath it has 18. The LIST
 * > is taken as the contract, because the order is the contract and only the
 * > list states an order. Reported to cs-oracle in `requests-impl.jsonl` and
 * > still open; a correction is a mechanical insert that the arity constant
 * > will catch loudly.
 *
 * ## `out` is a second return channel
 *
 * `int.TryParse(s, out var n)` returns a `bool` and produces an `int`. An engine
 * that models only return values loses that dataflow, and `TryParse` is in every
 * C# codebase written. That is the whole reason `parameterMode` is on every row
 * rather than a flag on a few.
 *
 * ## `isThis` is how an extension method is reconstructable
 *
 * `xs.Count()` has a syntactic receiver that is **not** the declaring type. The
 * three facts that make the edge findable are this marker, the declaring static
 * class (`cs_method.csTypeLinkHash`), and the governing `using` set — and the
 * parser emits all three and resolves none of them.
 *
 * `isThis` and `parameterMode = THIS` are deliberately redundant, so a rule over
 * modes and a rule over flags cannot disagree.
 */
export class CsMethodParameterRegistry implements EntityIdentifiable {
  static readonly ARITY = 18;
  static readonly RELATION = 'cs_method_parameter';

  readonly csMethodLinkHash: string;
  readonly position: number;
  readonly name: string;
  readonly parameterMode: CsParameterMode;
  readonly typeName: string;
  readonly completeTypeName: string;
  readonly isNullableAnnotated: boolean;
  readonly hasDefaultValue: boolean;
  readonly defaultValueText: string;
  readonly isParams: boolean;
  readonly isThis: boolean;
  readonly scopedModifier: CsScopedModifier;
  private attributeCount = 0;
  readonly startLine: number;
  readonly startColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csMethodParameterUniqueHash = ABSENT;

  constructor(props: {
    csMethodLinkHash: string;
    position: number;
    name: string;
    parameterMode: CsParameterMode;
    typeName: string;
    completeTypeName: string;
    isNullableAnnotated: boolean;
    hasDefaultValue: boolean;
    defaultValueText: string;
    isParams: boolean;
    isThis: boolean;
    scopedModifier: CsScopedModifier;
    attributeCount: number;
    startLine: number;
    startColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.csMethodLinkHash = props.csMethodLinkHash;
    this.position = props.position;
    this.name = props.name;
    this.parameterMode = props.parameterMode;
    this.typeName = props.typeName;
    this.completeTypeName = props.completeTypeName;
    this.isNullableAnnotated = props.isNullableAnnotated;
    this.hasDefaultValue = props.hasDefaultValue;
    this.defaultValueText = props.defaultValueText;
    this.isParams = props.isParams;
    this.isThis = props.isThis;
    this.scopedModifier = props.scopedModifier;
    this.attributeCount = props.attributeCount;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_METHOD_PARAMETER_md5(csMethodLinkHash ‖ position ‖ name ‖ parameterMode)`
   *
   * `parameterMode` is in the key on the schema's instruction. Position and name
   * alone would suffice for legal C#; including the mode means a `ref` becoming
   * an `out` re-keys the row, which is right — it is a different dataflow
   * contract, not an edit to the same one.
   */
  generateHash(): void {
    this.csMethodParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_METHOD_PARAMETER,
      keyOf(this.csMethodLinkHash, this.position, this.name, this.parameterMode)
    );
  }

  getHash(): string {
    return this.csMethodParameterUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_method_parameter[name=${this.name}, position=${this.position}, ` +
      `mode=${this.parameterMode}, type=${this.completeTypeName}, ` +
      `hash=${this.csMethodParameterUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.csMethodLinkHash,
        num(this.position),
        text(this.name),
        this.parameterMode,
        text(this.typeName),
        text(this.completeTypeName),
        bool(this.isNullableAnnotated),
        bool(this.hasDefaultValue),
        text(this.defaultValueText),
        bool(this.isParams),
        bool(this.isThis),
        this.scopedModifier,
        num(this.attributeCount),
        num(this.startLine),
        num(this.startColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csMethodParameterUniqueHash,
      ],
      CsMethodParameterRegistry.ARITY,
      CsMethodParameterRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'csMethodLinkHash', 'position', 'name', 'parameterMode', 'typeName',
        'completeTypeName', 'isNullableAnnotated', 'hasDefaultValue', 'defaultValueText',
        'isParams', 'isThis', 'scopedModifier', 'attributeCount', 'startLine',
        'startColumn', 'isExternal', 'serviceVersionLinkHash',
        'csMethodParameterUniqueHash',
      ],
      CsMethodParameterRegistry.ARITY,
      CsMethodParameterRegistry.RELATION
    );
  }
}
