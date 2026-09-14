/**
 * Classifies the structural form of a type reference in Java source code.
 *
 * Provides information about what the structural form the type has.
 *
 * This enumeration distinguishes between different syntactic forms that type
 * references can take, enabling precise parsing and representation of Java's
 * type system within the dependency analysis framework.
 *
 * ## Type Reference Forms
 *
 * - **CLASS** – Simple class or interface reference (`String`, `List`)
 * - **PARAMETERIZED** – Generic type with arguments (`List<String>`, `Map<K,V>`)
 * - **WILDCARD** – Wildcard type argument (`?`, `? extends T`, `? super T`)
 * - **TYPE_VARIABLE** – Reference to a type parameter (`T`, `K`, `V`)
 * - **ARRAY** – Array type reference (`String[]`, `int[][]`, `T[]`)
 * - **PRIMITIVE** – Primitive type reference (`int`, `boolean`, `char`)
 *
 * ## Classification Examples
 *
 * ```java
 * // CLASS - Simple type references
 * String name;                    // CLASS: String
 * List list;                      // CLASS: List (raw type)
 * CustomService service;          // CLASS: CustomService
 *
 * // PARAMETERIZED - Generic types with arguments
 * List<String> names;             // PARAMETERIZED: List<String>
 *                                 //   └─ Child: CLASS: String
 * Map<String, Integer> counts;    // PARAMETERIZED: Map<String,Integer>
 *                                 //   ├─ Child: CLASS: String
 *                                 //   └─ Child: CLASS: Integer
 *
 * // WILDCARD - Wildcard type arguments
 * List<?> unknown;                // PARAMETERIZED: List<?>
 *                                 //   └─ Child: WILDCARD: ? (UNBOUNDED)
 * List<? extends Number> nums;    // PARAMETERIZED: List<? extends Number>
 *                                 //   └─ Child: WILDCARD: ? extends
 *                                 //       └─ Child: CLASS: Number
 *
 * // TYPE_VARIABLE - References to type parameters
 * class Container<T> {
 *     private T value;            // TYPE_VARIABLE: T
 *     List<T> items;              // PARAMETERIZED: List<T>
 *                                 //   └─ Child: TYPE_VARIABLE: T
 * }
 *
 * // TYPE_VARIABLE as bound - with variance
 * public <U extends T> void method(U item) { }
 * // TYPE_VARIABLE: T with EXTENDS variance (in METHOD_TYPE_PARAM_BOUND context)
 *
 * // ARRAY - Array type references
 * String[] names;                 // ARRAY: String[] (1 dimension)
 * int[][] matrix;                 // ARRAY: int[][] (2 dimensions)
 * T[] genericArray;               // ARRAY: T[] (generic array)
 *
 * // PRIMITIVE - Primitive type references
 * int count;                      // PRIMITIVE: int
 * boolean flag;                   // PRIMITIVE: boolean
 * char letter;                    // PRIMITIVE: char
 *
 * // COMPLEX COMBINATIONS
 * Map<String, List<? extends T>[]> complex;
 * // PARAMETERIZED: Map<String, List<? extends T>[]>
 * //   ├─ Child: CLASS: String
 * //   └─ Child: ARRAY: List<? extends T>[]
 * //       └─ Child: PARAMETERIZED: List<? extends T>
 * //           └─ Child: WILDCARD: ? extends
 * //               └─ Child: TYPE_VARIABLE: T
 * ```
 *
 * ## Implementation Guidelines
 *
 * - **Hierarchy:** PARAMETERIZED types create parent-child relationships for their arguments
 * - **Nesting:** Complex types can nest multiple kinds (ARRAY of PARAMETERIZED with WILDCARD)
 * - **Context Independence:** Same kind can appear in different TypeRefContext values
 * - **Primitive Handling:** Only use PRIMITIVE for actual primitive types, not their wrapper classes
 */
export enum TypeRefKind {
  /** Simple class or interface reference (String, List, CustomType). */
  CLASS = 'CLASS',

  /** Generic type with type arguments (List<String>, Map<K,V>). */
  PARAMETERIZED = 'PARAMETERIZED',

  /** Wildcard type argument (?, ? extends T, ? super T). */
  WILDCARD = 'WILDCARD',

  /** Reference to a declared type parameter (T, K, V). May have wildcardVariance when used as a bound. */
  TYPE_VARIABLE = 'TYPE_VARIABLE',

  /** Array type reference (String[], int[][], T[]). */
  ARRAY = 'ARRAY',

  /** Primitive type reference (int, boolean, char, double). */
  PRIMITIVE = 'PRIMITIVE',
}
