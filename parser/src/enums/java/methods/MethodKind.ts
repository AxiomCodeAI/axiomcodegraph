/**
 * Method Kind Classification
 *
 * Categorizes methods based on their type and behavior. Each method is assigned exactly ONE MethodKind.
 *
 * ## Method Categories
 *
 * - **Instance** – Regular methods requiring an object instance
 * - **Static** – Class-level methods not tied to an instance
 * - **Abstract** – Methods without implementation (must be overridden)
 * - **Default** – Interface methods with default implementation (Java 8+)
 * - **Constructors** – Regular constructors and record compact constructors
 * - **Initializers** – Static and instance initialization blocks
 * - **Special** – Annotation elements and enum constant methods
 *
 * ## Classification Examples
 *
 * ```java
 * public class UserService {
 *     // STATIC_INITIALIZER - static initialization block
 *     static {
 *         System.loadLibrary("native");           // methodKind: STATIC_INITIALIZER
 *     }
 *
 *     // INSTANCE_INITIALIZER - instance initialization block
 *     {
 *         System.out.println("instance created"); // methodKind: INSTANCE_INITIALIZER
 *     }
 *
 *     // CONSTRUCTOR - regular constructor
 *     public UserService(UserRepository repo) {   // methodKind: CONSTRUCTOR
 *         this.repo = repo;
 *     }
 *
 *     // INSTANCE_METHOD - regular instance method
 *     public User findById(Long id) {             // methodKind: INSTANCE_METHOD
 *         return repo.findById(id);
 *     }
 *
 *     // STATIC_METHOD - static utility method
 *     public static UserService create() {        // methodKind: STATIC_METHOD
 *         return new UserService(new UserRepository());
 *     }
 * }
 *
 * // ABSTRACT_METHOD - no method body
 * public abstract class BaseProcessor {
 *     public abstract void process();             // methodKind: ABSTRACT_METHOD
 * }
 *
 * // DEFAULT_METHOD - interface method with implementation (Java 8+)
 * public interface Logger {
 *     void log(String msg);                       // methodKind: ABSTRACT_METHOD (no body)
 *     default void info(String msg) {             // methodKind: DEFAULT_METHOD
 *         log("INFO: " + msg);
 *     }
 *     static Logger create() {                    // methodKind: STATIC_METHOD
 *         return msg -> System.out.println(msg);
 *     }
 * }
 *
 * // ANNOTATION_ELEMENT - methods in @interface declarations
 * public @interface Config {
 *     String name();                              // methodKind: ANNOTATION_ELEMENT
 *     int timeout() default 30;                   // methodKind: ANNOTATION_ELEMENT
 * }
 *
 * // COMPACT_CONSTRUCTOR - record compact constructor (Java 16+)
 * public record User(String name, int age) {
 *     public User {                               // methodKind: COMPACT_CONSTRUCTOR (no param list)
 *         if (age < 0) throw new IllegalArgumentException();
 *     }
 * }
 *
 * // CONSTRUCTOR for records - explicit canonical constructor
 * public record Point(int x, int y) {
 *     public Point(int x, int y) {                // methodKind: CONSTRUCTOR (explicit canonical)
 *         this.x = x;
 *         this.y = y;
 *     }
 * }
 *
 * // ENUM_CONSTANT_METHOD - method in enum constant anonymous body
 * public enum Status {
 *     ACTIVE {
 *         @Override
 *         public String describe() {              // methodKind: ENUM_CONSTANT_METHOD
 *             return "Active";
 *         }
 *     };
 *     public abstract String describe();          // methodKind: ABSTRACT_METHOD
 * }
 * ```
 *
 * ## Determination Logic (Priority Order)
 *
 * 1. Special AST node types (constructors, initializers, annotation elements)
 * 2. Abstract (no method body, excluding native methods)
 * 3. Default modifier (interface default methods)
 * 4. Static modifier
 * 5. Fallback to INSTANCE_METHOD
 *
 * ## Edge Cases
 *
 * - **Native methods:** No body but NOT abstract → STATIC_METHOD or INSTANCE_METHOD
 * - **Interface methods:** No body → ABSTRACT_METHOD (unless default or static)
 * - **Interface private methods (Java 9+):** INSTANCE_METHOD or STATIC_METHOD
 * - **Enum constructors:** Always CONSTRUCTOR (implicitly private)
 * - **Record constructors:** Explicit canonical = CONSTRUCTOR, compact = COMPACT_CONSTRUCTOR
 */
export enum MethodKind {
  INSTANCE_METHOD = 'INSTANCE_METHOD',
  STATIC_METHOD = 'STATIC_METHOD',
  ABSTRACT_METHOD = 'ABSTRACT_METHOD',
  DEFAULT_METHOD = 'DEFAULT_METHOD',
  CONSTRUCTOR = 'CONSTRUCTOR',
  COMPACT_CONSTRUCTOR = 'COMPACT_CONSTRUCTOR',
  STATIC_INITIALIZER = 'STATIC_INITIALIZER',
  INSTANCE_INITIALIZER = 'INSTANCE_INITIALIZER',
  ANNOTATION_ELEMENT = 'ANNOTATION_ELEMENT',
  ENUM_CONSTANT_METHOD = 'ENUM_CONSTANT_METHOD',
}
