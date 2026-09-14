package dep;

/** Stands in for a dependency: a three-level hierarchy that declares an OVERLOAD SET. */
public abstract class Sink {
    public void write(String s) { }          // the applicable target for a String argument
    public void write(char[] c) { }          // a sibling overload, same arity
    public void write(String s, int off) { }
}
