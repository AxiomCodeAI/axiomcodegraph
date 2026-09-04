package java.lang;

/**
 * The stub library for this case IS java.lang.Object — the one supertype no source file ever
 * writes down. A real run stages the platform IR, where this class is present with these members;
 * here it stands in for that, so the case needs no 2 GB library to pin the rule.
 */
public class Object {
    public final Class getClass() { return null; }
    public int hashCode() { return 0; }
    public boolean equals(Object obj) { return this == obj; }
    public String toString() { return ""; }
    public final void notifyAll() { }
    protected Object clone() { return this; }
}
