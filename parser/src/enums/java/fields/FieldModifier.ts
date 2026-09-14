/**
 * Field-specific modifiers in Java.
 * 
 * These modifiers apply specifically to field declarations and control
 * various aspects of field behavior including memory visibility, serialization,
 * and mutability.
 * 
 * ## Modifier Descriptions
 * 
 * - **STATIC** - Field belongs to the class rather than instances
 * - **FINAL** - Field value cannot be changed after initialization
 * - **VOLATILE** - Field reads/writes go directly to main memory (thread visibility)
 * - **TRANSIENT** - Field is excluded from serialization
 * 
 * ## Modifier Combinations
 * 
 * Some combinations are legal, others are not:
 * 
 * ### Legal Combinations:
 * ```java
 * private static final String CONSTANT = "value";  // static + final
 * private static volatile boolean flag;            // static + volatile
 * private static transient Logger logger;          // static + transient
 * private final transient InputStream stream;      // final + transient
 * private volatile transient int cached;           // volatile + transient
 * ```
 * 
 * ### Illegal Combinations:
 * ```java
 * private final volatile int x;  // ILLEGAL: final + volatile
 * ```
 * 
 * ## Examples
 * 
 * ```java
 * // STATIC - Class-level field
 * private static int instanceCount;
 * public static final String VERSION = "1.0";
 * 
 * // FINAL - Immutable after initialization
 * private final String id;
 * private final List<String> items;
 * 
 * // VOLATILE - Memory visibility for concurrent access
 * private volatile boolean running;
 * private volatile int counter;
 * 
 * // TRANSIENT - Excluded from serialization
 * private transient Connection connection;
 * private transient Thread workerThread;
 * ```
 * 
 * @remarks These modifiers are combined with access modifiers (public, private, etc.)
 *          to fully describe field visibility and behavior.
 */
export enum FieldModifier {
  /** Field belongs to the class, not instances. */
  STATIC = 'STATIC',
  
  /** Field value cannot be changed after initialization. */
  FINAL = 'FINAL',
  
  /** Field reads/writes bypass CPU cache for thread visibility. */
  VOLATILE = 'VOLATILE',
  
  /** Field is excluded from Java serialization. */
  TRANSIENT = 'TRANSIENT',
}
