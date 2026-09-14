import Parser from 'tree-sitter';

import { TypeRefKind, WildcardVariance } from '@/enums';
import { EntityJavaUtils } from '@/utils/java/entity-java-utils';

/**
 * Tree-sitter specific utilities for Java syntax node analysis.
 * 
 * Provides helper methods for identifying and extracting information from
 * Java syntax nodes parsed by tree-sitter, specifically for type reference extraction.
 */
export class JavaTreeSitterUtils {
  /**
   * True when this statement is the body of an arrow arm belonging to a switch used as a VALUE.
   *
   * `case 1 -> t();` is written as an expression_statement whichever form the switch takes, so a
   * walk that collects every expression statement picks the arm up a second time. The arm's value
   * is the switch's value, not a statement in the enclosing body, so that second row asserts a
   * root context the source does not have and turns one written site into two.
   *
   * The two forms are told apart by what the switch is attached to. tree-sitter models both as
   * `switch_expression`; one used as a statement sits directly in a `block`, while one used as a
   * value sits under whatever consumes it - a return, a variable_declarator, an argument_list, an
   * assignment. So a `block` parent means statement, and anything else means value.
   *
   * Shared rather than private to one extractor: a method body and a field initializer are walked
   * by different code, and the same arm is a value in both. Guarding only the method walk left the
   * field-initializer path duplicating every arm of a switch inside an initializer lambda.
   */
  static isValueProducingSwitchArm(node: Parser.SyntaxNode): boolean {
    if (node.parent?.type !== 'switch_rule') return false;

    const switchExpression = node.parent.parent?.parent;
    if (switchExpression?.type !== 'switch_expression') return false;

    return switchExpression.parent?.type !== 'block';
  }

  /**
   * Determines the TypeRefKind from a Java syntax node.
   * 
   * Analyzes the node type and text to classify it into the appropriate
   * TypeRefKind category for TypeReference creation.
   * 
   * @param typeNode The syntax node to classify
   * @param declaredTypeParams Set of declared type parameter names (T, U, V, etc.) to distinguish from class names
   * @returns The determined TypeRefKind
   */
  static determineTypeKind(typeNode: Parser.SyntaxNode, declaredTypeParams: Set<string> = new Set()): TypeRefKind {
    // Unwrap annotated_type to get the actual type
    const actualType = JavaTreeSitterUtils.unwrapAnnotatedType(typeNode);
    
    if (actualType.type === 'wildcard') {
      return TypeRefKind.WILDCARD;
    }
    if (actualType.type === 'array_type') {
      return TypeRefKind.ARRAY;
    }
    if (EntityJavaUtils.isPrimitiveType(actualType.text)) {
      return TypeRefKind.PRIMITIVE;
    }
    if (actualType.type === 'generic_type') {
      return TypeRefKind.PARAMETERIZED;
    }
    // type_identifier could be either a type variable or a class name
    if (actualType.type === 'type_identifier') {
      // If it's in the declared type parameters, it's a type variable
      if (declaredTypeParams.has(actualType.text)) {
        return TypeRefKind.TYPE_VARIABLE;
      }
      // Otherwise it's a class/interface name
      return TypeRefKind.CLASS;
    }
    return TypeRefKind.CLASS;
  }

  /**
   * Checks if a syntax node represents a Java type.
   * 
   * @param node The syntax node to check
   * @returns true if the node represents a type
   */
  static isTypeNode(node: Parser.SyntaxNode): boolean {
    return [
      'type_identifier',
      'generic_type',
      'scoped_type_identifier',
      'array_type',
      'integral_type',
      'floating_point_type',
      'boolean_type',
      'void_type',
      'annotated_type',
    ].includes(node.type);
  }

  /**
   * Unwraps an annotated_type node to get the underlying type.
   * 
   * For `@Annotation Type`, returns the node for `Type`.
   * For non-annotated types, returns the node as-is.
   * 
   * @param typeNode The potentially annotated type node
   * @returns The underlying type node
   */
  static unwrapAnnotatedType(typeNode: Parser.SyntaxNode): Parser.SyntaxNode {
    if (typeNode.type === 'annotated_type') {
      // Find the actual type child (skip annotations)
      for (const child of typeNode.children) {
        if (JavaTreeSitterUtils.isTypeNode(child) && child.type !== 'annotated_type') {
          return child;
        }
      }
    }
    return typeNode;
  }

  /**
   * Extracts the simple type name from a type syntax node.
   * 
   * Handles various type node structures:
   * - generic_type: extracts name field
   * - scoped_type_identifier: extracts name field
   * - other types: returns node text
   * 
   * @param typeNode The type syntax node
   * @returns The extracted type name or null
   */
  static extractTypeName(typeNode: Parser.SyntaxNode): string | null {
    // Unwrap annotated_type to get the actual type
    let actualType = JavaTreeSitterUtils.unwrapAnnotatedType(typeNode);
    
    // Unwrap catch_type to get the actual type node inside
    // catch_type wraps the exception type in catch clauses: catch (IOException e)
    // For multi-catch (IOException | SQLException), we extract the first type's simple name
    if (actualType.type === 'catch_type') {
      const innerType = actualType.children.find(c => 
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
      );
      if (innerType) {
        actualType = innerType;
      }
    }
    
    if (actualType.type === 'generic_type') {
      // Find the type name child - can be type_identifier (simple) or scoped_type_identifier (FQN)
      // For simple generics like List<String>, child is type_identifier
      // For FQN generics like java.util.Map<...>, child is scoped_type_identifier
      const nameNode = actualType.children.find(c => 
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
      );
      if (!nameNode) return null;
      
      // For scoped_type_identifier, extract the last identifier (simple name)
      if (nameNode.type === 'scoped_type_identifier') {
        const identifiers = nameNode.children.filter(c => c.type === 'type_identifier');
        return identifiers.length > 0 ? identifiers[identifiers.length - 1]?.text ?? null : null;
      }
      return nameNode.text;
    }
    if (actualType.type === 'scoped_type_identifier') {
      // For scoped types, the name is the last type_identifier
      const identifiers = actualType.children.filter(c => c.type === 'type_identifier');
      return identifiers.length > 0 ? identifiers[identifiers.length - 1]?.text ?? null : null;
    }
    return actualType.text;
  }

  /**
   * Extracts the COMPLETE type name from a syntax node, preserving qualifier chains.
   * 
   * Unlike extractTypeName which returns only the last identifier (simple name),
   * this method returns the full dotted chain as written in source code.
   * 
   * Examples:
   * - `Builder` → "Builder" (same as extractTypeName)
   * - `KeyRangeIterator.Builder` → "KeyRangeIterator.Builder" (extractTypeName returns "Builder")
   * - `Map.Entry` → "Map.Entry" (extractTypeName returns "Entry")
   * - `java.util.List` → "java.util.List" (extractTypeName returns "List")
   * 
   * @param typeNode The type syntax node
   * @returns The complete type name including qualifiers, or null
   */
  static extractCompleteTypeName(typeNode: Parser.SyntaxNode): string | null {
    // Unwrap annotated_type to get the actual type
    let actualType = JavaTreeSitterUtils.unwrapAnnotatedType(typeNode);

    // Unwrap catch_type to get the actual type node inside
    if (actualType.type === 'catch_type') {
      const innerType = actualType.children.find(c =>
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
      );
      if (innerType) {
        actualType = innerType;
      }
    }

    if (actualType.type === 'generic_type') {
      // Find the type name child — can be type_identifier or scoped_type_identifier
      const nameNode = actualType.children.find(c =>
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
      );
      if (!nameNode) return null;
      // Return the full text of the name node (including dots for scoped types)
      return nameNode.text;
    }
    if (actualType.type === 'scoped_type_identifier') {
      // Return the full scoped name (e.g., "KeyRangeIterator.Builder")
      return actualType.text;
    }
    return actualType.text;
  }

  /**
   * Resolves a fully qualified name from a simple type name and package.
   * 
   * @param typeName The simple type name
   * @param packageName The package name (can be null)
   * @returns The qualified name
   */
  static resolveQualifiedName(typeName: string, packageName: string | null): string {
    if (!packageName) return typeName;
    if (typeName.includes('.')) return typeName; // Already qualified
    return `${packageName}.${typeName}`;
  }

  /**
   * Extracts the package name from a fully qualified name.
   * 
   * @param qualifiedName The fully qualified name
   * @returns The package name (empty string if no package)
   */
  static extractPackageName(qualifiedName: string): string {
    const lastDot = qualifiedName.lastIndexOf('.');
    if (lastDot === -1) return ''; // No package
    return qualifiedName.substring(0, lastDot);
  }

  /**
   * Extracts wildcard variance from a wildcard syntax node.
   * 
   * Determines if the wildcard is:
   * - UNBOUNDED: `?`
   * - EXTENDS: `? extends Type`
   * - SUPER: `? super Type`
   * 
   * @param wildcardNode The wildcard syntax node
   * @returns The wildcard variance
   */
  static extractWildcardVariance(wildcardNode: Parser.SyntaxNode): WildcardVariance {
    for (const child of wildcardNode.children) {
      if (child.type === 'extends') {
        return WildcardVariance.EXTENDS;
      }
      if (child.type === 'super') {
        return WildcardVariance.SUPER;
      }
    }
    return WildcardVariance.UNBOUNDED;
  }

  /**
   * Finds the bound type node within a wildcard node.
   * 
   * For `? extends T`, this returns the node for `T`.
   * 
   * @param wildcardNode The wildcard syntax node
   * @returns The bound type node or null if unbounded
   */
  static findBoundNode(wildcardNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of wildcardNode.children) {
      if (JavaTreeSitterUtils.isTypeNode(child)) {
        return child;
      }
    }
    return null;
  }

  /**
   * Counts the number of array dimensions in an array type node.
   * 
   * For `String[][]`, returns 2.
   * 
   * Tree-sitter represents multi-dimensional arrays with a FLAT structure:
   * - `int[][]` is a single `array_type` node
   * - The `dimensions` child contains all brackets: `[][]`
   * - NOT nested `array_type` nodes
   * 
   * So we count the `[` tokens in the dimensions node.
   * 
   * @param arrayNode The array type syntax node
   * @returns The number of dimensions
   */
  static countArrayDimensions(arrayNode: Parser.SyntaxNode): number {
    if (arrayNode.type !== 'array_type') {
      return 0;
    }

    // Find the 'dimensions' child node which contains all the [][][] brackets
    const dimensionsNode = arrayNode.childForFieldName('dimensions');
    if (!dimensionsNode) {
      return 0;
    }

    // Count the '[' tokens in the dimensions node
    let count = 0;
    for (const child of dimensionsNode.children) {
      if (child.type === '[') {
        count++;
      }
    }

    return count;
  }

  /**
   * Finds the element type node of an array type.
   * 
   * For `String[][]`, returns the node for `String`.
   * 
   * Tree-sitter represents multi-dimensional arrays with a FLAT structure:
   * - `int[][]` has element = `integral_type` (directly, not nested array_type)
   * - The 'element' field points directly to the base type
   * 
   * @param arrayNode The array type syntax node
   * @returns The element type node or null
   */
  static findArrayElementType(arrayNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (arrayNode.type !== 'array_type') {
      return null;
    }

    // In tree-sitter-java's flat structure, 'element' points directly to the base type
    return arrayNode.childForFieldName('element');
  }
}
