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
 * // RECORD_ACCESSOR / RECORD_EQUALS / RECORD_HASH_CODE / RECORD_TO_STRING
 * // Members JLS 8.10.3 declares implicitly on a record. They have no declaration node in the
 * // source, so they are synthesised from the record header.
 * public record Point(int x, int y) {}
 * //                      ^      ^   implicit: x() and y()  -> RECORD_ACCESSOR
 * //                                 implicit: equals(Object) -> RECORD_EQUALS
 * //                                 implicit: hashCode()     -> RECORD_HASH_CODE
 * //                                 implicit: toString()     -> RECORD_TO_STRING
 *
 * // These four kinds mark IMPLICIT members only. A record may declare any of them itself, in
 * // which case javac does not declare it implicitly and nothing is synthesised - the declared
 * // member is extracted from its own node and keeps INSTANCE_METHOD, exactly as before:
 * public record Custom(int x, int y) {
 *     @Override public int x() { return x < 0 ? 0 : x; }   // methodKind: INSTANCE_METHOD
 *     // y() is still implicit                             // methodKind: RECORD_ACCESSOR
 * }
 * // So methodKind answers "did the language declare this, or did a person?" - which is the
 * // distinction a consumer cannot recover once the member is in the fact set.
 *
 * // ENUM_VALUES / ENUM_VALUE_OF
 * // JLS 8.9.3 declares both on every enum. Unlike a record's members these cannot be written by
 * // hand - declaring values() or valueOf(String) in an enum body is a compile error - so they
 * // are always implicit and always present.
 * public enum Color { RED, GREEN }
 * //   implicit: public static Color[] values()          -> ENUM_VALUES
 * //   implicit: public static Color valueOf(String)     -> ENUM_VALUE_OF
 *
 * // DEFAULT_CONSTRUCTOR
 * // JLS 8.8.9 (classes) and 8.9.2 (enums): a type that declares NO constructor gets one
 * // implicitly. Its access is the class's own access, except on an enum, where it is private.
 * public class PlainClass { }        // implicit: public PlainClass()  -> DEFAULT_CONSTRUCTOR
 * public enum Color { RED }          // implicit: private Color()      -> DEFAULT_CONSTRUCTOR
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
  RECORD_ACCESSOR = 'RECORD_ACCESSOR',
  RECORD_EQUALS = 'RECORD_EQUALS',
  RECORD_HASH_CODE = 'RECORD_HASH_CODE',
  RECORD_TO_STRING = 'RECORD_TO_STRING',
  ENUM_VALUES = 'ENUM_VALUES',
  ENUM_VALUE_OF = 'ENUM_VALUE_OF',
  DEFAULT_CONSTRUCTOR = 'DEFAULT_CONSTRUCTOR',
}
