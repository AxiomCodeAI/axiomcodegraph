/**
 * Classifies the type of method reference expression.
 *
 * This enumeration distinguishes between different forms of method references
 * (Type::method syntax), enabling precise analysis of functional interface usage.
 *
 * ## Method Reference Categories
 *
 * - **QUALIFIED_METHOD** – Reference to a method via qualifier (Type::method, obj::method)
 * - **CONSTRUCTOR** – Reference to constructor (ArrayList::new)
 * - **ARRAY_CONSTRUCTOR** – Reference to array constructor (int[]::new)
 * - **SUPER** – Reference to superclass method (super::method, Child.super::method)
 *
 * ## Why QUALIFIED_METHOD combines STATIC, BOUND, and UNBOUND
 *
 * Without full type resolution (which tree-sitter doesn't provide), we cannot
 * reliably distinguish between:
 * - **STATIC vs UNBOUND**: Both use `Type::method` syntax. Distinguishing requires
 *   knowing if the method is static or instance.
 * - **BOUND vs UNBOUND**: `prefix::length` vs `String::length`. Distinguishing
 *   requires knowing if the qualifier is a variable or a type name.
 *
 * Downstream consumers with type resolution can further classify if needed.
 *
 * ## Classification Examples
 *
 * ```java
 * public class MethodReferenceExamples {
 *     private String prefix = "Hello";
 *
 *     // QUALIFIED_METHOD - Reference to method via qualifier
 *     private Function<Integer, Integer> abs = Math::abs;
 *     //                                        ^^^^^^^^
 *     //                                        methodReferenceKind: QUALIFIED_METHOD
 *     //                                        (could be static or unbound - we can't tell)
 *
 *     private Supplier<Integer> len = prefix::length;
 *     //                              ^^^^^^^^^^^^^^
 *     //                              methodReferenceKind: QUALIFIED_METHOD
 *     //                              (could be bound instance method)
 *
 *     private Function<String, Integer> strLen = String::length;
 *     //                                         ^^^^^^^^^^^^^^
 *     //                                         methodReferenceKind: QUALIFIED_METHOD
 *     //                                         (could be unbound instance method)
 *
 *     // CONSTRUCTOR - Reference to constructor
 *     private Supplier<List<String>> listFactory = ArrayList::new;
 *     //                                           ^^^^^^^^^^^^^
 *     //                                           methodReferenceKind: CONSTRUCTOR
 *
 *     private Function<String, User> userFactory = User::new;
 *     //                                           ^^^^^^^^
 *     //                                           methodReferenceKind: CONSTRUCTOR
 *
 *     // ARRAY_CONSTRUCTOR - Reference to array constructor
 *     private IntFunction<int[]> intArrayFactory = int[]::new;
 *     //                                           ^^^^^^^^^^
 *     //                                           methodReferenceKind: ARRAY_CONSTRUCTOR
 *
 *     private IntFunction<String[]> strArrayFactory = String[]::new;
 *     //                                              ^^^^^^^^^^^^^
 *     //                                              methodReferenceKind: ARRAY_CONSTRUCTOR
 *
 *     // SUPER - Reference to superclass method
 *     class Child extends Parent {
 *         private Runnable r = super::parentMethod;
 *         //                   ^^^^^^^^^^^^^^^^^^
 *         //                   methodReferenceKind: SUPER
 *
 *         class Inner {
 *             // Qualified super from inner class
 *             private Runnable r2 = Child.super::parentMethod;
 *             //                    ^^^^^^^^^^^^^^^^^^^^^^^^^
 *             //                    methodReferenceKind: SUPER
 *         }
 *     }
 * }
 * ```
 *
 * ## Linking
 *
 * - QUALIFIED_METHOD, SUPER → link to MethodRegistry via invokedMethodHash
 * - CONSTRUCTOR → link to MethodRegistry (constructor) via invokedConstructorHash
 * - CONSTRUCTOR, ARRAY_CONSTRUCTOR → link to TypeRegistry via createdTypeHash
 */
export enum MethodReferenceKind {
  /** Reference to method via qualifier (Math::abs, str::length, String::length). */
  QUALIFIED_METHOD = 'QUALIFIED_METHOD',

  /** Reference to constructor (ArrayList::new, User::new). */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /** Reference to array constructor (int[]::new, String[]::new). */
  ARRAY_CONSTRUCTOR = 'ARRAY_CONSTRUCTOR',

  /** Reference to superclass method (super::method, Child.super::method). */
  SUPER = 'SUPER',
}
