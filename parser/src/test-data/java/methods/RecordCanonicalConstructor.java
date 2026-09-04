package com.axiomcode.test.methods;

/**
 * Acceptance fixture for JLS 8.10.4: a record has EXACTLY ONE canonical
 * constructor, and it is implicitly declared only when the record declares
 * neither an explicit canonical constructor nor a compact one.
 *
 * Every record below has exactly one constructor per `javap -p`, except
 * Delegating, which has two.
 */
public class RecordCanonicalConstructor {

    /** Declares nothing: the canonical constructor is implicit. */
    public record Implicit(int x, int y) {
    }

    /**
     * A compact constructor IS the canonical constructor - not a second one.
     * Its parameters are the record's components, so its signature is
     * Compact(int,int), never Compact().
     */
    public record Compact(int x, int y) {
        public Compact {
            if (x < 0) {
                throw new IllegalArgumentException("x");
            }
        }
    }

    /**
     * An explicit canonical constructor. What makes it canonical is that its
     * parameter TYPES match the component types in order, which is what the
     * extractor tests. javac additionally requires the parameter NAMES to match
     * the component names in this non-compact form, so they do here.
     */
    public record Explicit(String name, int code) {
        public Explicit(String name, int code) {
            this.name = name;
            this.code = code;
        }
    }

    /**
     * A canonical constructor plus a genuine second constructor that delegates
     * to it. The delegating one is NOT canonical - its parameter types differ -
     * so this record really does have two constructors, and both are emitted.
     */
    public record Delegating(int x, int y) {
        public Delegating(int both) {
            this(both, both);
        }
    }
}
