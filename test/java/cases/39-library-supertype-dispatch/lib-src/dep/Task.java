package dep;

/** A dependency-declared ABSTRACT CLASS — the same question with a superclass instead of an
 *  interface, because the fan is built from the declaring hierarchy either way. */
public abstract class Task {
    public abstract String run();
}
