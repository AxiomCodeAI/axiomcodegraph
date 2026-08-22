import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonDecoratorArgumentValueType } from '@/enums/python/decorators';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One argument of a decorator call.
 *
 * Positions 0–9 mirror `java_annotation_argument`, and this is where framework
 * semantics actually live: `@app.route("/admin/<id>", methods=["POST"])` is a
 * route and a verb, and a rule about unauthenticated admin endpoints reads both
 * from here. Nothing else in the schema carries them.
 *
 * `arrayIndex` handles a list-valued argument by emitting one row per element,
 * exactly as Java does, so `methods=["GET", "POST"]` is two rows rather than one
 * row holding text a consumer would have to re-parse.
 *
 * ## Column order (frozen — schema v7 §2.13, 15 columns)
 *
 * **PK** `PY_DECORATOR_ARGUMENT_md5(parentDecoratorLinkHash ‖ position ‖ arrayIndex ‖ argumentName ‖ argumentValue)`
 */
export class PyDecoratorArgumentRegistry implements EntityIdentifiable {
  private argumentName: string;
  private argumentValue: string;
  private valueType: PythonDecoratorArgumentValueType;
  private position: number;
  private parentDecoratorLinkHash: string;
  private referencedTypeHash: string;
  private nestedDecoratorHash: string;
  private arrayIndex: string;
  private startLine: number;
  private endLine: number;
  private isKeyword: boolean;
  private isStarred: boolean;
  private pyExpressionLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyDecoratorArgumentUniqueHash: string = '';

  constructor(
    argumentName: string,
    argumentValue: string,
    valueType: PythonDecoratorArgumentValueType,
    position: number,
    parentDecoratorLinkHash: string,
    arrayIndex: string,
    startLine: number,
    endLine: number,
    isKeyword: boolean,
    isStarred: boolean,
    serviceVersionLinkHash: string
  ) {
    this.argumentName = argumentName;
    this.argumentValue = argumentValue;
    this.valueType = valueType;
    this.position = position;
    this.parentDecoratorLinkHash = parentDecoratorLinkHash;
    this.referencedTypeHash = '';
    // Reserved by the schema and always empty: a decorator argument that is
    // itself a decorator has no meaning in Python, unlike a nested annotation in
    // Java. Kept for column parity so a ported rule still finds the slot.
    this.nestedDecoratorHash = '';
    this.arrayIndex = arrayIndex;
    this.startLine = startLine;
    this.endLine = endLine;
    this.isKeyword = isKeyword;
    this.isStarred = isStarred;
    this.pyExpressionLinkHash = '';
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getArgumentName(): string {
    return this.argumentName;
  }

  getArgumentValue(): string {
    return this.argumentValue;
  }

  getValueType(): PythonDecoratorArgumentValueType {
    return this.valueType;
  }

  getPosition(): number {
    return this.position;
  }

  getParentDecoratorLinkHash(): string {
    return this.parentDecoratorLinkHash;
  }

  getArrayIndex(): string {
    return this.arrayIndex;
  }

  getIsKeyword(): boolean {
    return this.isKeyword;
  }

  /**
   * Records that this argument NAMES A TYPE, with the FK to it.
   *
   * Java declares the same column and never populates it — `referencedType()`
   * is not called anywhere in the Java parser — so a rule ported across finds an
   * empty field on both sides. Populating it here is the difference between a
   * consumer reading `HandlerClass` as text and reaching the class.
   */
  setReferencedType(referencedTypeHash: string, valueType: PythonDecoratorArgumentValueType): void {
    // No re-hash: the PK is built from parent, position, arrayIndex, name and
    // VALUE, none of which change here, so resolution cannot move a row.
    this.referencedTypeHash = referencedTypeHash;
    this.valueType = valueType;
  }

  getReferencedTypeHash(): string {
    return this.referencedTypeHash;
  }

  setPyExpressionLinkHash(pyExpressionLinkHash: string): void {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
  }

  getHash(): string {
    return this.pyDecoratorArgumentUniqueHash;
  }

  generateHash(): void {
    const content =
      this.parentDecoratorLinkHash +
      '||' +
      this.position +
      '||' +
      this.arrayIndex +
      '||' +
      this.argumentName +
      '||' +
      this.argumentValue;

    this.pyDecoratorArgumentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_DECORATOR_ARGUMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `py_decorator_argument[name=${this.argumentName || '-'}, value=${this.argumentValue}, type=${this.valueType}, position=${this.position}]`;
  }

  toCsv(): string {
    return [
      this.argumentName,
      EntityUtils.escapeTsv(this.argumentValue),
      this.valueType,
      this.position,
      this.parentDecoratorLinkHash,
      this.referencedTypeHash,
      this.nestedDecoratorHash,
      this.arrayIndex,
      this.startLine,
      this.endLine,
      this.isKeyword,
      this.isStarred,
      this.pyExpressionLinkHash,
      this.serviceVersionLinkHash,
      this.pyDecoratorArgumentUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'argumentName',
      'argumentValue',
      'valueType',
      'position',
      'parentDecoratorLinkHash',
      'referencedTypeHash',
      'nestedDecoratorHash',
      'arrayIndex',
      'startLine',
      'endLine',
      'isKeyword',
      'isStarred',
      'pyExpressionLinkHash',
      'serviceVersionLinkHash',
      'pyDecoratorArgumentUniqueHash',
    ].join('\t');
  }
}
