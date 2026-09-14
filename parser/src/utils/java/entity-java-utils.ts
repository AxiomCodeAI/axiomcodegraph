/**
 * Java-specific entity utilities.
 *
 * Contains helper methods for Java language constructs like primitive types,
 * type qualifications, and other Java-specific validations.
 */
export class EntityJavaUtils {
  /**
   * Checks if a type name is a Java primitive type.
   *
   * @param typeName The type name to check
   * @returns true if the type is a Java primitive, false otherwise
   */
  static isPrimitiveType(typeName: string): boolean {
    const primitives = [
      'boolean',
      'byte',
      'char',
      'short',
      'int',
      'long',
      'float',
      'double',
      'void',
    ];
    return primitives.includes(typeName);
  }
}
