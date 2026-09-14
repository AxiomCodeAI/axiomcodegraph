/**
 * Identifies the type of entity being referenced by an expression.
 *
 * This enumeration classifies what kind of entity an expression refers to,
 * enabling proper linking to the appropriate registry (TypeRegistry,
 * FieldRegistry, MethodRegistry, etc.).
 *
 * ## Entity Categories
 *
 * - **TYPE** – Class, interface, enum type reference
 * - **FIELD** – Instance or static field reference
 * - **METHOD** – Method being invoked
 * - **CONSTRUCTOR** – Constructor being called (new expressions)
 * - **ENUM_CONSTANT** – Enum constant value
 * - **LOCAL_VARIABLE** – Local variable reference
 * - **PARAMETER** – Method parameter reference
 * - **THIS** – Qualified this (OuterClass.this) or this() constructor invocation
 * - **SUPER** – Qualified super or super() constructor invocation
 * - **PATTERN_BINDING** – Pattern variable declaration in instanceof/switch patterns (Java 16+)
 * - **PATTERN_BINDING_VARIABLE** – Reference to a pattern binding variable (usage site)
 * - **LAMBDA_PARAMETER** – Lambda parameter declaration (x -> ..., (a, b) -> ...)
 * - **UNKNOWN** – Cannot determine at extraction time
 *
 * ## Classification Examples
 *
 * ```java
 * public class Example {
 *     private static final int DEFAULT = 100;
 *     private int count;
 *
 *     // TYPE - Reference to a type
 *     private Class<?> type = String.class;       // referencedEntityKind: TYPE (for String)
 *     private int max = Integer.MAX_VALUE;        // Integer is TYPE
 *     private List<String> list = Collections.emptyList();  // Collections is TYPE
 *
 *     // FIELD - Reference to a field
 *     private int timeout = DEFAULT;              // referencedEntityKind: FIELD
 *     private int copy = count;                   // referencedEntityKind: FIELD
 *     private double pi = Math.PI;                // referencedEntityKind: FIELD (static field)
 *
 *     // METHOD - Method being invoked
 *     private String data = getData();            // referencedEntityKind: METHOD
 *     private int abs = Math.abs(-5);             // referencedEntityKind: METHOD
 *
 *     // CONSTRUCTOR - Constructor being called
 *     private User user = new User("John");       // referencedEntityKind: CONSTRUCTOR
 *     private List<String> items = new ArrayList<>();  // referencedEntityKind: CONSTRUCTOR
 *
 *     // ENUM_CONSTANT - Enum constant reference
 *     private Status status = Status.ACTIVE;     // referencedEntityKind: ENUM_CONSTANT
 *     private Priority p = Priority.HIGH;        // referencedEntityKind: ENUM_CONSTANT
 *
 *     // LOCAL_VARIABLE - Local variable reference (method body context)
 *     // void method() {
 *     //     int x = 5;
 *     //     int y = x + 1;  // x is LOCAL_VARIABLE
 *     // }
 *
 *     // PARAMETER - Method parameter reference (method body context)
 *     // int add(List<Integer> list, int b) {
 *     //     return list.stream().sum() + b;  // list is PARAMETER, b is PARAMETER
 *     // }
 *     // void process(String input) {
 *     //     System.out.println(input);  // input is PARAMETER
 *     // }
 *
 *     // THIS - Qualified this or this() constructor invocation
 *     // class Outer {
 *     //     class Inner {
 *     //         Object o = Outer.this;  // referencedEntityKind: THIS (qualified this)
 *     //         Inner() { this(0); }    // referencedEntityKind: THIS (constructor invocation)
 *     //     }
 *     // }
 *
 *     // SUPER - Qualified super or super() constructor invocation
 *     // class Child extends Parent {
 *     //     Child() { super(); }             // referencedEntityKind: SUPER
 *     //     Child(int x) { super(x, null); } // referencedEntityKind: SUPER (with args)
 *     // }
 *
 *     // PATTERN_BINDING - Pattern variable declaration in instanceof/switch patterns (Java 16+)
 *     // obj instanceof Person(String name, int age)  // name, age declarations are PATTERN_BINDING
 *     // case Point(int x, int y) -> ...              // x, y declarations are PATTERN_BINDING
 *
 *     // PATTERN_BINDING_VARIABLE - Usage of a pattern binding variable (Java 16+)
 *     // (obj instanceof String s) ? s.toUpperCase() : "default"  // s in s.toUpperCase() is PATTERN_BINDING_VARIABLE
 *     // obj instanceof List<?> list ? list : null                // list after ? is PATTERN_BINDING_VARIABLE
 *
 *     // LAMBDA_PARAMETER - Lambda parameter declaration (Java 8+)
 *     // Function<String, Integer> f = s -> s.length();     // s is LAMBDA_PARAMETER
 *     // BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;  // a, b are LAMBDA_PARAMETER
 *     // Consumer<String> c = (String str) -> System.out.println(str);  // str is LAMBDA_PARAMETER
 *     // Note: The parameter declaration itself is LAMBDA_PARAMETER.
 *     // Usage of the parameter inside the lambda body requires scope analysis (Datalog).
 *
 *     // UNKNOWN - Truly cannot determine (rare for field initializers)
 *     // This should be rare since field initializers have well-defined scope
 * }
 * ```
 *
 * ## Resolution Strategy
 *
 * For **field initializers**, resolution happens at extraction time:
 * 1. Check if identifier exists as field in current class → FIELD
 * 2. Check if it's a static import → FIELD or METHOD
 * 3. Check if it's a type name (capitalized, in imports) → TYPE
 * 4. Otherwise → UNKNOWN (should be rare)
 *
 * For **method bodies**, resolution happens at extraction time:
 * 1. Check if identifier matches a method parameter name → PARAMETER
 * 2. Otherwise → falls back to naming convention (LOCAL_VARIABLE requires scope analysis)
 */
export enum ReferencedEntityKind {
  /** Reference to a type (class, interface, enum). */
  TYPE = 'TYPE',

  /** Reference to a field (instance or static). */
  FIELD = 'FIELD',

  /** Reference to a method being called. */
  METHOD = 'METHOD',

  /** Reference to a constructor being called. */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /** Reference to an enum constant. */
  ENUM_CONSTANT = 'ENUM_CONSTANT',

  /** Reference to a local variable (method body context). */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  /** Reference to a method parameter (method body context). */
  PARAMETER = 'PARAMETER',

  /** Reference to 'this' in a qualified this expression (e.g., OuterClass.this) or this() constructor invocation. */
  THIS = 'THIS',

  /** Reference to 'super' in a qualified super expression or super() constructor invocation. */
  SUPER = 'SUPER',

  /** Pattern variable binding in instanceof/switch patterns (Java 16+) - the declaration site. */
  PATTERN_BINDING = 'PATTERN_BINDING',

  /** Reference to a pattern binding variable (usage site, e.g., `s` in `s.toUpperCase()` after `instanceof String s`). */
  PATTERN_BINDING_VARIABLE = 'PATTERN_BINDING_VARIABLE',

  /** Lambda parameter declaration (x -> ..., (a, b) -> ...). */
  LAMBDA_PARAMETER = 'LAMBDA_PARAMETER',

  /** Cannot determine the entity type at extraction time. */
  UNKNOWN = 'UNKNOWN',
}
