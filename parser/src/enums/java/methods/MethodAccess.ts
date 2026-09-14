/**
 * ### Supported Method Access Levels:
 * - **PUBLIC** - Method is accessible from any package (`public` modifier)
 * - **PROTECTED** - Method is accessible within package and subclasses (`protected` modifier)
 * - **PRIVATE** - Method is accessible only within enclosing class (`private` modifier)
 * - **PACKAGE** - Method is accessible only within same package (no explicit modifier)
 *
 * ### Java Language Rules Applied:
 * - Interface methods default to `public` (implicit)
 * - Annotation elements are always `public` (implicit)
 * - Enum constructors default to `private` (public/protected are illegal)
 * - Class methods default to package-private (no modifier)
 * - Private interface methods are allowed in Java 9+
 *
 * ### Examples:
 * ```java
 * // Class methods
 * public class UserService {
 *     public void save(User user) {}           // PUBLIC - External API
 *     protected void validate(User user) {}    // PROTECTED - Subclass access
 *     private void encrypt(String data) {}     // PRIVATE - Internal only
 *     void log(String message) {}              // PACKAGE - Package internal
 * }
 *
 * // Interface methods (Java 9+)
 * public interface PaymentGateway {
 *     void process(Payment p);                 // PUBLIC (implicit)
 *     default void log(String msg) {}          // PUBLIC (implicit)
 *     static void validate(Payment p) {}       // PUBLIC (implicit)
 *     private void helper() {}                 // PRIVATE (Java 9+)
 * }
 *
 * // Annotation elements (always public)
 * public @interface RequestMapping {
 *     String value();                          // PUBLIC (implicit)
 *     String method() default "GET";           // PUBLIC (implicit)
 * }
 *
 * // Enum constructors (always private)
 * public enum Status {
 *     ACTIVE("active"), INACTIVE("inactive");
 *     Status(String code) {}                   // PRIVATE (implicit, public/protected illegal)
 * }
 * ```
 */
export enum MethodAccess {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  PACKAGE = 'PACKAGE',
}
