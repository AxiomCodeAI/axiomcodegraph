/**
 * Import Kind Classification (Java 23+)
 *
 * Categorizes import declarations based on their type and behavior.
 * Each import statement is assigned exactly ONE ImportKind.
 *
 * Values:
 * - SINGLE_TYPE: Single type import (import java.util.List;)
 * - TYPE_ON_DEMAND: Wildcard type import (import java.util.*;)
 * - SINGLE_STATIC: Single static member import (import static java.lang.Math.PI;)
 * - STATIC_ON_DEMAND: Wildcard static import (import static java.lang.Math.*;)
 * - MODULE: Module import - Java 23+ JEP 476 (import module java.base;)
 *
 * Grammar (JLS):
 * ```
 * ImportDeclaration:
 *     SingleTypeImportDeclaration
 *     TypeImportOnDemandDeclaration
 *     SingleStaticImportDeclaration
 *     StaticImportOnDemandDeclaration
 *     ModuleImportDeclaration
 *
 * SingleTypeImportDeclaration:
 *     import TypeName ;
 *
 * TypeImportOnDemandDeclaration:
 *     import PackageOrTypeName . * ;
 *
 * SingleStaticImportDeclaration:
 *     import static TypeName . Identifier ;
 *
 * StaticImportOnDemandDeclaration:
 *     import static TypeName . * ;
 *
 * ModuleImportDeclaration:
 *     import module ModuleName ;
 * ```
 *
 * Examples:
 * ```java
 * // SINGLE_TYPE - imports a specific type
 * import java.util.List;
 * import com.example.MyClass;
 *
 * // TYPE_ON_DEMAND - imports all public types from a package
 * import java.util.*;
 * import com.example.models.*;
 *
 * // SINGLE_STATIC - imports a specific static member
 * import static java.lang.Math.PI;
 * import static java.lang.Math.max;
 *
 * // STATIC_ON_DEMAND - imports all static members from a type
 * import static java.lang.Math.*;
 * import static org.junit.Assert.*;
 *
 * // MODULE (Java 23+) - imports all public types from all packages exported by a module
 * import module java.base;
 * import module java.sql;
 * import module com.example.mymodule;
 * ```
 *
 * Determination Logic:
 * 1. Check for "module" keyword → MODULE
 * 2. Check for "static" keyword:
 *    - With "*" → STATIC_ON_DEMAND
 *    - Without "*" → SINGLE_STATIC
 * 3. Non-static imports:
 *    - With "*" → TYPE_ON_DEMAND
 *    - Without "*" → SINGLE_TYPE
 */
export enum ImportKind {
  SINGLE_TYPE = 'SINGLE_TYPE',
  TYPE_ON_DEMAND = 'TYPE_ON_DEMAND',
  SINGLE_STATIC = 'SINGLE_STATIC',
  STATIC_ON_DEMAND = 'STATIC_ON_DEMAND',
  MODULE = 'MODULE',
}
