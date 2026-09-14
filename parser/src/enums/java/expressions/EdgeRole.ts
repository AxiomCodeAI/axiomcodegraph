/**
 * Describes the relationship of an expression to its parent expression.
 *
 * This enumeration describes how a child expression relates to its parent
 * in the expression tree. Root expressions use ROOT.
 *
 * ## Role Categories
 *
 * - **ROOT** – Top-level expression (no parent)
 * - **Operands** – Binary, unary, ternary operand positions
 * - **Invocation** – Method receiver, arguments
 * - **Field/Array Access** – Qualifier, array index
 * - **Array Creation** – Element, dimension positions
 * - **Type Operations** – Cast operand, instanceof operand
 * - **Functional** – Lambda body
 * - **Switch** – Selector, case labels, guards, results
 * - **String Template** – Template literal text, embedded expressions (Java 21+)
 * - **Structural** – Parenthesized inner
 * - **Assignment** – Target and value
 *
 * ## Classification Examples
 *
 * Each example shows: [ROOT: ExpressionKind] then the tree structure.
 *
 * **Tree Direction:** ROOT is always the OUTERMOST expression.
 * Trees go from outer (top) to inner (bottom/leaves).
 * - `(a + b) * c` → ROOT is `*` (outermost), `a + b` is nested inside
 * - `obj.method()` → ROOT is method call (outermost), `obj` is nested inside
 *
 * ```java
 * // ─────────────────────────────────────────────────────────────────
 * // ROOT - Top-level expression (no parent)
 * // ─────────────────────────────────────────────────────────────────
 * private int x = 42;
 * // [ROOT: LITERAL]
 * // Tree: LITERAL (edgeRole: ROOT)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // LEFT_OPERAND, RIGHT_OPERAND - Binary expression operands
 * // ─────────────────────────────────────────────────────────────────
 * private int sum = a + b;
 * // [ROOT: BINARY_EXPRESSION]
 * // Tree:
 * //   BINARY_EXPRESSION (edgeRole: ROOT, operator: +)
 * //     ├── IDENTIFIER_REFERENCE 'a' (edgeRole: LEFT_OPERAND)
 * //     └── IDENTIFIER_REFERENCE 'b' (edgeRole: RIGHT_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // TERNARY_CONDITION, TERNARY_TRUE, TERNARY_FALSE
 * // ─────────────────────────────────────────────────────────────────
 * private int val = cond ? trueVal : falseVal;
 * // [ROOT: TERNARY_EXPRESSION]
 * // Tree:
 * //   TERNARY_EXPRESSION (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'cond' (edgeRole: TERNARY_CONDITION)
 * //     ├── IDENTIFIER_REFERENCE 'trueVal' (edgeRole: TERNARY_TRUE)
 * //     └── IDENTIFIER_REFERENCE 'falseVal' (edgeRole: TERNARY_FALSE)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // RECEIVER, ARGUMENT - Method invocation parts
 * // ─────────────────────────────────────────────────────────────────
 * private String result = obj.method(arg1, arg2);
 * // [ROOT: METHOD_INVOCATION]
 * // Tree:
 * //   METHOD_INVOCATION 'method' (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'obj' (edgeRole: RECEIVER)
 * //     ├── IDENTIFIER_REFERENCE 'arg1' (edgeRole: ARGUMENT, position: 0)
 * //     └── IDENTIFIER_REFERENCE 'arg2' (edgeRole: ARGUMENT, position: 1)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // RECEIVER for chained calls - outermost is ROOT
 * // ─────────────────────────────────────────────────────────────────
 * private String s = getData().trim().toLowerCase();
 * // [ROOT: METHOD_INVOCATION 'toLowerCase']
 * // Tree:
 * //   METHOD_INVOCATION 'toLowerCase' (edgeRole: ROOT)
 * //     └── METHOD_INVOCATION 'trim' (edgeRole: RECEIVER)
 * //           └── METHOD_INVOCATION 'getData' (edgeRole: RECEIVER)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // METHOD_NAME - Method name identifier (internal, not typically visible)
 * // ─────────────────────────────────────────────────────────────────
 * // Note: METHOD_NAME is used internally to mark the method name identifier
 * // within a method invocation. It is extracted as a child of METHOD_INVOCATION.
 * // Example: obj.calculate(x) → "calculate" is METHOD_NAME
 *
 * // ─────────────────────────────────────────────────────────────────
 * // FIELD_NAME - Field name identifier (internal, not typically visible)
 * // ─────────────────────────────────────────────────────────────────
 * // Note: FIELD_NAME is used internally to mark the field name identifier
 * // within a field access expression. It is extracted as a child of FIELD_ACCESS.
 * // Example: obj.status → "status" is FIELD_NAME
 *
 * // ─────────────────────────────────────────────────────────────────
 * // QUALIFIER - Qualifier expression in field access
 * // ─────────────────────────────────────────────────────────────────
 * private int len = getData().items.length;
 * // [ROOT: FIELD_ACCESS 'length']
 * // Tree:
 * //   FIELD_ACCESS 'length' (edgeRole: ROOT)
 * //     └── FIELD_ACCESS 'items' (edgeRole: QUALIFIER)
 * //           └── METHOD_INVOCATION 'getData' (edgeRole: QUALIFIER)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // ARRAY_INDEX - Index expression in array access
 * // ─────────────────────────────────────────────────────────────────
 * private int first = array[0];
 * // [ROOT: ARRAY_ACCESS]
 * // Tree:
 * //   ARRAY_ACCESS (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'array' (edgeRole: QUALIFIER)
 * //     └── LITERAL '0' (edgeRole: ARRAY_INDEX)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // ARRAY_ELEMENT - Elements in array initializer
 * // ─────────────────────────────────────────────────────────────────
 * private int[] arr = {1, 2, 3};
 * // [ROOT: ARRAY_INITIALIZER]
 * // Tree:
 * //   ARRAY_INITIALIZER (edgeRole: ROOT)
 * //     ├── LITERAL '1' (edgeRole: ARRAY_ELEMENT, position: 0)
 * //     ├── LITERAL '2' (edgeRole: ARRAY_ELEMENT, position: 1)
 * //     └── LITERAL '3' (edgeRole: ARRAY_ELEMENT, position: 2)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // ARRAY_DIMENSION - Size expression in array creation
 * // ─────────────────────────────────────────────────────────────────
 * private int[] arr = new int[size];
 * // [ROOT: ARRAY_CREATION]
 * // Tree:
 * //   ARRAY_CREATION (edgeRole: ROOT, elementType: int)
 * //     └── IDENTIFIER_REFERENCE 'size' (edgeRole: ARRAY_DIMENSION, position: 0)
 *
 * // Multi-dimensional array
 * private int[][] matrix = new int[rows][cols];
 * // [ROOT: ARRAY_CREATION]
 * // Tree:
 * //   ARRAY_CREATION (edgeRole: ROOT, elementType: int, dimensions: 2)
 * //     ├── IDENTIFIER_REFERENCE 'rows' (edgeRole: ARRAY_DIMENSION, position: 0)
 * //     └── IDENTIFIER_REFERENCE 'cols' (edgeRole: ARRAY_DIMENSION, position: 1)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // UNARY_OPERAND - Operand of unary expression
 * // ─────────────────────────────────────────────────────────────────
 * private int neg = -value;
 * // [ROOT: UNARY_EXPRESSION]
 * // Tree:
 * //   UNARY_EXPRESSION (edgeRole: ROOT, operator: -, fixity: PREFIX)
 * //     └── IDENTIFIER_REFERENCE 'value' (edgeRole: UNARY_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // CAST_OPERAND - Expression being cast
 * // ─────────────────────────────────────────────────────────────────
 * private long big = (long) smallInt;
 * // [ROOT: CAST_EXPRESSION]
 * // Tree:
 * //   CAST_EXPRESSION (edgeRole: ROOT, castType: long)
 * //     └── IDENTIFIER_REFERENCE 'smallInt' (edgeRole: CAST_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // INSTANCEOF_OPERAND - Expression being tested
 * // ─────────────────────────────────────────────────────────────────
 * private boolean isStr = obj instanceof String;
 * // [ROOT: INSTANCEOF_EXPRESSION]
 * // Tree:
 * //   INSTANCEOF_EXPRESSION (edgeRole: ROOT, testType: String)
 * //     └── IDENTIFIER_REFERENCE 'obj' (edgeRole: INSTANCEOF_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // PATTERN_VARIABLE - Pattern variable in instanceof pattern (Java 16+)
 * // ─────────────────────────────────────────────────────────────────
 * String result = (obj instanceof String s) ? s.toUpperCase() : "default";
 * // [ROOT: TERNARY_EXPRESSION]
 * // Tree:
 * //   TERNARY_EXPRESSION (edgeRole: ROOT)
 * //     ├── PARENTHESIZED (edgeRole: TERNARY_CONDITION)
 * //     │     └── INSTANCEOF_PATTERN (edgeRole: PARENTHESIZED_INNER, testType: String)
 * //     │           ├── IDENTIFIER_REFERENCE 'obj' (edgeRole: INSTANCEOF_OPERAND)
 * //     │           └── IDENTIFIER_REFERENCE 's' (edgeRole: PATTERN_VARIABLE)
 * //     ├── METHOD_INVOCATION 'toUpperCase' (edgeRole: TERNARY_TRUE)
 * //     │     └── IDENTIFIER_REFERENCE 's' (edgeRole: RECEIVER)
 * //     └── LITERAL '"default"' (edgeRole: TERNARY_FALSE)
 * //
 * // Note: Pattern variable 's' appears twice - as PATTERN_VARIABLE (declaration)
 * // and as RECEIVER (usage). Both reference the same scoped variable.
 *
 * Integer doubled = numObj instanceof Integer i ? i * 2 : 0;
 * // [ROOT: TERNARY_EXPRESSION]
 * // Tree:
 * //   TERNARY_EXPRESSION (edgeRole: ROOT)
 * //     ├── INSTANCEOF_PATTERN (edgeRole: TERNARY_CONDITION, testType: Integer)
 * //     │     ├── IDENTIFIER_REFERENCE 'numObj' (edgeRole: INSTANCEOF_OPERAND)
 * //     │     └── IDENTIFIER_REFERENCE 'i' (edgeRole: PATTERN_VARIABLE)
 * //     ├── BINARY_EXPRESSION (edgeRole: TERNARY_TRUE, operator: *)
 * //     │     ├── IDENTIFIER_REFERENCE 'i' (edgeRole: LEFT_OPERAND)
 * //     │     └── LITERAL '2' (edgeRole: RIGHT_OPERAND)
 * //     └── LITERAL '0' (edgeRole: TERNARY_FALSE)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // LAMBDA_PARAMETER & LAMBDA_BODY - Lambda expression components
 * // ─────────────────────────────────────────────────────────────────
 * private Function<Integer, Integer> f = x -> x * 2;
 * // [ROOT: LAMBDA_EXPRESSION] - The lambda itself is assigned to field 'f'
 * // Tree:
 * //   LAMBDA_EXPRESSION (edgeRole: ROOT, operator: "x")
 * //     ├── IDENTIFIER_REFERENCE 'x' (edgeRole: LAMBDA_PARAMETER, referencedEntityKind: LAMBDA_PARAMETER)
 * //     └── BINARY_EXPRESSION (edgeRole: LAMBDA_BODY, operator: *)
 * //           ├── IDENTIFIER_REFERENCE 'x' (edgeRole: LEFT_OPERAND)
 * //           └── LITERAL '2' (edgeRole: RIGHT_OPERAND)
 * //
 * // Multi-parameter lambda:
 * private BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
 * // Tree:
 * //   LAMBDA_EXPRESSION (edgeRole: ROOT, operator: "a,b")
 * //     ├── IDENTIFIER_REFERENCE 'a' (edgeRole: LAMBDA_PARAMETER, position: 0)
 * //     ├── IDENTIFIER_REFERENCE 'b' (edgeRole: LAMBDA_PARAMETER, position: 1)
 * //     └── BINARY_EXPRESSION (edgeRole: LAMBDA_BODY, operator: +)
 * //           ├── IDENTIFIER_REFERENCE 'a' (edgeRole: LEFT_OPERAND)
 * //           └── IDENTIFIER_REFERENCE 'b' (edgeRole: RIGHT_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // Anonymous class assigned to field (class body is separate TypeRegistry entry)
 * // ─────────────────────────────────────────────────────────────────
 * private Runnable r = new Runnable() {
 *     private int count = 0;
 *     public void run() { System.out.println(count++); }
 * };
 * // [ROOT: ANONYMOUS_CLASS_CREATION] - The anonymous class is assigned to field 'r'
 * // Tree:
 * //   ANONYMOUS_CLASS_CREATION (edgeRole: ROOT)
 * //     - implementedTypeHash → TypeRegistry (Runnable)
 * //     - anonymousTypeHash → TypeRegistry (MyClass$1)
 * //
 * // The anonymous class body is extracted separately:
 * //   - TypeRegistry entry for "MyClass$1" (isAnonymous: true)
 * //   - FieldRegistry entry for "count" (enclosingType: MyClass$1)
 * //   - MethodRegistry entry for "run" (enclosingType: MyClass$1)
 * //   - Field initializer "0" has its own ExpressionReference tree
 *
 * // ─────────────────────────────────────────────────────────────────
 * // SWITCH_SELECTOR, SWITCH_CASE_RESULT - Switch expression parts
 * // ─────────────────────────────────────────────────────────────────
 * private String day = switch(getStatus()) {
 *     case 1 -> "Monday";
 *     default -> "Other";
 * };
 * // [ROOT: SWITCH_EXPRESSION]
 * // Tree:
 * //   SWITCH_EXPRESSION (edgeRole: ROOT)
 * //     ├── METHOD_INVOCATION 'getStatus' (edgeRole: SWITCH_SELECTOR)
 * //     ├── LITERAL '"Monday"' (edgeRole: SWITCH_CASE_RESULT)
 * //     └── LITERAL '"Other"' (edgeRole: SWITCH_CASE_RESULT)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // SWITCH_TYPE_PATTERN, SWITCH_GUARD - Pattern matching in switch (Java 17+/21+)
 * // ─────────────────────────────────────────────────────────────────
 * private String guardedPattern = switch(obj) {
 *     case String s when s.length() > 5 -> "long string";
 *     case String s when s.isEmpty() -> "empty";
 *     case String s -> "short string";
 *     default -> "other";
 * };
 * // [ROOT: SWITCH_EXPRESSION]
 * // Tree:
 * //   SWITCH_EXPRESSION (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'obj' (edgeRole: SWITCH_SELECTOR)
 * //     │
 * //     │ // Case 0: case String s when s.length() > 5 -> "long string"
 * //     ├── IDENTIFIER_REFERENCE 's' (edgeRole: SWITCH_TYPE_PATTERN, position: 0)
 * //     ├── BINARY_EXPRESSION '>' (edgeRole: SWITCH_GUARD, position: 0)
 * //     │     ├── METHOD_INVOCATION 'length' (edgeRole: LEFT_OPERAND)
 * //     │     │     └── IDENTIFIER_REFERENCE 's' (edgeRole: RECEIVER)
 * //     │     └── LITERAL '5' (edgeRole: RIGHT_OPERAND)
 * //     ├── LITERAL '"long string"' (edgeRole: SWITCH_CASE_RESULT, position: 0)
 * //     │
 * //     │ // Case 1: case String s when s.isEmpty() -> "empty"
 * //     ├── IDENTIFIER_REFERENCE 's' (edgeRole: SWITCH_TYPE_PATTERN, position: 1)
 * //     ├── METHOD_INVOCATION 'isEmpty' (edgeRole: SWITCH_GUARD, position: 1)
 * //     │     └── IDENTIFIER_REFERENCE 's' (edgeRole: RECEIVER)
 * //     ├── LITERAL '"empty"' (edgeRole: SWITCH_CASE_RESULT, position: 1)
 * //     │
 * //     │ // Case 2: case String s -> "short string" (no guard)
 * //     ├── IDENTIFIER_REFERENCE 's' (edgeRole: SWITCH_TYPE_PATTERN, position: 2)
 * //     ├── LITERAL '"short string"' (edgeRole: SWITCH_CASE_RESULT, position: 2)
 * //     │
 * //     │ // Case 3: default -> "other"
 * //     └── LITERAL '"other"' (edgeRole: SWITCH_CASE_RESULT, position: 3)
 * //
 * // Note: The type 'String' is extracted as a TYPE_REFERENCE linked to the expression.
 * // The pattern variable 's' is extracted as SWITCH_TYPE_PATTERN.
 * // Position links SWITCH_TYPE_PATTERN, SWITCH_GUARD, and SWITCH_CASE_RESULT for each case.
 *
 * // ─────────────────────────────────────────────────────────────────
 * // SWITCH_CASE_LABEL - Constant/enum expression in case label
 * // ─────────────────────────────────────────────────────────────────
 * private int val = switch(status) {
 *     case ACTIVE -> 1;       // ACTIVE is SWITCH_CASE_LABEL
 *     case 1, 2, 3 -> 0;      // Each constant is SWITCH_CASE_LABEL
 *     default -> -1;
 * };
 * // [ROOT: SWITCH_EXPRESSION]
 * // Tree:
 * //   SWITCH_EXPRESSION (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'status' (edgeRole: SWITCH_SELECTOR)
 * //     ├── IDENTIFIER_REFERENCE 'ACTIVE' (edgeRole: SWITCH_CASE_LABEL)
 * //     ├── LITERAL '1' (edgeRole: SWITCH_CASE_LABEL, position: 0)
 * //     ├── LITERAL '2' (edgeRole: SWITCH_CASE_LABEL, position: 1)
 * //     ├── LITERAL '3' (edgeRole: SWITCH_CASE_LABEL, position: 2)
 * //     ├── LITERAL '1' (edgeRole: SWITCH_CASE_RESULT)  // for ACTIVE case
 * //     ├── LITERAL '0' (edgeRole: SWITCH_CASE_RESULT)  // for 1,2,3 case
 * //     └── UNARY_EXPRESSION '-1' (edgeRole: SWITCH_CASE_RESULT)  // for default
 *
 * // ─────────────────────────────────────────────────────────────────
 * // ASSIGNMENT_TARGET, ASSIGNMENT_VALUE - Assignment as expression
 * // ─────────────────────────────────────────────────────────────────
 * // Note: More common in method bodies. In field init, the assigned
 * // variable becomes a side effect of initializing the field.
 * private int result = (x = 5);  // x gets 5, result also gets 5
 * // [ROOT: ASSIGNMENT_EXPRESSION]
 * // Tree:
 * //   ASSIGNMENT_EXPRESSION (edgeRole: ROOT, operator: =)
 * //     ├── IDENTIFIER_REFERENCE 'x' (edgeRole: ASSIGNMENT_TARGET)
 * //     └── LITERAL '5' (edgeRole: ASSIGNMENT_VALUE)
 * //
 * // Note: Field 'result' is the OWNER, not in expression tree.
 * // The tree represents only the initializer expression (x = 5).
 *
 * // ─────────────────────────────────────────────────────────────────
 * // ENCLOSING_INSTANCE - Enclosing instance in qualified class creation
 * // ─────────────────────────────────────────────────────────────────
 * private Inner obj = outer.new Inner(arg);
 * // [ROOT: OBJECT_CREATION]
 * // Tree:
 * //   OBJECT_CREATION 'Inner' (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'outer' (edgeRole: ENCLOSING_INSTANCE)
 * //     └── IDENTIFIER_REFERENCE 'arg' (edgeRole: ARGUMENT, position: 0)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // PARENTHESIZED_INNER - Inner expression of parentheses
 * // ─────────────────────────────────────────────────────────────────
 * private int grouped = (a + b) * c;
 * // [ROOT: BINARY_EXPRESSION]
 * // Tree:
 * //   BINARY_EXPRESSION (edgeRole: ROOT, operator: *)
 * //     ├── PARENTHESIZED (edgeRole: LEFT_OPERAND)
 * //     │     └── BINARY_EXPRESSION (edgeRole: PARENTHESIZED_INNER, operator: +)
 * //     │           ├── IDENTIFIER_REFERENCE 'a' (edgeRole: LEFT_OPERAND)
 * //     │           └── IDENTIFIER_REFERENCE 'b' (edgeRole: RIGHT_OPERAND)
 * //     └── IDENTIFIER_REFERENCE 'c' (edgeRole: RIGHT_OPERAND)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // TEMPLATE_LITERAL, TEMPLATE_EMBEDDED - String templates (Java 21+)
 * // ─────────────────────────────────────────────────────────────────
 * private String greeting = STR."Hello, \{name}! You are \{age} years old.";
 * // [ROOT: STRING_TEMPLATE]
 * // Tree:
 * //   STRING_TEMPLATE (edgeRole: ROOT, operator: STR)
 * //     ├── LITERAL "Hello, \{name}! You are \{age} years old." (edgeRole: TEMPLATE_LITERAL)
 * //     ├── IDENTIFIER_REFERENCE 'name' (edgeRole: TEMPLATE_EMBEDDED, position: 0)
 * //     └── IDENTIFIER_REFERENCE 'age' (edgeRole: TEMPLATE_EMBEDDED, position: 1)
 *
 * // Complex expressions in templates
 * private String info = STR."Sum: \{a + b}, Upper: \{name.toUpperCase()}";
 * // [ROOT: STRING_TEMPLATE]
 * // Tree:
 * //   STRING_TEMPLATE (edgeRole: ROOT, operator: STR)
 * //     ├── LITERAL "Sum: \{a + b}, Upper: \{name.toUpperCase()}" (edgeRole: TEMPLATE_LITERAL)
 * //     ├── BINARY_EXPRESSION '+' (edgeRole: TEMPLATE_EMBEDDED, position: 0)
 * //     │     ├── IDENTIFIER_REFERENCE 'a' (edgeRole: LEFT_OPERAND)
 * //     │     └── IDENTIFIER_REFERENCE 'b' (edgeRole: RIGHT_OPERAND)
 * //     └── METHOD_INVOCATION 'toUpperCase' (edgeRole: TEMPLATE_EMBEDDED, position: 1)
 * //           └── IDENTIFIER_REFERENCE 'name' (edgeRole: RECEIVER)
 *
 * // Nested string templates
 * private String nested = STR."Outer: \{STR."Inner: \{value}"}";
 * // [ROOT: STRING_TEMPLATE]
 * // Tree:
 * //   STRING_TEMPLATE (edgeRole: ROOT, operator: STR)
 * //     ├── LITERAL "Outer: \{STR."Inner: \{value}"}" (edgeRole: TEMPLATE_LITERAL)
 * //     └── STRING_TEMPLATE (edgeRole: TEMPLATE_EMBEDDED, position: 0, operator: STR)
 * //           ├── LITERAL "Inner: \{value}" (edgeRole: TEMPLATE_LITERAL)
 * //           └── IDENTIFIER_REFERENCE 'value' (edgeRole: TEMPLATE_EMBEDDED, position: 0)
 * //
 * // Note: The processor (STR, FMT, RAW) is stored in operatorString field.
 * // Position field orders embedded expressions within the template.
 * // TEMPLATE_LITERAL captures full template text for reconstruction.
 *
 * // ─────────────────────────────────────────────────────────────────
 * // TYPE_ARGUMENT - Explicit type argument in generic method invocation
 * // ─────────────────────────────────────────────────────────────────
 * private List<String> empty = Collections.<String>emptyList();
 * // [ROOT: METHOD_INVOCATION 'emptyList']
 * // Tree:
 * //   METHOD_INVOCATION 'emptyList' (edgeRole: ROOT)
 * //     ├── IDENTIFIER_REFERENCE 'Collections' (edgeRole: RECEIVER)
 * //     └── IDENTIFIER_REFERENCE 'String' (edgeRole: TYPE_ARGUMENT, position: 0)
 *
 * // ─────────────────────────────────────────────────────────────────
 * // RECORD_PATTERN_BINDING - Pattern variable in record deconstruction
 * // ─────────────────────────────────────────────────────────────────
 * // if (obj instanceof Person(String name, int age)) { ... }
 * // [ROOT: RECORD_PATTERN]
 * // Tree:
 * //   RECORD_PATTERN (edgeRole: ROOT or INSTANCEOF_OPERAND)
 * //     ├── IDENTIFIER_REFERENCE 'name' (edgeRole: RECORD_PATTERN_BINDING, position: 0)
 * //     └── IDENTIFIER_REFERENCE 'age' (edgeRole: RECORD_PATTERN_BINDING, position: 1)
 * ```
 *
 * ## Key Invariants
 *
 * - **Root expressions** (`parentExpressionHash == null`): edgeRole = ROOT
 * - **Child expressions** (`parentExpressionHash != null`): edgeRole describes relationship
 * - **Position field**: Used with ARGUMENT, ARRAY_ELEMENT, ARRAY_DIMENSION, TEMPLATE_EMBEDDED for ordering
 */
export enum EdgeRole {
  /** Top-level expression with no parent. */
  ROOT = 'ROOT',

  // === Binary/Ternary Operands ===
  /** Left operand of binary expression. */
  LEFT_OPERAND = 'LEFT_OPERAND',

  /** Right operand of binary expression. */
  RIGHT_OPERAND = 'RIGHT_OPERAND',

  /** Condition part of ternary expression. */
  TERNARY_CONDITION = 'TERNARY_CONDITION',

  /** True branch of ternary expression. */
  TERNARY_TRUE = 'TERNARY_TRUE',

  /** False branch of ternary expression. */
  TERNARY_FALSE = 'TERNARY_FALSE',

  // === Method/Constructor Calls ===
  /** Receiver expression (obj in obj.method()). */
  RECEIVER = 'RECEIVER',

  /** Method name identifier in method invocation (method in obj.method()). */
  METHOD_NAME = 'METHOD_NAME',

  /** Argument in method/constructor call. Use position field for index. */
  ARGUMENT = 'ARGUMENT',

  // === Field Access ===
  /** Qualifier expression in field access (obj in obj.field). */
  QUALIFIER = 'QUALIFIER',

  /** Field name identifier in field access (field in obj.field). */
  FIELD_NAME = 'FIELD_NAME',

  // === Array ===
  /** Index expression in array access (i in arr[i]). */
  ARRAY_INDEX = 'ARRAY_INDEX',

  /** Element in array initializer. Use position field for index. */
  ARRAY_ELEMENT = 'ARRAY_ELEMENT',

  /** Size expression in array creation (n in new int[n]). */
  ARRAY_DIMENSION = 'ARRAY_DIMENSION',

  // === Unary ===
  /** Operand of unary expression (-x, !x, ++x). */
  UNARY_OPERAND = 'UNARY_OPERAND',

  // === Type Operations ===
  /** Expression being cast ((Type) EXPR). */
  CAST_OPERAND = 'CAST_OPERAND',

  /** Expression being tested (EXPR instanceof Type). */
  INSTANCEOF_OPERAND = 'INSTANCEOF_OPERAND',

  /** Pattern variable in instanceof pattern (obj instanceof Type VAR). Java 16+. */
  PATTERN_VARIABLE = 'PATTERN_VARIABLE',

  // === Functional ===
  /** Parameter declaration in lambda (x -> ..., (a, b) -> ...). */
  LAMBDA_PARAMETER = 'LAMBDA_PARAMETER',

  /** Body expression of lambda. */
  LAMBDA_BODY = 'LAMBDA_BODY',

  // === Switch Expression ===
  /** Selector expression in switch (switch(EXPR)). */
  SWITCH_SELECTOR = 'SWITCH_SELECTOR',

  /** Result expression in switch case (case X -> RESULT). */
  SWITCH_CASE_RESULT = 'SWITCH_CASE_RESULT',

  /** Guard expression in pattern case (case X when EXPR). Java 21+. */
  SWITCH_GUARD = 'SWITCH_GUARD',

  /** Constant expression in case label (case EXPR). */
  SWITCH_CASE_LABEL = 'SWITCH_CASE_LABEL',

  /**
   * Type pattern in switch case (case String s -> ...). Java 17+.
   * Contains the pattern variable name. The type is extracted as a type reference.
   * Example: case String s when s.length() > 5 -> "long";
   *          ^^^^^^^^ type pattern with variable 's'
   */
  SWITCH_TYPE_PATTERN = 'SWITCH_TYPE_PATTERN',

  // === Structural ===
  /** Inner expression of parentheses ((INNER)). */
  PARENTHESIZED_INNER = 'PARENTHESIZED_INNER',

  // === Assignment ===
  /** Left side of assignment (x in x = y). */
  ASSIGNMENT_TARGET = 'ASSIGNMENT_TARGET',

  /** Right side of assignment (y in x = y). */
  ASSIGNMENT_VALUE = 'ASSIGNMENT_VALUE',

  // === Object Creation ===
  /** Enclosing instance in qualified class creation (outer in outer.new Inner()). */
  ENCLOSING_INSTANCE = 'ENCLOSING_INSTANCE',

  // === Generic Type Arguments ===
  /** Type argument in generic method call or parameterized type (String in obj.<String>method()). Use position field for index. */
  TYPE_ARGUMENT = 'TYPE_ARGUMENT',

  // === String Template (Java 21+) ===
  /** Full template literal text in string template (STR."Hello \{name}!" -> "Hello \{name}!"). */
  TEMPLATE_LITERAL = 'TEMPLATE_LITERAL',

  /** Embedded expression in string template (\{expr} in STR."text \{expr} more"). Use position for index. */
  TEMPLATE_EMBEDDED = 'TEMPLATE_EMBEDDED',

  // === Record Pattern (Java 21+) ===
  /** Pattern variable binding in record pattern (n in Person(String n, int a)). Use position for index. */
  RECORD_PATTERN_BINDING = 'RECORD_PATTERN_BINDING',
}
