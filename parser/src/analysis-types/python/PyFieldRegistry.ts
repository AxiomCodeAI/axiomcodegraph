import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonFieldModifier,
  PythonFieldOrigin,
  PythonInitializerKind,
} from '@/enums/python/fields';
import { PythonMethodAccess } from '@/enums/python/methods';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One attribute of a class — declared in the class body, or recovered from
 * `self.x = …` inside a method.
 *
 * Python has no field declarations, and that single fact drives every unusual
 * column here. Three consequences worth stating, because each one is a place a
 * Java-shaped model gives the wrong answer:
 *
 * 1. **An attribute is a MERGED fact, not a syntactic one.** `self.buf` written
 *    in `__init__`, `reset` and `close` is *one* attribute with three write
 *    sites, so the PK is `(owner, name, origin)` and deliberately **not**
 *    line-based. `writeCount` and `writtenInMethodCount` preserve what the merge
 *    would otherwise destroy, and `writtenInMethodCount > 1` is the signal that
 *    matters: it means cross-method mutable state.
 * 2. **Only 67% of instance attributes are created in `__init__`.** A model that
 *    reads `__init__` alone misses a third of them, so `isDeclaredInInit` is
 *    recorded as an observation rather than assumed.
 * 3. **`self.x` has no binding.** CPython's symtable records `self` as a local
 *    and the attribute name nowhere at all — it is resolved at runtime through
 *    `__dict__`. So `bindingLinkHash` is populated for class-body fields and
 *    **empty** for `self.*`, which is not an omission but the modelling problem
 *    itself (§2.9 c25).
 *
 * `fieldOrigin` is part of identity for a real reason: a name can arrive by two
 * mechanisms in one class, and they are different facts.
 *
 * ```python
 * class Conn:
 *     retries = 3                 # CLASS_BODY_ASSIGN, CLASS_VAR
 *     host: str                   # CLASS_BODY_ANNOTATION_ONLY
 *     __slots__ = ("sock",)       # SLOTS_ENTRY -> sock
 *
 *     def __init__(self, host):
 *         self.host = host        # SELF_ASSIGN, INSTANCE_VAR — shadows the annotation
 *         self.retries += 1       # SELF_AUGASSIGN — reads the CLASS_VAR, writes an instance one
 * ```
 *
 * ## Column order (frozen — schema v6 §2.9, 29 columns)
 *
 * Positions 0–12 mirror `java_field` 0–12 so ported rules keep working.
 *
 * **PK** `PY_FIELD_md5(pyTypeLinkHash ‖ name ‖ fieldOrigin)`
 */
export class PyFieldRegistry implements EntityIdentifiable {
  private name: string;
  private fieldTypeName: string;
  private fieldBaseType: string;
  private potentialQualifiedName: string;
  private isAmbiguous: boolean;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private pyTypeLinkHash: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private fieldAccess: PythonMethodAccess;
  private fieldModifier: string;
  private fieldOrigin: PythonFieldOrigin;
  private declaringMethodLinkHash: string;
  private receiverName: string;
  private isDeclaredInInit: boolean;
  private writeCount: number;
  private writtenInMethodCount: number;
  private firstWriteLine: number;
  private hasAnnotation: boolean;
  private annotationIsString: boolean;
  private initializerText: string;
  private initializerKind: PythonInitializerKind;
  private pyModuleLinkHash: string;
  private bindingLinkHash: string;
  private pyExpressionLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyFieldUniqueHash: string = '';

  private constructor(builder: PyFieldRegistryBuilder) {
    this.name = builder.name;
    this.fieldTypeName = builder.fieldTypeName;
    this.fieldBaseType = builder.fieldBaseType;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.fieldAccess = builder.fieldAccess;
    this.fieldModifier = builder.fieldModifier;
    this.fieldOrigin = builder.fieldOrigin;
    this.declaringMethodLinkHash = builder.declaringMethodLinkHash;
    this.receiverName = builder.receiverName;
    this.isDeclaredInInit = builder.isDeclaredInInit;
    this.writeCount = builder.writeCount;
    this.writtenInMethodCount = builder.writtenInMethodCount;
    this.firstWriteLine = builder.firstWriteLine;
    this.hasAnnotation = builder.hasAnnotation;
    this.annotationIsString = builder.annotationIsString;
    this.initializerText = builder.initializerText;
    this.initializerKind = builder.initializerKind;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.bindingLinkHash = builder.bindingLinkHash;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    fieldOrigin: PythonFieldOrigin,
    pyTypeLinkHash: string,
    pyModuleLinkHash: string,
    filePath: string,
    startLine: number,
    serviceVersionLinkHash: string
  ): PyFieldRegistryBuilder {
    return new PyFieldRegistryBuilder(
      name,
      fieldOrigin,
      pyTypeLinkHash,
      pyModuleLinkHash,
      filePath,
      startLine,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getFieldTypeName(): string {
    return this.fieldTypeName;
  }

  getFieldBaseType(): string {
    return this.fieldBaseType;
  }

  getFieldOrigin(): PythonFieldOrigin {
    return this.fieldOrigin;
  }

  getFieldModifier(): string {
    return this.fieldModifier;
  }

  getFieldAccess(): PythonMethodAccess {
    return this.fieldAccess;
  }

  getPyTypeLinkHash(): string {
    return this.pyTypeLinkHash;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getDeclaringMethodLinkHash(): string {
    return this.declaringMethodLinkHash;
  }

  getReceiverName(): string {
    return this.receiverName;
  }

  getIsDeclaredInInit(): boolean {
    return this.isDeclaredInInit;
  }

  /** Distinct write sites merged into this row. */
  getWriteCount(): number {
    return this.writeCount;
  }

  /** Distinct methods writing it — `> 1` means cross-method state. */
  getWrittenInMethodCount(): number {
    return this.writtenInMethodCount;
  }

  getFirstWriteLine(): number {
    return this.firstWriteLine;
  }

  getHasAnnotation(): boolean {
    return this.hasAnnotation;
  }

  getInitializerKind(): PythonInitializerKind {
    return this.initializerKind;
  }

  getInitializerText(): string {
    return this.initializerText;
  }

  /** FK→`py_binding`; empty for `self.*`, where no binding exists. */
  getBindingLinkHash(): string {
    return this.bindingLinkHash;
  }

  getPyExpressionLinkHash(): string {
    return this.pyExpressionLinkHash;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getPotentialQualifiedName(): string {
    return this.potentialQualifiedName;
  }

  getIsAmbiguous(): boolean {
    return this.isAmbiguous;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyFieldUniqueHash(): string {
    return this.pyFieldUniqueHash;
  }

  getHash(): string {
    return this.pyFieldUniqueHash;
  }

  /**
   * Folds one further write into this row.
   *
   * Called when the same attribute is written again, which is the common case —
   * the merge is what makes this relation an attribute table rather than a write
   * log. `endLine` grows to the furthest write so the row spans them all, while
   * the initialiser columns stay pinned to the FIRST write, since that is the
   * one that establishes the attribute.
   */
  recordAdditionalWrite(line: number, methodHash: string, writingMethods: Set<string>): void {
    this.writeCount += 1;
    if (methodHash !== '') {
      writingMethods.add(methodHash);
    }
    this.writtenInMethodCount = writingMethods.size === 0 ? this.writtenInMethodCount : writingMethods.size;
    if (line > this.endLine) {
      this.endLine = line;
    }
  }

  /**
   * Marks the attribute as holding more than one kind of value.
   *
   * `self.result = []` in one method and `self.result = None` in another is not a
   * `list`, and a resolver that treats the first write as definitive would claim
   * `self.result.append(x)` reaches `list.append` — a confident wrong answer on
   * code where the attribute is often `None`. Column 4 exists for exactly this
   * (`java_field` parity), so a disagreement between writes is RECORDED rather
   * than silently resolved by write order.
   */
  /**
   * Links the field to the expression node of its FIRST write.
   *
   * Set after the fact because the field stage and the expression stage mint
   * their rows independently and are joined on the target's byte range. §2.10
   * removed `py_field_write` on the grounds that the write facts already live on
   * `py_expression`; this is the pointer that makes that true rather than merely
   * arguable.
   */
  setPyExpressionLinkHash(pyExpressionLinkHash: string): void {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
  }

  markAmbiguous(): void {
    this.isAmbiguous = true;
  }

  getFieldModifierIncludes(modifier: string): boolean {
    return this.fieldModifier.split(',').includes(modifier);
  }

  /** Marks a `@property` of the same name — a read of this attribute is a call. */
  addModifier(modifier: PythonFieldModifier): void {
    const parts = this.fieldModifier === '' ? [] : this.fieldModifier.split(',');
    if (!parts.includes(modifier)) {
      parts.push(modifier);
      this.fieldModifier = parts.join(',');
    }
  }

  /**
   * Adopts an annotation discovered after the row was created.
   *
   * `self.x: int = 0` in `__init__` and a bare `x: int` in the class body are the
   * same attribute annotated in two places; whichever is seen first wins, and
   * this lets the other contribute its type rather than being lost.
   */
  adoptAnnotation(fieldTypeName: string, fieldBaseType: string, annotationIsString: boolean): void {
    if (this.hasAnnotation) {
      return;
    }
    this.hasAnnotation = true;
    this.fieldTypeName = fieldTypeName;
    this.fieldBaseType = fieldBaseType;
    this.annotationIsString = annotationIsString;
  }

  generateHash(): void {
    const content = this.pyTypeLinkHash + '||' + this.name + '||' + this.fieldOrigin;

    this.pyFieldUniqueHash = EntityUtils.generateEntityHash(ENTITY_IDENTIFIERS.PY_FIELD, content);
  }

  getEntryCombined(): string {
    return `py_field[name=${this.name}, origin=${this.fieldOrigin}, owner=${this.ownerTypeName}, writes=${this.writeCount}, hash=${this.pyFieldUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.name,
      EntityUtils.escapeTsv(this.fieldTypeName),
      this.fieldBaseType,
      this.potentialQualifiedName,
      this.isAmbiguous,
      this.filePath,
      this.startLine,
      this.endLine,
      this.pyTypeLinkHash,
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.fieldAccess,
      this.fieldModifier,
      this.fieldOrigin,
      this.declaringMethodLinkHash,
      this.receiverName,
      this.isDeclaredInInit,
      this.writeCount,
      this.writtenInMethodCount,
      this.firstWriteLine,
      this.hasAnnotation,
      this.annotationIsString,
      EntityUtils.escapeTsv(this.initializerText),
      this.initializerKind,
      this.pyModuleLinkHash,
      this.bindingLinkHash,
      this.pyExpressionLinkHash,
      this.serviceVersionLinkHash,
      this.pyFieldUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'fieldTypeName',
      'fieldBaseType',
      'potentialQualifiedName',
      'isAmbiguous',
      'filePath',
      'startLine',
      'endLine',
      'pyTypeLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'fieldAccess',
      'fieldModifier',
      'fieldOrigin',
      'declaringMethodLinkHash',
      'receiverName',
      'isDeclaredInInit',
      'writeCount',
      'writtenInMethodCount',
      'firstWriteLine',
      'hasAnnotation',
      'annotationIsString',
      'initializerText',
      'initializerKind',
      'pyModuleLinkHash',
      'bindingLinkHash',
      'pyExpressionLinkHash',
      'serviceVersionLinkHash',
      'pyFieldUniqueHash',
    ].join('\t');
  }
}

export class PyFieldRegistryBuilder {
  name: string;
  fieldTypeName: string = '';
  fieldBaseType: string = '';
  potentialQualifiedName: string = '';
  isAmbiguous: boolean = false;
  filePath: string;
  startLine: number;
  endLine: number;
  pyTypeLinkHash: string;
  ownerTypeName: string = '';
  ownerQualifiedName: string = '';
  fieldAccess: PythonMethodAccess = PythonMethodAccess.PUBLIC_ACCESS;
  fieldModifier: string = '';
  fieldOrigin: PythonFieldOrigin;
  declaringMethodLinkHash: string = '';
  receiverName: string = '';
  isDeclaredInInit: boolean = false;
  writeCount: number = 1;
  writtenInMethodCount: number = 0;
  firstWriteLine: number;
  hasAnnotation: boolean = false;
  annotationIsString: boolean = false;
  initializerText: string = '';
  initializerKind: PythonInitializerKind = PythonInitializerKind.NONE;
  pyModuleLinkHash: string;
  bindingLinkHash: string = '';
  pyExpressionLinkHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    fieldOrigin: PythonFieldOrigin,
    pyTypeLinkHash: string,
    pyModuleLinkHash: string,
    filePath: string,
    startLine: number,
    serviceVersionLinkHash: string
  ) {
    this.name = name;
    this.fieldOrigin = fieldOrigin;
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = startLine;
    this.firstWriteLine = startLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withEndLine(endLine: number): this {
    this.endLine = endLine;
    return this;
  }

  withOwner(ownerTypeName: string, ownerQualifiedName: string): this {
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    return this;
  }

  withAccess(fieldAccess: PythonMethodAccess): this {
    this.fieldAccess = fieldAccess;
    return this;
  }

  withModifier(fieldModifier: string): this {
    this.fieldModifier = fieldModifier;
    return this;
  }

  withAnnotation(
    fieldTypeName: string,
    fieldBaseType: string,
    annotationIsString: boolean
  ): this {
    this.hasAnnotation = fieldTypeName !== '';
    this.fieldTypeName = fieldTypeName;
    this.fieldBaseType = fieldBaseType;
    this.annotationIsString = annotationIsString;
    return this;
  }

  withPotentialQualifiedName(potentialQualifiedName: string, isAmbiguous: boolean): this {
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  withDeclaringMethod(declaringMethodLinkHash: string, isDeclaredInInit: boolean): this {
    this.declaringMethodLinkHash = declaringMethodLinkHash;
    this.isDeclaredInInit = isDeclaredInInit;
    return this;
  }

  withReceiverName(receiverName: string): this {
    this.receiverName = receiverName;
    return this;
  }

  withWriteCounts(writeCount: number, writtenInMethodCount: number): this {
    this.writeCount = writeCount;
    this.writtenInMethodCount = writtenInMethodCount;
    return this;
  }

  withInitializer(initializerText: string, initializerKind: PythonInitializerKind): this {
    this.initializerText = initializerText;
    this.initializerKind = initializerKind;
    return this;
  }

  withBindingLinkHash(bindingLinkHash: string): this {
    this.bindingLinkHash = bindingLinkHash;
    return this;
  }

  withPyExpressionLinkHash(pyExpressionLinkHash: string): this {
    this.pyExpressionLinkHash = pyExpressionLinkHash;
    return this;
  }

  build(): PyFieldRegistry {
    return new (PyFieldRegistry as unknown as {
      new (builder: PyFieldRegistryBuilder): PyFieldRegistry;
    })(this);
  }
}
