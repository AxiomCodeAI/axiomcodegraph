package java.lang;

/** Staged so that `java.lang.Object` is a known type: phase-1 applicability of an Object parameter
 *  is decided by recognising it as the universal supertype, and with no library at all the suite
 *  cannot, so the varargs shape below would not discriminate. */
public class Object {
    public boolean equals(Object o) { return this == o; }
    public String toString() { return ""; }
}
