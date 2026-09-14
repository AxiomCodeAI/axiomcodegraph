/**
 * Classification of annotation structural patterns in Java.
 * 
 * Annotations in Java can take various syntactic forms depending on their
 * argument structure. This enum categorizes annotations by their argument
 * pattern to enable structural analysis and querying.
 * 
 * ## Annotation Syntax Patterns
 * 
 * Java supports five distinct annotation argument patterns:
 * 
 * 1. **MARKER**: No arguments
 *    - Simplest form, used for boolean flags or presence indicators
 *    - Example: `@Override`, `@Deprecated`, `@FunctionalInterface`
 * 
 * 2. **SINGLE_VALUE**: Shorthand single argument (implicit "value")
 *    - Uses implicit "value" attribute name
 *    - Example: `@Timeout(1000)`, `@SuppressWarnings("unchecked")`
 * 
 * 3. **ARRAY_VALUE**: Shorthand array argument
 *    - Array literal using braces without explicit attribute name
 *    - Example: `@Target({ElementType.TYPE, ElementType.METHOD})`
 * 
 * 4. **NAMED_ARGUMENTS**: Explicit name=value pairs
 *    - One or more explicitly named arguments
 *    - Example: `@Column(name = "user_id", nullable = false)`
 *    - Example: `@RequestMapping(method = RequestMethod.GET, path = "/users")`
 * 
 * 5. **NESTED**: Contains nested annotation(s) as arguments
 *    - Arguments include other annotations
 *    - Example: `@JoinColumn(foreignKey = @ForeignKey(name = "fk_user"))`
 *    - Example: `@JsonFormat(with = @JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY)`
 * 
 * ## Usage in Analysis
 * 
 * The annotation kind enables:
 * - Pattern-based filtering: Find all marker annotations vs. configured ones
 * - Complexity analysis: Identify heavily parameterized annotations
 * - Refactoring detection: Track changes from marker to configured annotations
 * - Convention analysis: Discover common annotation patterns in codebase
 * 
 * ## Relationship to Arguments
 * 
 * While AnnotationKind categorizes the structural pattern, individual arguments
 * are tracked separately as AnnotationArgumentReference entities for detailed
 * argument-level analysis.
 */
export enum AnnotationKind {
  /**
   * Marker annotation with no arguments.
   * 
   * Examples:
   * - `@Override`
   * - `@Deprecated`
   * - `@FunctionalInterface`
   * - `@PostConstruct`
   */
  MARKER = 'MARKER',
  
  /**
   * Single value annotation using implicit "value" attribute.
   * 
   * Examples:
   * - `@Timeout(1000)`
   * - `@SuppressWarnings("unchecked")`
   * - `@RequestMapping("/api/users")`
   * - `@Retention(RetentionPolicy.RUNTIME)`
   */
  SINGLE_VALUE = 'SINGLE_VALUE',
  
  /**
   * Array value annotation with implicit "value" attribute.
   * 
   * Examples:
   * - `@Target({ElementType.TYPE, ElementType.METHOD})`
   * - `@SuppressWarnings({"unchecked", "deprecation"})`
   */
  ARRAY_VALUE = 'ARRAY_VALUE',
  
  /**
   * Named arguments annotation with explicit attribute names.
   * 
   * Examples:
   * - `@Column(name = "user_id", nullable = false)`
   * - `@Table(name = "users", schema = "public")`
   * - `@RequestMapping(method = RequestMethod.GET, path = "/users")`
   */
  NAMED_ARGUMENTS = 'NAMED_ARGUMENTS',
  
  /**
   * Nested annotation containing other annotations as arguments.
   * 
   * Examples:
   * - `@JoinColumn(foreignKey = @ForeignKey(name = "fk_user"))`
   * - `@JsonFormat(with = @JsonFormat.Feature.ACCEPT_SINGLE_VALUE_AS_ARRAY)`
   * - `@Repeatable(@Schedules)`
   */
  NESTED = 'NESTED',
}
