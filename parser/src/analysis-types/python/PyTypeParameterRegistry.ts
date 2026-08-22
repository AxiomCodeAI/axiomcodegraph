import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonExpressionOwnerKind } from '@/enums/python/expressions';
import { PythonTypeParameterVariance } from '@/enums/python/type-parameters';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One PEP 695 type parameter — the `T` in `class Box[T]`.
 *
 * Emitted only for the 3.12 SYNTAX. On 3.11 and earlier a `TypeVar` is a runtime
 * assignment rather than syntax — 255 of them in the corpus — and §2.20 puts
 * those in `py_binding` with `targetEntityKind=TYPE_VAR`, because they are
 * genuinely a different thing: an assignment the interpreter executes, not a
 * declaration the grammar recognises.
 *
 * `boundText` carries the constraint, and it is where the scope subtlety lives:
 * CPython opens a SEPARATE scope for a bound (`TypeVar bound`, verified on
 * 3.12.4) because the bound is evaluated lazily and can refer to the parameters
 * around it. `pyScopeLinkHash` therefore points at that scope when one exists,
 * and at the type-parameter scope otherwise.
 *
 * `variance` is `INFERRED` for everything here, and that is a statement rather
 * than a default: PEP 695 removed the explicit `covariant=True` spelling, so the
 * source genuinely does not say and a checker works it out from usage.
 *
 * ## Column order (frozen — schema v7 §2.20, 14 columns)
 *
 * **PK** `PY_TYPE_PARAMETER_md5(ownerLinkHash ‖ paramName ‖ position)`
 */
export class PyTypeParameterRegistry implements EntityIdentifiable {
  private paramName: string;
  private position: number;
  private ownerName: string;
  private ownerQualifiedName: string;
  private filePath: string;
  private startLine: number;
  private ownerLinkHash: string;
  private ownerKind: PythonExpressionOwnerKind;
  private boundText: string;
  private variance: PythonTypeParameterVariance;
  private defaultText: string;
  private pyScopeLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyTypeParameterUniqueHash: string = '';

  constructor(
    paramName: string,
    position: number,
    ownerName: string,
    ownerQualifiedName: string,
    filePath: string,
    startLine: number,
    ownerLinkHash: string,
    ownerKind: PythonExpressionOwnerKind,
    boundText: string,
    variance: PythonTypeParameterVariance,
    defaultText: string,
    pyScopeLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    this.paramName = paramName;
    this.position = position;
    this.ownerName = ownerName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.filePath = filePath;
    this.startLine = startLine;
    this.ownerLinkHash = ownerLinkHash;
    this.ownerKind = ownerKind;
    this.boundText = boundText;
    this.variance = variance;
    this.defaultText = defaultText;
    this.pyScopeLinkHash = pyScopeLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getParamName(): string {
    return this.paramName;
  }

  getPosition(): number {
    return this.position;
  }

  getBoundText(): string {
    return this.boundText;
  }

  getOwnerLinkHash(): string {
    return this.ownerLinkHash;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getHash(): string {
    return this.pyTypeParameterUniqueHash;
  }

  generateHash(): void {
    const content = this.ownerLinkHash + '||' + this.paramName + '||' + this.position;

    this.pyTypeParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_TYPE_PARAMETER,
      content
    );
  }

  getEntryCombined(): string {
    return `py_type_parameter[name=${this.paramName}, position=${this.position}, owner=${this.ownerName}, bound=${this.boundText || '-'}]`;
  }

  toCsv(): string {
    return [
      this.paramName,
      this.position,
      this.ownerName,
      this.ownerQualifiedName,
      this.filePath,
      this.startLine,
      this.ownerLinkHash,
      this.ownerKind,
      EntityUtils.escapeTsv(this.boundText),
      this.variance,
      EntityUtils.escapeTsv(this.defaultText),
      this.pyScopeLinkHash,
      this.serviceVersionLinkHash,
      this.pyTypeParameterUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'paramName',
      'position',
      'ownerName',
      'ownerQualifiedName',
      'filePath',
      'startLine',
      'ownerLinkHash',
      'ownerKind',
      'boundText',
      'variance',
      'defaultText',
      'pyScopeLinkHash',
      'serviceVersionLinkHash',
      'pyTypeParameterUniqueHash',
    ].join('\t');
  }
}
