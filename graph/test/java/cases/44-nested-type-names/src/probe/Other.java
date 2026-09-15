package probe;

/** The colliding simple name: a second nested Builder in the same package. */
public class Other {
    public static class Builder {
        static Builder create() { return new Builder(); }
        Other build() { return new Other(); }
    }
}
