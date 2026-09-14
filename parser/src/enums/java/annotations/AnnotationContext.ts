/**
 * Classification of where annotations appear in Java source code.
 * 
 * Java allows annotations in numerous syntactic locations, each serving
 * different purposes in the language. This enum categorizes annotations
 * by their declaration context to enable context-specific analysis.
 * 
 * ## Annotation Target Contexts
 * 
 * Java supports annotations in 12 distinct contexts, each with specific
 * semantic meaning and application:
 * 
 * ### Declaration Contexts
 * - **TYPE_DECLARATION**: Classes, interfaces, enums
 * - **FIELD_DECLARATION**: Class or instance fields
 * - **METHOD_DECLARATION**: Method definitions
 * - **PARAMETER_DECLARATION**: Method and constructor parameters
 * - **CONSTRUCTOR_DECLARATION**: Constructor definitions
 * - **ANNOTATION_TYPE_DECLARATION**: Meta-annotations on annotation definitions
 * - **ENUM_CONSTANT**: Individual enum values
 * - **RECORD_COMPONENT**: Record component parameters (Java 14+)
 * - **PACKAGE_DECLARATION**: Package-level annotations
 * 
 * ### Type System Contexts
 * - **TYPE_PARAMETER**: Generic type parameter declarations
 * - **TYPE_USE**: Any use of a type in code (Java 8+)
 * - **LOCAL_VARIABLE**: Local variable declarations within methods
 * 
 * ## Usage in Analysis
 * 
 * The annotation context enables:
 * - Target analysis: Find annotations by where they're applied
 * - Convention checking: Validate annotation usage patterns
 * - Migration detection: Track annotation placement across versions
 * - Framework analysis: Identify dependency injection, validation, mapping patterns
 * - Compliance checking: Ensure annotations used in correct contexts
 * 
 * ## Java @Target Relationship
 * 
 * While Java's `@Target` meta-annotation restricts where annotations can be used,
 * AnnotationContext captures where they're actually used in source code, enabling
 * validation and pattern analysis.
 */
export enum AnnotationContext {
  /**
   * Annotation on a type declaration (class, interface, enum).
   * 
   * Examples:
   * ```java
   * @Entity
   * @Table(name = "users")
   * public class User { }
   * 
   * @Service
   * public class UserService { }
   * 
   * @FunctionalInterface
   * public interface Processor { }
   * ```
   */
  TYPE_DECLARATION = 'TYPE_DECLARATION',
  
  /**
   * Annotation on a field declaration.
   * 
   * Examples:
   * ```java
   * @Id
   * @GeneratedValue(strategy = GenerationType.IDENTITY)
   * private Long id;
   * 
   * @Autowired
   * private UserRepository userRepository;
   * 
   * @Column(name = "email_address")
   * private String email;
   * ```
   */
  FIELD_DECLARATION = 'FIELD_DECLARATION',
  
  /**
   * Annotation on a method declaration.
   * 
   * Examples:
   * ```java
   * @Override
   * public String toString() { }
   * 
   * @GetMapping("/users/{id}")
   * public User getUser(@PathVariable Long id) { }
   * 
   * @Transactional(readOnly = true)
   * public List<User> findAll() { }
   * ```
   */
  METHOD_DECLARATION = 'METHOD_DECLARATION',
  
  /**
   * Annotation on a method or constructor parameter.
   * 
   * Examples:
   * ```java
   * public void setUser(@NotNull User user) { }
   * 
   * public User getUser(@PathVariable("id") Long userId) { }
   * 
   * public UserService(@Autowired UserRepository repo) { }
   * ```
   */
  PARAMETER_DECLARATION = 'PARAMETER_DECLARATION',
  
  /**
   * Annotation on a constructor declaration.
   * 
   * Examples:
   * ```java
   * @Autowired
   * public UserService(UserRepository repo) { }
   * 
   * @JsonCreator
   * public User(@JsonProperty("name") String name) { }
   * ```
   */
  CONSTRUCTOR_DECLARATION = 'CONSTRUCTOR_DECLARATION',
  
  /**
   * Annotation on a local variable within a method body.
   * 
   * Examples:
   * ```java
   * public void process() {
   *     @SuppressWarnings("unchecked")
   *     List<String> items = (List<String>) obj;
   * }
   * ```
   */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',
  
  /**
   * Annotation on a generic type parameter declaration.
   * 
   * Examples:
   * ```java
   * public class Container<@NonNull T> { }
   * 
   * public <@Nullable E> void process(E element) { }
   * ```
   */
  TYPE_PARAMETER = 'TYPE_PARAMETER',
  
  /**
   * Annotation on type usage (Java 8+ type annotations).
   * 
   * Examples:
   * ```java
   * List<@NonNull String> items;
   * 
   * Map<@NonEmpty String, @Positive Integer> scores;
   * 
   * @NonNull String getValue() { }
   * 
   * void process() throws @Critical IOException { }
   * ```
   */
  TYPE_USE = 'TYPE_USE',
  
  /**
   * Annotation on a package declaration (in package-info.java).
   * 
   * Examples:
   * ```java
   * @NonNullApi
   * @NonNullFields
   * package com.example.api;
   * ```
   */
  PACKAGE_DECLARATION = 'PACKAGE_DECLARATION',
  
  /**
   * Meta-annotation on an annotation type declaration.
   * 
   * Examples:
   * ```java
   * @Target(ElementType.TYPE)
   * @Retention(RetentionPolicy.RUNTIME)
   * public @interface MyAnnotation { }
   * ```
   */
  ANNOTATION_TYPE_DECLARATION = 'ANNOTATION_TYPE_DECLARATION',
  
  /**
   * Annotation on an enum constant.
   * 
   * Examples:
   * ```java
   * public enum Status {
   *     @JsonProperty("active")
   *     ACTIVE,
   *     
   *     @JsonProperty("inactive")
   *     INACTIVE
   * }
   * ```
   */
  ENUM_CONSTANT = 'ENUM_CONSTANT',
  
  /**
   * Annotation on a record component (Java 14+).
   * 
   * Examples:
   * ```java
   * public record User(
   *     @NotNull String name,
   *     @Email String email
   * ) { }
   * ```
   */
  RECORD_COMPONENT = 'RECORD_COMPONENT',
  
  /**
   * Annotation on a class-level type parameter bound.
   * 
   * Examples:
   * ```java
   * public class Container<T extends @NonNull Serializable> { }
   * 
   * public class Box<T extends @Valid Number & @NonNull Comparable<T>> { }
   * ```
   */
  TYPE_PARAM_BOUND = 'TYPE_PARAM_BOUND',
  
  /**
   * Annotation on a method-level type parameter bound.
   * 
   * Examples:
   * ```java
   * public <T extends @NonNull Number> T process(T value) { }
   * 
   * public <T extends @Valid Comparable<T>> void sort(List<T> items) { }
   * ```
   */
  METHOD_TYPE_PARAM_BOUND = 'METHOD_TYPE_PARAM_BOUND',
}
