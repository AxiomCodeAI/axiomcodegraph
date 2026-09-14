/**
 * Utility functions for resolving Java type qualified names from imports.
 * 
 * These utilities handle type name resolution including:
 * - Primitive types (int, boolean, etc.)
 * - java.lang.* types (String, Object, etc.)
 * - Explicitly imported types
 * - Same-package type assumptions
 * - Array type resolution
 * - Type parameter detection
 */

/**
 * Result of type qualified name resolution
 */
export interface TypeResolutionResult {
  potentialQualifiedName: string | null;
  isAmbiguous: boolean;
}

/**
 * Java primitive types - no qualified name needed
 */
const JAVA_PRIMITIVES = new Set([
  'byte', 'short', 'int', 'long', 'float', 'double', 'boolean', 'char', 'void'
]);

/**
 * java.lang.* types that are implicitly imported in Java
 */
const JAVA_LANG_TYPES = new Set([
  // Primitive wrappers
  'Boolean', 'Byte', 'Character', 'Double', 'Float', 'Integer', 'Long', 'Short', 'Void',
  // Core classes
  'Class', 'ClassLoader', 'ClassValue', 'Compiler', 'Enum', 'InheritableThreadLocal',
  'Math', 'Module', 'ModuleLayer', 'Number', 'Object', 'Package', 'Process',
  'ProcessBuilder', 'Record', 'Runtime', 'SecurityManager', 'StackTraceElement',
  'StrictMath', 'String', 'StringBuffer', 'StringBuilder', 'System', 'Thread',
  'ThreadGroup', 'ThreadLocal',
  // Interfaces
  'Appendable', 'AutoCloseable', 'CharSequence', 'Cloneable', 'Comparable', 'Iterable',
  'Readable', 'Runnable',
  // Throwable hierarchy
  'Throwable', 'Exception', 'RuntimeException', 'Error',
  // Exceptions
  'ArithmeticException', 'ArrayIndexOutOfBoundsException', 'ArrayStoreException',
  'ClassCastException', 'ClassNotFoundException', 'CloneNotSupportedException',
  'EnumConstantNotPresentException', 'IllegalAccessException', 'IllegalArgumentException',
  'IllegalCallerException', 'IllegalMonitorStateException', 'IllegalStateException',
  'IllegalThreadStateException', 'IndexOutOfBoundsException', 'InstantiationException',
  'InterruptedException', 'LayerInstantiationException', 'MatchException',
  'NegativeArraySizeException', 'NoSuchFieldException', 'NoSuchMethodException',
  'NullPointerException', 'NumberFormatException', 'ReflectiveOperationException',
  'SecurityException', 'StringIndexOutOfBoundsException', 'TypeNotPresentException',
  'UnsupportedOperationException', 'WrongThreadException',
  // Errors
  'AbstractMethodError', 'AssertionError', 'BootstrapMethodError', 'ClassCircularityError',
  'ClassFormatError', 'ExceptionInInitializerError', 'IllegalAccessError',
  'IncompatibleClassChangeError', 'InstantiationError', 'InternalError', 'LinkageError',
  'NoClassDefFoundError', 'NoSuchFieldError', 'NoSuchMethodError', 'OutOfMemoryError',
  'StackOverflowError', 'ThreadDeath', 'UnknownError', 'UnsatisfiedLinkError',
  'UnsupportedClassVersionError', 'VerifyError', 'VirtualMachineError',
  // Annotations
  'Deprecated', 'FunctionalInterface', 'Native', 'Override', 'SafeVarargs', 'SuppressWarnings'
]);

/**
 * Resolves a type name to its potential fully qualified name.
 * 
 * Resolution rules:
 * - Primitives: null, not ambiguous
 * - Type parameters (T, U, etc.): null, not ambiguous
 * - java.lang.* types: java.lang.TypeName, not ambiguous
 * - Explicit import: fully qualified from import, not ambiguous
 * - No import with package: package.TypeName, ambiguous if star imports exist
 * - Already qualified (contains '.'): use as-is, not ambiguous
 * - Array types: resolve base type, append array markers
 * 
 * @param baseType - The simple or qualified type name to resolve
 * @param packageName - The package of the current file (null if default package)
 * @param importMap - Map of simple names to fully qualified names from imports
 * @param hasStarImports - Whether the file has any star (*) imports
 * @param declaredTypeParams - Set of declared type parameter names (T, U, K, V, etc.)
 * @returns Resolution result with potentialQualifiedName and isAmbiguous flag
 */
export function resolveTypeQualifiedName(
  baseType: string,
  packageName: string | null,
  importMap: Map<string, string>,
  hasStarImports: boolean,
  declaredTypeParams: Set<string> = new Set()
): TypeResolutionResult {
  // Handle primitives - no qualified name
  if (JAVA_PRIMITIVES.has(baseType)) {
    return { potentialQualifiedName: null, isAmbiguous: false };
  }

  // Handle type parameters (T, U, K, V, etc.) - no qualified name
  if (declaredTypeParams.has(baseType)) {
    return { potentialQualifiedName: null, isAmbiguous: false };
  }

  // Handle java.lang.* types (implicitly imported in Java)
  if (JAVA_LANG_TYPES.has(baseType)) {
    return { potentialQualifiedName: `java.lang.${baseType}`, isAmbiguous: false };
  }

  // Handle arrays - strip array markers and recurse on base
  if (baseType.includes('[')) {
    const arrayBaseType = baseType.replace(/\[\]/g, '');
    const resolved = resolveTypeQualifiedName(arrayBaseType, packageName, importMap, hasStarImports, declaredTypeParams);
    // Add back array markers to qualified name if present
    if (resolved.potentialQualifiedName) {
      const arrayMarkers = baseType.match(/\[\]/g)?.join('') || '';
      return {
        potentialQualifiedName: resolved.potentialQualifiedName + arrayMarkers,
        isAmbiguous: resolved.isAmbiguous
      };
    }
    return resolved;
  }

  // If contains '.', could be:
  // 1. Already fully qualified (e.g., "java.util.List") 
  // 2. Inner class reference (e.g., "DataInitializer.TempClass")
  // Resolve the leftmost part and append the rest
  if (baseType.includes('.')) {
    const dotIndex = baseType.indexOf('.');
    const leftmost = baseType.substring(0, dotIndex);
    const rest = baseType.substring(dotIndex); // includes the leading '.'
    
    // If leftmost is a java.lang type, it's not a package prefix - resolve it
    if (JAVA_LANG_TYPES.has(leftmost)) {
      return { potentialQualifiedName: `java.lang.${leftmost}${rest}`, isAmbiguous: false };
    }
    
    // Check for explicit import of the leftmost part
    const explicitImport = importMap.get(leftmost);
    if (explicitImport) {
      return { potentialQualifiedName: `${explicitImport}${rest}`, isAmbiguous: false };
    }
    
    // If leftmost looks like a package (lowercase), treat as already qualified
    if (leftmost.charAt(0) === leftmost.charAt(0).toLowerCase()) {
      return { potentialQualifiedName: baseType, isAmbiguous: false };
    }
    
    // Leftmost is a class name - assume same package, mark ambiguous if star imports
    if (packageName) {
      return { 
        potentialQualifiedName: `${packageName}.${baseType}`, 
        isAmbiguous: hasStarImports 
      };
    }
    
    // No package - cannot fully resolve
    return { potentialQualifiedName: baseType, isAmbiguous: true };
  }

  // Check for explicit import
  const explicitImport = importMap.get(baseType);
  if (explicitImport) {
    return { potentialQualifiedName: explicitImport, isAmbiguous: false };
  }

  // No explicit import - assume same package
  if (packageName) {
    const assumedQualifiedName = `${packageName}.${baseType}`;
    // Mark as ambiguous if star imports exist (could be from star import instead)
    return { potentialQualifiedName: assumedQualifiedName, isAmbiguous: hasStarImports };
  }

  // No package and no import - cannot resolve
  return { potentialQualifiedName: null, isAmbiguous: true };
}

/**
 * Checks if a type name is a Java primitive
 */
export function isPrimitiveType(typeName: string): boolean {
  return JAVA_PRIMITIVES.has(typeName);
}

/**
 * Checks if a type name is a java.lang.* type
 */
export function isJavaLangType(typeName: string): boolean {
  return JAVA_LANG_TYPES.has(typeName);
}
