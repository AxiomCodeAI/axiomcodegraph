/**
 * ### Supported Access Levels:
 * - **PUBLIC_ACCESS** - Type is accessible from any package (`public` modifier)
 * - **PROTECTED_ACCESS** - Type is accessible within package and subclasses (`protected` modifier)
 * - **PRIVATE_ACCESS** - Type is accessible only within enclosing class (`private` modifier)
 * - **PACKAGE_ACCESS** - Type is accessible only within same package (no explicit modifier)
 *
 * ### Java Language Rules Applied:
 * - Top-level types can only be `public` or package-private (default)
 * - Nested types can have any access modifier (`public`, `protected`, `private`, or package-private)
 * - Local types (inside methods) cannot have explicit access modifiers
 * - When no explicit modifier is present, package-private access is assumed
 *
 * ### Examples:
 * ```java
 * // PUBLIC_ACCESS - Accessible from any microservice
 * public class PaymentProcessor {}
 * public interface PaymentGateway {}
 * public enum PaymentStatus {}
 * public record PaymentRequest() {}
 *
 * // PACKAGE_ACCESS (default) - Internal to microservice
 * class InternalPaymentValidator {}
 * interface InternalAuditLogger {}
 * enum InternalErrorCode {}
 * record InternalTransactionData() {}
 *
 * // Nested types with various access levels
 * public class PaymentService {
 *     public static class PublicPaymentResult {}    // PUBLIC_ACCESS - External API
 *     protected class ProtectedPaymentCache {}      // PROTECTED_ACCESS - Subclass access
 *     private enum PrivatePaymentState {}           // PRIVATE_ACCESS - Internal only
 *     static record InternalPaymentLog() {}         // PACKAGE_ACCESS - Service internal
 * }
 *
 * // Local types (treated as package access for analysis)
 * public class PaymentController {
 *     void processPayment() {
 *         class LocalPaymentValidator {}            // Analyzed as PACKAGE_ACCESS
 *         record LocalPaymentData() {}              // Analyzed as PACKAGE_ACCESS
 *     }
 * }
 * ```
 */
export enum TypeAccess {
  PUBLIC_ACCESS = 'PUBLIC_ACCESS',
  PROTECTED_ACCESS = 'PROTECTED_ACCESS',
  PRIVATE_ACCESS = 'PRIVATE_ACCESS',
  PACKAGE_ACCESS = 'PACKAGE_ACCESS',
}
