package java.lang;

/** Reached only THROUGH getClass(): if that call resolves to nothing, so does everything chained
 *  onto it, which is how one unresolved member costs more than one edge. */
public class Class {
    public String getName() { return ""; }
    public String getSimpleName() { return ""; }
}
