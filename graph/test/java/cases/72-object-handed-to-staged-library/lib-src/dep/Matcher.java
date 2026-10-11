package dep;

/** A dependency-declared callback interface: the dependency calls matches(). */
public interface Matcher<T> {
    boolean matches(T value);
}
