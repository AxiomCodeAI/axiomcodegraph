import Parser from 'tree-sitter';

import { PYTHON_BUILTIN_TYPE_METHODS } from '@/constants/python-constants';

import {
  PyFieldPositionRegistry,
  PyFieldRegistry,
  PyMethodRegistry,
  PyModuleRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import {
  PythonFieldModifier,
  PythonFieldOrigin,
  PythonInitializerKind,
} from '@/enums/python/fields';
import { PythonMethodAccess } from '@/enums/python/methods';
import { PythonMethodKind } from '@/enums/python/methods';
import {
  PythonTypeRefContext,
  PythonTypeRefOwnerKind,
} from '@/enums/python/type-references';
import type { TypePositionInput } from '@/parsers/python/extractors/python-type-reference-extractor';
import { PythonSourcePositions } from '@/utils/python/python-position-utils';

/** Everything the field stage produces for one module. */
export interface PythonFieldExtraction {
  fields: PyFieldRegistry[];
  fieldPositions: PyFieldPositionRegistry[];
  /**
   * `(pyTypeLinkHash, attributeName)` -> `py_field` PK.
   *
   * The join key schema §2.10 names when it deleted `py_field_write`: linking a
   * write expression to its merged field row is a resolution rule, not a stored
   * fact. This is that rule's index.
   */
  fieldHashByTypeAndName: Map<string, string>;
  /** `py_field` PK -> its first write target's `startIndex:endIndex`. */
  targetByteRangeByField: Map<string, string>;
  /**
   * `py_field` PK -> the row, so a resolver can read the attribute's type
   * without re-scanning the list.
   */
  fieldByHash: Map<string, PyFieldRegistry>;
  /**
   * `py_method` PK -> that method's receiver parameter name.
   *
   * Needed to tell `self.conn.send()` from `other.conn.send()`: only the first
   * is an attribute of the enclosing class, and the receiver is not always
   * called `self`.
   */
  receiverNameByMethodHash: Map<string, string>;
}

export interface PythonFieldInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  filePath: string;
  serviceVersionLinkHash: string;
  types: PyTypeRegistry[];
  methods: PyMethodRegistry[];
  typeHashByNodeId: Map<number, string>;
  methodHashByNodeId: Map<number, string>;
  scopeHashByNodeId: Map<number, string>;
  bindingHashByScopeAndName: Map<string, string>;
  positions: PythonSourcePositions;
}

/** One observed write, before writes are merged into a field row. */
interface WriteObservation {
  name: string;
  /**
   * The builtin type this write produces, if any — `list` for `[]`.
   *
   * Kept per observation so the merge can notice two writes DISAGREEING, which
   * is the difference between an attribute that is a `list` and one that is
   * sometimes a `list` and sometimes `None`.
   */
  writtenBuiltinType: string;
  origin: PythonFieldOrigin;
  line: number;
  endLine: number;
  methodHash: string;
  methodName: string;
  receiverName: string;
  annotationText: string;
  annotationIsString: boolean;
  /** The annotation NODE, needed to build the py_type_reference tree. */
  annotationNode: Parser.SyntaxNode | null;
  initializerText: string;
  initializerKind: PythonInitializerKind;
  bindingHash: string;
  targetByteRange: string;
  /** Class-body declaration order, or `-1` for a `self.*` write. */
  declarationPosition: number;
}

/** What a class contributes, gathered before any row is minted. */
interface ClassCollection {
  typeHash: string;
  /** The class body's `py_scope` PK — where a class-body attribute IS a binding. */
  classScopeHash: string;
  typeName: string;
  qualifiedName: string;
  observations: WriteObservation[];
  propertyNames: Set<string>;
  slotNames: Set<string>;
  isDataclass: boolean;
  isNamedTuple: boolean;
  isTypedDict: boolean;
  isEnum: boolean;
}

const INIT_METHOD_NAMES = new Set(['__init__', '__new__', '__post_init__']);

/**
 * Recovers class attributes and instance attributes.
 *
 * Python has no field declarations, so this stage does what a Java parser gets
 * for free: it works out which attributes a class has by looking at every place
 * one is WRITTEN, and merges those writes into one row per attribute.
 *
 * ## Why this is a separate stage
 *
 * The declaration stage walks declarations, and an attribute is not one. There
 * is no `field_definition` node to visit — `self.buf = b""` is an assignment
 * statement whose target happens to be an attribute of the first parameter, and
 * recognising it requires knowing which parameter that is. That test needs the
 * `py_method` rows, so this runs after them.
 *
 * ## The merge, and what it must not destroy
 *
 * ```python
 * class Buffer:
 *     limit = 4096                    # class body
 *     def __init__(self):
 *         self.data = bytearray()     # first write — establishes it
 *     def reset(self):
 *         self.data = bytearray()     # second write, second method
 * ```
 *
 * `data` is ONE attribute with `writeCount=2` and `writtenInMethodCount=2`.
 * The second number is the one worth having: `> 1` means the attribute is
 * mutable state shared across methods, which is exactly the shape a data-flow
 * rule needs to notice. The initialiser columns stay pinned to the first write,
 * because that is the write that establishes the attribute; `endLine` grows to
 * cover them all.
 *
 * ## Names are mangled, matching CPython
 *
 * `self.__x` inside `class C` stores `_C__x` — mangling applies to attribute
 * names, not just to locals. This stage stores the mangled name, so `name`
 * equals the runtime `__dict__` key and matches what `py_binding` already does.
 * The alternative, storing `__x`, would let a reference from a DIFFERENT class
 * match this field, which at runtime raises `AttributeError`.
 */
export class PythonFieldExtractor {
  private input!: PythonFieldInput;
  private methodByNodeId = new Map<number, PyMethodRegistry>();
  private receiverNameByMethodHash = new Map<string, string>();
  private dictAliases = new Set<string>();
  private annotationByField = new Map<
    string,
    { node: Parser.SyntaxNode; typeHash: string; scopeHash: string }
  >();
  private targetByteRangeByField = new Map<string, string>();

  extract(input: PythonFieldInput): PythonFieldExtraction {
    this.input = input;
    this.methodByNodeId = new Map();

    const methodByHash = new Map<string, PyMethodRegistry>();
    for (const method of input.methods) {
      methodByHash.set(method.getHash(), method);
    }
    for (const [nodeId, hash] of input.methodHashByNodeId) {
      const method = methodByHash.get(hash);
      if (method) {
        this.methodByNodeId.set(nodeId, method);
      }
    }

    const typeByHash = new Map<string, PyTypeRegistry>();
    for (const type of input.types) {
      typeByHash.set(type.getHash(), type);
    }

    this.targetByteRangeByField = new Map();
    const fields: PyFieldRegistry[] = [];
    const fieldPositions: PyFieldPositionRegistry[] = [];
    const fieldHashByTypeAndName = new Map<string, string>();
    const fieldByHash = new Map<string, PyFieldRegistry>();
    const targetByteRangeByField = new Map<string, string>();
    this.receiverNameByMethodHash = new Map();

    for (const classNode of this.findClassNodes(input.rootNode)) {
      const typeHash = input.typeHashByNodeId.get(classNode.id);
      if (!typeHash) {
        continue;
      }
      const type = typeByHash.get(typeHash);
      if (!type) {
        continue;
      }
      const collection = this.collectClass(classNode, typeHash, type);
      this.mintFields(collection, fields, fieldPositions, fieldHashByTypeAndName);
    }

    for (const field of fields) {
      fieldByHash.set(field.getHash(), field);
    }

    const fieldTypePositions: TypePositionInput[] = [];
    for (const field of fields) {
      const annotation = this.annotationByField.get(field.getHash());
      if (annotation === undefined) {
        continue;
      }
      fieldTypePositions.push({
        node: annotation.node,
        context: PythonTypeRefContext.FIELD_TYPE,
        ownerHash: field.getHash(),
        ownerKind: PythonTypeRefOwnerKind.FIELD,
        enclosingTypeHash: annotation.typeHash,
        scopeHash: annotation.scopeHash,
      });
    }

    return {
      fields,
      fieldTypePositions,
      fieldPositions,
      fieldHashByTypeAndName,
      fieldByHash,
      receiverNameByMethodHash: this.receiverNameByMethodHash,
      targetByteRangeByField: this.targetByteRangeByField,
    };
  }

  /** Every `class_definition` in the file, including nested ones. */
  private findClassNodes(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const found: Parser.SyntaxNode[] = [];
    const worklist: Parser.SyntaxNode[] = [root];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'class_definition') {
        found.push(node);
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return found;
  }

  // ---- collection ------------------------------------------------------

  private collectClass(
    classNode: Parser.SyntaxNode,
    typeHash: string,
    type: PyTypeRegistry
  ): ClassCollection {
    const collection: ClassCollection = {
      typeHash,
      classScopeHash: this.input.scopeHashByNodeId.get(classNode.id) ?? '',
      typeName: type.getName(),
      qualifiedName: type.getQualifiedName(),
      observations: [],
      propertyNames: new Set<string>(),
      slotNames: new Set<string>(),
      isDataclass: this.hasDataclassDecorator(classNode),
      isNamedTuple: this.hasBaseNamed(classNode, ['NamedTuple']),
      isTypedDict: this.hasBaseNamed(classNode, ['TypedDict']),
      isEnum: this.hasBaseNamed(classNode, ['Enum', 'IntEnum', 'StrEnum', 'Flag', 'IntFlag']),
    };

    const body = classNode.childForFieldName('body');
    if (!body) {
      return collection;
    }

    this.collectClassBody(body, collection);
    this.collectMethodBodies(body, collection);
    return collection;
  }

  /**
   * Walks the class body's own statements.
   *
   * Only DIRECT statements count as declarations. A statement nested inside a
   * method belongs to that method, and one inside a nested class belongs to the
   * nested class — both are visited separately, so descending here would attach
   * the attribute to the wrong owner.
   */
  private collectClassBody(body: Parser.SyntaxNode, collection: ClassCollection): void {
    let position = 0;
    const statements: Parser.SyntaxNode[] = [];
    for (let index = 0; index < body.namedChildCount; index += 1) {
      const child = body.namedChild(index);
      if (child && !child.isExtra) {
        statements.push(child);
      }
    }

    for (const statement of statements) {
      // A class-body assignment can be guarded — `if sys.platform == "win32":
      // FLAG = 1` inside a class body is a real class attribute. Descend through
      // compound statements, but never into a def or a nested class.
      for (const inner of this.classLevelStatements(statement)) {
        if (inner.type !== 'expression_statement') {
          continue;
        }
        for (let index = 0; index < inner.namedChildCount; index += 1) {
          const assignment = inner.namedChild(index);
          if (!assignment || assignment.isExtra) {
            continue;
          }
          const consumed = this.collectClassBodyAssignment(assignment, collection, position);
          position += consumed;
        }
      }
    }
  }

  /**
   * Flattens a class-body statement to the statements that can declare an
   * attribute, stopping at any nested scope.
   */
  private classLevelStatements(statement: Parser.SyntaxNode): Parser.SyntaxNode[] {
    if (statement.type === 'expression_statement') {
      return [statement];
    }
    const nested = new Set<string>([
      'function_definition',
      'decorated_definition',
      'class_definition',
    ]);
    if (nested.has(statement.type)) {
      return [];
    }
    const found: Parser.SyntaxNode[] = [];
    const worklist: Parser.SyntaxNode[] = [statement];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'expression_statement') {
        found.push(node);
        continue;
      }
      if (nested.has(node.type)) {
        continue;
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return found;
  }

  /**
   * Records one class-body assignment. Returns how many declaration positions
   * it consumed, since `x = y = 1` declares two attributes.
   */
  private collectClassBodyAssignment(
    assignment: Parser.SyntaxNode,
    collection: ClassCollection,
    startPosition: number
  ): number {
    if (assignment.type !== 'assignment') {
      return 0;
    }

    const left = assignment.childForFieldName('left');
    const right = assignment.childForFieldName('right');
    const annotation = assignment.childForFieldName('type');
    if (!left) {
      return 0;
    }

    if (this.isSlotsTarget(left) && right) {
      this.collectSlots(right, collection);
      return 0;
    }

    const targets = this.assignmentTargets(left);
    let consumed = 0;
    for (const target of targets) {
      const rawName = target.text;
      if (rawName === '' || rawName === '__slots__') {
        continue;
      }
      const name = this.mangle(collection.typeName, rawName);
      const hasValue = right !== null && right !== undefined;
      const origin = this.classBodyOrigin(collection, hasValue, annotation !== null);
      collection.observations.push({
        name,
        origin,
        line: target.startPosition.row,
        endLine: assignment.endPosition.row,
        methodHash: '',
        methodName: '',
        receiverName: '',
        annotationText: annotation ? this.normalizeText(annotation.text) : '',
        annotationIsString: annotation ? this.isStringAnnotation(annotation) : false,
        annotationNode: annotation,
        initializerText: right ? this.normalizeText(right.text) : '',
        initializerKind: right ? this.initializerKindOf(right) : PythonInitializerKind.NONE,
        writtenBuiltinType: right ? this.builtinTypeOfValue(right) : '',
        bindingHash: this.classBodyBinding(collection, name),
        targetByteRange: `${target.startIndex}:${target.endIndex}`,
        declarationPosition: startPosition + consumed,
      });
      consumed += 1;
    }
    return consumed;
  }

  /** `__slots__ = ("a", "b")` declares two attributes, one per string. */
  private collectSlots(value: Parser.SyntaxNode, collection: ClassCollection): void {
    const worklist: Parser.SyntaxNode[] = [value];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'string') {
        const literal = this.stringLiteralValue(node);
        if (literal !== '') {
          collection.slotNames.add(this.mangle(collection.typeName, literal));
          collection.observations.push({
            name: this.mangle(collection.typeName, literal),
            origin: PythonFieldOrigin.SLOTS_ENTRY,
            line: node.startPosition.row,
            endLine: node.endPosition.row,
            methodHash: '',
            methodName: '',
            receiverName: '',
            annotationText: '',
            annotationIsString: false,
            annotationNode: null,
            initializerText: '',
            initializerKind: PythonInitializerKind.NONE,
            writtenBuiltinType: '',
            bindingHash: '',
            targetByteRange: `${node.startIndex}:${node.endIndex}`,
            declarationPosition: -1,
          });
        }
        continue;
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
  }

  /**
   * Walks the methods of this class looking for writes through the receiver.
   *
   * The receiver name is taken from the method's OWN first parameter rather than
   * assumed to be `self`: `def f(this, x): this.y = x` is legal and binds an
   * attribute, and 2.4% of stdlib methods use a name other than `self`.
   */
  private collectMethodBodies(body: Parser.SyntaxNode, collection: ClassCollection): void {
    for (let index = 0; index < body.namedChildCount; index += 1) {
      const statement = body.namedChild(index);
      if (!statement || statement.isExtra) {
        continue;
      }
      const definition = this.unwrapDecorated(statement);
      if (!definition || definition.type !== 'function_definition') {
        continue;
      }

      const method = this.methodByNodeId.get(definition.id);
      const methodName = definition.childForFieldName('name')?.text ?? '';
      if (method && this.isProperty(method)) {
        collection.propertyNames.add(this.mangle(collection.typeName, methodName));
      }

      const receiverName = this.receiverNameOf(definition, method);
      if (receiverName === '') {
        continue;
      }
      if (method) {
        this.receiverNameByMethodHash.set(method.getHash(), receiverName);
      }
      const methodBody = definition.childForFieldName('body');
      if (!methodBody) {
        continue;
      }
      this.collectReceiverWrites(
        methodBody,
        collection,
        method ? method.getHash() : '',
        methodName,
        receiverName
      );
    }
  }

  /**
   * Finds every write to `<receiver>.<name>` in one method body.
   *
   * Descends into nested functions on purpose: a closure inside `__init__` that
   * sets `self.done = True` writes the SAME attribute, and attributing it to the
   * closure rather than dropping it is the point. It stops at a nested class,
   * whose methods have their own receiver.
   */
  private collectReceiverWrites(
    methodBody: Parser.SyntaxNode,
    collection: ClassCollection,
    methodHash: string,
    methodName: string,
    receiverName: string
  ): void {
    this.dictAliases = this.collectDictAliases(methodBody, receiverName);

    const worklist: Parser.SyntaxNode[] = [methodBody];
    while (worklist.length > 0) {
      const node = worklist.shift()!;

      if (node.type === 'class_definition') {
        continue;
      }

      this.recordWritesIn(node, collection, methodHash, methodName, receiverName);

      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
  }

  /** Dispatches one statement to the write shapes that can bind an attribute. */
  private recordWritesIn(
    node: Parser.SyntaxNode,
    collection: ClassCollection,
    methodHash: string,
    methodName: string,
    receiverName: string
  ): void {
    switch (node.type) {
      case 'assignment': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const annotation = node.childForFieldName('type');
        if (!left) {
          return;
        }
        const dictName = this.instanceDictKey(left, receiverName);
        if (dictName !== '') {
          this.pushAttributeWrite(
            left,
            node,
            collection,
            methodHash,
            methodName,
            receiverName,
            annotation ?? null,
            right ?? null,
            PythonFieldOrigin.SELF_ASSIGN,
            dictName
          );
          return;
        }
        const targets = this.attributeTargets(left, receiverName);
        // `self.a, self.b = pair` — the value is one ELEMENT of the RHS, not the
        // whole thing, so claiming the tuple as each attribute's initialiser
        // would be wrong. Only a sole target owns the RHS.
        const soleTarget = targets.length === 1 && this.attributeTargets(left, receiverName).length === 1;
        for (const target of targets) {
          const valueNode = soleTarget ? right : null;
          this.pushAttributeWrite(
            target,
            node,
            collection,
            methodHash,
            methodName,
            receiverName,
            annotation ?? null,
            valueNode ?? null,
            annotation ? PythonFieldOrigin.SELF_ASSIGN : PythonFieldOrigin.SELF_ASSIGN
          );
        }
        return;
      }
      case 'augmented_assignment': {
        const left = node.childForFieldName('left');
        if (!left) {
          return;
        }
        for (const target of this.attributeTargets(left, receiverName)) {
          this.pushAttributeWrite(
            target,
            node,
            collection,
            methodHash,
            methodName,
            receiverName,
            null,
            null,
            PythonFieldOrigin.SELF_AUGASSIGN
          );
        }
        return;
      }
      case 'for_statement': {
        const left = node.childForFieldName('left');
        if (!left) {
          return;
        }
        for (const target of this.attributeTargets(left, receiverName)) {
          this.pushAttributeWrite(
            target,
            node,
            collection,
            methodHash,
            methodName,
            receiverName,
            null,
            null,
            PythonFieldOrigin.SELF_ASSIGN
          );
        }
        return;
      }
      case 'as_pattern': {
        // `with open(p) as self.fh:` — the alias sits in an as_pattern whose
        // target is an attribute.
        const alias = node.namedChild(node.namedChildCount - 1);
        if (!alias) {
          return;
        }
        for (const target of this.attributeTargets(alias, receiverName)) {
          this.pushAttributeWrite(
            target,
            node,
            collection,
            methodHash,
            methodName,
            receiverName,
            null,
            null,
            PythonFieldOrigin.SELF_ASSIGN
          );
        }
        return;
      }
      case 'call': {
        this.recordSetattr(node, collection, methodHash, methodName, receiverName);
        return;
      }
      default: {
        return;
      }
    }
  }

  /**
   * Records `setattr(self, "flag", value)`.
   *
   * Only the constant-name form is recorded. `setattr(self, name, value)` with a
   * computed name creates an attribute whose identity is not statically known,
   * and inventing a row named `name` would assert an attribute that does not
   * exist.
   */
  private recordSetattr(
    call: Parser.SyntaxNode,
    collection: ClassCollection,
    methodHash: string,
    methodName: string,
    receiverName: string
  ): void {
    const callee = call.childForFieldName('function');
    if (!callee || callee.text !== 'setattr') {
      return;
    }
    const args = call.childForFieldName('arguments');
    if (!args) {
      return;
    }
    const positional: Parser.SyntaxNode[] = [];
    for (let index = 0; index < args.namedChildCount; index += 1) {
      const child = args.namedChild(index);
      if (child && !child.isExtra) {
        positional.push(child);
      }
    }
    if (positional.length < 2) {
      return;
    }
    if (positional[0]!.text !== receiverName) {
      return;
    }
    if (positional[1]!.type !== 'string') {
      return;
    }
    const literal = this.stringLiteralValue(positional[1]!);
    if (literal === '') {
      return;
    }
    const value = positional.length > 2 ? positional[2]! : null;
    collection.observations.push({
      name: this.mangle(collection.typeName, literal),
      origin: PythonFieldOrigin.SETATTR_DYNAMIC,
      line: call.startPosition.row,
      endLine: call.endPosition.row,
      methodHash,
      methodName,
      receiverName,
      annotationText: '',
      annotationIsString: false,
      annotationNode: null,
      initializerText: value ? this.normalizeText(value.text) : '',
      initializerKind: value ? this.initializerKindOf(value) : PythonInitializerKind.NONE,
      writtenBuiltinType: value ? this.builtinTypeOfValue(value) : '',
      bindingHash: '',
      targetByteRange: `${positional[1]!.startIndex}:${positional[1]!.endIndex}`,
      declarationPosition: -1,
    });
  }

  private pushAttributeWrite(
    target: Parser.SyntaxNode,
    statement: Parser.SyntaxNode,
    collection: ClassCollection,
    methodHash: string,
    methodName: string,
    receiverName: string,
    annotation: Parser.SyntaxNode | null,
    value: Parser.SyntaxNode | null,
    origin: PythonFieldOrigin,
    nameOverride = ''
  ): void {
    const attributeName = target.childForFieldName('attribute');
    if (!attributeName && nameOverride === '') {
      return;
    }
    collection.observations.push({
      name: this.mangle(collection.typeName, nameOverride || attributeName!.text),
      origin,
      line: target.startPosition.row,
      endLine: statement.endPosition.row,
      methodHash,
      methodName,
      receiverName,
      annotationText: annotation ? this.normalizeText(annotation.text) : '',
      annotationIsString: annotation ? this.isStringAnnotation(annotation) : false,
      annotationNode: annotation,
      initializerText: value ? this.normalizeText(value.text) : '',
      initializerKind: value ? this.initializerKindOf(value) : PythonInitializerKind.NONE,
      writtenBuiltinType: value ? this.builtinTypeOfValue(value) : '',
      // Schema §2.9 c25: no binding exists for `self.x`. CPython's symtable
      // records `self` as a local and the attribute name NOWHERE — it lives in
      // the instance `__dict__`, resolved at runtime. Empty here is the
      // modelling problem, not an omission.
      bindingHash: '',
      targetByteRange: `${target.startIndex}:${target.endIndex}`,
      declarationPosition: -1,
    });
  }

  // ---- minting ---------------------------------------------------------

  /**
   * Merges the observations for one class into `py_field` rows.
   *
   * Merge key is `(name, origin)`, matching the PK. Origin is part of it because
   * a class attribute and an instance attribute of the same name are genuinely
   * two facts: `limit = 4096` in the body and `self.limit = n` in `__init__`
   * produce two rows, and the engine needs both to reason about which one a read
   * sees.
   */
  private mintFields(
    collection: ClassCollection,
    fields: PyFieldRegistry[],
    fieldPositions: PyFieldPositionRegistry[],
    fieldHashByTypeAndName: Map<string, string>
  ): void {
    const byKey = new Map<string, PyFieldRegistry>();
    const writtenTypesByKey = new Map<string, Set<string>>();
    const writingMethodsByKey = new Map<string, Set<string>>();
    const positionByKey = new Map<string, number>();
    const ordered: PyFieldRegistry[] = [];

    for (const observation of collection.observations) {
      const key = observation.name + '||' + observation.origin;
      const existing = byKey.get(key);
      if (existing) {
        // Two writes of different builtin types make the attribute's type
        // ambiguous, and a resolver must refuse rather than take the first.
        if (observation.writtenBuiltinType !== '') {
          const seen = writtenTypesByKey.get(key)!;
          seen.add(observation.writtenBuiltinType);
          if (seen.size > 1) {
            existing.markAmbiguous();
          }
        }
        const writers = writingMethodsByKey.get(key)!;
        existing.recordAdditionalWrite(observation.endLine, observation.methodHash, writers);
        if (observation.annotationText !== '') {
          existing.adoptAnnotation(
            observation.annotationText,
            this.baseTypeOf(observation.annotationText),
            observation.annotationIsString
          );
          this.recordFieldAnnotation(existing.getHash(), observation, collection);
        }
        continue;
      }

      const field = this.buildField(collection, observation);
      this.recordFieldAnnotation(field.getHash(), observation, collection);
      this.targetByteRangeByField.set(field.getHash(), observation.targetByteRange);
      byKey.set(key, field);
      writtenTypesByKey.set(
        key,
        observation.writtenBuiltinType === ''
          ? new Set<string>()
          : new Set<string>([observation.writtenBuiltinType])
      );
      const writers = new Set<string>();
      if (observation.methodHash !== '') {
        writers.add(observation.methodHash);
      }
      writingMethodsByKey.set(key, writers);
      if (observation.declarationPosition >= 0) {
        positionByKey.set(key, observation.declarationPosition);
      }
      ordered.push(field);
    }

    // Modifiers that depend on the whole class are applied after the merge:
    // whether a `@property` of the same name exists, and whether the name is a
    // slot, are facts about the class rather than about one write.
    for (const [key, field] of byKey) {
      if (collection.propertyNames.has(field.getName())) {
        field.addModifier(PythonFieldModifier.PROPERTY_BACKED);
      }
      if (
        collection.slotNames.has(field.getName()) &&
        field.getFieldOrigin() !== PythonFieldOrigin.SLOTS_ENTRY
      ) {
        field.addModifier(PythonFieldModifier.SLOT);
      }
      if (field.getWriteCount() === 1 && field.getFieldOrigin() !== PythonFieldOrigin.SELF_AUGASSIGN) {
        field.addModifier(PythonFieldModifier.READ_ONLY);
      }

    }

    // Positions are assigned over ALL fields, class-body declarations first in
    // declaration order and then method-recovered attributes in first-write
    // order, so the relation is 1:1 with `py_field` as it is in Java. Restricting
    // it to class-body fields dropped exactly the rows a constructor-argument
    // rule needs, since Python's constructor-assigned fields are SELF_ASSIGN.
    const positioned = [...ordered].sort((left, right) => {
      const leftDeclared = positionByKey.get(left.getName() + '||' + left.getFieldOrigin());
      const rightDeclared = positionByKey.get(right.getName() + '||' + right.getFieldOrigin());
      if (leftDeclared !== undefined && rightDeclared !== undefined) {
        return leftDeclared - rightDeclared;
      }
      if (leftDeclared !== undefined) {
        return -1;
      }
      if (rightDeclared !== undefined) {
        return 1;
      }
      return left.getFirstWriteLine() - right.getFirstWriteLine();
    });
    positioned.forEach((field, index) => {
      fieldPositions.push(
        new PyFieldPositionRegistry(collection.typeHash, field.getHash(), index)
      );
    });

    for (const field of ordered) {
      fields.push(field);
      const joinKey = collection.typeHash + '||' + field.getName();
      // A class attribute and an instance attribute share a name. The join key
      // keeps the INSTANCE one, which is what an attribute read through a
      // receiver actually reaches at runtime.
      const incumbent = fieldHashByTypeAndName.get(joinKey);
      if (!incumbent || this.isInstanceOrigin(field.getFieldOrigin())) {
        fieldHashByTypeAndName.set(joinKey, field.getHash());
      }
    }
  }

  private buildField(
    collection: ClassCollection,
    observation: WriteObservation
  ): PyFieldRegistry {
    const modifiers = this.modifiersFor(collection, observation);
    const builder = PyFieldRegistry.builder(
      observation.name,
      observation.origin,
      collection.typeHash,
      this.input.module.getHash(),
      this.input.filePath,
      observation.line,
      this.input.serviceVersionLinkHash
    )
      .withEndLine(observation.endLine)
      .withOwner(collection.typeName, collection.qualifiedName)
      .withAccess(this.accessOf(observation.name))
      .withModifier(modifiers.join(','))
      .withAnnotation(
        observation.annotationText,
        this.baseTypeOf(observation.annotationText),
        observation.annotationIsString
      )
      .withReceiverName(observation.receiverName)
      .withInitializer(observation.initializerText, observation.initializerKind)
      .withBindingLinkHash(observation.bindingHash)
      .withDeclaringMethod(observation.methodHash, INIT_METHOD_NAMES.has(observation.methodName))
      .withWriteCounts(1, observation.methodHash === '' ? 0 : 1);

    if (observation.annotationText !== '') {
      builder.withPotentialQualifiedName(
        collection.qualifiedName + '.' + observation.name,
        false
      );
    }

    return builder.build();
  }

  /**
   * Works out `fieldModifier` for one attribute.
   *
   * `CLASS_VAR` versus `INSTANCE_VAR` follows the ORIGIN rather than the
   * annotation, with one exception the language forces: `ClassVar[int]` on a
   * class-body entry says explicitly that it is not an instance attribute, and
   * `dataclass` uses precisely that to decide what to leave out of the generated
   * `__init__`.
   */
  private modifiersFor(collection: ClassCollection, observation: WriteObservation): string[] {
    const modifiers: string[] = [];
    const annotation = observation.annotationText;
    const isClassBody =
      observation.origin === PythonFieldOrigin.CLASS_BODY_ASSIGN ||
      observation.origin === PythonFieldOrigin.CLASS_BODY_ANNOTATION_ONLY ||
      observation.origin === PythonFieldOrigin.DATACLASS_FIELD ||
      observation.origin === PythonFieldOrigin.NAMEDTUPLE_FIELD ||
      observation.origin === PythonFieldOrigin.TYPEDDICT_KEY ||
      observation.origin === PythonFieldOrigin.ENUM_MEMBER;

    if (observation.origin === PythonFieldOrigin.SLOTS_ENTRY) {
      modifiers.push(PythonFieldModifier.SLOT);
      modifiers.push(PythonFieldModifier.INSTANCE_VAR);
    } else if (isClassBody) {
      modifiers.push(PythonFieldModifier.CLASS_VAR);
    } else {
      modifiers.push(PythonFieldModifier.INSTANCE_VAR);
    }

    if (annotation.startsWith('ClassVar')) {
      modifiers.push(PythonFieldModifier.CLASSVAR_ANNOTATED);
    }
    if (annotation.startsWith('Final')) {
      modifiers.push(PythonFieldModifier.FINAL);
    }
    if (
      observation.initializerKind === PythonInitializerKind.CALL &&
      observation.initializerText.startsWith('field(')
    ) {
      modifiers.push(PythonFieldModifier.DATACLASS_FIELD);
    }
    if (observation.origin === PythonFieldOrigin.DATACLASS_FIELD) {
      modifiers.push(PythonFieldModifier.DATACLASS_FIELD);
    }
    if (observation.origin === PythonFieldOrigin.ENUM_MEMBER) {
      modifiers.push(PythonFieldModifier.ENUM_MEMBER);
    }
    if (collection.isDataclass && isClassBody && !modifiers.includes(PythonFieldModifier.DATACLASS_FIELD)) {
      modifiers.push(PythonFieldModifier.DATACLASS_FIELD);
    }
    return modifiers;
  }

  // ---- shape helpers ---------------------------------------------------

  /**
   * Which origin a class-body entry gets.
   *
   * The class's own shape decides: a `@dataclass` body declares dataclass
   * fields, a `TypedDict` body declares keys, an `Enum` body declares members.
   * These are different facts with different runtime behaviour — an enum member
   * becomes an instance of the enum class, and a TypedDict key never exists as
   * an attribute at all.
   */
  private classBodyOrigin(
    collection: ClassCollection,
    hasValue: boolean,
    hasAnnotation: boolean
  ): PythonFieldOrigin {
    if (collection.isTypedDict && hasAnnotation) {
      return PythonFieldOrigin.TYPEDDICT_KEY;
    }
    if (collection.isNamedTuple && hasAnnotation) {
      return PythonFieldOrigin.NAMEDTUPLE_FIELD;
    }
    if (collection.isDataclass && hasAnnotation) {
      return PythonFieldOrigin.DATACLASS_FIELD;
    }
    if (collection.isEnum && hasValue && !hasAnnotation) {
      return PythonFieldOrigin.ENUM_MEMBER;
    }
    if (!hasValue) {
      return PythonFieldOrigin.CLASS_BODY_ANNOTATION_ONLY;
    }
    return PythonFieldOrigin.CLASS_BODY_ASSIGN;
  }

  private isInstanceOrigin(origin: PythonFieldOrigin): boolean {
    return (
      origin === PythonFieldOrigin.SELF_ASSIGN ||
      origin === PythonFieldOrigin.SELF_AUGASSIGN ||
      origin === PythonFieldOrigin.SLOTS_ENTRY ||
      origin === PythonFieldOrigin.SETATTR_DYNAMIC
    );
  }

  /** Bare names on the left of a class-body assignment. */
  private assignmentTargets(left: Parser.SyntaxNode): Parser.SyntaxNode[] {
    if (left.type === 'identifier') {
      return [left];
    }
    const found: Parser.SyntaxNode[] = [];
    const worklist: Parser.SyntaxNode[] = [left];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'identifier') {
        found.push(node);
        continue;
      }
      // An attribute or subscript on the left of a class-body assignment is not
      // a declaration of this class: `Config.registry["k"] = v` mutates
      // something else.
      if (
        node.type === 'attribute' ||
        node.type === 'subscript'
      ) {
        continue;
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return found;
  }

  /**
   * `attribute` nodes on the left of a write whose object is the receiver.
   *
   * The object test is exact: `self.x` counts, and `self.inner.x` does not —
   * that writes an attribute of whatever `self.inner` is, which is a different
   * class. Claiming it here would attach a stranger's attribute to this one.
   */
  private attributeTargets(left: Parser.SyntaxNode, receiverName: string): Parser.SyntaxNode[] {
    const found: Parser.SyntaxNode[] = [];
    const worklist: Parser.SyntaxNode[] = [left];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'attribute') {
        const object = node.childForFieldName('object');
        if (
          object &&
          object.type === 'identifier' &&
          object.text === receiverName
        ) {
          found.push(node);
        }
        continue;
      }
      if (node.type === 'subscript') {
        continue;
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return found;
  }

  private isSlotsTarget(left: Parser.SyntaxNode): boolean {
    return left.type === 'identifier' && left.text === '__slots__';
  }

  /**
   * The receiver name for a method — its first positional parameter.
   *
   * A `@staticmethod` has no receiver, so it gets `''` and contributes nothing:
   * its first parameter is an ordinary argument, and treating it as `self` would
   * invent attributes on the class from writes to a caller's object.
   */
  private receiverNameOf(
    definition: Parser.SyntaxNode,
    method: PyMethodRegistry | undefined
  ): string {
    if (method && method.getMethodKind() === PythonMethodKind.STATIC_METHOD) {
      return '';
    }
    const parameters = definition.childForFieldName('parameters');
    if (!parameters) {
      return '';
    }
    for (let index = 0; index < parameters.namedChildCount; index += 1) {
      const parameter = parameters.namedChild(index);
      if (!parameter || parameter.isExtra) {
        continue;
      }
      if (parameter.type === 'identifier') {
        return parameter.text;
      }
      if (parameter.type === 'default_parameter') {
        return parameter.childForFieldName('name')?.text ?? '';
      }
      if (parameter.type === 'typed_parameter') {
        const inner = parameter.namedChild(0);
        return inner && inner.type === 'identifier' ? inner.text : '';
      }
      return '';
    }
    return '';
  }

  private isProperty(method: PyMethodRegistry): boolean {
    return method.getMethodKind() === PythonMethodKind.PROPERTY_GETTER;
  }

  private unwrapDecorated(statement: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (statement.type !== 'decorated_definition') {
      return statement;
    }
    return statement.childForFieldName('definition') ?? null;
  }

  private hasDataclassDecorator(classNode: Parser.SyntaxNode): boolean {
    const parent = classNode.parent;
    if (!parent || parent.type !== 'decorated_definition') {
      return false;
    }
    for (let index = 0; index < parent.namedChildCount; index += 1) {
      const child = parent.namedChild(index);
      if (!child || child.type !== 'decorator') {
        continue;
      }
      if (child.text.includes('dataclass')) {
        return true;
      }
    }
    return false;
  }

  private hasBaseNamed(classNode: Parser.SyntaxNode, names: string[]): boolean {
    const superclasses = classNode.childForFieldName('superclasses');
    if (!superclasses) {
      return false;
    }
    for (let index = 0; index < superclasses.namedChildCount; index += 1) {
      const base = superclasses.namedChild(index);
      if (!base || base.isExtra) {
        continue;
      }
      const rightmost = base.text.split('.').pop() ?? '';
      const head = rightmost.split('[')[0] ?? '';
      if (names.includes(head)) {
        return true;
      }
    }
    return false;
  }

  /**
   * CPython's private-name mangling, applied to attribute names.
   *
   * `self.__x` inside `class C` stores `_C__x`. A trailing double underscore
   * opts out, which is why `__init__` is not mangled.
   */
  private mangle(className: string, name: string): string {
    if (!name.startsWith('__') || name.endsWith('__')) {
      return name;
    }
    const stripped = className.replace(/^_+/, '');
    if (stripped === '') {
      return name;
    }
    return '_' + stripped + name;
  }

  private accessOf(name: string): PythonMethodAccess {
    if (name.startsWith('__') && name.endsWith('__')) {
      return PythonMethodAccess.DUNDER_ACCESS;
    }
    if (name.startsWith('_') && name.includes('__')) {
      return PythonMethodAccess.PRIVATE_ACCESS;
    }
    if (name.startsWith('_')) {
      return PythonMethodAccess.PROTECTED_ACCESS;
    }
    return PythonMethodAccess.PUBLIC_ACCESS;
  }

  /**
   * The `py_binding` PK for a class-body attribute.
   *
   * This is the asymmetry schema §2.9 c25 is about. `limit = 4096` in a class
   * body IS a binding — CPython's symtable records it in the class block, so
   * there is a row to point at. `self.limit = n` is not: the symtable records
   * `self` and nothing else, because the attribute lives in the instance
   * `__dict__` and is resolved at runtime. Empty is therefore the correct answer
   * for `self.*`, not a missing link.
   */
  private classBodyBinding(collection: ClassCollection, name: string): string {
    if (collection.classScopeHash === '') {
      return '';
    }
    return (
      this.input.bindingHashByScopeAndName.get(`${collection.classScopeHash}::${name}`) ?? ''
    );
  }

  private initializerKindOf(value: Parser.SyntaxNode): PythonInitializerKind {
    switch (value.type) {
      case 'string':
      case 'integer':
      case 'float':
      case 'true':
      case 'false':
      case 'none':
      case 'list':
      case 'dictionary':
      case 'set':
      case 'tuple':
      case 'concatenated_string': {
        return PythonInitializerKind.LITERAL;
      }
      case 'call': {
        return PythonInitializerKind.CALL;
      }
      case 'identifier': {
        return PythonInitializerKind.NAME;
      }
      case 'attribute': {
        return PythonInitializerKind.ATTRIBUTE;
      }
      case 'lambda': {
        return PythonInitializerKind.LAMBDA;
      }
      case 'list_comprehension':
      case 'set_comprehension':
      case 'dictionary_comprehension':
      case 'generator_expression': {
        return PythonInitializerKind.COMPREHENSION;
      }
      default: {
        return PythonInitializerKind.UNKNOWN;
      }
    }
  }

  private isStringAnnotation(annotation: Parser.SyntaxNode): boolean {
    return annotation.namedChild(0)?.type === 'string';
  }

  /** The head of an annotation: `Dict` for `Dict[str, int]`. */
  private baseTypeOf(annotationText: string): string {
    if (annotationText === '') {
      return '';
    }
    const head = annotationText.split('[')[0] ?? '';
    return (head.split('.').pop() ?? '').trim();
  }

  /**
   * The VALUE of a string literal, prefix and quotes removed.
   *
   * `__slots__ = ("a",)` declares an attribute named `a`, not `"a"`. An f-string
   * is rejected: `f"{n}"` in a `__slots__` list has no statically known name, and
   * a row named `{n}` would assert an attribute that never exists.
   */
  private stringLiteralValue(node: Parser.SyntaxNode): string {
    const text = node.text;
    const quote = text.search(/['"]/);
    if (quote < 0) {
      return '';
    }
    const prefix = text.slice(0, quote).toLowerCase();
    if (prefix.includes('f')) {
      return '';
    }
    const body = text.slice(quote).replace(/^('''|\"\"\"|'|")/, '').replace(/('''|\"\"\"|'|")$/, '');
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(body) ? body : '';
  }

  /**
   * The builtin type a value expression produces, or `''`.
   *
   * Only the forms where the syntax settles it. A call to anything other than a
   * builtin constructor is deliberately `''`: its return type is unknown here, so
   * claiming one would manufacture a disagreement or hide a real one.
   */
  private builtinTypeOfValue(value: Parser.SyntaxNode): string {
    switch (value.type) {
      case 'list':
      case 'list_comprehension': {
        return 'list';
      }
      case 'dictionary':
      case 'dictionary_comprehension': {
        return 'dict';
      }
      case 'set':
      case 'set_comprehension': {
        return 'set';
      }
      case 'tuple': {
        return 'tuple';
      }
      case 'integer': {
        return 'int';
      }
      case 'float': {
        return 'float';
      }
      case 'true':
      case 'false': {
        return 'bool';
      }
      case 'none': {
        return 'None';
      }
      case 'string':
      case 'concatenated_string': {
        const start = value.child(0);
        const prefix = start ? start.text.toLowerCase() : '';
        return prefix.includes('b') ? 'bytes' : 'str';
      }
      case 'call': {
        const callee = value.childForFieldName('function');
        const name = callee ? (callee.text.split('.').pop() ?? '') : '';
        return PYTHON_BUILTIN_TYPE_METHODS.has(name) ? name : '';
      }
      default: {
        return '';
      }
    }
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Remembers the annotation that gave a field its declared type, so a
   * `py_type_reference` can be OWNED BY THE FIELD.
   *
   * `class Foo: x: Bar` previously produced a reference owned by the class-body
   * BINDING with context VARIABLE_ANNOTATION, and nothing owned by the field --
   * FIELD_TYPE and owner kind FIELD were both dead. So "what type does field x
   * of Foo declare?" could not be answered by joining from py_field at all: a
   * consumer had to know that a class attribute is ALSO a binding, find the
   * class body scope and match on name. That is a join nobody should have to
   * discover, and getting it wrong returns nothing rather than failing.
   *
   * Only the FIRST annotation is kept. A field is observed many times -- the
   * class-body declaration plus every `self.x = ...` -- and the declaration is
   * the one that declares the type.
   */
  private recordFieldAnnotation(
    fieldHash: string,
    observation: WriteObservation,
    collection: ClassCollection
  ): void {
    if (observation.annotationNode === null || this.annotationByField.has(fieldHash)) {
      return;
    }
    this.annotationByField.set(fieldHash, {
      node: observation.annotationNode,
      typeHash: collection.typeHash,
      scopeHash: collection.classScopeHash,
    });
  }

  /**
   * `self.__dict__['x'] = v` names attribute `x` exactly as `self.x = v` does.
   *
   * Classes that must bypass a custom `__setattr__` write through `__dict__`
   * instead, and they usually alias it first:
   *
   *     __dict__ = self.__dict__
   *     __dict__['_mock_children'] = {}
   *
   * Every attribute defined that way had NO py_field row, so a call on it could
   * not be linked to anything -- on unittest that was every remaining
   * parser-owned gap but two. The key is a string LITERAL, so this is decided
   * statically and is not inference: a computed key is skipped rather than
   * guessed.
   *
   * Returns the attribute name, or `''` when the target is not such a write.
   */
  private instanceDictKey(left: Parser.SyntaxNode, receiverName: string): string {
    if (left.type !== 'subscript') {
      return '';
    }
    const value = left.childForFieldName('value');
    if (!value) {
      return '';
    }
    const isDirect =
      value.type === 'attribute' &&
      value.childForFieldName('object')?.text === receiverName &&
      value.childForFieldName('attribute')?.text === '__dict__';
    const isAlias = value.type === 'identifier' && this.dictAliases.has(value.text);
    if (!isDirect && !isAlias) {
      return '';
    }
    const key = left.childForFieldName('subscript') ?? left.namedChild(1);
    if (!key || key.type !== 'string') {
      return '';
    }
    const content = key.namedChildren.find(c => c.type === 'string_content');
    return content ? content.text : '';
  }

  /** Locals bound to `self.__dict__` in this method body. */
  private collectDictAliases(methodBody: Parser.SyntaxNode, receiverName: string): Set<string> {
    const aliases = new Set<string>();
    const worklist: Parser.SyntaxNode[] = [methodBody];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      if (node.type === 'assignment') {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (
          left?.type === 'identifier' &&
          right?.type === 'attribute' &&
          right.childForFieldName('object')?.text === receiverName &&
          right.childForFieldName('attribute')?.text === '__dict__'
        ) {
          aliases.add(left.text);
        }
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return aliases;
  }
}
