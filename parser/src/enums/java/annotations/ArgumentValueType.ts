/**
 * Classification of annotation argument value types in Java.
 * 
 * Annotation arguments in Java can accept various value types, each with
 * specific semantic meaning and linking requirements. This enum categorizes
 * argument values to enable type-specific analysis and relationship tracking.
 * 
 * ## Argument Value Categories
 * 
 * Java annotation arguments support eight distinct value types:
 * 
 * ### Reference Types
 * - **CLASS_REFERENCE**: Class literals (`.class` syntax)
 * - **ENUM_CONSTANT**: Enum values
 * - **NESTED_ANNOTATION**: Other annotations as values
 * 
 * ### Literal Types
 * - **STRING_LITERAL**: String constants
 * - **NUMBER_LITERAL**: Integer and floating-point numbers
 * - **BOOLEAN_LITERAL**: `true` or `false`
 * - **NULL**: Null literal
 * 
 * ### Fallback
 * - **UNKNOWN**: Unclassified or complex expressions
 * 
 * ## Array Handling
 * 
 * Arrays are NOT represented as a single ARRAY type. Instead, each array element
 * is expanded into its own AnnotationArgumentReference with:
 * - `valueType`: The type of the individual element (STRING_LITERAL, ENUM_CONSTANT, etc.)
 * - `arrayIndex`: Position within the array (0, 1, 2, ...)
 * 
 * Example: `@Target({TYPE, METHOD})` creates two separate argument references:
 * - argumentName="value", argumentValue="TYPE", valueType=ENUM_CONSTANT, arrayIndex=0
 * - argumentName="value", argumentValue="METHOD", valueType=ENUM_CONSTANT, arrayIndex=1
 * 
 * ## Usage in Analysis
 * 
 * Argument value types enable:
 * - **Type linking**: Connect CLASS_REFERENCE to TypeRegistry entities
 * - **Annotation graphs**: Link NESTED_ANNOTATION to child annotations
 * - **Configuration mining**: Extract STRING_LITERAL and NUMBER_LITERAL patterns
 * - **Dependency analysis**: Track class references in annotations
 * - **Validation**: Ensure type-appropriate argument values
 * 
 * ## Relationship to AnnotationArgumentReference
 * 
 * Each AnnotationArgumentReference entity has a valueType field that uses
 * this enum to classify its value, enabling type-specific queries and linking.
 */
export enum ArgumentValueType {
  /**
   * Class reference using `.class` literal syntax.
   * 
   * Links to TypeRegistry entities for dependency analysis.
   * 
   * Examples:
   * ```java
   * @EntityListeners(AuditListener.class)
   * @JsonDeserialize(using = CustomDeserializer.class)
   * @ManyToOne(targetEntity = Customer.class)
   * ```
   * 
   * Pattern: `ClassName.class` or `package.ClassName.class`
   */
  CLASS_REFERENCE = 'CLASS_REFERENCE',
  
  /**
   * String literal value.
   * 
   * Common for configuration, names, paths, and messages.
   * 
   * Examples:
   * ```java
   * @Column(name = "user_id")
   * @RequestMapping(path = "/api/users")
   * @Table(name = "users", schema = "public")
   * @Value("${app.config.timeout}")
   * ```
   * 
   * Pattern: `"string content"` (with escaping support)
   */
  STRING_LITERAL = 'STRING_LITERAL',
  
  /**
   * Numeric literal (integer or floating-point).
   * 
   * Used for configuration values, limits, and constants.
   * 
   * Examples:
   * ```java
   * @Timeout(1000)
   * @Size(min = 1, max = 255)
   * @Column(length = 50, precision = 2)
   * @CacheEvict(maxEntries = 100)
   * ```
   * 
   * Pattern: `123`, `3.14`, `0xFF`, `1_000_000`, `-1`, `999L`
   */
  NUMBER_LITERAL = 'NUMBER_LITERAL',
  
  /**
   * Character literal value.
   * 
   * Single character constants enclosed in single quotes.
   * 
   * Examples:
   * ```java
   * @CharValue('x')
   * @Delimiter(',')
   * @Separator('\t')
   * ```
   * 
   * Pattern: `'c'`, `'\n'`, `'\u0041'`
   */
  CHAR_LITERAL = 'CHAR_LITERAL',
  
  /**
   * Boolean literal (`true` or `false`).
   * 
   * Used for feature flags and configuration switches.
   * 
   * Examples:
   * ```java
   * @Column(nullable = false)
   * @JsonProperty(required = true)
   * @Transactional(readOnly = true)
   * @Cacheable(sync = false)
   * ```
   * 
   * Pattern: `true` or `false`
   */
  BOOLEAN_LITERAL = 'BOOLEAN_LITERAL',
  
  /**
   * Enum constant or static final field reference.
   * 
   * Common for type-safe configuration using enum values or compile-time constants.
   * Cannot distinguish between enum constants and static final fields without type resolution.
   * 
   * Examples:
   * ```java
   * @Retention(RetentionPolicy.RUNTIME)
   * @Target(ElementType.TYPE)
   * @RequestMapping(method = RequestMethod.GET)
   * @Timeout(Constants.DEFAULT_TIMEOUT)
   * @Message(ErrorMessages.CONNECTION_FAILED)
   * ```
   * 
   * Pattern: `Type.CONSTANT` or `CONSTANT` (when statically imported)
   */
  ENUM_CONSTANT = 'ENUM_CONSTANT',
  
  /**
   * Compile-time constant expression.
   * 
   * Arithmetic, bitwise, or string concatenation expressions evaluated at compile time.
   * 
   * Examples:
   * ```java
   * @Timeout(60 * 1000)
   * @BitMask(1 << 3)
   * @Value(2 + 3 * 4)
   * @Message("Error: " + "Connection failed")
   * @NegativeValue(-1)
   * @BitwiseNot(~0)
   * ```
   * 
   * Pattern: Binary ops (`+`, `-`, `*`, `/`, `<<`, `>>`, `|`, `&`, `^`) or unary ops (`-`, `+`, `~`, `!`)
   */
  CONSTANT_EXPRESSION = 'CONSTANT_EXPRESSION',
  
  /**
   * Nested annotation as argument value.
   * 
   * Links to child TypeAnnotation entities for hierarchical analysis.
   * 
   * Examples:
   * ```java
   * @JoinColumn(foreignKey = @ForeignKey(name = "fk_user"))
   * @JsonFormat(with = @JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY)
   * @SecondaryTable(pkJoinColumns = @PrimaryKeyJoinColumn(name = "user_id"))
   * ```
   * 
   * Pattern: Full annotation syntax `@AnnotationName(...)`
   */
  NESTED_ANNOTATION = 'NESTED_ANNOTATION',
  
  /**
   * Null literal value.
   * 
   * Rarely used but syntactically valid in some contexts.
   * 
   * Examples:
   * ```java
   * @JsonProperty(defaultValue = null)
   * ```
   * 
   * Pattern: `null`
   */
  NULL = 'NULL',
  
  /**
   * Unknown or unclassified value type.
   * 
   * Fallback for complex expressions or unrecognized patterns.
   * May indicate need for parser enhancement.
   * 
   * Examples:
   * - Complex constant expressions
   * - Method calls (generally not allowed)
   * - Unrecognized syntax patterns
   */
  UNKNOWN = 'UNKNOWN',
}
