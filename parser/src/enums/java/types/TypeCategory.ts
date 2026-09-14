/**
 * ### Supported Type Categories:
 * - **CLASS_TYPE** - Regular class that can be instantiated and extended
 * - **INTERFACE_TYPE** - Contract definition that must be implemented
 * - **ENUM_TYPE** - Fixed set of constants with type safety (Java 5+)
 * - **RECORD_TYPE** - Immutable data carrier with auto-generated methods (Java 14+)
 * - **ANNOTATION_TYPE** - Reserved for future use or general annotation classification
 * - **ANNOTATION_INTERFACE_TYPE** - Annotation type declarations using @interface syntax
 *
 * ### Examples by Type Category:
 * ```java
 * // CLASS_TYPE - Regular instantiable classes
 * public class PaymentService {}
 * public abstract class BasePaymentProcessor {}
 * public final class PaymentValidator {}
 *
 * // INTERFACE_TYPE - Contract definitions
 * public interface PaymentGateway {
 *     PaymentResult process(PaymentRequest request);
 * }
 *
 * // ENUM_TYPE - Type-safe constants
 * public enum PaymentStatus {
 *     PENDING, PROCESSING, COMPLETED, FAILED;
 * }
 *
 * // RECORD_TYPE - Immutable data carriers (Java 14+)
 * public record PaymentRequest(
 *     String merchantId,
 *     BigDecimal amount,
 *     Currency currency
 * ) {}
 *
 * // ANNOTATION_INTERFACE_TYPE - Annotation type declarations (@interface)
 * // These are interfaces that extend java.lang.annotation.Annotation
 * @Target(ElementType.METHOD)
 * @Retention(RetentionPolicy.RUNTIME)
 * public @interface PaymentEndpoint {
 *     String value() default "";
 * }
 * ```
 *
 * ### Note on ANNOTATION_INTERFACE_TYPE:
 * In Java, `@interface` declarations are syntactic sugar. At the bytecode level:
 * - They ARE interfaces that implicitly extend java.lang.annotation.Annotation
 * - The @interface keyword is syntactic sugar for this special interface type
 * - ANNOTATION_INTERFACE_TYPE distinguishes these from regular INTERFACE_TYPE
 */
export enum TypeCategory {
  CLASS_TYPE = 'CLASS_TYPE',
  INTERFACE_TYPE = 'INTERFACE_TYPE',
  ENUM_TYPE = 'ENUM_TYPE',
  RECORD_TYPE = 'RECORD_TYPE',
  ANNOTATION_TYPE = 'ANNOTATION_TYPE',
  ANNOTATION_INTERFACE_TYPE = 'ANNOTATION_INTERFACE_TYPE',
}
