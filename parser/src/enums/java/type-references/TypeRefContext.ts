/**
 * Identifies WHERE a type reference appears in Java source code.
 *
 * This enum answers the question: "In what syntactic location is this type being used?"
 * It classifies the specific code context where each type reference occurs, enabling
 * precise tracking of how types are used throughout your codebase.
 *
 * ## Reference Contexts
 *
 * - **TYPE_PARAM_BOUND** – Type bound in a class/interface generic parameter declaration (`class Box<T extends Number>`)
 * - **METHOD_TYPE_PARAM_BOUND** – Type bound in a method generic parameter declaration (`<T extends Shape> void process(T item)`)
 * - **SUPER_TYPE** – Superclass or extended type in a class or record declaration
 * - **IMPLEMENTS_INTERFACE** – Implemented interface in a class or record declaration
 * - **PERMITS** – Permitted subtype in a sealed class or interface declaration
 * - **FIELD_TYPE** – Declared type of a field
 * - **METHOD_RETURN** – Declared return type of a method or constructor
 * - **METHOD_PARAM** – Declared type of a formal method or constructor parameter
 * - **ANNOTATION_PARAM** – Declared type of an annotation element value
 * - **THROWS_CLAUSE** – Declared exception type in a method or constructor throws clause
 * - **LOCAL_VARIABLE** – Declared type of a local variable within a block or method scope
 * - **CAST_EXPRESSION** – Target type used in an explicit cast expression
 * - **METHOD_TYPE_ARGUMENT** – Explicit type argument in a generic method invocation (`Collections.<String>emptyList()`)
 * - **INSTANCEOF_TYPE** – Type tested in an instanceof expression (`obj instanceof String`)
 * - **OBJECT_CREATION_TYPE** – Type instantiated in a new expression (`new ArrayList<String>()`)
 * - **ARRAY_CREATION_TYPE** – Element type in an array creation expression (`new int[3]`, `new String[] { }`)
 * - **RECORD_PATTERN_TYPE** – Record type in a record pattern (`Person` in `obj instanceof Person(String name, int age)`)
 * - **PATTERN_BINDING_TYPE** – Declared type of a pattern binding variable (`String` in `Person(String name, int age)`)
 * - **LAMBDA_PARAMETER_TYPE** – Declared type of a lambda parameter (`String` in `(String s) -> s.length()`)
 *
 * ## Implementation Assumptions
 *
 * - **Position:** When multiple references occur in the same context (e.g., `extends A & B`),
 *   the position field preserves their source ordering
 * - **Hierarchy:** Generic arguments form a parent–child tree (e.g., `List<String>`
 *   → `List`(parent) → `String`(child))
 * - **Linking:** Each context links to a specific registry type via its corresponding
 *   hash identifier (e.g., field, method, or type)
 * - **Wildcards:** Represented using WildcardVariance with nested child nodes for their bounds
 *
 * ## Comprehensive Example
 *
 * ```java
 * // Complex class demonstrating all major contexts
 * @Entity(name = "users", targetEntity = User.class)  // ANNOTATION_PARAM: User.class
 * public sealed class UserService<T extends BaseEntity & Auditable>  // TYPE_PARAM_BOUND: BaseEntity, Auditable
 *        extends AbstractService<T>                    // SUPER_TYPE: AbstractService<T>
 *        implements CrudService<T, Long>, Serializable // IMPLEMENTS_INTERFACE: CrudService<T,Long>, Serializable
 *        permits StandardUserService, AdminUserService { // PERMITS: StandardUserService, AdminUserService
 *
 *     // Field type references
 *     private Repository<T> repository;               // FIELD_TYPE: Repository<T>
 *     private final List<String> validationRules;    // FIELD_TYPE: List<String>
 *     private Map<String, ? extends Number> metrics; // FIELD_TYPE: Map<String, ? extends Number>
 *
 *     // Method with multiple contexts
 *     public Optional<T> findById(Long id, Class<? super T> type) // METHOD_RETURN: Optional<T>
 *                                                                 // METHOD_PARAM: Long, Class<? super T>
 *            throws ServiceException, ValidationException {      // THROWS_CLAUSE: ServiceException, ValidationException
 *
 *         // Local variable context
 *         String cacheKey = generateKey(id);          // LOCAL_VARIABLE: String
 *         List<T> results = new ArrayList<>();        // LOCAL_VARIABLE: List<T>
 *
 *         // Cast expression context
 *         return Optional.of((T) repository.findById(id)); // CAST_EXPRESSION: (T)
 *
 *         // Method type argument context (explicit type arguments in method calls)
 *         List<String> empty = Collections.<String>emptyList();  // METHOD_TYPE_ARGUMENT: String
 *         Map<String, Integer> map = ImmutableMap.<String, Integer>of(); // METHOD_TYPE_ARGUMENT: String, Integer
 *     }
 * }
 *
 * // This single class creates 20+ TypeReference entries:
 * // - 2 TYPE_PARAM_BOUND (BaseEntity, Auditable)
 * // - 1 SUPER_TYPE (AbstractService<T> with child T)
 * // - 3 IMPLEMENTS_INTERFACE (CrudService<T,Long> with children, Serializable)
 * // - 2 PERMITS (StandardUserService, AdminUserService)
 * // - 1 ANNOTATION_PARAM (User.class)
 * // - 6 FIELD_TYPE (Repository<T>, List<String>, Map<String,? extends Number> with children)
 * // - 1 METHOD_RETURN (Optional<T> with child T)
 * // - 2 METHOD_PARAM (Long, Class<? super T> with child T)
 * // - 2 THROWS_CLAUSE (ServiceException, ValidationException)
 * // - 2 LOCAL_VARIABLE (String, List<T> with child T)
 * // - 1 CAST_EXPRESSION ((T))
 * // - 3 METHOD_TYPE_ARGUMENT (String, String, Integer from explicit generic method calls)
 * ```
 *
 * ## Type Parameter Annotation Example (Java 8+)
 *
 * ```java
 * // Annotations on type parameters (Java 8+ feature)
 * public class Container<@NonNull T,                     // T: type parameter, @NonNull: annotation (no type refs)
 *                        @Validated(validator = SizeValidator.class) U> {  // U: type parameter, @Validated: annotation
 *
 *     public <@Valid(groups = {Quick.class, Full.class}) E>  // E: type parameter, @Valid: annotation
 *     void process(E element) { }
 * }
 * ```
 *
 * **What gets extracted:**
 *
 * - 3 TypeParameter entries: T, U, E
 * - 3 TypeAnnotation entries: @NonNull (on T), @Validated (on U), @Valid (on E)
 * - 3 AnnotationArgumentReference entries: validator, groups[0], groups[1]
 * - 3 TypeReference entries with **TYPE_PARAMETER_ANNOTATION** context:
 *   - `SizeValidator` - type used in U's @Validated annotation (context: TYPE_PARAMETER_ANNOTATION, owner: ANNOTATION_ARGUMENT)
 *   - `Quick` - type used in E's @Valid annotation array (context: TYPE_PARAMETER_ANNOTATION, owner: ANNOTATION_ARGUMENT)
 *   - `Full` - type used in E's @Valid annotation array (context: TYPE_PARAMETER_ANNOTATION, owner: ANNOTATION_ARGUMENT)
 *
 * **Key distinction:** TYPE_PARAMETER_ANNOTATION is the **context for type references** that appear
 * in annotation arguments on type parameters. The type parameters themselves (T, U, E) and their
 * annotations (@NonNull, @Validated, @Valid) are separate entities.
 * ```
 *
 * ## METHOD_TYPE_ARGUMENT Example
 *
 * ```java
 * // Explicit type arguments in generic method invocations
 * List<String> empty = Collections.<String>emptyList();
 * Map<String, Integer> map = Collections.<String, Integer>emptyMap();
 * List<List<String>> nested = Collections.<List<String>>singletonList(Collections.<String>emptyList());
 * ```
 *
 * **What gets extracted:**
 *
 * - `Collections.<String>emptyList()` → 1 TypeReference: String (context: METHOD_TYPE_ARGUMENT, owner: EXPRESSION)
 * - `Collections.<String, Integer>emptyMap()` → 2 TypeReferences: String (pos 0), Integer (pos 1)
 * - `Collections.<List<String>>singletonList()` → TypeReference tree: List (depth 0) → String (depth 1)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the method invocation)
 * - Position tracks order of multiple type arguments
 * - Complex type arguments create parent-child hierarchies
 *
 * ## INSTANCEOF_TYPE Example
 *
 * ```java
 * // Simple instanceof
 * boolean isString = obj instanceof String;
 * boolean isNumber = obj instanceof Number;
 *
 * // Interface types
 * boolean isSerializable = obj instanceof Serializable;
 *
 * // Array types
 * boolean isIntArray = obj instanceof int[];
 * boolean isStringArray = obj instanceof String[][];
 *
 * // In expressions
 * String result = obj instanceof String ? ((String) obj).toUpperCase() : "default";
 * boolean combined = obj != null && obj instanceof Map;
 * ```
 *
 * **What gets extracted:**
 *
 * - `obj instanceof String` → 1 TypeReference: String (context: INSTANCEOF_TYPE, owner: EXPRESSION)
 * - `obj instanceof int[]` → 1 TypeReference: int[] (kind: ARRAY)
 * - `obj instanceof String[][]` → 1 TypeReference: String[][] (kind: ARRAY, nested)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the instanceof expression)
 * - The operand (`obj`) is extracted as a child expression with edgeRole: INSTANCEOF_OPERAND
 * - Array types preserve dimensionality
 * - Works in complex expressions (ternary, binary, etc.)
 *
 * ## OBJECT_CREATION_TYPE Example
 *
 * ```java
 * // Simple object creation
 * Object obj = new Object();
 * String str = new String("hello");
 *
 * // Generic types with explicit type arguments
 * ArrayList<String> list = new ArrayList<String>();
 * HashMap<String, Integer> map = new HashMap<String, Integer>();
 *
 * // Diamond operator (type inferred)
 * ArrayList<Integer> inferred = new ArrayList<>();
 *
 * // Nested generics
 * HashMap<String, List<Map<Integer, String>>> complex = new HashMap<String, List<Map<Integer, String>>>();
 *
 * // Fully qualified type names
 * java.util.Date date = new java.util.Date();
 *
 * // Qualified inner class creation (outer.new Inner)
 * Outer outer = new Outer();
 * Outer.Inner inner = outer.new Inner();
 *
 * // Generic constructor type arguments (rare)
 * GenericCtor gc = new <String>GenericCtor("test");
 * ```
 *
 * **What gets extracted:**
 *
 * - `new Object()` → 1 TypeReference: Object (context: OBJECT_CREATION_TYPE, owner: EXPRESSION)
 * - `new ArrayList<String>()` → TypeReference tree: ArrayList (depth 0) → String (depth 1)
 * - `new ArrayList<>()` → 1 TypeReference: ArrayList (generic_type with empty type_arguments)
 * - `new HashMap<String, Integer>()` → TypeReference tree: HashMap → String (pos 0), Integer (pos 1)
 * - `outer.new Inner()` → 1 TypeReference: Inner; enclosing instance `outer` is ENCLOSING_INSTANCE child
 * - `new <String>GenericCtor()` → 2 TypeReferences: String (METHOD_TYPE_ARGUMENT), GenericCtor (OBJECT_CREATION_TYPE)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the object creation expression)
 * - Constructor arguments are extracted as child expressions with edgeRole: ARGUMENT
 * - For qualified inner class creation, the enclosing instance is edgeRole: ENCLOSING_INSTANCE
 * - Diamond operator creates a generic_type with empty type_arguments
 * - Generic constructor type arguments use METHOD_TYPE_ARGUMENT context (reused)
 *
 * ## ARRAY_CREATION_TYPE Example
 *
 * ```java
 * // Primitive arrays with size
 * int[] ints = new int[3];
 * double[] doubles = new double[10];
 *
 * // Reference arrays with size
 * String[] strings = new String[5];
 * Object[] objects = new Object[10];
 *
 * // Arrays with initializer (explicit new)
 * int[] withInit = new int[] { 1, 2, 3 };
 * String[] strInit = new String[] { "a", "b" };
 *
 * // Multi-dimensional arrays
 * int[][] matrix = new int[2][3];
 * int[][] jagged = new int[2][];
 * int[][] withInit2D = new int[][] { {1, 2}, {3, 4} };
 *
 * // Standalone array initializer (no explicit new)
 * int[] implicit = { 1, 2, 3 };
 * ```
 *
 * **What gets extracted:**
 *
 * - `new int[3]` → 1 TypeReference: int (PRIMITIVE, context: ARRAY_CREATION_TYPE)
 * - `new String[5]` → 1 TypeReference: String (CLASS, context: ARRAY_CREATION_TYPE)
 * - `new int[] { 1, 2, 3 }` → TypeReference for int; initializer elements are ARRAY_ELEMENT children
 * - `new int[2][3]` → TypeReference for int; size expressions are ARRAY_DIMENSION children
 * - `{ 1, 2, 3 }` (standalone) → ARRAY_INITIALIZER expression; no type reference (type from field declaration)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the array creation expression)
 * - The element type (int, String, etc.) is extracted, NOT the array type
 * - Size expressions are extracted as children with edgeRole: ARRAY_DIMENSION
 * - Initializer elements are extracted as children with edgeRole: ARRAY_ELEMENT
 * - Standalone array initializers ({ 1, 2, 3 }) are ARRAY_INITIALIZER expressions, not ARRAY_CREATION
 *
 * ## SWITCH_TYPE_PATTERN Example (Java 17+)
 *
 * ```java
 * // Type patterns in switch expressions
 * String result = switch(obj) {
 *     case String s when s.length() > 5 -> "long string";
 *     case String s when s.isEmpty() -> "empty";
 *     case String s -> "short string";
 *     case List<String> list -> "list: " + list.size();
 *     case Integer i -> "int: " + i;
 *     default -> "other";
 * };
 * ```
 *
 * **What gets extracted:**
 *
 * - `case String s` → TypeReference: String (context: SWITCH_TYPE_PATTERN, owner: EXPRESSION)
 * - `case List<String> list` → TypeReference tree: List (depth 0) → String (depth 1)
 * - `case Integer i` → TypeReference: Integer (context: SWITCH_TYPE_PATTERN, owner: EXPRESSION)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the switch expression)
 * - Pattern variable ('s', 'list', 'i') is extracted as SWITCH_TYPE_PATTERN expression child
 * - Guard expressions ('s.length() > 5', 's.isEmpty()') are SWITCH_GUARD expression children
 * - Generic type patterns create parent-child hierarchies like other contexts
 * - Position links SWITCH_TYPE_PATTERN, SWITCH_GUARD, and SWITCH_CASE_RESULT for each case arm
 *
 * ## RECORD_PATTERN_TYPE and PATTERN_BINDING_TYPE Example (Java 16+)
 *
 * ```java
 * // Record patterns in instanceof expressions
 * if (obj instanceof Person(String name, int age)) {
 *     System.out.println(name + " is " + age);
 * }
 *
 * // Nested record patterns
 * if (obj instanceof Employee(String name, int id, Department(String deptName, String code))) {
 *     System.out.println(name + " in " + deptName);
 * }
 * ```
 *
 * **What gets extracted:**
 *
 * - `Person(String name, int age)`:
 *   - Person → TypeReference (context: RECORD_PATTERN_TYPE, owner: EXPRESSION)
 *   - String → TypeReference (context: PATTERN_BINDING_TYPE, owner: EXPRESSION)
 *   - int → TypeReference (context: PATTERN_BINDING_TYPE, owner: EXPRESSION)
 *
 * - `Employee(String name, int id, Department(String deptName, String code))`:
 *   - Employee → TypeReference (context: RECORD_PATTERN_TYPE)
 *   - String (for name) → TypeReference (context: PATTERN_BINDING_TYPE)
 *   - int → TypeReference (context: PATTERN_BINDING_TYPE)
 *   - Department → TypeReference (context: RECORD_PATTERN_TYPE) - nested
 *   - String (for deptName) → TypeReference (context: PATTERN_BINDING_TYPE)
 *   - String (for code) → TypeReference (context: PATTERN_BINDING_TYPE)
 *
 * **Key points:**
 * - RECORD_PATTERN_TYPE is for the record type being matched (Person, Department)
 * - PATTERN_BINDING_TYPE is for the declared type of pattern binding variables
 * - Owner is the ExpressionReference (the record pattern expression)
 * - Pattern binding variables (name, age, etc.) are extracted as IDENTIFIER_REFERENCE with PATTERN_BINDING entity kind
 *
 * ## LAMBDA_PARAMETER_TYPE Example (Java 8+)
 *
 * ```java
 * // Lambda with typed parameters
 * Function<String, Integer> lengthFn = (String s) -> s.length();
 * BiFunction<Integer, Integer, Integer> adder = (Integer a, Integer b) -> a + b;
 *
 * // Lambda with generic typed parameters
 * Function<List<String>, Integer> sizeFunc = (List<String> items) -> items.size();
 *
 * // Lambda with array typed parameter
 * Function<String[], String> joiner = (String[] arr) -> String.join(",", arr);
 * ```
 *
 * **What gets extracted:**
 *
 * - `(String s) -> s.length()`:
 *   - String → TypeReference (context: LAMBDA_PARAMETER_TYPE, owner: EXPRESSION)
 *
 * - `(Integer a, Integer b) -> a + b`:
 *   - Integer (for a) → TypeReference (context: LAMBDA_PARAMETER_TYPE, position: 0)
 *   - Integer (for b) → TypeReference (context: LAMBDA_PARAMETER_TYPE, position: 1)
 *
 * - `(List<String> items) -> items.size()`:
 *   - List → TypeReference (context: LAMBDA_PARAMETER_TYPE, kind: PARAMETERIZED)
 *   - String → TypeReference (depth: 1, parent: List)
 *
 * **Key points:**
 * - Owner is the ExpressionReference (the lambda expression)
 * - Only explicitly typed parameters create type references (inferred params like `(x, y) -> x + y` do not)
 * - Generic parameter types create parent-child hierarchies
 * - Lambda parameter names are extracted as IDENTIFIER_REFERENCE with LAMBDA_PARAMETER entity kind
 *
 * ## Context-Specific Behavior
 *
 * - **Multiple Bounds:** `T extends A & B` creates 2 entries with same typeParameterLinkHash, positions 0,1
 * - **Generic Nesting:** `List<Map<K,V>>` creates parent-child tree: List → Map → K,V
 * - **Wildcard Bounds:** `? extends T` creates WILDCARD entry with EXTENDS variance + child for T
 * - **Method Linking:** All METHOD_RETURN/METHOD_PARAM entries share same methodRegistryLinkHash
 * - **Position Ordering:** Preserves source order for implements, permits, method parameters
 * - **Method Type Arguments:** `Collections.<String, Integer>emptyMap()` creates 2 METHOD_TYPE_ARGUMENT entries at positions 0,1
 */
export enum TypeRefContext {
  /** Type bound in a class/interface generic parameter declaration (e.g., class Box<T extends Number>). */
  TYPE_PARAM_BOUND = 'TYPE_PARAM_BOUND',

  /** Type bound in a method generic parameter declaration (e.g., <T extends Shape> void process(T item)). */
  METHOD_TYPE_PARAM_BOUND = 'METHOD_TYPE_PARAM_BOUND',

  /** Superclass or extended type in a class or record declaration. */
  SUPER_TYPE = 'SUPER_TYPE',

  /** Implemented interface in a class or record declaration. */
  IMPLEMENTS_INTERFACE = 'IMPLEMENTS_INTERFACE',

  /** Permitted subtype in a sealed class or interface declaration. */
  PERMITS = 'PERMITS',

  /** Declared type of a class or instance field. */
  FIELD_TYPE = 'FIELD_TYPE',

  /** Declared return type of a method or constructor. */
  METHOD_RETURN = 'METHOD_RETURN',

  /** Declared type of a formal parameter in a method or constructor. */
  METHOD_PARAM = 'METHOD_PARAM',

  /** Declared type of a parameter in an annotation element. */
  ANNOTATION_PARAM = 'ANNOTATION_PARAM',

  /** Type referenced in an annotation applied to a type parameter (e.g., class Box<@Valid(validator = SizeValidator.class) T>). */
  TYPE_PARAMETER_ANNOTATION = 'TYPE_PARAMETER_ANNOTATION',

  /** Declared type in a throws clause of a method or constructor. */
  THROWS_CLAUSE = 'THROWS_CLAUSE',

  /** Declared type of a local variable within a block or method scope. */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  /** Target type used in an explicit cast expression. */
  CAST_EXPRESSION = 'CAST_EXPRESSION',

  /** Type argument in a generic method invocation (e.g., Collections.<String>emptyList()). */
  METHOD_TYPE_ARGUMENT = 'METHOD_TYPE_ARGUMENT',

  /** Type tested in an instanceof expression (e.g., obj instanceof String, obj instanceof Map<String, Integer>). */
  INSTANCEOF_TYPE = 'INSTANCEOF_TYPE',

  /** Type instantiated in an object creation expression (e.g., new ArrayList<String>(), new HashMap<K, V>()). */
  OBJECT_CREATION_TYPE = 'OBJECT_CREATION_TYPE',

  /** Element type in an array creation expression (e.g., int in new int[3], String in new String[] { ... }). */
  ARRAY_CREATION_TYPE = 'ARRAY_CREATION_TYPE',

  /** Type qualifier in a method reference expression (e.g., String in String::valueOf, String[] in String[]::new, List<String> in List<String>::new). */
  METHOD_REFERENCE_QUALIFIER = 'METHOD_REFERENCE_QUALIFIER',

  /** Type pattern in switch case (e.g., String in case String s -> ...). Java 17+. */
  SWITCH_TYPE_PATTERN = 'SWITCH_TYPE_PATTERN',

  /** Declared type of a pattern binding variable in a record pattern (e.g., String in Person(String name, int age)). Java 16+. */
  PATTERN_BINDING_TYPE = 'PATTERN_BINDING_TYPE',

  /** Record type being matched in a record pattern (e.g., Person in obj instanceof Person(String name, int age)). Java 16+. */
  RECORD_PATTERN_TYPE = 'RECORD_PATTERN_TYPE',

  /** Declared type of a lambda parameter (e.g., String in (String s) -> s.length()). Java 8+. */
  LAMBDA_PARAMETER_TYPE = 'LAMBDA_PARAMETER_TYPE',

  /** The annotation type itself (e.g., RequestMapping in @RequestMapping("/api"), Override in @Override). Links annotation usage to its type definition. */
  ANNOTATION_TYPE = 'ANNOTATION_TYPE',
}
