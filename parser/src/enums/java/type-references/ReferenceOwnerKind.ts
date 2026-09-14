/**
 * Classifies the ownership context of type references within Java source code structures.
 *
 * This enumeration identifies the specific syntactic location where a type reference
 * appears, enabling precise traceability from type usage back to the exact code element
 * that declares or uses the type. This supports detailed dependency analysis and impact
 * assessment across different levels of code organization.
 *
 * ## Ownership Contexts
 *
 * - **TYPE** – Type-level declarations (extends, implements, permits, type bounds)
 * - **FIELD** – Field type declarations within classes
 * - **METHOD** – Method return types and throws clause declarations
 * - **METHOD_PARAM** – Method and constructor parameter type declarations
 * - **ANNOTATION_ARGUMENT** – Type references in annotation argument values
 * - **LOCAL_VARIABLE** – Local variable type declarations within method bodies
 * - **EXPRESSION** – Type references in expressions (casts, instanceof, new)
 * - **ANNOTATION** – The annotation type itself (e.g., @Override → Override, @RequestMapping → RequestMapping)
 *
 * ## Ownership Examples
 *
 * ```java
 * // TYPE - Class-level type relationships
 * public class UserService<T extends BaseEntity>     // T extends BaseEntity: TYPE ownership
 *        extends AbstractService<User>               // AbstractService<User>: TYPE ownership
 *        implements CrudRepository<User, Long>       // CrudRepository<User, Long>: TYPE ownership
 *        permits StandardUserService, AdminUserService {  // Permitted types: TYPE ownership
 *
 *     // FIELD - Field type declarations
 *     private UserRepository repository;             // UserRepository: FIELD ownership
 *     private List<UserRole> roles;                  // List<UserRole>: FIELD ownership
 *     private final Map<String, Permission> perms;   // Map<String, Permission>: FIELD ownership
 *
 *     // METHOD - Method return types and throws clauses
 *     public Optional<User> findById(Long id)        // Optional<User>: METHOD ownership
 *            throws UserNotFoundException {          // UserNotFoundException: METHOD ownership
 *
 *         // LOCAL_VARIABLE - Local variable declarations
 *         UserQuery query = new UserQuery();         // UserQuery: LOCAL_VARIABLE ownership
 *         List<UserFilter> filters = getFilters();   // List<UserFilter>: LOCAL_VARIABLE ownership
 *
 *         // EXPRESSION - Type references in expressions
 *         if (user instanceof AdminUser) {           // AdminUser: EXPRESSION ownership
 *             return (AdminUser) user;               // AdminUser: EXPRESSION ownership
 *         }
 *         return new Optional<>(user);               // Optional: EXPRESSION ownership
 *     }
 *
 *     // METHOD_PARAM - Parameter type declarations
 *     public void saveUser(User user,                // User: METHOD_PARAM ownership
 *                         List<UserRole> roles,      // List<UserRole>: METHOD_PARAM ownership
 *                         UserOptions options) {     // UserOptions: METHOD_PARAM ownership
 *         // method body
 *     }
 *
 *     // Constructor parameters also use METHOD_PARAM
 *     public UserService(UserRepository repo,        // UserRepository: METHOD_PARAM ownership
 *                       UserValidator validator) {   // UserValidator: METHOD_PARAM ownership
 *         this.repository = repo;
 *     }
 * }
 *
 * // ANNOTATION_ARGUMENT - Type references in annotation argument values
 * @Entity(name = "users")                            // No type reference (string literal)
 * @Table(
 *     indexes = @Index(columnList = "email")         // No type reference (string literal)
 * )
 * @JsonDeserialize(using = UserDeserializer.class)   // UserDeserializer: ANNOTATION_ARGUMENT ownership
 * class User {
 *     @Column(targetClass = String.class)            // String: ANNOTATION_ARGUMENT ownership
 *     private String email;
 *
 *     @Enumerated(EnumType.STRING)                   // EnumType: ANNOTATION_ARGUMENT ownership (enum class)
 *     private UserRole role;
 *
 *     @Config(
 *         timeout = Constants.DEFAULT_TIMEOUT,      // Constants: ANNOTATION_ARGUMENT ownership
 *         handler = ErrorHandler.class,             // ErrorHandler: ANNOTATION_ARGUMENT ownership
 *         retries = Config.MAX_RETRIES * 2         // Config: ANNOTATION_ARGUMENT ownership
 *     )
 *     void processUser() {}
 * }
 *
 * // TYPE_PARAMETER - Type parameter bounds (the types that constrain the parameter)
 * class Container<T extends Number> {                // Number: TYPE_PARAMETER ownership (bound on T)
 *     // Type parameters with bounds
 * }
 *
 * class Processor<E extends Comparable<E> & Serializable> {
 *     // Comparable<E>: TYPE_PARAMETER ownership (first bound)
 *     // Serializable: TYPE_PARAMETER ownership (second bound)
 * }
 *
 * // Note: For annotations ON type parameters, type references in those annotation arguments
 * // use ANNOTATION_ARGUMENT ownership (not TYPE_PARAMETER), to maintain direct linkability:
 * class ValidatedContainer<@Validated(validator = SizeValidator.class) U> {
 *     // SizeValidator: ANNOTATION_ARGUMENT ownership (class literal in annotation argument)
 *     // Context: TYPE_PARAMETER_ANNOTATION (distinguishes it from regular annotation arguments)
 *     // Linkage: TypeReference → AnnotationArgument → Annotation → TypeParameter
 * }
 *
 * // ANNOTATION - The annotation type itself
 * @Entity                                            // Entity: ANNOTATION ownership → TYPE_ANNOTATION_*
 * @RequestMapping("/api/users")                      // RequestMapping: ANNOTATION ownership → TYPE_ANNOTATION_*
 * @javax.annotation.Nullable                         // Nullable: ANNOTATION ownership (qualified name)
 * class AnnotatedService { }
 * ```
 *
 * ## Ownership Linking
 *
 * - **TYPE:** Links to TypeRegistry hash of the declaring class
 * - **FIELD:** Links to FieldRegistry hash of the specific field
 * - **METHOD:** Links to MethodRegistry hash of the specific method
 * - **METHOD_PARAM:** Links to MethodParameterRegistry hash of the specific parameter
 * - **ANNOTATION_ARGUMENT:** Links to AnnotationArgumentReference hash of the specific argument
 *   - Used for class literals in all annotation arguments, including those on type parameters
 *   - For type parameter annotations, the context is TYPE_PARAMETER_ANNOTATION (not just ANNOTATION_PARAM)
 * - **TYPE_PARAMETER:** Links to TypeParameter hash (for type parameter bounds like `T extends Number`)
 * - **LOCAL_VARIABLE:** Links to LocalVariableRegistry hash
 * - **EXPRESSION:** Links to ExpressionReference hash
 * - **ANNOTATION:** Links to TypeAnnotation hash (the annotation usage entity itself)
 *
 * ## Analysis Capabilities
 *
 * ```sql
 * -- Find all usages of CustomUser type
 * SELECT tr.*, rk.owner_kind, rk.owner_link_hash
 * FROM java_type_reference tr
 * WHERE tr.referenced_type_registry_hash = 'custom_user_hash';
 *
 * -- Results enable precise impact analysis:
 * -- - TYPE: CustomUser used in class inheritance
 * -- - FIELD: CustomUser used as field type in specific fields
 * -- - METHOD: CustomUser used as return type in specific methods
 * -- - METHOD_PARAM: CustomUser used as parameter in specific methods
 * -- - LOCAL_VARIABLE: CustomUser used in local variables
 * -- - EXPRESSION: CustomUser used in casts/instanceof checks
 * -- - ANNOTATION: CustomUser used as annotation type (@CustomUser)
 * ```
 *
 * ## Implementation Guidelines
 *
 * - **Granularity:** Each ownership kind links to the most specific registry entity
 * - **Traceability:** Enables navigation from type usage to exact source location
 * - **Extensibility:** New ownership contexts can be added without breaking existing data
 * - **Consistency:** Same type reference pattern across all ownership contexts
 *
 * @remarks Used in conjunction with TypeRefKind and TypeRefContext
 *          to provide complete classification of type reference location and structure.
 *
 * @see TypeRefKind
 * @see TypeRefContext
 *
 * @todo Add FieldRegistry, MethodRegistry, ConstructorRegistry, MethodParameterRegistry
 */
export enum ReferenceOwnerKind {
  /** Type-level declarations (extends, implements, permits, type parameter bounds). */
  TYPE = 'TYPE',

  /** Field type declarations within classes, interfaces, enums, or records. */
  FIELD = 'FIELD',

  /** Method return types and throws clause type declarations. */
  METHOD = 'METHOD',

  /** Method and constructor parameter type declarations. */
  METHOD_PARAM = 'METHOD_PARAM',

  /** Annotation argument type references (e.g., @Anno(value = SomeClass.class)). */
  ANNOTATION_ARGUMENT = 'ANNOTATION_ARGUMENT',

  /** Annotations on type parameter declarations (e.g., class Box<@NonNull T>). */
  TYPE_PARAMETER = 'TYPE_PARAMETER',

  /** Local variable type declarations within method or constructor bodies. */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  /** Type references in expressions (casts, instanceof, object creation). */
  EXPRESSION = 'EXPRESSION',

  /** Annotation type reference (the annotation itself, e.g., @RequestMapping). Owner is the TypeAnnotation hash. */
  ANNOTATION = 'ANNOTATION',
}
