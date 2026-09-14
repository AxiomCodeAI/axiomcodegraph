/**
 * ### Supported Type Placements:
 * - **TOP_LEVEL_PLACEMENT** - Type declared at package level (most common, widest visibility)
 * - **STATIC_NESTED_PLACEMENT** - Static nested type within another class (no outer instance dependency)
 * - **INNER_PLACEMENT** - Non-static inner class with access to outer instance members
 * - **LOCAL_PLACEMENT** - Type declared within a method, constructor, or initializer block
 * - **ANONYMOUS_PLACEMENT** - Anonymous class implementation (often lambda alternatives)
 *
 * ### Examples by Placement:
 * ```java
 * // TOP_LEVEL_PLACEMENT - Package-level types
 * public class PaymentService {}
 * interface PaymentGateway {}
 * enum PaymentStatus {}
 * record PaymentRequest() {}
 *
 * // STATIC_NESTED_PLACEMENT - No outer instance dependency
 * public class PaymentProcessor {
 *     public static class PaymentResult {}        // Explicit static
 *     public interface PaymentCallback {}         // Implicitly static
 *     public enum PaymentMethod {}                // Implicitly static
 *     public record PaymentData() {}              // Implicitly static
 *     public @interface PaymentAnnotation {}      // Implicitly static
 * }
 *
 * // INNER_PLACEMENT - Has access to outer instance
 * public class PaymentService {
 *     private String serviceId;
 *
 *     public class PaymentValidator {             // Non-static inner class
 *         public boolean validate() {
 *             return serviceId != null;           // Can access outer fields
 *         }
 *     }
 * }
 *
 * // LOCAL_PLACEMENT - Method/block scoped
 * public class PaymentController {
 *     public void processPayment() {
 *         class LocalValidator {}                 // Local class
 *         record LocalPaymentData() {}            // Local record
 *     }
 * }
 *
 * // ANONYMOUS_PLACEMENT - Anonymous implementations
 * public class PaymentService {
 *     PaymentCallback callback = new PaymentCallback() {  // Anonymous class
 *         @Override
 *         public void onComplete() { ... }
 *     };
 * }
 * ```
 */
export enum TypePlacement {
  TOP_LEVEL_PLACEMENT = 'TOP_LEVEL_PLACEMENT',
  STATIC_NESTED_PLACEMENT = 'STATIC_NESTED_PLACEMENT',
  INNER_PLACEMENT = 'INNER_PLACEMENT',
  LOCAL_PLACEMENT = 'LOCAL_PLACEMENT',
  ANONYMOUS_PLACEMENT = 'ANONYMOUS_PLACEMENT',
}
