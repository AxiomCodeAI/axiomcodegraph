/**
 * ### Supported Type Modifiers:
 * - **STATIC_MODIFIER** - Type doesn't require outer class instance (nested classes only)
 * - **ABSTRACT_MODIFIER** - Type cannot be instantiated directly, must be subclassed
 * - **FINAL_MODIFIER** - Type cannot be extended/subclassed
 * - **STRICTFP_MODIFIER** - Floating-point calculations use strict IEEE 754 semantics
 * - **SEALED_MODIFIER** - Type restricts which classes can extend it (Java 17+)
 * - **NON_SEALED_MODIFIER** - Sealed subclass that allows further extension (Java 17+)
 * - **DEPRECATED_MODIFIER** - Type is marked for removal or discouraged use
 *
 * ### Examples by Modifier Type:
 * ```java
 * // STATIC_MODIFIER - Nested class without outer instance dependency
 * public class PaymentService {
 *     public static class PaymentResult {}     // Can be instantiated independently
 * }
 *
 * // ABSTRACT_MODIFIER - Cannot be instantiated directly
 * public abstract class BasePaymentProcessor {
 *     public abstract void process();          // Must be implemented by subclasses
 * }
 *
 * // FINAL_MODIFIER - Cannot be extended
 * public final class ImmutablePaymentData {   // Prevents subclassing for security
 *     // Implementation details
 * }
 *
 * // SEALED_MODIFIER - Controlled inheritance (Java 17+)
 * public sealed class PaymentMethod
 *     permits CreditCard, DebitCard, DigitalWallet {
 *     // Only specified classes can extend this
 * }
 *
 * // NON_SEALED_MODIFIER - Allows further extension in sealed hierarchy
 * public non-sealed class DigitalWallet extends PaymentMethod {
 *     // Can be extended by other classes
 * }
 *
 * // DEPRECATED_MODIFIER - Marked for removal
 * @Deprecated(since = "2.0", forRemoval = true)
 * public class LegacyPaymentProcessor {       // Should be migrated away from
 *     // Legacy implementation
 * }
 *
 * // STRICTFP_MODIFIER - Strict floating-point semantics
 * public strictfp class FinancialCalculator { // Ensures consistent math across platforms
 *     public double calculateInterest() { ... }
 * }
 * ```
 */
export enum TypeModifier {
  ABSTRACT_MODIFIER = 'ABSTRACT_MODIFIER',
  FINAL_MODIFIER = 'FINAL_MODIFIER',
  STRICTFP_MODIFIER = 'STRICTFP_MODIFIER',
  STATIC_MODIFIER = 'STATIC_MODIFIER',
  SEALED_MODIFIER = 'SEALED_MODIFIER',
  NON_SEALED_MODIFIER = 'NON_SEALED_MODIFIER',
  DEPRECATED_MODIFIER = 'DEPRECATED_MODIFIER',
}
