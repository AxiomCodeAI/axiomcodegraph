/**
 * Classifies the type of expression in Java source code.
 *
 * This enumeration distinguishes between different expression forms,
 * enabling precise parsing and representation of Java expressions
 * within the dependency analysis framework.
 *
 * ## Expression Categories
 *
 * - **Literals** – Constant values (`42`, `"hello"`, `true`, `String.class`)
 * - **References** – Variable/field/type access (`foo`, `this`, `obj.field`)
 * - **Creation** – Object/array instantiation (`new Foo()`, `new int[10]`)
 * - **Invocation** – Method/constructor calls (`obj.method()`, `this()`)
 * - **Operators** – Binary, unary, ternary operations (`a + b`, `-x`, `a ? b : c`)
 * - **Type Operations** – Cast, instanceof (`(Type) x`, `x instanceof T`)
 * - **Functional** – Lambda, method reference (`x -> x * 2`, `String::length`)
 *
 * ## Classification Examples
 *
 * ```java
 * // LITERAL - Constant values
 * private int count = 42;                    // LITERAL (INTEGER)
 * private String name = "John";              // LITERAL (STRING)
 * private boolean active = true;             // LITERAL (BOOLEAN)
 * private Object nothing = null;             // LITERAL (NULL)
 *
 * // CLASS_LITERAL - Class object references
 * private Class<?> type = String.class;      // CLASS_LITERAL
 * private Class<?> intType = int.class;      // CLASS_LITERAL
 *
 * // IDENTIFIER_REFERENCE - Simple name (no dots)
 * private int b = a;                         // IDENTIFIER_REFERENCE (a)
 * private int timeout = DEFAULT_TIMEOUT;     // IDENTIFIER_REFERENCE
 *
 * // FIELD_ACCESS - Dotted path (Type.field or obj.field)
 * private double pi = Math.PI;               // FIELD_ACCESS (Math=TYPE, PI=FIELD)
 * private int max = Integer.MAX_VALUE;       // FIELD_ACCESS (Integer=TYPE, MAX_VALUE=FIELD)
 * private Status s = Status.ACTIVE;          // FIELD_ACCESS (Status=TYPE, ACTIVE=FIELD)
 * private String name = user.name;           // FIELD_ACCESS (user=FIELD, name=FIELD)
 *
 * // THIS_REFERENCE / SUPER_REFERENCE
 * private Service self = this;               // THIS_REFERENCE
 * private Parent p = super;                  // SUPER_REFERENCE
 *
 * // Qualified this/super (OuterClass.this) - represented as FIELD_ACCESS tree:
 * //   FIELD_ACCESS (memberName="this", memberKind=THIS)
 * //     └─ IDENTIFIER_REFERENCE (edgeRole=QUALIFIER, "OuterClass", isTypeReference=true)
 * private Inner i = OuterClass.this.new Inner();  // FIELD_ACCESS + IDENTIFIER_REFERENCE
 *
 * // OBJECT_CREATION - new ClassName()
 * private List<String> list = new ArrayList<>();  // OBJECT_CREATION
 * private User user = new User("John", 30);       // OBJECT_CREATION
 *
 * // ANONYMOUS_CLASS_CREATION - new Type() { ... }
 * private Runnable r = new Runnable() {           // ANONYMOUS_CLASS_CREATION
 *     public void run() { }
 * };
 *
 * // ARRAY_CREATION - new Type[size] or new Type[]{...}
 * private int[] arr = new int[10];           // ARRAY_CREATION
 * private int[] init = new int[]{1, 2, 3};   // ARRAY_CREATION (hasArrayInitializer=true)
 *
 * // ARRAY_INITIALIZER - Standalone {1, 2, 3}
 * private int[] values = {1, 2, 3};          // ARRAY_INITIALIZER
 *
 * // METHOD_INVOCATION - obj.method() or method()
 * private String result = getData();                  // METHOD_INVOCATION
 * private int abs = Math.abs(-5);                     // METHOD_INVOCATION
 * private User user = userService.getCurrentUser();   // METHOD_INVOCATION
 *
 * // CONSTRUCTOR_INVOCATION - this() or super() in constructor body
 * public MyClass() { this(0); }                         // CONSTRUCTOR_INVOCATION (this())
 * public MyClass(int x) { super(x); }                   // CONSTRUCTOR_INVOCATION (super())
 * public Child() { super(compute()); }                  // CONSTRUCTOR_INVOCATION with arg expression
 *
 * // LAMBDA_EXPRESSION - x -> expr or (x, y) -> { ... }
 * private Function<Integer, Integer> f = x -> x * 2;  // LAMBDA_EXPRESSION
 * private Consumer<String> c = s -> { System.out.println(s); };
 *
 * // METHOD_REFERENCE - Type::method or obj::method
 * private Function<String, Integer> len = String::length;  // METHOD_REFERENCE
 * private Supplier<List<String>> s = ArrayList::new;       // METHOD_REFERENCE (CONSTRUCTOR)
 *
 * // BINARY_EXPRESSION - a op b
 * private int sum = a + b;                   // BINARY_EXPRESSION (operator: +)
 * private boolean valid = x > 0 && y < 10;   // BINARY_EXPRESSION (operator: &&)
 *
 * // UNARY_EXPRESSION - op a or a op
 * private int neg = -value;                  // UNARY_EXPRESSION (operator: -)
 * private boolean not = !flag;               // UNARY_EXPRESSION (operator: !)
 *
 * // TERNARY_EXPRESSION - cond ? a : b
 * private int val = isDefault ? 5 : custom;  // TERNARY_EXPRESSION
 *
 * // ASSIGNMENT_EXPRESSION - x = y (when used as expression)
 * private int chain = x = y = 5;             // ASSIGNMENT_EXPRESSION
 *
 * // COMPOUND_ASSIGNMENT - x op= y
 * // (rare in field initializers, common in method bodies)
 *
 * // CAST_EXPRESSION - (Type) expr
 * private long big = (long) smallInt;        // CAST_EXPRESSION
 *
 * // INSTANCEOF_EXPRESSION - expr instanceof Type
 * private boolean isString = obj instanceof String;  // INSTANCEOF_EXPRESSION
 *
 * // INSTANCEOF_PATTERN - expr instanceof Type var (Java 16+)
 * // Used in method body context with pattern matching
 *
 * // ARRAY_ACCESS - arr[index]
 * private int first = array[0];              // ARRAY_ACCESS
 *
 * // SWITCH_EXPRESSION - switch(x) { case 1 -> val; } (Java 14+)
 * private String day = switch(num) {
 *     case 1 -> "Mon";
 *     default -> "Other";
 * };
 *
 * // BREAK_STATEMENT - break; or break label; in switch case or loop
 * switch (status) {
 *     case ACTIVE:
 *         handle();
 *         break;          // BREAK_STATEMENT (no label)
 *         break outer;    // BREAK_STATEMENT (literalValue = "outer")
 * }
 *
 * // CONTINUE_STATEMENT - continue; or continue label; in loop
 * for (String s : items) {
 *     if (s == null) continue;        // CONTINUE_STATEMENT (no label)
 *     if (skip) continue outer;       // CONTINUE_STATEMENT (literalValue = "outer")
 * }
 *
 * // PARENTHESIZED - (expr) - preserves source fidelity
 * private int grouped = (a + b) * c;         // PARENTHESIZED wrapping BINARY_EXPRESSION
 *
 * // RECORD_PATTERN - Record deconstruction pattern (Java 21+)
 * // Used in instanceof and switch to destructure record components
 * // if (obj instanceof Person(String name, int age)) { ... }
 * // case Point(int x, int y) -> x + y;
 *
 * // STRING_TEMPLATE - Template expression (Java 21+ preview)
 * private String greeting = STR."Hello, \{name}! You are \{age}.";  // STRING_TEMPLATE
 * private String query = STR."""
 *     SELECT * FROM users
 *     WHERE id = \{userId}
 *     """;                                    // STRING_TEMPLATE (text block form)
 * ```
 *
 * ## Implementation Guidelines
 *
 * - **Tree Structure:** Complex expressions create parent-child relationships
 * - **Kind Selection:** Use most specific kind (e.g., CLASS_LITERAL over LITERAL for String.class)
 * - **Operator Storage:** BINARY/UNARY/COMPOUND store operator in separate field
 * - **Method Name:** METHOD_INVOCATION stores methodName in separate field
 */
export enum ExpressionKind {
  // === Literals ===
  /** Primitive, string, or null literal (42, "hello", true, null). Use literalType for subtype. */
  LITERAL = 'LITERAL',

  /** Class literal reference (String.class, int.class). Links to TypeRegistry. */
  CLASS_LITERAL = 'CLASS_LITERAL',

  // === References ===
  /** Simple name without dots (foo, bar, count). Resolved at extraction to field/type. */
  IDENTIFIER_REFERENCE = 'IDENTIFIER_REFERENCE',

  /** Field/member access (obj.field, this.field, Math.PI, Type.CONST). Qualifier extracted as child. */
  FIELD_ACCESS = 'FIELD_ACCESS',

  /** The 'this' keyword alone. */
  THIS_REFERENCE = 'THIS_REFERENCE',

  /** The 'super' keyword alone. */
  SUPER_REFERENCE = 'SUPER_REFERENCE',

  // NOTE: Qualified this/super (OuterClass.this, OuterClass.super) are NOT separate kinds.
  // They are represented as FIELD_ACCESS with:
  //   - memberName = "this" or "super"
  //   - memberKind = THIS or SUPER
  //   - Child IDENTIFIER_REFERENCE with edgeRole=QUALIFIER containing the outer class name
  //
  // Example: OuterClass.this.new Inner()
  //   FIELD_ACCESS (edgeRole=ENCLOSING_INSTANCE, memberName="this", memberKind=THIS)
  //     └─ IDENTIFIER_REFERENCE (edgeRole=QUALIFIER, memberName="OuterClass", isTypeReference=true)

  // === Object/Array Creation ===
  /** Object instantiation (new ClassName(), new ClassName(args)). */
  OBJECT_CREATION = 'OBJECT_CREATION',

  /** Anonymous class creation (new Interface() { ... }). */
  ANONYMOUS_CLASS_CREATION = 'ANONYMOUS_CLASS_CREATION',

  /** Array creation (new int[10], new String[]{...}). */
  ARRAY_CREATION = 'ARRAY_CREATION',

  /** Standalone array initializer ({1, 2, 3}). */
  ARRAY_INITIALIZER = 'ARRAY_INITIALIZER',

  // === Invocations ===
  /** Method invocation (obj.method(), method(), Type.staticMethod()). */
  METHOD_INVOCATION = 'METHOD_INVOCATION',

  /** Explicit constructor invocation in constructor body (this(), super()). */
  CONSTRUCTOR_INVOCATION = 'CONSTRUCTOR_INVOCATION',

  // === Functional ===
  /** Lambda expression (x -> x * 2, (a, b) -> a + b). */
  LAMBDA_EXPRESSION = 'LAMBDA_EXPRESSION',

  /** Method reference (String::length, ArrayList::new, obj::method). */
  METHOD_REFERENCE = 'METHOD_REFERENCE',

  // === Operators ===
  /** Binary operation (a + b, a && b, a == b). */
  BINARY_EXPRESSION = 'BINARY_EXPRESSION',

  /** Unary operation (-a, !a, ++a, a++). */
  UNARY_EXPRESSION = 'UNARY_EXPRESSION',

  /** Ternary conditional (cond ? trueExpr : falseExpr). */
  TERNARY_EXPRESSION = 'TERNARY_EXPRESSION',

  /** Assignment as expression (x = y when used in larger expression). */
  ASSIGNMENT_EXPRESSION = 'ASSIGNMENT_EXPRESSION',

  /** Compound assignment (x += 5, x *= 2). */
  COMPOUND_ASSIGNMENT = 'COMPOUND_ASSIGNMENT',

  // === Type Operations ===
  /** Cast expression ((Type) expr). */
  CAST_EXPRESSION = 'CAST_EXPRESSION',

  /** instanceof check (obj instanceof Type). */
  INSTANCEOF_EXPRESSION = 'INSTANCEOF_EXPRESSION',

  /** instanceof with pattern variable (obj instanceof String s). Java 16+. */
  INSTANCEOF_PATTERN = 'INSTANCEOF_PATTERN',

  // === Access ===
  /** Array element access (array[index]). */
  ARRAY_ACCESS = 'ARRAY_ACCESS',

  // === Control Flow as Expression ===
  /** Switch expression (switch(x) { case 1 -> "one"; }). Java 14+. */
  SWITCH_EXPRESSION = 'SWITCH_EXPRESSION',

  /** Break statement in a switch case or loop (break; or break label;). */
  BREAK_STATEMENT = 'BREAK_STATEMENT',

  /** Continue statement in a loop (continue; or continue label;). */
  CONTINUE_STATEMENT = 'CONTINUE_STATEMENT',

  // === Structural ===
  /** Parenthesized expression ((expr)). Preserves source fidelity. */
  PARENTHESIZED = 'PARENTHESIZED',

  // === Advanced Patterns (Java 21+) ===
  /** Record pattern (Java 21+). */
  RECORD_PATTERN = 'RECORD_PATTERN',

  /** String template (Java 21+ preview). */
  STRING_TEMPLATE = 'STRING_TEMPLATE',

  // === Fallback ===
  /** Unknown or unrecognized expression type. */
  UNKNOWN = 'UNKNOWN',
}
