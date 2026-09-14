package fn;

/** A library functional interface with a one-parameter SAM. */
public interface Fn<T, R> {
    R apply(T t);
}
