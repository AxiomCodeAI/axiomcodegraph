package dep;

/** A LIBRARY record. Its accessors are component-named, and hand-written members sit beside them. */
public record Point(int x, int y) {
    public String describe() {
        return x + ":" + y;
    }
}
