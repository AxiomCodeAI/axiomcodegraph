package com.axiomcode.test.methods;

import java.io.Serializable;

/**
 * Acceptance fixture for the members JLS 8.10 declares implicitly on a record.
 *
 * The oracle for every assertion here is javac: compile this file and run
 * `javap -p`, and the member set below is what it reports (minus ACC_SYNTHETIC
 * and ACC_BRIDGE entries, which are class-file artifacts rather than declared
 * members and are deliberately NOT extracted).
 */
public class RecordImplicitMembers {

    /**
     * The plain case. javac declares, and the extractor must emit:
     *   private final int x;              private final int y;
     *   public Point(int, int);           <- canonical constructor
     *   public int x();                   public int y();          <- accessors
     *   public String toString();         public int hashCode();
     *   public boolean equals(Object);
     * Nothing here has a declaration node in the source.
     */
    public record Point(int x, int y) {
    }

    /**
     * Type variables reach the accessor return type: first() returns A, not Object.
     */
    public record Pair<A extends Serializable, B>(A first, B second) {
    }

    /**
     * A varargs component. The component's type - and so the field type and the
     * accessor return type - is the array type int[], while the canonical
     * constructor keeps the varargs parameter.
     */
    public record Args(String name, int... values) {
    }

    /**
     * A record may declare any implicit member itself, and javac then declares
     * nothing. x() and toString() below are declared, so only y(), equals and
     * hashCode are implicit - and x()/toString() keep INSTANCE_METHOD, because
     * a person wrote them.
     */
    public record Custom(int x, int y) {
        @Override
        public int x() {
            return x < 0 ? 0 : x;
        }

        @Override
        public String toString() {
            return "Custom[" + x + "," + y + "]";
        }
    }

    /**
     * A record with no components has no accessors and no component fields, but
     * still has equals/hashCode/toString and a no-argument canonical constructor.
     */
    public record Empty() {
    }
}
