import Parser from 'tree-sitter';

import { TypeReference } from '@/analysis-types/java/TypeReference';
import { TypeRefKind, TypeRefContext, ReferenceOwnerKind, WildcardVariance } from '@/enums';
import { BaseExtractor } from '@/parsers/base-extractor';
import { EntityUtils } from '@/utils/entity-utils';
import { JavaTreeSitterUtils } from '@/utils/java/java-tree-sitter-utils';

/**
 * Extracts TypeReference entities from Java type usage contexts across the codebase.
 * 
 * This extractor handles type references in ALL contexts including:
 * - **Type Parameter Bounds**: `<T extends Number & Comparable<T>>`
 * - **Field Types**: `private List<String> items;`
 * - **Method Return Types**: `public Optional<T> findById(...)`
 * - **Method Parameters**: `void process(Map<K, V> data)`
 * - **Local Variables**: `List<String> results = new ArrayList<>();`
 * - **Superclass**: `extends AbstractService<T>`
 * - **Implemented Interfaces**: `implements Comparable<T>, Serializable`
 * - **Cast Expressions**: `(T) repository.findById(id)`
 * - **Throws Clauses**: `throws ServiceException`
 * 
 * Handles complex nested generics like:
 * - Simple: `List<String>`
 * - Nested: `Map<String, List<Integer>>`
 * - Wildcards: `List<? extends T>`, `Map<?, ? super Number>`
 * - Complex: `Map<String, List<? extends Comparable<T>>>`
 * - Arrays: `String[]`, `List<T>[]`
 * 
 * The extractor recursively parses nested type structures, maintaining:
 * - Parent-child relationships via `parentReferenceHash`
 * - Depth tracking for nested generics (0 = top-level)
 * - Position ordering for multiple references in same context
 */
export class TypeReferenceExtractor implements BaseExtractor<TypeReference> {

  /**
   * @deprecated Use extractFromBounds instead - this method is kept for interface compatibility
   */
  extract(_filePath: string, _fileContent: string, _hash: string): TypeReference[] {
    console.warn('TypeReferenceExtractor.extract() is deprecated. Use extractFromBounds() instead.');
    return [];
  }

  /**
   * Extracts TypeReferences from type parameter bounds
   * Example: <T extends Number & Comparable<T>> creates 2 TypeReferences
   * 
   * @param typeParameterNode The type_parameter syntax node
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param typeParameterHash Hash of the type parameter itself
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names for this type
   */
  extractFromBounds(
    typeParameterNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Look for type_bound node
    let typeBoundNode: Parser.SyntaxNode | null = null;
    for (const child of typeParameterNode.children) {
      if (child.type === 'type_bound') {
        typeBoundNode = child;
        break;
      }
    }
    
    if (!typeBoundNode) {
      return references;
    }

    let position = 0;
    for (const child of typeBoundNode.children) {
      // Skip punctuation like '&'
      if (child.type === '&') {
        continue;
      }

      // Process each bound type
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const boundRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          typeParameterHash,
          TypeRefContext.TYPE_PARAM_BOUND,
          ReferenceOwnerKind.TYPE,
          typeRegistryHash, // owner is the type itself for TYPE_PARAM_BOUND
          packageName,
          position,
          0, // depth starts at 0 for top-level bound
          undefined, // no parent for top-level bounds
          declaredTypeParams
        );
        references.push(...boundRefs);
        position++;
      }
    }

    return references;
  }

  /**
   * Extracts TypeReferences from method-level type parameter bounds
   * Example: <T extends Shape & Cloneable> creates 2 TypeReferences with METHOD_TYPE_PARAM_BOUND context
   * 
   * @param typeParameterNode The type_parameter syntax node from method declaration
   * @param typeRegistryHash Hash of the type containing this method
   * @param methodRegistryHash Hash of the owning method
   * @param methodTypeParameterHash Hash of the method type parameter itself
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names (class + method level)
   */
  extractFromMethodTypeParameterBounds(
    typeParameterNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodRegistryHash: string,
    methodTypeParameterHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Look for type_bound node
    let typeBoundNode: Parser.SyntaxNode | null = null;
    for (const child of typeParameterNode.children) {
      if (child.type === 'type_bound') {
        typeBoundNode = child;
        break;
      }
    }
    
    if (!typeBoundNode) {
      return references;
    }

    // Detect the bound variance from the type_bound node (extends/super keyword is inside type_bound)
    const variance = JavaTreeSitterUtils.extractWildcardVariance(typeBoundNode);

    let position = 0;
    for (const child of typeBoundNode.children) {
      // Skip punctuation like '&' and keywords like 'extends'/'super'
      if (child.type === '&' || child.type === 'extends' || child.type === 'super') {
        continue;
      }

      // Process each bound type with variance information
      // The variance (EXTENDS/SUPER) is passed to the bound type
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const boundRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          methodTypeParameterHash,
          TypeRefContext.METHOD_TYPE_PARAM_BOUND,
          ReferenceOwnerKind.METHOD_PARAM,
          methodRegistryHash,
          packageName,
          position,
          0, // depth starts at 0 for top-level bound
          undefined, // no parent for top-level bounds
          declaredTypeParams,
          variance // pass the variance to be stored on the bound type
        );
        references.push(...boundRefs);
        position++;
      }
    }

    return references;
  }

  /**
   * Extracts TypeReferences from superclass (extends clause)
   * Example: class MyClass extends BaseClass<T> creates TypeReferences for BaseClass and T
   * 
   * @param classNode The class_declaration or interface_declaration syntax node
   * @param typeRegistryHash Hash of the type being declared
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names for this type
   */
  extractFromSuperclass(
    classNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find superclass node - this is a wrapper containing 'extends' keyword and the actual type
    const superclassNode = classNode.childForFieldName('superclass');
    if (!superclassNode) {
      return references;
    }

    // Find the actual type node within superclass (skip 'extends' keyword)
    let typeNode: Parser.SyntaxNode | null = null;
    for (const child of superclassNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        typeNode = child;
        break;
      }
    }

    if (!typeNode) {
      return references;
    }

    // Extract the type reference (will recursively handle generic arguments)
    const superRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for extends clause
      TypeRefContext.SUPER_TYPE,
      ReferenceOwnerKind.TYPE,
      typeRegistryHash,
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent
      declaredTypeParams
    );
    references.push(...superRefs);

    return references;
  }

  /**
   * Extract type references from implemented interfaces (implements clause).
   * 
   * @param classNode The class/interface declaration node
   * @param typeRegistryHash Hash of the declaring type
   * @param packageName Package name context (currently unused)
   * @param declaredTypeParams Set of all declared type parameter names for this type
   */
  extractFromInterfaces(
    classNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find interfaces node - search by type since field name may vary
    let interfacesNode: Parser.SyntaxNode | null = null;
    for (const child of classNode.children) {
      if (child.type === 'super_interfaces') {
        interfacesNode = child;
        break;
      }
    }
    
    if (!interfacesNode) {
      return references;
    }

    // Find type_list inside super_interfaces
    let typeListNode: Parser.SyntaxNode | null = null;
    for (const child of interfacesNode.children) {
      if (child.type === 'type_list') {
        typeListNode = child;
        break;
      }
    }

    if (!typeListNode) {
      return references;
    }

    // Extract each interface type reference (skip commas)
    let position = 0;
    for (const child of typeListNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const interfaceRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '', // no typeParameterHash for implements clause
          TypeRefContext.IMPLEMENTS_INTERFACE,
          ReferenceOwnerKind.TYPE,
          typeRegistryHash,
          packageName,
          position,
          0, // depth starts at 0
          undefined, // no parent
          declaredTypeParams
        );
        references.push(...interfaceRefs);
        position++;
      }
    }

    return references;
  }

  /**
   * Extract type references from extended interfaces (extends clause for interfaces).
   * 
   * @param interfaceNode The interface declaration node
   * @param typeRegistryHash Hash of the declaring interface
   * @param packageName Package name context (currently unused)
   * @param declaredTypeParams Set of all declared type parameter names for this interface
   */
  extractFromInterfaceExtension(
    interfaceNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find extends_interfaces node
    let extendsInterfacesNode: Parser.SyntaxNode | null = null;
    for (const child of interfaceNode.children) {
      if (child.type === 'extends_interfaces') {
        extendsInterfacesNode = child;
        break;
      }
    }
    
    if (!extendsInterfacesNode) {
      return references;
    }

    // Find type_list inside extends_interfaces
    let typeListNode: Parser.SyntaxNode | null = null;
    for (const child of extendsInterfacesNode.children) {
      if (child.type === 'type_list') {
        typeListNode = child;
        break;
      }
    }

    if (!typeListNode) {
      return references;
    }

    // Extract each extended interface type reference (skip commas)
    let position = 0;
    for (const child of typeListNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const extendedInterfaceRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '', // no typeParameterHash for extends clause
          TypeRefContext.SUPER_TYPE,
          ReferenceOwnerKind.TYPE,
          typeRegistryHash,
          packageName,
          position,
          0, // depth starts at 0
          undefined, // no parent
          declaredTypeParams
        );
        references.push(...extendedInterfaceRefs);
        position++;
      }
    }

    return references;
  }

  /**
   * Extracts TypeReferences from an anonymous class base type.
   * This captures what interface/class the anonymous class implements/extends.
   * 
   * Example: new Runnable() { ... } → creates TypeReference for Runnable with SUPER_TYPE context
   * Example: new Comparator<String>() { ... } → creates TypeReferences for Comparator and String
   * 
   * @param creationNode The object_creation_expression node
   * @param anonymousTypeHash Hash of the anonymous type being created
   * @param packageName Package name for resolving types
   */
  extractFromAnonymousClassBase(
    creationNode: Parser.SyntaxNode,
    anonymousTypeHash: string,
    packageName: string | null
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find the type node in the object creation expression
    const typeNode = creationNode.childForFieldName('type');
    if (!typeNode) {
      return references;
    }

    // Extract with SUPER_TYPE context (anonymous class extends/implements this type)
    const baseTypeRefs = this.extractTypeReference(
      typeNode,
      anonymousTypeHash, // The anonymous type is the type registry
      '', // no typeParameterHash
      TypeRefContext.SUPER_TYPE,
      ReferenceOwnerKind.TYPE,
      anonymousTypeHash, // owner is the anonymous type
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent
      new Set<string>() // anonymous classes don't have type parameters
    );
    references.push(...baseTypeRefs);

    return references;
  }

  /**
   * Extracts TypeReferences from a method parameter type.
   * Handles complex types including wildcards, nested generics, arrays.
   * 
   * Example: Map<String, List<? extends Number>> param
   * Creates TypeReferences:
   * - Map (PARAMETERIZED_TYPE, depth=0)
   * - String (CLASS_TYPE, depth=1, parent=Map)
   * - List (PARAMETERIZED_TYPE, depth=1, parent=Map)
   * - ? extends Number (WILDCARD, EXTENDS, depth=2, parent=List)
   * - Number (CLASS_TYPE, depth=3, parent=wildcard)
   * 
   * @param paramTypeNode The type node from formal_parameter (e.g., generic_type, array_type)
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param methodParameterHash Hash of the MethodParameter entity
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names (class + method level)
   */
  extractFromMethodParameter(
    paramTypeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodParameterHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const paramRefs = this.extractTypeReference(
      paramTypeNode,
      typeRegistryHash,
      '', // no typeParameterHash for method parameters
      TypeRefContext.METHOD_PARAM,
      ReferenceOwnerKind.METHOD_PARAM,
      methodParameterHash, // owner is the MethodParameter entity
      packageName,
      0, // position (single parameter type, always 0)
      0, // depth starts at 0 for top-level parameter type
      undefined, // no parent for top-level parameter type
      declaredTypeParams
    );
    references.push(...paramRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from method return types.
   * 
   * Example: `public Map<String, List<Integer>> getMap()`
   * Creates TypeReferences:
   * - Map (PARAMETERIZED_TYPE, depth=0, owner=METHOD)
   * - String (CLASS_TYPE, depth=1, parent=Map)
   * - List (PARAMETERIZED_TYPE, depth=1, parent=Map)
   * - Integer (CLASS_TYPE, depth=2, parent=List)
   * 
   * @param returnTypeNode The return type node from method_declaration
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param methodRegistryHash Hash of the MethodRegistry entity
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names (class + method level)
   */
  extractFromMethodReturnType(
    returnTypeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const returnRefs = this.extractTypeReference(
      returnTypeNode,
      typeRegistryHash,
      '', // no typeParameterHash for method return types
      TypeRefContext.METHOD_RETURN,
      ReferenceOwnerKind.METHOD,
      methodRegistryHash, // owner is the MethodRegistry entity
      packageName,
      0, // position (single return type, always 0)
      0, // depth starts at 0 for top-level return type
      undefined, // no parent for top-level return type
      declaredTypeParams
    );
    references.push(...returnRefs);
    
    return references;
  }

  /**
   * Extract type references from permits clause (sealed types).
   * 
   * @param typeNode The sealed class or interface declaration node
   * @param typeRegistryHash Hash of the declaring sealed type
   * @param packageName Package name context (currently unused)
   * @param declaredTypeParams Set of all declared type parameter names for this type
   */
  extractFromPermits(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find permits node
    let permitsNode: Parser.SyntaxNode | null = null;
    for (const child of typeNode.children) {
      if (child.type === 'permits') {
        permitsNode = child;
        break;
      }
    }
    
    if (!permitsNode) {
      return references;
    }

    // Find type_list inside permits
    let typeListNode: Parser.SyntaxNode | null = null;
    for (const child of permitsNode.children) {
      if (child.type === 'type_list') {
        typeListNode = child;
        break;
      }
    }

    if (!typeListNode) {
      return references;
    }

    // Extract each permitted subtype type reference (skip commas)
    let position = 0;
    for (const child of typeListNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const permittedTypeRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '', // no typeParameterHash for permits clause
          TypeRefContext.PERMITS,
          ReferenceOwnerKind.TYPE,
          typeRegistryHash,
          packageName,
          position,
          0, // depth starts at 0
          undefined, // no parent
          declaredTypeParams
        );
        references.push(...permittedTypeRefs);
        position++;
      }
    }

    return references;
  }

  /**
   * Extracts TypeReferences from method/constructor throws clause.
   * 
   * Example: `public void process() throws IOException, SQLException`
   * Creates TypeReferences:
   * - IOException (CLASS_TYPE, position=0, owner=METHOD)
   * - SQLException (CLASS_TYPE, position=1, owner=METHOD)
   * 
   * Also handles generic exception types:
   * Example: `<E extends Exception> void mayThrow() throws E`
   * Creates TypeReference:
   * - E (TYPE_VARIABLE, position=0, owner=METHOD)
   * 
   * @param methodNode The method_declaration or constructor_declaration node
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param methodRegistryHash Hash of the MethodRegistry entity
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names (class + method level)
   */
  extractFromThrowsClause(
    methodNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    methodRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    // Find the throws node
    let throwsNode: Parser.SyntaxNode | null = null;
    for (const child of methodNode.children) {
      if (child.type === 'throws') {
        throwsNode = child;
        break;
      }
    }
    
    if (!throwsNode) {
      return references;
    }

    // Extract each exception type from the throws clause
    // The throws node contains exception types (type_identifier, generic_type, scoped_type_identifier)
    let position = 0;
    for (const child of throwsNode.children) {
      // Skip 'throws' keyword and commas
      if (child.type === 'throws' || child.type === ',') {
        continue;
      }

      // Process each exception type
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const exceptionRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '', // no typeParameterHash for throws clause
          TypeRefContext.THROWS_CLAUSE,
          ReferenceOwnerKind.METHOD,
          methodRegistryHash, // owner is the MethodRegistry entity
          packageName,
          position,
          0, // depth starts at 0 for top-level exception type
          undefined, // no parent for top-level exception type
          declaredTypeParams
        );
        references.push(...exceptionRefs);
        position++;
      }
    }
    
    return references;
  }

  /**
   * Extracts TypeReferences from method invocation type arguments.
   * 
   * Example: `Collections.<String, Integer>emptyMap()`
   * Creates TypeReferences:
   * - String (CLASS_TYPE, position=0, context=METHOD_TYPE_ARGUMENT)
   * - Integer (CLASS_TYPE, position=1, context=METHOD_TYPE_ARGUMENT)
   * 
   * Also handles complex type arguments:
   * Example: `obj.<List<? extends Number>>method()`
   * Creates TypeReferences:
   * - List (PARAMETERIZED, depth=0, position=0)
   * - ? extends Number (WILDCARD, depth=1, parent=List)
   * - Number (CLASS, depth=2, parent=wildcard)
   * 
   * @param typeArgumentsNode The type_arguments node from method_invocation
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (method invocation)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromMethodTypeArguments(
    typeArgumentsNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    let position = 0;
    for (const child of typeArgumentsNode.namedChildren) {
      // Process each type argument
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const typeArgRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '', // no typeParameterHash for method type arguments
          TypeRefContext.METHOD_TYPE_ARGUMENT,
          ReferenceOwnerKind.EXPRESSION,
          expressionHash, // owner is the expression (method invocation)
          packageName,
          position,
          0, // depth starts at 0 for top-level type argument
          undefined, // no parent for top-level type argument
          declaredTypeParams
        );
        references.push(...typeArgRefs);
        position++;
      }
    }
    
    return references;
  }

  /**
   * Extracts TypeReferences from instanceof expressions.
   * 
   * Example: `obj instanceof Map<String, List<Integer>>`
   * Creates TypeReferences:
   * - Map (PARAMETERIZED_TYPE, context=INSTANCEOF_TYPE, owner=EXPRESSION)
   * - String (CLASS_TYPE, depth=1, parent=Map)
   * - List (PARAMETERIZED_TYPE, depth=1, parent=Map)
   * - Integer (CLASS_TYPE, depth=2, parent=List)
   * 
   * @param typeNode The type node from instanceof_expression
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (instanceof expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromInstanceof(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for instanceof
      TypeRefContext.INSTANCEOF_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (instanceof expression)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from switch type patterns.
   * 
   * Example: `case String s -> ...`
   * Creates TypeReferences:
   * - String (CLASS_TYPE, context=SWITCH_TYPE_PATTERN, owner=EXPRESSION)
   * 
   * Example: `case List<String> list -> ...`
   * Creates TypeReferences:
   * - List (PARAMETERIZED_TYPE, context=SWITCH_TYPE_PATTERN, owner=EXPRESSION)
   * - String (CLASS_TYPE, depth=1, parent=List)
   * 
   * @param typeNode The type node from type_pattern
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (switch expression)
   * @param packageName Package name for resolving types
   * @param casePosition Position of the case arm within the switch (for linking with pattern binding)
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromSwitchTypePattern(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    casePosition: number,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for switch type pattern
      TypeRefContext.SWITCH_TYPE_PATTERN,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (switch expression)
      packageName,
      casePosition, // position matches case arm for linking with pattern binding
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from record pattern types.
   * 
   * Example: `obj instanceof Person(String name, int age)`
   * Creates TypeReferences:
   * - Person (CLASS_TYPE, context=RECORD_PATTERN_TYPE, owner=EXPRESSION)
   * 
   * @param typeNode The type identifier node from record_pattern
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (record pattern expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromRecordPattern(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for record pattern
      TypeRefContext.RECORD_PATTERN_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (record pattern expression)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from pattern binding types in record patterns.
   * 
   * Example: `Person(String name, int age)`
   * Creates TypeReferences:
   * - String (CLASS_TYPE, context=PATTERN_BINDING_TYPE, owner=EXPRESSION)
   * - int (PRIMITIVE, context=PATTERN_BINDING_TYPE, owner=EXPRESSION)
   * 
   * @param typeNode The type node from record_pattern_component
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (parent record pattern)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromPatternBinding(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for pattern binding
      TypeRefContext.PATTERN_BINDING_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (record pattern)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from lambda parameter types.
   * 
   * Example: `(String s) -> s.length()`
   * Creates TypeReferences:
   * - String (CLASS_TYPE, context=LAMBDA_PARAMETER_TYPE, owner=EXPRESSION)
   * 
   * Example: `(List<String> items) -> items.size()`
   * Creates TypeReferences:
   * - List (PARAMETERIZED_TYPE, context=LAMBDA_PARAMETER_TYPE, owner=EXPRESSION)
   * - String (CLASS_TYPE, depth=1, parent=List)
   * 
   * @param typeNode The type node from formal_parameter in lambda
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (lambda expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromLambdaParameter(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    position: number = 0,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for lambda parameter
      TypeRefContext.LAMBDA_PARAMETER_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (lambda expression)
      packageName,
      position, // parameter position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from cast expressions.
   * 
   * Example: `(String) obj`
   * Creates TypeReferences:
   * - String (CLASS_TYPE, context=CAST_EXPRESSION, owner=EXPRESSION)
   * 
   * Example: `(List<String>) items`
   * Creates TypeReferences:
   * - List (PARAMETERIZED_TYPE, context=CAST_EXPRESSION, owner=EXPRESSION)
   * - String (CLASS_TYPE, depth=1, parent=List)
   * 
   * @param typeNode The type node from cast_expression
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (cast expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromCast(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set(),
    position: number = 0 // position for intersection types (0 for first type, 1 for second, etc.)
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for cast
      TypeRefContext.CAST_EXPRESSION,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (cast expression)
      packageName,
      position, // position for intersection types
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from object creation expressions.
   * 
   * Example: `new HashMap<String, List<Integer>>()`
   * Creates TypeReferences:
   * - HashMap (PARAMETERIZED_TYPE, context=OBJECT_CREATION_TYPE, owner=EXPRESSION)
   * - String (CLASS_TYPE, depth=1, parent=HashMap)
   * - List (PARAMETERIZED_TYPE, depth=1, parent=HashMap)
   * - Integer (CLASS_TYPE, depth=2, parent=List)
   * 
   * @param typeNode The type node from object_creation_expression
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (object creation expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromObjectCreation(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for object creation
      TypeRefContext.OBJECT_CREATION_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (object creation expression)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from array creation expressions.
   * 
   * Example: `new String[3]`, `new int[] { 1, 2, 3 }`, `new int[2][3]`
   * Creates TypeReferences for the element type:
   * - String (CLASS_TYPE, context=ARRAY_CREATION_TYPE, owner=EXPRESSION)
   * - int (PRIMITIVE, context=ARRAY_CREATION_TYPE, owner=EXPRESSION)
   * 
   * @param typeNode The type node from array_creation_expression (element type)
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (array creation expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromArrayCreation(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      typeNode,
      typeRegistryHash,
      '', // no typeParameterHash for array creation
      TypeRefContext.ARRAY_CREATION_TYPE,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (array creation expression)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from generic constructor type arguments.
   * 
   * Example: `new <String>GenericCtor("test")`
   * The `<String>` is a constructor type argument, separate from the class type.
   * 
   * @param typeArgsNode The type_arguments node from object_creation_expression
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromConstructorTypeArguments(
    typeArgsNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    let position = 0;
    for (const child of typeArgsNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        const typeRefs = this.extractTypeReference(
          child,
          typeRegistryHash,
          '',
          TypeRefContext.METHOD_TYPE_ARGUMENT, // Reuse METHOD_TYPE_ARGUMENT for constructor type args
          ReferenceOwnerKind.EXPRESSION,
          expressionHash,
          packageName,
          position,
          0,
          undefined,
          declaredTypeParams
        );
        references.push(...typeRefs);
        position++;
      }
    }
    
    return references;
  }

  /**
   * Extracts TypeReferences from method reference qualifier types.
   * 
   * This handles type-based qualifiers in method references where the qualifier
   * is a type (not an expression). These include:
   * - Simple types: `String::valueOf`, `Integer::parseInt`
   * - Array types: `String[]::new`, `int[]::new`
   * - Generic types: `List<String>::new`, `Map<K,V>::new`
   * - Scoped types: `Map.Entry::comparingByKey`
   * 
   * Example: `String[]::new`
   * Creates TypeReference:
   * - String[] (ARRAY, context=METHOD_REFERENCE_QUALIFIER, owner=EXPRESSION)
   * 
   * Example: `List<String>::new`
   * Creates TypeReferences:
   * - List (PARAMETERIZED, depth=0, context=METHOD_REFERENCE_QUALIFIER)
   * - String (CLASS, depth=1, parent=List)
   * 
   * @param qualifierNode The type node that is the qualifier of the method reference
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param expressionHash Hash of the ExpressionReference (method reference expression)
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromMethodReferenceQualifier(
    qualifierNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    expressionHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const typeRefs = this.extractTypeReference(
      qualifierNode,
      typeRegistryHash,
      '', // no typeParameterHash for method reference qualifiers
      TypeRefContext.METHOD_REFERENCE_QUALIFIER,
      ReferenceOwnerKind.EXPRESSION,
      expressionHash, // owner is the expression (method reference expression)
      packageName,
      0, // position
      0, // depth starts at 0
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...typeRefs);
    
    return references;
  }

  /**
   * Extracts TypeReferences from field types.
   * 
   * Example: `private Map<String, List<Integer>> data;`
   * Creates TypeReferences:
   * - Map (PARAMETERIZED_TYPE, depth=0, owner=FIELD)
   * - String (CLASS_TYPE, depth=1, parent=Map)
   * - List (PARAMETERIZED_TYPE, depth=1, parent=Map)
   * - Integer (CLASS_TYPE, depth=2, parent=List)
   * 
   * @param fieldTypeNode The type node from field_declaration
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param fieldRegistryHash Hash of the FieldRegistry entity
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromField(
    fieldTypeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    fieldRegistryHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const fieldRefs = this.extractTypeReference(
      fieldTypeNode,
      typeRegistryHash,
      '', // no typeParameterHash for fields
      TypeRefContext.FIELD_TYPE,
      ReferenceOwnerKind.FIELD,
      fieldRegistryHash, // owner is the FieldRegistry entity
      packageName,
      0, // position (single field type, always 0)
      0, // depth starts at 0 for top-level field type
      undefined, // no parent for top-level field type
      declaredTypeParams
    );
    references.push(...fieldRefs);
    
    return references;
  }

  /**
   * Extracts type references from a local variable type declaration.
   * 
   * Example: `List<String> items = new ArrayList<>();`
   * Returns TypeReferences for: List<String>, String
   * 
   * @param localVarTypeNode The AST node of the local variable type
   * @param typeRegistryHash Hash of the owning type (class/interface)
   * @param localVariableHash Hash of the LocalVariableRegistry entity
   * @param packageName Package name for resolving types
   * @param declaredTypeParams Set of all declared type parameter names
   */
  extractFromLocalVariable(
    localVarTypeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    localVariableHash: string,
    packageName: string | null,
    declaredTypeParams: Set<string> = new Set(),
    position: number = 0
  ): TypeReference[] {
    const references: TypeReference[] = [];
    
    const localVarRefs = this.extractTypeReference(
      localVarTypeNode,
      typeRegistryHash,
      '', // no typeParameterHash for local variables
      TypeRefContext.LOCAL_VARIABLE,
      ReferenceOwnerKind.LOCAL_VARIABLE,
      localVariableHash, // owner is the LocalVariableRegistry entity
      packageName,
      position, // position among sibling types (e.g., multi-catch)
      0, // depth starts at 0 for top-level type
      undefined, // no parent for top-level type
      declaredTypeParams
    );
    references.push(...localVarRefs);
    
    return references;
  }

  /**
   * Recursively extracts a type reference and all its nested children.
   * 
   * **Core extraction method** used by all context-specific extractors:
   * - `extractFromBounds()` for type parameter bounds
   * - `extractFromSuperclass()` for extends clauses (SUPER_TYPE)
   * - `extractFromInterfaces()` for implements clauses (IMPLEMENTS_INTERFACE)
   * - `extractFromField()` for field types
   * - Future: `extractFromMethod()` for method return/parameter types
   * 
   * This method handles nested generics by:
   * 1. Creating a TypeReference for the current type
   * 2. Recursively processing any generic arguments
   * 3. Maintaining parent-child relationships via parentReferenceHash
   * 4. Tracking depth for nested structures
   * 
   * Example: List<? extends T>
   * - Depth 0: PARAMETERIZED "List"
   * - Depth 1: WILDCARD "? extends" (parent = List)
   * - Depth 2: TYPE_VARIABLE "T" (parent = wildcard)
   * 
   * @param typeNode The syntax node representing the type
   * @param typeRegistryHash Hash of the owning TypeRegistry
   * @param typeParameterHash Hash of the associated TypeParameter (if applicable)
   * @param context The context where this type reference appears (TYPE_PARAM_BOUND, FIELD_TYPE, etc.)
   * @param ownerKind The kind of entity that owns this reference (TYPE, FIELD, METHOD, etc.)
   * @param ownerHash Hash of the specific owner entity
   * @param packageName Package name for resolving type references
   * @param position Position among sibling references in the same context
   * @param depth Nesting depth (0 = top-level, increases for each level of nesting)
   * @param parentReferenceHash Hash of the parent TypeReference (for nested generics)
   * @param declaredTypeParams Set of declared type parameter names
   * @param boundVariance Optional variance for bound contexts (EXTENDS/SUPER) - only applies to top-level bound types
   */
  private extractTypeReference(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    declaredTypeParams: Set<string>,
    boundVariance?: WildcardVariance
  ): TypeReference[] {
    const references: TypeReference[] = [];

    // Determine the kind and extract accordingly
    const kind = JavaTreeSitterUtils.determineTypeKind(typeNode, declaredTypeParams);

    switch (kind) {
      case TypeRefKind.PARAMETERIZED:
        references.push(...this.extractParameterizedType(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, packageName, position, depth, parentReferenceHash, declaredTypeParams, boundVariance
        ));
        break;

      case TypeRefKind.WILDCARD:
        references.push(...this.extractWildcardType(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, packageName, position, depth, parentReferenceHash, declaredTypeParams
        ));
        break;

      case TypeRefKind.TYPE_VARIABLE:
        references.push(this.extractTypeVariable(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, position, depth, parentReferenceHash, boundVariance
        ));
        break;

      case TypeRefKind.ARRAY:
        const arrayRefs = this.extractArrayType(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, packageName, position, depth, parentReferenceHash, declaredTypeParams
        );
        references.push(...arrayRefs);
        break;

      case TypeRefKind.PRIMITIVE:
        const primitiveRef = this.extractPrimitiveType(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, packageName, position, depth, parentReferenceHash
        );
        if (primitiveRef) references.push(primitiveRef);
        break;

      case TypeRefKind.CLASS:
      default:
        const classRefs = this.extractClassType(
          typeNode, typeRegistryHash, typeParameterHash, context, ownerKind,
          ownerHash, packageName, position, depth, parentReferenceHash, declaredTypeParams, boundVariance
        );
        references.push(...classRefs);
        break;
    }

    return references;
  }

  /**
   * Extracts a parameterized type (generic type with arguments).
   * 
   * **Used across all contexts**: type parameter bounds, field types, method signatures, etc.
   * 
   * Examples:
   * - Type parameter bound: `<T extends List<String>>`
   * - Field type: `private Map<K, V> cache;`
   * - Method return: `public Optional<T> find(...)`
   * 
   * This creates:
   * 1. Parent PARAMETERIZED reference for the generic type
   * 2. Child references for each type argument (recursively)
   */
  private extractParameterizedType(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    declaredTypeParams: Set<string>,
    boundVariance?: WildcardVariance
  ): TypeReference[] {
    const references: TypeReference[] = [];

    const typeName = JavaTreeSitterUtils.extractTypeName(typeNode);
    if (!typeName) return references;
    const completeTypeName = JavaTreeSitterUtils.extractCompleteTypeName(typeNode) || typeName;

    // Build the parent parameterized type
    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.PARAMETERIZED,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .setTypeName(typeName)
      .setCompleteTypeName(completeTypeName)
      .positionAndDepth(position, depth);

    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    // Add variance for bound contexts (e.g., <T extends List<String>> where List has EXTENDS variance)
    if (boundVariance) {
      builder.wildcard(boundVariance);
    }

    const parentRef = builder.build();
    references.push(parentRef);

    // Unwrap annotated_type to find the actual generic_type containing type_arguments
    const actualType = JavaTreeSitterUtils.unwrapAnnotatedType(typeNode);

    // Check for qualified inner class types like Outer<String>.Inner<Integer>
    // The scoped_type_identifier may contain a nested generic_type for the qualifier
    const scopedTypeId = actualType.children.find(c => c.type === 'scoped_type_identifier');
    if (scopedTypeId) {
      // Look for nested generic_type in the scoped identifier (e.g., Outer<String> in Outer<String>.Inner)
      const nestedGenericType = scopedTypeId.children.find(c => c.type === 'generic_type');
      if (nestedGenericType) {
        // Recursively extract the qualifier type (Outer<String>)
        const qualifierRefs = this.extractTypeReference(
          nestedGenericType,
          typeRegistryHash,
          typeParameterHash,
          context,
          ownerKind,
          ownerHash,
          packageName,
          0, // qualifier position
          depth + 1, // Increase depth for qualifier
          parentRef.getHash(), // Parent is the inner type
          declaredTypeParams
        );
        references.push(...qualifierRefs);
      }
    }

    // Extract type arguments recursively
    const typeArgsNode = actualType.children.find(c => c.type === 'type_arguments');
    if (typeArgsNode) {
      let argPosition = 0;
      for (const child of typeArgsNode.children) {
        if (JavaTreeSitterUtils.isTypeNode(child) || child.type === 'wildcard') {
          const childRefs = this.extractTypeReference(
            child,
            typeRegistryHash,
            typeParameterHash,
            context,
            ownerKind,
            ownerHash,
            packageName,
            argPosition,
            depth + 1, // Increase depth for children
            parentRef.getHash(), // Set parent
            declaredTypeParams
          );
          references.push(...childRefs);
          argPosition++;
        }
      }
    }

    return references;
  }

  /**
   * Extracts a wildcard type (?, ? extends T, ? super T).
   * 
   * **Used across all contexts**: type parameter bounds, field types, method signatures, etc.
   * 
   * Creates a WILDCARD reference with appropriate variance (UNBOUNDED, EXTENDS, SUPER).
   */
  private extractWildcardType(
    wildcardNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    declaredTypeParams: Set<string>
  ): TypeReference[] {
    const references: TypeReference[] = [];

    // Determine variance
    const variance = JavaTreeSitterUtils.extractWildcardVariance(wildcardNode);

    // Build wildcard reference
    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.WILDCARD,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .wildcard(variance)
      .positionAndDepth(position, depth);

    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    const wildcardRef = builder.build();
    references.push(wildcardRef);

    // If bounded wildcard, extract the bound type
    if (variance !== WildcardVariance.UNBOUNDED) {
      const boundNode = JavaTreeSitterUtils.findBoundNode(wildcardNode);
      if (boundNode) {
        const boundRefs = this.extractTypeReference(
          boundNode,
          typeRegistryHash,
          typeParameterHash,
          context,
          ownerKind,
          ownerHash,
          packageName,
          position, // inherit parent wildcard's position for better traceability
          depth + 1,
          wildcardRef.getHash(),
          declaredTypeParams
        );
        references.push(...boundRefs);
      }
    }

    return references;
  }

  /**
   * Extracts a type variable reference (T, K, V, etc.).
   * 
   * **Used across all contexts**: type parameter bounds, field types, method signatures, etc.
   */
  private extractTypeVariable(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    boundVariance?: WildcardVariance
  ): TypeReference {
    const typeVarName = EntityUtils.normalizeWhitespace(typeNode.text);

    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.TYPE_VARIABLE,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .typeVariable(typeVarName)
      .positionAndDepth(position, depth);

    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    // Add variance for bound contexts (e.g., <U extends T> where T has EXTENDS variance)
    if (boundVariance) {
      builder.wildcard(boundVariance);
    }

    return builder.build();
  }

  /**
   * Extracts an array type reference.
   * 
   * **Used across all contexts**: type parameter bounds, field types, method signatures, etc.
   * 
   * Examples: `String[]`, `T[]`, `List<String>[]`
   */
  private extractArrayType(
    arrayNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    declaredTypeParams: Set<string> = new Set()
  ): TypeReference[] {
    const references: TypeReference[] = [];
    // Unwrap annotated_type (e.g., @Nullable Annotation[]) to get the actual array_type node
    const actualArrayNode = JavaTreeSitterUtils.unwrapAnnotatedType(arrayNode);
    const dimensions = JavaTreeSitterUtils.countArrayDimensions(actualArrayNode);
    const elementTypeNode = JavaTreeSitterUtils.findArrayElementType(actualArrayNode);
    
    // For array types, we need to get the base type name (not the full generic text)
    let elementTypeName = 'unknown';
    if (elementTypeNode) {
      if (elementTypeNode.type === 'generic_type') {
        // For generic element types like List<String>, get just the base type name
        const baseTypeNode = elementTypeNode.children.find(
          c => c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
        );
        elementTypeName = EntityUtils.normalizeWhitespace(baseTypeNode ? baseTypeNode.text : elementTypeNode.text);
      } else {
        elementTypeName = EntityUtils.normalizeWhitespace(elementTypeNode.text);
      }
    }

    // For arrays, completeTypeName matches elementTypeName (arrays don't have scoped qualifiers)
    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.ARRAY,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .setTypeName(elementTypeName)
      .setCompleteTypeName(elementTypeName)
      .array(dimensions)
      .positionAndDepth(position, depth);

    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    const arrayRef = builder.build();
    references.push(arrayRef);

    // If the element type is a generic type, recursively extract its type arguments
    if (elementTypeNode && elementTypeNode.type === 'generic_type') {
      const typeArgsNode = elementTypeNode.children.find(c => c.type === 'type_arguments');
      if (typeArgsNode) {
        let argPosition = 0;
        for (const child of typeArgsNode.namedChildren) {
          const childRefs = this.extractTypeReference(
            child,
            typeRegistryHash,
            typeParameterHash,
            context,
            ownerKind,
            ownerHash,
            packageName,
            argPosition,
            depth + 1,
            arrayRef.getHash(),
            declaredTypeParams
          );
          references.push(...childRefs);
          argPosition++;
        }
      }
    }

    return references;
  }

  /**
   * Extracts a primitive type reference.
   * 
   * **Used across all contexts**: field types, method signatures, local variables, etc.
   * 
   * Examples: `int`, `boolean`, `double`
   */
  private extractPrimitiveType(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    _packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined
  ): TypeReference | null {
    const typeName = EntityUtils.normalizeWhitespace(typeNode.text);
    if (!typeName) return null;

    // For primitives, completeTypeName is the same as typeName
    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.PRIMITIVE,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .setTypeName(typeName)
      .setCompleteTypeName(typeName)
      .positionAndDepth(position, depth);

    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    return builder.build();
  }

  /**
   * Extracts a simple class/interface type reference (non-generic).
   * 
   * **Used across all contexts**: type parameter bounds, field types, method signatures, etc.
   * 
   * Examples: `String`, `Number`, `Serializable`
   */
  private extractClassType(
    typeNode: Parser.SyntaxNode,
    typeRegistryHash: string,
    typeParameterHash: string,
    context: TypeRefContext,
    ownerKind: ReferenceOwnerKind,
    ownerHash: string,
    _packageName: string | null,
    position: number,
    depth: number,
    parentReferenceHash: string | undefined,
    _declaredTypeParams: Set<string>,
    boundVariance?: WildcardVariance
  ): TypeReference[] {
    const references: TypeReference[] = [];
    const typeName = JavaTreeSitterUtils.extractTypeName(typeNode);
    if (!typeName) return references;
    const completeTypeName = JavaTreeSitterUtils.extractCompleteTypeName(typeNode) || typeName;

    const builder = TypeReference.builder(
      typeRegistryHash,
      TypeRefKind.CLASS,
      context,
      ownerKind,
      ownerHash
    )
      .typeParameter(typeParameterHash)
      .setTypeName(typeName)
      .setCompleteTypeName(completeTypeName)
      .positionAndDepth(position, depth);
    
    if (parentReferenceHash) {
      builder.parent(parentReferenceHash);
    }

    // Add variance for bound contexts (e.g., <T extends Number> where Number has EXTENDS variance)
    if (boundVariance) {
      builder.wildcard(boundVariance);
    }
    
    const parentRef = builder.build();
    references.push(parentRef);

    // NOTE: We intentionally do NOT recursively extract qualifier parts of scoped_type_identifier.
    // For package-qualified types like java.util.Random, "java" and "util" are package names,
    // not types, and should not be extracted as type references.
    // Only the actual class name (e.g., "Random") is a type reference.
    
    return references;
  }

}
