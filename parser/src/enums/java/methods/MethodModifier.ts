/**
 * ### Supported Method Modifiers:
 * - **STATIC_MODIFIER** - Method belongs to the class, not instances (`static`)
 * - **ABSTRACT_MODIFIER** - Method has no implementation (`abstract`)
 * - **FINAL_MODIFIER** - Method cannot be overridden in subclasses (`final`)
 * - **SYNCHRONIZED_MODIFIER** - Method has synchronized access (`synchronized`)
 * - **NATIVE_MODIFIER** - Method implemented in native code (`native`)
 * - **STRICTFP_MODIFIER** - Method uses strict floating-point semantics (`strictfp`)
 * - **DEFAULT_MODIFIER** - Interface default method with implementation (`default`, Java 8+)
 *
 * ### Key Differences from TypeModifier:
 * - **Method-only:** SYNCHRONIZED, NATIVE, DEFAULT
 * - **Type-only:** SEALED, NON_SEALED, TRANSIENT
 * - **Shared:** STATIC, ABSTRACT, FINAL, STRICTFP
 *
 * ### Usage Notes:
 * - Methods can have multiple modifiers (stored as comma-separated string in MethodRegistry)
 * - Some combinations are illegal (e.g., `abstract final`, `abstract native`)
 * - Access modifiers (public, private, etc.) are stored separately in MethodAccess enum
 * - Interface methods have implicit modifiers (abstract for methods without bodies, public for all)
 *
 * ### Examples:
 * ```java
 * // STATIC_MODIFIER
 * public static void main(String[] args) {}
 * public static final int calculate(int x) {}  // STATIC + FINAL
 *
 * // ABSTRACT_MODIFIER (explicit in abstract classes)
 * public abstract void draw();
 * abstract void process();  // In abstract classes - explicit abstract keyword
 *
 * // FINAL_MODIFIER
 * public final void validate() {}  // Cannot be overridden
 * protected final String format() {}
 *
 * // SYNCHRONIZED_MODIFIER
 * public synchronized void increment() {}
 * private synchronized static void reset() {}  // SYNCHRONIZED + STATIC
 *
 * // NATIVE_MODIFIER
 * public native void nativeOperation();
 * private static native String getNativeVersion();  // NATIVE + STATIC
 *
 * // STRICTFP_MODIFIER
 * public strictfp double calculate(double x) {}
 * private strictfp static void compute() {}  // STRICTFP + STATIC
 *
 * // DEFAULT_MODIFIER (Java 8+ interface default methods)
 * public interface Logger {
 *     default void log(String msg) {  // DEFAULT
 *         System.out.println(msg);
 *     }
 * }
 *
 * // Multiple modifiers combined
 * public static final synchronized void criticalSection() {}
 * // Stored as: "STATIC_MODIFIER,FINAL_MODIFIER,SYNCHRONIZED_MODIFIER"
 * ```
 */
export enum MethodModifier {
  STATIC_MODIFIER = 'STATIC_MODIFIER',
  ABSTRACT_MODIFIER = 'ABSTRACT_MODIFIER',
  FINAL_MODIFIER = 'FINAL_MODIFIER',
  SYNCHRONIZED_MODIFIER = 'SYNCHRONIZED_MODIFIER',
  NATIVE_MODIFIER = 'NATIVE_MODIFIER',
  STRICTFP_MODIFIER = 'STRICTFP_MODIFIER',
  DEFAULT_MODIFIER = 'DEFAULT_MODIFIER',
}
