/**
 * Specifies the variance constraint for bounded type references.
 *
 * This enumeration captures the bound relationships supported by Java's generic
 * type system, enabling precise representation of variance relationships in:
 * - **Wildcard type arguments** (`? extends T`, `? super T`)
 * - **Type parameter bounds** (`<U extends T>` in method/class declarations)
 *
 * ## Variance Forms
 *
 * - **UNBOUNDED** – No constraint, accepts any type (`List<?>`)
 * - **EXTENDS** – Upper bound constraint (`? extends Number`, `<T extends Number>`)
 * - **SUPER** – Lower bound constraint (`? super Integer`)
 *
 * ## Examples
 *
 * ```java
 * // WILDCARD with UNBOUNDED - can read Object, cannot write safely
 * List<?> unknownList = Arrays.asList("hello", 123, true);
 *
 * // WILDCARD with EXTENDS - upper bounded wildcard
 * List<? extends Number> numbers = Arrays.asList(1, 2.5, 3L);
 *
 * // WILDCARD with SUPER - lower bounded wildcard
 * List<? super Integer> integers = new ArrayList<Number>();
 *
 * // TYPE_VARIABLE with EXTENDS - type parameter bound
 * public <U extends T> Map<U, String> transform(List<U> items) { }
 * // Here T is extracted as TYPE_VARIABLE with EXTENDS variance
 *
 * // Complex nesting with type variables
 * Map<String, ? extends Collection<? super T>> complexMap;
 * ```
 *
 * ## Implementation Notes
 *
 * - **Bound Representation:** The bound type (if any) creates a child TypeReference entry
 * - **Nesting Support:** Wildcards can contain other wildcards or type variables
 * - **Context Independence:** Same variance rules apply across all TypeRefContext values
 *
 * @remarks Applicable when TypeRefKind is WILDCARD or when a TYPE_VARIABLE/CLASS
 *          appears in a TYPE_PARAM_BOUND or METHOD_TYPE_PARAM_BOUND context.
 *          For bounded types, the bound appears as a child entry with
 *          parentRefHash pointing to the parent entry.
 *
 * @see TypeRefKind
 * @see TypeRefContext
 */
export enum WildcardVariance {
  /** Unbounded wildcard with no constraints (?). */
  UNBOUNDED = 'UNBOUNDED',

  /** Upper-bounded wildcard (? extends Type). */
  EXTENDS = 'EXTENDS',

  /** Lower-bounded wildcard (? super Type). */
  SUPER = 'SUPER',
}
